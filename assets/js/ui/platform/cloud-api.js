/**
 * 同網域雲端 API 的 adapter：/api/me、快照 meta、下載與條件式上傳。
 *
 * 一律以同源 fetch 送出、帶 same-origin cookie；不經手任何 token。
 * 所有失敗都轉成 CloudApiError（穩定的 code），呼叫端只依 code 分支，訊息只供顯示。
 * 上傳若沒收到回應（網路中斷、逾時、5xx），標記 outcomeUnknown，交由執行器先查 meta 再決定（C10）。
 * 雲端只在 Workers 根網域啟用，因此路徑直接寫成 /api/... 絕對路徑。
 */
import { BACKUP_JSON_MAX_BYTES } from '../../core/backup-limits.js';

/**
 * 壓縮後快照的大小上限（8 MiB），與伺服器的 413 上限相同（C11）。
 */
export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 60000;
const JSON_MAX_BYTES = 256 * 1024;
const GZIP_CHUNK_CHARS = 64 * 1024;

const MESSAGES = {
  UNAUTHENTICATED: '登入已失效，請重新登入。',
  FORBIDDEN: '這個帳號目前沒有使用雲端同步的權限。',
  NOT_FOUND: '雲端還沒有學習紀錄。',
  REVISION_MISMATCH: '雲端紀錄已被其他裝置更新。',
  TOO_LARGE: '紀錄太大，無法同步；請改用備份檔。',
  RATE_LIMITED: '同步太頻繁，稍後會自動再試。',
  SERVER: '雲端暫時無法使用，稍後會自動再試。',
  NETWORK: '目前連不上雲端，稍後會自動再試。',
  TIMEOUT: '連線逾時，稍後會自動再試。',
  BAD_RESPONSE: '雲端回應格式不正確，沒有動任何資料。',
  CORRUPT_SNAPSHOT: '雲端紀錄無法解壓或已損壞，沒有動任何資料。',
  INVALID_REQUEST: '同步請求的參數不正確。',
};

/**
 * 雲端 API 的錯誤。code 為穩定錯誤碼；status 為 HTTP 狀態（若有）；
 * retryAfterMs 來自 429 的 Retry-After；current 是 409 附帶的雲端 meta；
 * outcomeUnknown 表示上傳可能已被伺服器接受；limitBytes 為大小上限。
 */
export class CloudApiError extends Error {
  constructor(code, message = MESSAGES[code] || '雲端同步失敗。', { status = null, retryAfterMs = null, current = null, outcomeUnknown = false, limitBytes = null } = {}) {
    super(message);
    this.name = 'CloudApiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.current = current;
    this.outcomeUnknown = outcomeUnknown === true;
    this.limitBytes = limitBytes;
  }
}

const failure = (code, details) => new CloudApiError(code, MESSAGES[code], details);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRevision = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * Retry-After 可能是秒數或 HTTP 日期；回傳毫秒（過去的日期視為 0），無法解析回傳 null。
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{1,9}$/.test(text)) return Number(text) * 1000;
  if (!/[A-Za-z]/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/**
 * 讀完串流並在超過上限時立刻取消；回傳合併後的 bytes。
 */
async function drain(stream, maxBytes, tooLarge) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/**
 * 以 CompressionStream 串流壓縮文字：分段寫入、同時讀出；壓縮後超過 maxBytes 立即停止並丟出 TOO_LARGE（C11）。
 */
export async function gzipText(text, { maxBytes = SNAPSHOT_MAX_BYTES, chunkChars = GZIP_CHUNK_CHARS } = {}) {
  if (typeof CompressionStream !== 'function') throw failure('INVALID_REQUEST');
  const source = String(text);
  const transform = new CompressionStream('gzip');
  const writer = transform.writable.getWriter();
  const encoder = new TextEncoder();
  let stopped = false;
  const writing = (async () => {
    try {
      for (let start = 0; start < source.length && !stopped;) {
        let end = Math.min(start + chunkChars, source.length);
        const last = source.charCodeAt(end - 1);
        if (end < source.length && last >= 0xD800 && last <= 0xDBFF) end--;
        await writer.write(encoder.encode(source.slice(start, end)));
        start = end;
      }
      if (!stopped) await writer.close();
    } finally {
      writer.releaseLock();
    }
  })();
  writing.catch(() => {});
  try {
    const out = await drain(transform.readable, maxBytes, () => failure('TOO_LARGE', { limitBytes: maxBytes }));
    await writing;
    return out;
  } catch (error) {
    stopped = true;
    await writer.abort(error).catch(() => {});
    await writing.catch(() => {});
    throw error;
  }
}

/**
 * 解壓 gzip bytes（或串流）成 UTF-8 文字；解壓失敗或編碼錯誤丟出 CORRUPT_SNAPSHOT，超過上限丟出 TOO_LARGE。
 */
export async function gunzipText(input, { maxBytes = BACKUP_JSON_MAX_BYTES } = {}) {
  let bytes;
  try {
    const stream = input instanceof Uint8Array ? new Blob([input]).stream() : input;
    bytes = await drain(stream.pipeThrough(new DecompressionStream('gzip')), maxBytes, () => failure('TOO_LARGE', { limitBytes: maxBytes }));
  } catch (error) {
    if (error instanceof CloudApiError) throw error;
    throw failure('CORRUPT_SNAPSHOT');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw failure('CORRUPT_SNAPSHOT');
  }
}

/**
 * 裝置標籤可能含中文；HTTP 標頭只能放 ASCII，因此以 encodeURIComponent 編碼並限制長度。
 */
function encodeLabel(label) {
  const text = typeof label === 'string' ? label.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '';
  return encodeURIComponent(Array.from(text).slice(0, 40).join(''));
}

/**
 * 建立雲端 API；fetch、時間與計時器都可注入。
 */
export function createCloudApi({
  fetch: fetchImpl = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null,
  now = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (id) => globalThis.clearTimeout(id),
} = {}) {
  /**
   * 送出請求並在逾時時中止；read(response) 也在同一個逾時範圍內執行。
   * unknownOnFailure 只用於上傳：沒收到明確回應時，請求可能已被伺服器接受。
   */
  async function request(method, path, { headers = {}, body, unknownOnFailure = false, read } = {}) {
    if (typeof fetchImpl !== 'function') throw failure('NETWORK');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimer(() => { timedOut = true; controller?.abort(); }, timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(path, { method, headers, body, credentials: 'same-origin', cache: 'no-store', signal: controller?.signal });
      } catch {
        throw failure(timedOut ? 'TIMEOUT' : 'NETWORK', { outcomeUnknown: unknownOnFailure });
      }
      if (response.ok) {
        try {
          return await read(response);
        } catch (error) {
          if (error instanceof CloudApiError) throw error;
          throw failure(timedOut ? 'TIMEOUT' : 'BAD_RESPONSE', { outcomeUnknown: unknownOnFailure });
        }
      }
      throw await errorFrom(response, unknownOnFailure);
    } finally {
      clearTimer(timer);
    }
  }

  async function errorFrom(response, unknownOnFailure) {
    const status = response.status;
    if (status === 401) return failure('UNAUTHENTICATED', { status });
    if (status === 403) return failure('FORBIDDEN', { status });
    if (status === 404) return failure('NOT_FOUND', { status });
    if (status === 413) return failure('TOO_LARGE', { status, limitBytes: SNAPSHOT_MAX_BYTES });
    if (status === 429) return failure('RATE_LIMITED', { status, retryAfterMs: parseRetryAfter(response.headers.get('Retry-After'), now()) });
    if (status === 409) {
      const body = await readJson(response).catch(() => null);
      return failure('REVISION_MISMATCH', { status, current: isObject(body?.current) ? normalizeMeta(body.current, false) : null });
    }
    if (status >= 500) return failure('SERVER', { status, outcomeUnknown: unknownOnFailure });
    return failure('BAD_RESPONSE', { status });
  }

  async function readJson(response) {
    const bytes = response.body ? await drain(response.body, JSON_MAX_BYTES, () => failure('BAD_RESPONSE')) : new Uint8Array(await response.arrayBuffer());
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /**
   * 雲端 meta 正規化；strict 時 revision 不合法就視為壞回應。
   */
  function normalizeMeta(body, strict = true) {
    if (!isObject(body) || !isRevision(body.revision)) {
      if (strict) throw failure('BAD_RESPONSE');
      return null;
    }
    const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);
    const count = (value) => (isRevision(value) ? value : null);
    return { revision: body.revision, uploadId: text(body.uploadId, 128), schemaVersion: count(body.schemaVersion),
      byteSize: count(body.byteSize), deviceLabel: text(body.deviceLabel, 80) ?? '', updatedAt: count(body.updatedAt) };
  }

  return {
    /**
     * 目前登入者：{ accountId, email, role }；未登入（401）回傳 null，其他錯誤丟 CloudApiError。
     */
    async me() {
      try {
        return await request('GET', '/api/me', { read: async (response) => {
          const body = await readJson(response);
          if (!isObject(body) || typeof body.accountId !== 'string' || !body.accountId || typeof body.email !== 'string') throw failure('BAD_RESPONSE');
          return { accountId: body.accountId, email: body.email, role: typeof body.role === 'string' ? body.role : 'member' };
        } });
      } catch (error) {
        if (error?.code === 'UNAUTHENTICATED') return null;
        throw error;
      }
    },
    /**
     * 雲端快照 meta：{ revision, uploadId, schemaVersion, byteSize, deviceLabel, updatedAt }；沒有快照時 revision 為 0。
     */
    meta() {
      return request('GET', '/api/snapshot/meta', { read: async (response) => normalizeMeta(await readJson(response)) });
    },
    /**
     * 下載雲端快照並解壓：回傳 { text, revision }；text 交給 previewFrom 的 readText 走既有深驗證。
     */
    download() {
      return request('GET', '/api/snapshot', { read: async (response) => {
        const revision = Number(response.headers.get('X-Revision'));
        if (!/^\d{1,15}$/.test(response.headers.get('X-Revision') || '') || !isRevision(revision)) throw failure('BAD_RESPONSE');
        if (!response.body) throw failure('CORRUPT_SNAPSHOT');
        const compressed = await drain(response.body, SNAPSHOT_MAX_BYTES, () => failure('TOO_LARGE', { limitBytes: SNAPSHOT_MAX_BYTES }));
        return { text: await gunzipText(compressed), revision };
      } });
    },
    /**
     * 條件式上傳 gzip bytes：成功回傳 { revision }。
     * 409 丟 REVISION_MISMATCH（附 current）；網路中斷、逾時與 5xx 標記 outcomeUnknown。
     * X-Device-Label 以 encodeURIComponent 編碼（標頭只能放 ASCII）。
     */
    upload(bytes, { ifMatch, uploadId, schemaVersion, deviceLabel = '' } = {}) {
      if (!(bytes instanceof Uint8Array) || !isRevision(ifMatch) || typeof uploadId !== 'string'
          || !/^[A-Za-z0-9_-]{1,128}$/.test(uploadId) || !isRevision(schemaVersion)) {
        return Promise.reject(failure('INVALID_REQUEST'));
      }
      return request('PUT', '/api/snapshot', {
        unknownOnFailure: true, body: bytes,
        headers: { 'Content-Type': 'application/gzip', 'If-Match': String(ifMatch), 'X-Upload-Id': uploadId,
          'X-Schema-Version': String(schemaVersion), 'X-Device-Label': encodeLabel(deviceLabel) },
        read: async (response) => {
          const body = await readJson(response);
          if (!isObject(body) || !isRevision(body.revision)) throw failure('BAD_RESPONSE', { outcomeUnknown: true });
          return { revision: body.revision };
        },
      });
    },
    /**
     * 登出：POST /api/auth/logout（204）。
     */
    async logout() {
      await request('POST', '/api/auth/logout', { read: async () => undefined });
    },
    /**
     * 刪除雲端資料與帳號：DELETE /api/account（204）。
     */
    async deleteAccount() {
      await request('DELETE', '/api/account', { read: async () => undefined });
    },
  };
}
