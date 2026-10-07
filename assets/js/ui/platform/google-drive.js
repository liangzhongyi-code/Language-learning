/**
 * Google Drive appDataFolder 手動多份備份 adapter。
 * 每次備份都 POST 一個新的不可變檔案（新 exportId），從不 PATCH／DELETE 既有快照。
 * 所有請求都經由 auth.authorizedFetch 送往固定端點，並以 generation 守衛丟棄晚到結果。
 * 下載只回傳固定 bytes 的文字給呼叫端預覽，不直接寫入任何學習資料。
 */
import { BACKUP_JSON_MAX_BYTES } from '../../core/backup-limits.js';
import { BACKUP_FORMAT } from '../../core/backup.js';
import { LearningError } from '../../core/learning-errors.js';
import { googleError } from './google-web-auth.js';

export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

const FILE_FIELDS = 'id,name,createdTime,size,appProperties';
const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;
const FILE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const EXPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE_TOKEN = /^[\x21-\x7e]{1,4096}$/;
const DIGITS = /^\d{1,16}$/;
const MAX_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * 清單、查詢與上傳回應只是中繼資料，上限遠小於備份本體；錯誤回應只讀前 64 KiB 判斷原因。
 */
const METADATA_MAX_BYTES = 2 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 64 * 1024;

/**
 * Drive appProperties 每組 key＋value 上限 124 bytes；deviceLabel 另限 40 字只供辨識。
 */
const LABEL_MAX_CHARS = 40;
const LABEL_MAX_BYTES = 124 - 'deviceLabel'.length;
const FALLBACK_LABEL = '未命名裝置';

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED']);
const QUOTA_REASONS = new Set(['storageQuotaExceeded']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'insufficientScopes', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
const UNKNOWN_OUTCOME = new Set(['GOOGLE_OFFLINE', 'GOOGLE_TIMEOUT']);

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).byteLength;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function randomHex(bytes, getRandomValues) {
  const buffer = new Uint8Array(bytes);
  const fill = getRandomValues ?? globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (fill) fill(buffer);
  else for (let i = 0; i < bytes; i += 1) buffer[i] = Math.floor(Math.random() * 256);
  return Array.from(buffer, value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * 產生新的匯出識別碼：時間（base36）＋ 128 bits 亂數，只含查詢安全字元。
 */
export function newExportId({ getRandomValues, now = Date.now() } = {}) {
  return `${Math.max(0, Math.floor(now)).toString(36)}-${randomHex(16, getRandomValues)}`;
}

/**
 * 裝置標籤只供辨識：去除控制與格式字元、合併空白、最長 40 字，且符合 appProperties 位元組上限。
 */
export function sanitizeDeviceLabel(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned).slice(0, LABEL_MAX_CHARS);
  while (chars.length && byteLength(chars.join('')) > LABEL_MAX_BYTES) chars.pop();
  return chars.join('').trim();
}

function invalid(message) {
  return googleError('INVALID_BACKUP', {}, message);
}

/**
 * 把 Drive 檔案中繼資料轉成固定形狀；id 不合法者直接略過，不讓它進入後續下載。
 */
function toSnapshot(file) {
  if (!isObject(file) || typeof file.id !== 'string' || !FILE_ID.test(file.id)) return null;
  const props = isObject(file.appProperties) ? file.appProperties : {};
  const text = (value) => (typeof value === 'string' ? value : '');
  const number = (value) => (DIGITS.test(text(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null);
  const schemaVersion = number(props.schemaVersion);
  return {
    id: file.id,
    name: text(file.name).slice(0, 200),
    createdTime: typeof file.createdTime === 'string' ? file.createdTime.slice(0, 64) : null,
    size: number(file.size),
    exportId: EXPORT_ID.test(text(props.exportId)) ? props.exportId : null,
    schemaVersion: schemaVersion !== null && schemaVersion >= 1 ? schemaVersion : null,
    exportedAt: number(props.exportedAt),
    deviceLabel: sanitizeDeviceLabel(props.deviceLabel),
  };
}

function snapshotName(exportedAt, exportId) {
  const stamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return `lang-learn-backup-${stamp}-${exportId}.json`;
}

function collectReasons(body) {
  const error = isObject(body?.error) ? body.error : {};
  const list = [];
  for (const item of Array.isArray(error.errors) ? error.errors : []) list.push(item?.reason);
  for (const item of Array.isArray(error.details) ? error.details : []) list.push(item?.reason);
  list.push(error.status);
  return list.filter(value => typeof value === 'string' && /^[A-Za-z_]{1,64}$/.test(value));
}

/**
 * 建立 Drive adapter；auth 需提供 authorizedFetch 與 currentGeneration。
 */
export function createGoogleDrive({
  auth, timeoutMs = DEFAULT_TIMEOUT_MS, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, getRandomValues,
} = {}) {
  if (typeof auth?.authorizedFetch !== 'function' || typeof auth?.currentGeneration !== 'function') {
    throw new LearningError('INVALID_OPERATION', 'Google Drive adapter 需要授權 adapter。');
  }

  /**
   * 上傳結果未知的 exportId；再次備份同一份前必須先查詢，不盲目重送。
   */
  const unknownExports = new Set();

  function checkGeneration(gen, details) {
    if (auth.currentGeneration() !== gen) throw googleError('GOOGLE_STALE_SESSION', details);
  }

  function startTimer() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimer(() => controller.abort(), timeoutMs) : null;
    return { signal: controller?.signal, done: () => { if (timer !== null) clearTimer(timer); } };
  }

  async function call(url, init, gen) {
    checkGeneration(gen);
    const response = await auth.authorizedFetch(url, init);
    checkGeneration(gen);
    return response;
  }

  async function cancelBody(response) {
    try {
      await response?.body?.cancel?.();
    } catch {
      /* 取消失敗不影響錯誤結果 */
    }
  }

  /**
   * 邊讀邊累計 bytes，超過上限立刻取消串流；不先讀完整內容再檢查。
   * 沒有 body 時先以 Content-Length 擋下，再改用 text()。
   */
  async function readLimited(response, limit, gen, overCode) {
    const over = () => (overCode === 'BACKUP_SIZE_LIMIT' ? googleError('BACKUP_SIZE_LIMIT', { limit }) : googleError(overCode));
    const declared = Number(response.headers?.get?.('Content-Length'));
    if (Number.isFinite(declared) && declared > limit) {
      await cancelBody(response);
      throw over();
    }
    const networkError = (error) => {
      if (error instanceof LearningError) return error;
      return googleError(error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'GOOGLE_TIMEOUT' : 'GOOGLE_OFFLINE');
    };
    if (!response.body || typeof response.body.getReader !== 'function') {
      let text;
      try {
        text = await response.text();
      } catch (error) {
        throw networkError(error);
      }
      checkGeneration(gen);
      if (typeof text !== 'string') throw googleError('GOOGLE_INVALID_RESPONSE');
      const bytes = encoder.encode(text);
      if (bytes.byteLength > limit) throw over();
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (auth.currentGeneration() !== gen) {
          await reader.cancel().catch(() => {});
          throw googleError('GOOGLE_STALE_SESSION');
        }
        if (!(value instanceof Uint8Array)) {
          await reader.cancel().catch(() => {});
          throw googleError('GOOGLE_INVALID_RESPONSE');
        }
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          throw over();
        }
        chunks.push(value);
      }
    } catch (error) {
      throw networkError(error);
    } finally {
      try { reader.releaseLock(); } catch { /* 已釋放 */ }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  /**
   * 依 HTTP 狀態與 Google reason 對應固定 code；不帶入伺服器訊息原文。
   */
  async function httpError(response) {
    const status = response.status;
    let reasons = [];
    try {
      const bytes = await readLimited(response, ERROR_BODY_MAX_BYTES, auth.currentGeneration(), 'GOOGLE_INVALID_RESPONSE');
      reasons = collectReasons(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      await cancelBody(response);
    }
    const has = (set) => reasons.some(reason => set.has(reason));
    const details = { status };
    const reason = reasons.find(item => item !== 'PERMISSION_DENIED') ?? reasons[0];
    if (reason) details.reason = reason;
    if (status === 401) return googleError('GOOGLE_AUTH_EXPIRED', details);
    if (status === 429 || (status === 403 && has(RATE_REASONS))) {
      const retryAfter = Number(response.headers?.get?.('Retry-After'));
      if (Number.isInteger(retryAfter) && retryAfter >= 0 && retryAfter <= 86400) details.retryAfterSeconds = retryAfter;
      return googleError('GOOGLE_RATE_LIMITED', details);
    }
    if (status === 403 && has(QUOTA_REASONS)) return googleError('GOOGLE_QUOTA', details);
    if (status === 403 && has(SCOPE_REASONS)) return googleError('GOOGLE_SCOPE_MISSING', details);
    if (status === 403) return googleError('GOOGLE_FORBIDDEN', details);
    if (status === 404) return googleError('GOOGLE_NOT_FOUND', details);
    if (status === 400) return googleError('GOOGLE_BAD_REQUEST', details);
    if (status >= 500) return googleError('GOOGLE_SERVER_ERROR', details);
    return googleError('GOOGLE_HTTP_ERROR', details);
  }

  async function parseJson(response, gen) {
    const bytes = await readLimited(response, METADATA_MAX_BYTES, gen, 'GOOGLE_INVALID_RESPONSE');
    checkGeneration(gen);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw googleError('GOOGLE_INVALID_RESPONSE');
    }
  }

  async function getJson(url, gen) {
    const timer = startTimer();
    try {
      const response = await call(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: timer.signal }, gen);
      if (!response.ok) throw await httpError(response);
      return await parseJson(response, gen);
    } finally {
      timer.done();
    }
  }

  function listParams(pageSize) {
    return new URLSearchParams({
      spaces: 'appDataFolder',
      orderBy: 'createdTime desc',
      pageSize: String(pageSize),
      fields: LIST_FIELDS,
    });
  }

  /**
   * 列出 appDataFolder 中的快照，一次一頁；下一頁由呼叫端帶 nextPageToken 按需取得。
   */
  async function listSnapshots({ pageToken, pageSize = MAX_PAGE_SIZE } = {}) {
    const gen = auth.currentGeneration();
    if (pageToken != null && (typeof pageToken !== 'string' || !PAGE_TOKEN.test(pageToken))) {
      throw googleError('INVALID_OPERATION', {}, '雲端備份清單的頁碼不正確，請重新整理清單。');
    }
    const size = Number.isInteger(pageSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize)) : MAX_PAGE_SIZE;
    const params = listParams(size);
    if (pageToken) params.set('pageToken', pageToken);
    const body = await getJson(`${DRIVE_FILES_URL}?${params}`, gen);
    const files = Array.isArray(body?.files) ? body.files : [];
    const next = typeof body?.nextPageToken === 'string' && PAGE_TOKEN.test(body.nextPageToken) ? body.nextPageToken : null;
    return { snapshots: files.map(toSnapshot).filter(Boolean), nextPageToken: next };
  }

  async function findAt(exportId, gen) {
    if (typeof exportId !== 'string' || !EXPORT_ID.test(exportId)) throw invalid('備份識別碼不正確，已停止查詢。');
    const params = listParams(MAX_PAGE_SIZE);
    params.set('q', `appProperties has { key='exportId' and value='${exportId}' }`);
    const body = await getJson(`${DRIVE_FILES_URL}?${params}`, gen);
    const files = Array.isArray(body?.files) ? body.files : [];
    return files.map(toSnapshot).filter(snapshot => snapshot && snapshot.exportId === exportId);
  }

  /**
   * 以 exportId 查詢雲端是否已有同一次匯出；可能有多份重複，全部列出供辨識。
   */
  function findByExportId(exportId) {
    return findAt(exportId, auth.currentGeneration());
  }

  function validateUpload({ text, exportId, schemaVersion, exportedAt }) {
    if (typeof exportId !== 'string' || !EXPORT_ID.test(exportId)) throw invalid('備份識別碼不正確，已停止上傳。');
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw invalid('備份版本不正確，已停止上傳。');
    if (!Number.isSafeInteger(exportedAt) || exportedAt < 0 || exportedAt > 8640000000000000) {
      throw invalid('備份匯出時間不正確，已停止上傳。');
    }
    if (typeof text !== 'string' || text === '') throw invalid('備份內容是空的，已停止上傳。');
    if (byteLength(text) > BACKUP_JSON_MAX_BYTES) throw googleError('BACKUP_SIZE_LIMIT', { limit: BACKUP_JSON_MAX_BYTES });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalid('備份內容不是有效的 JSON，已停止上傳。');
    }
    if (!isObject(parsed) || parsed.format !== BACKUP_FORMAT) throw invalid('這不是本網站的備份格式，已停止上傳。');
  }

  function multipartBody(metadata, text) {
    const meta = JSON.stringify(metadata);
    let boundary = '';
    for (let i = 0; i < 8; i += 1) {
      boundary = `lang_learn_${randomHex(16, getRandomValues)}`;
      if (!text.includes(boundary) && !meta.includes(boundary)) break;
    }
    const part = 'Content-Type: application/json; charset=UTF-8';
    const body = `--${boundary}\r\n${part}\r\n\r\n${meta}\r\n--${boundary}\r\n${part}\r\n\r\n${text}\r\n--${boundary}--`;
    return { boundary, body };
  }

  function unknown(exportId) {
    unknownExports.add(exportId);
    return { status: 'unknown', exportId };
  }

  /**
   * 建立一份新的不可變快照。回傳：
   * - { status: 'created', exportId, snapshot }：伺服器確認建立。
   * - { status: 'exists', exportId, snapshot, matches }：先前結果未知，查詢後確認已存在，未重送。
   * - { status: 'unknown', exportId }：逾時、離線或 5xx，檔案可能已建立；下次同 exportId 會先查詢。
   * 確定失敗（4xx、401、大小、格式）一律拋 LearningError，本機與既有雲端份都不變動。
   */
  async function uploadSnapshot(args = {}) {
    const { text, exportId, schemaVersion, exportedAt, deviceLabel, checkExisting = false } = args ?? {};
    validateUpload({ text, exportId, schemaVersion, exportedAt });
    const gen = auth.currentGeneration();
    if (checkExisting === true || unknownExports.has(exportId)) {
      const found = await findAt(exportId, gen);
      if (found.length) {
        unknownExports.delete(exportId);
        return { status: 'exists', exportId, snapshot: found[0], matches: found.length };
      }
    }
    const metadata = {
      name: snapshotName(exportedAt, exportId),
      mimeType: 'application/json',
      parents: ['appDataFolder'],
      appProperties: {
        exportId,
        schemaVersion: String(schemaVersion),
        exportedAt: String(exportedAt),
        deviceLabel: sanitizeDeviceLabel(deviceLabel) || FALLBACK_LABEL,
      },
    };
    const { boundary, body } = multipartBody(metadata, text);
    const sentStale = { exportId, outcome: 'unknown' };
    checkGeneration(gen);
    const timer = startTimer();
    try {
      let response;
      try {
        response = await call(`${DRIVE_UPLOAD_URL}&fields=${encodeURIComponent(FILE_FIELDS)}`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, Accept: 'application/json' },
          body,
          signal: timer.signal,
        }, gen);
      } catch (error) {
        if (UNKNOWN_OUTCOME.has(error?.code)) return unknown(exportId);
        if (error?.code === 'GOOGLE_STALE_SESSION') {
          unknownExports.add(exportId);
          throw googleError('GOOGLE_STALE_SESSION', sentStale);
        }
        throw error;
      }
      if (!response.ok) {
        if (response.status >= 500) {
          await cancelBody(response);
          return unknown(exportId);
        }
        throw await httpError(response);
      }
      let created;
      try {
        created = toSnapshot(await parseJson(response, gen));
      } catch (error) {
        if (error?.code === 'GOOGLE_STALE_SESSION') {
          unknownExports.add(exportId);
          throw googleError('GOOGLE_STALE_SESSION', sentStale);
        }
        return unknown(exportId);
      }
      if (!created || created.exportId !== exportId) return unknown(exportId);
      unknownExports.delete(exportId);
      return { status: 'created', exportId, snapshot: created };
    } finally {
      timer.done();
    }
  }

  /**
   * 下載指定快照的固定 bytes 文字；只接受 Drive 檔案 id，不接受任意 URL。
   * 呼叫端應把 text 交給 restore-controller.preview(() => text) 走共用深驗證，不直接寫入。
   */
  async function downloadSnapshot(fileId) {
    if (typeof fileId !== 'string' || !FILE_ID.test(fileId)) throw googleError('GOOGLE_INVALID_FILE_ID');
    const gen = auth.currentGeneration();
    const timer = startTimer();
    try {
      const response = await call(`${DRIVE_FILES_URL}/${fileId}?alt=media`, { method: 'GET', signal: timer.signal }, gen);
      if (!response.ok) throw await httpError(response);
      const bytes = await readLimited(response, BACKUP_JSON_MAX_BYTES, gen, 'BACKUP_SIZE_LIMIT');
      checkGeneration(gen);
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw invalid('下載的備份不是有效的 UTF-8 文字，沒有動任何資料。');
      }
      return { fileId, text, byteLength: bytes.byteLength };
    } finally {
      timer.done();
    }
  }

  return { listSnapshots, findByExportId, uploadSnapshot, downloadSnapshot };
}
