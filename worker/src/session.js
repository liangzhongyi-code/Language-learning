/**
 * 隨機值、雜湊與 session cookie。
 * session token 是 32 bytes 隨機值（base64url），資料庫只保存它的 SHA-256；原文只出現在 Set-Cookie。
 */
import { insertSession } from './db.js';

/**
 * 產生 n bytes 的隨機值，以 base64url（無補位）表示。
 */
export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64url(buffer);
}

/**
 * 位元組轉 base64url（無補位）。
 */
export function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 文字的 SHA-256 原始位元組。
 */
export async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * 文字的 SHA-256，以小寫十六進位表示；用於 state 與 session token 的雜湊。
 */
export async function sha256Hex(text) {
  return Array.from(await sha256Bytes(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * session cookie 名稱；__Host- 前綴要求 Secure、Path=/ 且不得帶 Domain。
 */
export const SESSION_COOKIE = '__Host-ll_session';

/**
 * session 有效期（秒）：30 天，不滑動延長。
 */
export const SESSION_TTL = 30 * 24 * 60 * 60;

/**
 * 設定 session cookie 的 Set-Cookie 值。
 */
export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`;
}

/**
 * 清除 session cookie 的 Set-Cookie 值。
 */
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * 登入期間使用的瀏覽器綁定 cookie，與 session cookie 分開。
 */
const LOGIN_COOKIE = '__Host-ll_oauth';
const LOGIN_COOKIE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * 設定或清除瀏覽器綁定 cookie；清除時傳空值及 0 秒。
 */
export function loginCookie(token, maxAge) {
  return `${LOGIN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/**
 * 讀取綁定值；缺少、格式錯誤或有同名 cookie 時回 null。
 */
export function readLoginCookie(request) {
  let token = null;
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const cookie = part.trim();
    if (!cookie.startsWith(`${LOGIN_COOKIE}=`)) continue;
    const value = cookie.slice(LOGIN_COOKIE.length + 1);
    if (token !== null || !LOGIN_COOKIE_PATTERN.test(value)) return null;
    token = value;
  }
  return token;
}

/**
 * 為使用者建立新 session，回傳 token 原文（只用於 Set-Cookie）。
 * 資料庫只保存 token 的 SHA-256。
 */
export async function createSession(DB, userId, now) {
  const token = randomToken(32);
  await insertSession(DB, { tokenHash: await sha256Hex(token), userId, now, expiresAt: now + SESSION_TTL });
  return token;
}
