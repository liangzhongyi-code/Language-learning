/**
 * 學習紀錄快照：meta、下載、條件式上傳，以及刪除帳號（design TD-5、TD-6）。
 * 所有查詢都以 session 推得的 user_id 為條件；X-Cloud-Account 只用來核對帳號。
 * 伺服器不解壓、不驗證 JSON（Worker 每次請求只有 10ms CPU），只複製 bytes。
 */
import { json, error, noContent } from './http.js';
import { requireMatchingAccount } from './access.js';
import { clearSessionCookie } from './session.js';
import { accessMode, nowSec } from './config.js';
import * as db from './db.js';

/**
 * 壓縮後的快照上限：8 MiB。
 */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

/**
 * 每個分塊的上限（D1 單列上限是 2,000,000 bytes）。
 */
export const CHUNK_BYTES = 1_900_000;

/**
 * 頻率上限：一小時內最多 60 次成功上傳。
 */
const RATE_WINDOW = 3600;
const RATE_LIMIT = 60;

/**
 * 裝置名稱的長度上限（字元）。
 */
const DEVICE_LABEL_MAX = 64;

/**
 * 把資料庫的 meta 列轉成 API 回應；沒有快照時回 {revision:0}。時間轉為毫秒。
 */
function toMeta(row) {
  if (!row) return { revision: 0 };
  return {
    revision: row.revision,
    uploadId: row.upload_id,
    schemaVersion: row.schema_version,
    byteSize: row.byte_size,
    deviceLabel: row.device_label,
    updatedAt: row.updated_at === null ? null : row.updated_at * 1000,
  };
}

/**
 * GET /api/snapshot/meta。
 */
export const handleMeta = requireMatchingAccount(async (request, env, ctx, url, { user }) =>
  json(toMeta(await db.findSnapshotMeta(env.DB, user.id))));

/**
 * D1 讀回的 BLOB 可能是數字陣列或 ArrayBuffer，統一轉成 Uint8Array。
 */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return Uint8Array.from(data ?? []);
}

/**
 * GET /api/snapshot：回傳 gzip bytes（不設 Content-Encoding，避免瀏覽器自動解壓）與 X-Revision。
 */
export const handleDownload = requireMatchingAccount(async (request, env, ctx, url, { user }) => {
  const { meta, chunks } = await db.readSnapshot(env.DB, user.id);
  if (!meta) return error('NOT_FOUND', 404);
  if (chunks.length !== meta.chunk_count) return error('INTERNAL', 500);
  const body = new Uint8Array(meta.byte_size);
  let offset = 0;
  for (const chunk of chunks) {
    const part = toBytes(chunk.data);
    body.set(part, offset);
    offset += part.byteLength;
  }
  if (offset !== meta.byte_size) return error('INTERNAL', 500);
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/gzip', 'x-revision': String(meta.revision), 'cache-control': 'no-store' },
  });
});

/**
 * 解析上傳標頭；任何一項不合法回 null。
 * If-Match 是非負整數（第一次上傳為 0）；X-Upload-Id 為 1～64 個 [A-Za-z0-9_-]；
 * X-Schema-Version 為正整數（備份格式版本，目前為 2）；
 * X-Device-Label 選填，前端以 encodeURIComponent 編碼（標頭只能放 ASCII），解碼失敗存空字串、不讓請求失敗，解碼後截到 64 字。
 */
function parseUploadHeaders(headers) {
  const ifMatch = headers.get('if-match');
  const uploadId = headers.get('x-upload-id');
  const schemaVersion = headers.get('x-schema-version');
  if (ifMatch === null || !/^\d{1,15}$/.test(ifMatch)) return null;
  if (uploadId === null || !/^[A-Za-z0-9_-]{1,64}$/.test(uploadId)) return null;
  if (schemaVersion === null || !/^[1-9]\d{0,8}$/.test(schemaVersion)) return null;
  const rawLabel = headers.get('x-device-label');
  let deviceLabel = null;
  if (rawLabel !== null) {
    try {
      deviceLabel = decodeURIComponent(rawLabel);
    } catch {
      deviceLabel = '';
    }
    deviceLabel = Array.from(deviceLabel).slice(0, DEVICE_LABEL_MAX).join('');
  }
  return { base: Number(ifMatch), uploadId, schemaVersion: Number(schemaVersion), deviceLabel };
}

/**
 * 讀完 body，超過上限就立刻停止並回 null。
 */
async function readBodyCapped(request, limit) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/**
 * 把 bytes 切成每塊最多 CHUNK_BYTES 的分塊。
 */
function splitChunks(body) {
  const chunks = [];
  for (let start = 0; start < body.byteLength; start += CHUNK_BYTES) {
    chunks.push(body.slice(start, start + CHUNK_BYTES).buffer);
  }
  return chunks;
}

/**
 * 回傳頻率限制錯誤及距離下次可上傳的秒數。
 */
function rateLimited(recent, now) {
  const retryAfter = Math.max(1, recent.oldest + RATE_WINDOW - now);
  return error('RATE_LIMITED', 429, { 'retry-after': String(retryAfter) });
}

/**
 * PUT /api/snapshot：條件式上傳。
 * 依序檢查：標頭（400）→ 宣告大小（413）→ 頻率（429）→ 實際大小（413）→ 條件式寫入（200 或 409）。
 * 只有成功的上傳計入頻率上限。
 */
export const handleUpload = requireMatchingAccount(async (request, env, ctx, url, { user, tokenHash }) => {
  const headers = parseUploadHeaders(request.headers);
  if (!headers) return error('BAD_REQUEST', 400);
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_SNAPSHOT_BYTES) return error('TOO_LARGE', 413);

  const startedAt = nowSec(env);
  const since = startedAt - RATE_WINDOW;
  const recent = await db.recentUploads(env.DB, user.id, since);
  if (recent.count >= RATE_LIMIT) {
    return rateLimited(recent, startedAt);
  }

  const body = await readBodyCapped(request, MAX_SNAPSHOT_BYTES);
  if (body === null) return error('TOO_LARGE', 413);
  if (body.byteLength === 0) return error('BAD_REQUEST', 400);

  const now = nowSec(env);
  const result = await db.writeSnapshot(env.DB, {
    userId: user.id,
    tokenHash,
    mode: accessMode(env),
    base: headers.base,
    chunks: splitChunks(body),
    uploadId: headers.uploadId,
    schemaVersion: headers.schemaVersion,
    byteSize: body.byteLength,
    deviceLabel: headers.deviceLabel,
    now,
    since: now - RATE_WINDOW,
    rateLimit: RATE_LIMIT,
  });
  if (!result.access) return error('UNAUTHENTICATED', 401);
  if (!result.access.allowed) return error('NOT_ALLOWED', 403);
  if (result.recent.count >= RATE_LIMIT) return rateLimited(result.recent, now);
  if (!result.written) {
    return json({ error: 'REVISION_MISMATCH', current: toMeta(result.current) }, 409);
  }
  return json({ revision: result.current.revision });
});

/**
 * DELETE /api/account：刪除快照、分塊、全部 session 與使用者列，清除 cookie；白名單不變（A12）。
 */
export const handleDeleteAccount = requireMatchingAccount(async (request, env, ctx, url, { user }) => {
  await db.deleteAccount(env.DB, user.id);
  return noContent({ 'set-cookie': clearSessionCookie() });
});
