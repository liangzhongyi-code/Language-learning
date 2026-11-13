/**
 * Google 登入：伺服器端授權碼流程加 PKCE（design TD-2）。
 * 前端只是一般連結到 /api/auth/start，Worker 負責 state、verifier 與換 token，前端不碰任何 token。
 */
import { siteOrigin, nowSec, oauthEndpoints } from './config.js';
import { randomToken, sha256Hex, sha256Bytes, base64url, createSession, sessionCookie, clearSessionCookie } from './session.js';
import * as db from './db.js';
import { isEmailAllowed, requireUser } from './access.js';
import { noContent } from './http.js';

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
 * Google 簽發 id_token 時可能使用的 iss。
 */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * GET /api/auth/callback：取出一次性 state、以授權碼加 verifier 加 secret 換 token、
 * 驗證 id_token 欄位、查白名單、建立使用者與 session。
 * 成功 302 回 returnTo；失敗 302 回 returnTo#cloud-error=<CODE>，不設定 cookie。
 */
export async function handleCallback(request, env, ctx, url) {
  const origin = siteOrigin(env);
  const back = (returnTo, code) => redirect(`${origin}${returnTo}#cloud-error=${code}`);
  const state = url.searchParams.get('state');
  const loginState = state ? await db.consumeLoginState(env.DB, await sha256Hex(state)) : null;
  if (!loginState) return back('/', 'STATE_INVALID');

  const now = nowSec(env);
  const returnTo = normalizeReturnTo(loginState.return_to, origin);
  if (!(loginState.expires_at > now)) return back(returnTo, 'STATE_INVALID');
  if (url.searchParams.has('error')) return back(returnTo, 'DENIED');
  const code = url.searchParams.get('code');
  if (!code) return back(returnTo, 'EXCHANGE_FAILED');

  const claims = await exchangeCode(env, code, loginState.code_verifier, now);
  if (!claims) return back(returnTo, 'EXCHANGE_FAILED');
  if (claims.email_verified !== true) return back(returnTo, 'NOT_ALLOWED');
  const email = db.normalizeEmail(claims.email);
  if (!(await isEmailAllowed(env, email))) return back(returnTo, 'NOT_ALLOWED');

  const userId = await db.upsertUser(env.DB, { newId: crypto.randomUUID(), googleSub: claims.sub, email, now });
  await db.purgeExpiredSessions(env.DB, now);
  const token = await createSession(env.DB, userId, now);
  return redirect(`${origin}${returnTo}`, { 'set-cookie': sessionCookie(token) });
}

/**
 * 以授權碼向 token 端點換 id_token，並檢查 aud、iss、exp、sub、email。
 * 任何失敗都回 null；不記錄授權碼、secret 或 token 的原文。
 * id_token 是 Worker 以 TLS 加 secret 直接向 Google 取得，依 TD-2 不另外驗簽。
 */
async function exchangeCode(env, code, codeVerifier, now) {
  let response;
  try {
    response = await fetch(oauthEndpoints(env).token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: String(env.GOOGLE_CLIENT_ID ?? ''),
        client_secret: String(env.GOOGLE_CLIENT_SECRET ?? ''),
        redirect_uri: redirectUri(env),
        code_verifier: String(codeVerifier ?? ''),
      }).toString(),
    });
  } catch {
    console.warn('auth: token endpoint unreachable');
    return null;
  }
  if (!response.ok) {
    console.warn('auth: token exchange rejected', response.status);
    return null;
  }
  const body = await response.json().catch(() => null);
  const claims = decodeJwtPayload(body?.id_token);
  if (!claims) return null;
  const clientId = String(env.GOOGLE_CLIENT_ID ?? '');
  if (!clientId || claims.aud !== clientId) return null;
  if (!GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (typeof claims.exp !== 'number' || !(claims.exp > now)) return null;
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
  return claims;
}

/**
 * 解出 JWT 的 payload；格式不符回 null。
 */
function decodeJwtPayload(jwt) {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * 302 轉址，不快取；可附帶額外標頭（例如 Set-Cookie）。
 */
export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } });
}

/**
 * POST /api/auth/logout：刪除這個 session 並清除 cookie；同帳號其他裝置的 session 不受影響。
 */
export const handleLogout = requireUser(async (request, env, ctx, url, { tokenHash }) => {
  await db.deleteSession(env.DB, tokenHash);
  return noContent({ 'set-cookie': clearSessionCookie() });
});
