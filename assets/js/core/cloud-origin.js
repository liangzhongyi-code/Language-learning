/**
 * 雲端網址閘門的純判斷（H05–H07）：輸入目前頁面的 origin 與雲端設定，回傳要啟用哪一種模式。
 * 不碰瀏覽器全域；呼叫端自己傳入 origin（網頁版是 window.location.origin）。
 */

/**
 * 三種模式：cloud 是新網址（可登入、可呼叫 /api），legacy 是舊站（只顯示搬家提示），off 是其他一律不啟用。
 */
export const CLOUD_MODES = Object.freeze({ CLOUD: 'cloud', LEGACY: 'legacy', OFF: 'off' });

/**
 * 取出 http(s) 網址的 origin（主機名轉小寫、去掉路徑）；不是字串、解析失敗或不是 http(s) 時回傳空字串。
 */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  return url.origin;
}

/**
 * 判斷目前 origin 的模式。新網址優先於舊站；設定缺漏或格式錯誤時視為未設定，不拋例外。
 */
export function cloudMode(origin, config) {
  const current = normalizeOrigin(origin);
  if (!current || !config) return CLOUD_MODES.OFF;
  if (normalizeOrigin(config.siteOrigin) === current) return CLOUD_MODES.CLOUD;
  const legacy = Array.isArray(config.legacyOrigins) ? config.legacyOrigins : [];
  if (legacy.some((value) => normalizeOrigin(value) === current)) return CLOUD_MODES.LEGACY;
  return CLOUD_MODES.OFF;
}

/**
 * 搬家提示要連去的新網址；只接受絕對的 http(s) 網址，其他（含 javascript:）一律回傳空字串。
 */
export function newSiteHref(config) {
  const value = config ? config.newSiteUrl : '';
  if (!normalizeOrigin(value)) return '';
  return new URL(value).href;
}
