/**
 * Google 登入：伺服器端授權碼流程加 PKCE（design TD-2）。
 * 前端只是一般連結到 /api/auth/start，Worker 負責 state、verifier 與換 token，前端不碰任何 token。
 */
import { siteOrigin, nowSec, oauthEndpoints } from './config.js';
import { randomToken, sha256Hex, sha256Bytes, base64url } from './session.js';
import * as db from './db.js';

/**
 * login_states 的有效期（秒）。
 */
const LOGIN_STATE_TTL = 600;

/**
 * returnTo 的長度上限，超過一律改回首頁。
 */
const RETURN_TO_MAX = 2048;

/**
 * 把 returnTo 正規化為本站路徑（A05）。
 * 只接受單一 / 開頭的路徑；含 //、反斜線、控制字元，或解析後 origin 不是本站，一律改成 /。
 * 回傳 pathname + search，去掉 hash（失敗時要在後面接 #cloud-error=）。
 */
export function normalizeReturnTo(returnTo, origin) {
  if (typeof returnTo !== 'string' || returnTo.length === 0 || returnTo.length > RETURN_TO_MAX) return '/';
  if (!returnTo.startsWith('/') || returnTo.includes('//') || returnTo.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(returnTo)) return '/';
  if (!origin) return '/';
  let url;
  try {
    url = new URL(returnTo, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin) return '/';
  return url.pathname + url.search;
}

/**
 * 本站的 OAuth 回呼網址。
 */
function redirectUri(env) {
  return `${siteOrigin(env)}/api/auth/callback`;
}

/**
 * GET /api/auth/start：建立一次性 state 與 PKCE verifier，302 轉到 Google 授權端點。
 */
export async function handleStart(request, env, ctx, url) {
  const origin = siteOrigin(env);
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'), origin);
  const state = randomToken(32);
  const verifier = randomToken(32);
  const challenge = base64url(await sha256Bytes(verifier));
  const now = nowSec(env);
  await db.purgeExpiredLoginStates(env.DB, now);
  await db.insertLoginState(env.DB, {
    stateHash: await sha256Hex(state),
    codeVerifier: verifier,
    returnTo,
    expiresAt: now + LOGIN_STATE_TTL,
  });
  const target = new URL(oauthEndpoints(env).auth);
  target.search = new URLSearchParams({
    client_id: String(env.GOOGLE_CLIENT_ID ?? ''),
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'openid email',
    prompt: 'select_account',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return redirect(target.href);
}

/**
 * 302 轉址，不快取；可附帶額外標頭（例如 Set-Cookie）。
 */
export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } });
}
