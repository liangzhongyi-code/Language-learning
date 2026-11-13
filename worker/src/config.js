/**
 * 從 env 讀出的設定值，集中在這裡判斷，避免各模組各自解讀。
 * 測試專用的覆寫（GOOGLE_OAUTH_BASE、TEST_NOW）只在 ENVIRONMENT === 'test' 時生效。
 */

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * 是否為測試環境；只認完全等於 'test' 的值。
 */
export function isTestEnv(env) {
  return env?.ENVIRONMENT === 'test';
}

/**
 * 目前時間（毫秒）。正式環境一律 Date.now()，測試環境可注入 TEST_NOW()。
 */
export function nowMs(env) {
  if (isTestEnv(env) && typeof env.TEST_NOW === 'function') return env.TEST_NOW();
  return Date.now();
}

/**
 * 目前時間（Unix 秒），資料庫的時間欄位都用這個單位。
 */
export function nowSec(env) {
  return Math.floor(nowMs(env) / 1000);
}

/**
 * 存取模式：只有 'open' 是開放模式，其他值或未設定一律視為白名單模式。
 */
export function accessMode(env) {
  return env?.ACCESS_MODE === 'open' ? 'open' : 'allowlist';
}

/**
 * 本站 origin；未設定或格式錯誤時回空字串（寫入請求會因此全部被拒，屬於安全的失敗方式）。
 */
export function siteOrigin(env) {
  try {
    return new URL(String(env?.SITE_ORIGIN ?? '')).origin;
  } catch {
    return '';
  }
}

/**
 * Google OAuth 端點。只有測試環境才允許以 GOOGLE_OAUTH_BASE 指向本機假伺服器。
 */
export function oauthEndpoints(env) {
  if (isTestEnv(env) && env.GOOGLE_OAUTH_BASE) {
    const base = String(env.GOOGLE_OAUTH_BASE).replace(/\/+$/, '');
    return { auth: `${base}/o/oauth2/v2/auth`, token: `${base}/token` };
  }
  return { auth: GOOGLE_AUTH_ENDPOINT, token: GOOGLE_TOKEN_ENDPOINT };
}
