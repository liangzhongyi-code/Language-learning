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
 * 上傳交易使用與請求驗證相同的 session、帳號及白名單條件。
 */
const SNAPSHOT_ACCESS = "SELECT (? = 'open' OR a.email IS NOT NULL) AS allowed FROM sessions s "
  + 'JOIN users u ON u.id = s.user_id LEFT JOIN allowed_emails a ON a.email = u.email '
  + 'WHERE s.token_hash = ? AND s.expires_at > ? AND u.id = ?';

const RECENT_UPLOADS_FILTER = 'FROM upload_log WHERE user_id = ? AND at > ?';
const RECENT_UPLOADS = `SELECT COUNT(*) AS count, MIN(at) AS oldest ${RECENT_UPLOADS_FILTER}`;

/**
 * 在同一個交易內核對授權、頻率與版號，寫入分塊和 meta，並記錄成功上傳。
 * 只有 meta 更新成功才記錄上傳並清理舊資料。條件失敗時回傳交易內的狀態供路由判斷。
 */
export async function writeSnapshot(db, {
  userId, tokenHash, mode, base, chunks, uploadId, schemaVersion, byteSize, deviceLabel, now, since, rateLimit,
}) {
  const accessArgs = [mode, tokenHash, now, userId];
  const rateArgs = [userId, since];
  const canWrite = `(${SNAPSHOT_ACCESS}) AND (SELECT COUNT(*) ${RECENT_UPLOADS_FILTER}) < ?`;
  const writeArgs = [...accessArgs, ...rateArgs, rateLimit];
  const matchesBase = 'COALESCE((SELECT revision FROM snapshots WHERE user_id = ?), 0) = ?';
  const next = base + 1;
  const updateIndex = 3 + chunks.length;
  const statements = [
    db.prepare(SNAPSHOT_ACCESS).bind(...accessArgs),
    db.prepare(RECENT_UPLOADS).bind(...rateArgs),
    db.prepare(
      `DELETE FROM upload_log WHERE user_id = ? AND at <= ? AND ${canWrite} AND ${matchesBase}`,
    ).bind(userId, since, ...writeArgs, userId, base),
    ...chunks.map((chunk, idx) => db.prepare(
      'INSERT INTO snapshot_chunks(user_id, revision, idx, data) '
        + `SELECT ?, ?, ?, ? WHERE ${canWrite} AND ${matchesBase}`,
    ).bind(userId, next, idx, chunk, ...writeArgs, userId, base)),
    db.prepare(
      'INSERT INTO snapshots(user_id, revision, upload_id, schema_version, byte_size, chunk_count, device_label, updated_at) '
        + `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${canWrite} AND ${matchesBase} `
        + 'ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, upload_id = excluded.upload_id, '
        + 'schema_version = excluded.schema_version, byte_size = excluded.byte_size, chunk_count = excluded.chunk_count, '
        + 'device_label = excluded.device_label, updated_at = excluded.updated_at',
    ).bind(userId, next, uploadId, schemaVersion, byteSize, chunks.length, deviceLabel, now, ...writeArgs, userId, base),
    db.prepare('INSERT INTO upload_log(user_id, at) SELECT ?, ? WHERE changes() = 1').bind(userId, now),
    // changes() 依序讀取前一筆的影響列數：meta 更新成功才寫 log，log 寫入成功才清理舊分塊。
    db.prepare(
      'DELETE FROM snapshot_chunks WHERE user_id = ? AND revision <> ? AND changes() = 1',
    ).bind(userId, next),
    db.prepare(`SELECT ${SNAPSHOT_META_COLUMNS} FROM snapshots WHERE user_id = ?`).bind(userId),
  ];
  const results = await db.batch(statements);
  return {
    access: results[0].results[0],
    recent: results[1].results[0],
    written: results[updateIndex].meta.changes === 1,
    current: results.at(-1).results[0] ?? null,
  };
}

/**
 * 讀取目前頻率，讓超過上限的請求不必先上傳 body。
 */
export async function recentUploads(db, userId, since) {
  return db.prepare(RECENT_UPLOADS).bind(userId, since).first();
}

/**
 * 後台名單：合併白名單與 users（開放模式下才列出不在白名單的使用者），
 * 附上最後登入時間、未過期 session 數、快照最後更新時間與新增者 email。
 * 擁有者排第一，其餘依最後登入時間新到舊，從未登入的排最後，同序再依 email。
 */
export async function listMembers(db, { mode, now }) {
  const { results } = await db
    .prepare(
      'WITH people AS ('
        + ' SELECT email FROM allowed_emails'
        + " UNION SELECT email FROM users WHERE ?1 = 'open'"
        + '), stats AS ('
        + ' SELECT p.email AS email,'
        + ' (SELECT MAX(u.last_login_at) FROM users u WHERE u.email = p.email) AS last_login_at,'
        + ' (SELECT COUNT(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = p.email AND s.expires_at > ?2) AS active_sessions,'
        + ' (SELECT MAX(sn.updated_at) FROM snapshots sn JOIN users u ON u.id = sn.user_id WHERE u.email = p.email) AS snapshot_updated_at'
        + ' FROM people p'
        + ') '
        + 'SELECT st.email, a.nickname, a.role, a.email IS NOT NULL AS in_allowlist, a.created_at, adder.email AS added_by_email,'
        + ' st.last_login_at, st.active_sessions, st.snapshot_updated_at '
        + 'FROM stats st LEFT JOIN allowed_emails a ON a.email = st.email '
        + 'LEFT JOIN users adder ON adder.id = a.added_by '
        + "ORDER BY COALESCE(a.role = 'owner', 0) DESC, st.last_login_at IS NULL, st.last_login_at DESC, st.email",
    )
    .bind(mode, now)
    .all();
  return results;
}

/**
 * 新增成員的授權核對與 INSERT 共用交易。保留重複 email 的原有回應。
 */
export async function insertMember(db, { email, nickname, actor, tokenHash, now }) {
  const actorRole = 'SELECT a.role FROM sessions s JOIN users u ON u.id = s.user_id '
    + 'LEFT JOIN allowed_emails a ON a.email = u.email '
    + 'WHERE s.token_hash = ? AND s.expires_at > ? AND u.id = ? AND u.email = ?';
  const args = [tokenHash, now, actor.id, actor.email];
  const [session, inserted] = await db.batch([
    db.prepare(actorRole).bind(...args),
    db.prepare(
      "INSERT INTO allowed_emails(email, nickname, role, created_at, added_by) SELECT ?, ?, 'member', ?, ? "
        + `WHERE (${actorRole}) = ? ON CONFLICT(email) DO NOTHING`,
    ).bind(normalizeEmail(email), nickname, now, actor.id, ...args, actor.role),
  ]);
  return { session: session.results[0], inserted: inserted.meta.changes === 1 };
}

/**
 * 寫入當下確認操作者仍有同一角色和有效的 session。
 */
const ADMIN_WRITE_AUTH = 'EXISTS (SELECT 1 FROM sessions s '
  + 'JOIN users u ON u.id = s.user_id JOIN allowed_emails a ON a.email = u.email '
  + 'WHERE s.token_hash = ? AND s.expires_at > ? AND u.email = ? AND a.role = ?)';

/**
 * 只在目標與操作者仍符合已核准的條件時更新暱稱或角色。
 */
export async function updateMember(db, { email, expectedRole, changes, actor, tokenHash, now }) {
  const sets = [];
  const values = [];
  if ('nickname' in changes) {
    sets.push('nickname = ?');
    values.push(changes.nickname);
  }
  if ('role' in changes) {
    sets.push('role = ?');
    values.push(changes.role);
  }
  return db
    .prepare(
      `UPDATE allowed_emails SET ${sets.join(', ')} WHERE email = ? AND role = ? AND ${ADMIN_WRITE_AUTH} `
        + 'RETURNING email, nickname, role',
    )
    .bind(...values, normalizeEmail(email), expectedRole, tokenHash, now, actor.email, actor.role)
    .first();
}

/**
 * 在同一個交易內刪除符合條件的成員或管理員及其所有 session。
 * 先撤銷目標的 session，再移除白名單。目標不可能是發出請求的擁有者。
 */
export async function removeMember(db, { email, expectedRole, actor, tokenHash, now }) {
  const target = normalizeEmail(email);
  const guard = `email = ? AND role = ? AND role <> 'owner' AND ${ADMIN_WRITE_AUTH}`;
  const args = [target, expectedRole, tokenHash, now, actor.email, 'owner'];
  const [, deleted] = await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?) '
      + `AND EXISTS (SELECT 1 FROM allowed_emails WHERE ${guard})`).bind(target, ...args),
    db.prepare(`DELETE FROM allowed_emails WHERE ${guard}`).bind(...args),
  ]);
  return (deleted.meta?.changes ?? 0) > 0;
}
