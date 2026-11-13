/**
 * 學習紀錄快照：meta、下載、條件式上傳，以及刪除帳號（design TD-5、TD-6）。
 * 所有查詢都以 session 推得的 user_id 為條件，不接受前端傳入的帳號 ID。
 */
import { noContent } from './http.js';
import { requireUser } from './access.js';
import { clearSessionCookie } from './session.js';
import * as db from './db.js';

/**
 * DELETE /api/account：刪除快照、分塊、全部 session 與使用者列，清除 cookie；白名單不變（A12）。
 */
export const handleDeleteAccount = requireUser(async (request, env, ctx, url, { user }) => {
  await db.deleteAccount(env.DB, user.id);
  return noContent({ 'set-cookie': clearSessionCookie() });
});
