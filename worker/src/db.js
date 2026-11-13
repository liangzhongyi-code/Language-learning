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
