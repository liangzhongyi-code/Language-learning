/**
 * 每次請求的存取檢查：session cookie、白名單與 ACCESS_MODE、寫入請求的 Origin。
 */
import { error, json } from './http.js';
import { accessMode, nowSec, siteOrigin } from './config.js';
import { SESSION_COOKIE, sha256Hex } from './session.js';
import * as db from './db.js';

/**
 * 需要檢查 Origin 的寫入類方法。
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * session token 的格式：32 bytes 的 base64url（43 字元）。
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * 寫入類請求的 Origin 必須完全等於本站 origin；不符時回 403 BAD_ORIGIN 的回應，通過回 null。
 * 在讀取 body 之前呼叫。
 */
export function checkOrigin(request, env) {
  if (!WRITE_METHODS.has(request.method)) return null;
  const expected = siteOrigin(env);
  const actual = request.headers.get('origin');
  if (!expected || actual !== expected) return error('BAD_ORIGIN', 403);
  return null;
}

/**
 * 從 Cookie 標頭取出 session token；沒有或格式不符回 null。
 */
export function readSessionToken(request) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

/**
 * 該 email 是否可以使用雲端：開放模式一律可以，否則必須在白名單內。
 */
export async function isEmailAllowed(env, email) {
  if (accessMode(env) === 'open') return true;
  return (await db.findAllowed(env.DB, email)) !== null;
}

/**
 * 驗證目前請求的 session 與存取權。
 * 通過回 { user: { id, email, role }, tokenHash }；不通過回 { response }：
 * session 無效或過期 401 UNAUTHENTICATED；session 有效但已無存取權 403 NOT_ALLOWED，並刪除他的全部 session。
 * role 每次都從白名單重新讀取，開放模式下不在名單的人為 member。
 */
export async function authenticate(request, env) {
  const token = readSessionToken(request);
  if (!token) return { response: error('UNAUTHENTICATED', 401) };
  const tokenHash = await sha256Hex(token);
  const now = nowSec(env);
  const row = await db.findAuthorizedSession(env.DB, tokenHash, now, accessMode(env));
  if (row) return { user: { id: row.user_id, email: row.email, role: row.role ?? 'member' }, tokenHash };
  const session = await db.findSession(env.DB, tokenHash);
  if (session && session.expires_at > now) {
    await db.deleteUserSessions(env.DB, session.user_id);
    return { response: error('NOT_ALLOWED', 403) };
  }
  return { response: error('UNAUTHENTICATED', 401) };
}

/**
 * 包裝需要登入的路由：驗證通過才呼叫 handler(request, env, ctx, url, auth)。
 * auth 為 { user, tokenHash, params }。
 */
export function requireUser(handler) {
  return async (request, env, ctx, url, params = {}) => {
    const auth = await authenticate(request, env);
    if (auth.response) return auth.response;
    return handler(request, env, ctx, url, { ...auth, params });
  };
}

/**
 * GET /api/me：回傳 { accountId, email, role }。accountId 是 users.id，不是 email 或 google_sub。
 */
export const handleMe = requireUser(async (request, env, ctx, url, { user }) =>
  json({ accountId: user.id, email: user.email, role: user.role }));
