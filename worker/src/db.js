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
