/**
 * 隨機值、雜湊與 session cookie。
 * session token 是 32 bytes 隨機值（base64url），資料庫只保存它的 SHA-256；原文只出現在 Set-Cookie。
 */

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
