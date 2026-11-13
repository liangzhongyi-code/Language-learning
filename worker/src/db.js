/**
 * D1 存取層：Worker 的 SQL 全部集中在這裡，路由與業務邏輯不直接寫 SQL。
 * 時間欄位一律是 Unix 秒；email 一律以小寫、去除空白後的形式比對與保存。
 */

/**
 * 把 email 正規化為比對用的形式（去除前後空白、轉小寫）。
 */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * 查白名單中的一筆資料；查無回 null。
 */
export async function findAllowed(db, email) {
  return db
    .prepare('SELECT email, nickname, role, created_at, added_by FROM allowed_emails WHERE email = ?')
    .bind(normalizeEmail(email))
    .first();
}

/**
 * 新增一筆登入狀態（state 只存雜湊）。
 */
export async function insertLoginState(db, { stateHash, codeVerifier, returnTo, expiresAt }) {
  await db
    .prepare('INSERT INTO login_states(state_hash, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?)')
    .bind(stateHash, codeVerifier, returnTo, expiresAt)
    .run();
}

/**
 * 刪除已過期的登入狀態。
 */
export async function purgeExpiredLoginStates(db, now) {
  await db.prepare('DELETE FROM login_states WHERE expires_at <= ?').bind(now).run();
}

/**
 * 取出並刪除一筆登入狀態（一次性）；查無回 null。過期與否由呼叫端判斷。
 */
export async function consumeLoginState(db, stateHash) {
  return db
    .prepare('DELETE FROM login_states WHERE state_hash = ? RETURNING code_verifier, return_to, expires_at')
    .bind(stateHash)
    .first();
}

/**
 * 依 Google sub 建立或更新使用者，回傳使用者 id。
 * 新使用者的 id 由呼叫端產生（隨機值），不外露 google_sub。
 */
export async function upsertUser(db, { newId, googleSub, email, now }) {
  const row = await db
    .prepare(
      'INSERT INTO users(id, google_sub, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?) '
        + 'ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, last_login_at = excluded.last_login_at '
        + 'RETURNING id',
    )
    .bind(newId, googleSub, normalizeEmail(email), now, now)
    .first();
  return row.id;
}

/**
 * 新增一筆 session（只存 token 的雜湊）。
 */
export async function insertSession(db, { tokenHash, userId, now, expiresAt }) {
  await db
    .prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, now, expiresAt)
    .run();
}

/**
 * 刪除已過期的 session。
 */
export async function purgeExpiredSessions(db, now) {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
}

/**
 * 一句 SQL 同時驗 session、未過期與存取權（開放模式或 email 在白名單）。
 * 通過時回 { user_id, email, role }，role 為白名單角色（開放模式下不在名單者為 null）；否則回 null。
 */
export async function findAuthorizedSession(db, tokenHash, now, mode) {
  return db
    .prepare(
      'SELECT u.id AS user_id, u.email AS email, a.role AS role FROM sessions s '
        + 'JOIN users u ON s.user_id = u.id '
        + 'LEFT JOIN allowed_emails a ON a.email = u.email '
        + "WHERE s.token_hash = ? AND s.expires_at > ? AND (? = 'open' OR a.email IS NOT NULL)",
    )
    .bind(tokenHash, now, mode)
    .first();
}

/**
 * 查 session 本身（不看存取權），用來區分 401 與 403；使用者列已不存在時回 null。
 */
export async function findSession(db, tokenHash) {
  return db
    .prepare('SELECT s.user_id, s.expires_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ?')
    .bind(tokenHash)
    .first();
}

/**
 * 刪除某位使用者的全部 session。
 */
export async function deleteUserSessions(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/**
 * 刪除單一 session。
 */
export async function deleteSession(db, tokenHash) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/**
 * 刪除一位使用者在雲端的全部資料（快照、分塊、上傳紀錄、session、使用者列），同一個交易內完成。
 * 白名單不在此處理。
 */
export async function deleteAccount(db, userId) {
  await db.batch([
    db.prepare('DELETE FROM snapshot_chunks WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM snapshots WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM upload_log WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

/**
 * 快照 meta 的欄位清單（SELECT 用）。
 */
const SNAPSHOT_META_COLUMNS = 'revision, upload_id, schema_version, byte_size, chunk_count, device_label, updated_at';

/**
 * 讀取某位使用者的快照 meta；沒有快照回 null。
 */
export async function findSnapshotMeta(db, userId) {
  return db.prepare(`SELECT ${SNAPSHOT_META_COLUMNS} FROM snapshots WHERE user_id = ?`).bind(userId).first();
}

/**
 * 在同一個交易內讀出 meta 與目前 revision 的全部分塊（依 idx 排序）。
 * 回傳 { meta, chunks }；沒有快照時 meta 為 null。
 */
export async function readSnapshot(db, userId) {
  const [metaResult, chunkResult] = await db.batch([
    db.prepare(`SELECT ${SNAPSHOT_META_COLUMNS} FROM snapshots WHERE user_id = ?`).bind(userId),
    db.prepare(
      'SELECT idx, data FROM snapshot_chunks WHERE user_id = ? '
        + 'AND revision = (SELECT revision FROM snapshots WHERE user_id = ?) ORDER BY idx',
    ).bind(userId, userId),
  ]);
  return { meta: metaResult.results[0] ?? null, chunks: chunkResult.results };
}

/**
 * 條件式寫入快照（design §4 的四步，一個 db.batch() 在同一個交易內）：
 * 1. 以 revision = base + 1 插入每個分塊；同基準的並行上傳會在主鍵衝突，整批回滾。
 * 2. 寫入 meta：沒有快照時只在 base = 0 才插入；已有快照時只在目前 revision = base 才更新。
 * 3. 刪除該帳號中 revision 不等於 meta 目前 revision 的分塊（版本不符時也會刪掉這次插入的分塊）。
 * 4. 讀回 meta。
 * 回傳批次結束時的 meta（可能為 null）；主鍵衝突等錯誤會直接拋出，由呼叫端判斷。
 */
export async function writeSnapshot(db, { userId, base, chunks, uploadId, schemaVersion, byteSize, deviceLabel, now }) {
  const next = base + 1;
  const statements = chunks.map((chunk, idx) =>
    db.prepare('INSERT INTO snapshot_chunks(user_id, revision, idx, data) VALUES (?, ?, ?, ?)').bind(userId, next, idx, chunk));
  statements.push(
    db.prepare(
      'INSERT INTO snapshots(user_id, revision, upload_id, schema_version, byte_size, chunk_count, device_label, updated_at) '
        + 'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM snapshots WHERE user_id = ?) '
        + 'ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, upload_id = excluded.upload_id, '
        + 'schema_version = excluded.schema_version, byte_size = excluded.byte_size, chunk_count = excluded.chunk_count, '
        + 'device_label = excluded.device_label, updated_at = excluded.updated_at '
        + 'WHERE snapshots.revision = ?',
    ).bind(userId, next, uploadId, schemaVersion, byteSize, chunks.length, deviceLabel, now, base, userId, base),
    db.prepare(
      'DELETE FROM snapshot_chunks WHERE user_id = ? '
        + 'AND revision <> COALESCE((SELECT revision FROM snapshots WHERE user_id = ?), -1)',
    ).bind(userId, userId),
    db.prepare(`SELECT ${SNAPSHOT_META_COLUMNS} FROM snapshots WHERE user_id = ?`).bind(userId),
  );
  const results = await db.batch(statements);
  return results[results.length - 1].results[0] ?? null;
}

/**
 * 計算某位使用者自 since（不含）之後的成功上傳次數與其中最早的時間。
 */
export async function recentUploads(db, userId, since) {
  const row = await db
    .prepare('SELECT COUNT(*) AS count, MIN(at) AS oldest FROM upload_log WHERE user_id = ? AND at > ?')
    .bind(userId, since)
    .first();
  return { count: row?.count ?? 0, oldest: row?.oldest ?? null };
}

/**
 * 記錄一次成功上傳，並清掉這位使用者超過頻率視窗的舊紀錄。
 */
export async function logUpload(db, userId, now, since) {
  await db.batch([
    db.prepare('INSERT INTO upload_log(user_id, at) VALUES (?, ?)').bind(userId, now),
    db.prepare('DELETE FROM upload_log WHERE user_id = ? AND at <= ?').bind(userId, since),
  ]);
}
