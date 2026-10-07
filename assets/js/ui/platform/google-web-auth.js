/**
 * 網站版 Google 授權 adapter：Google Identity Services token model。
 * 只有使用者按「連接」才載入 SDK；Client ID 空白時完全不載入、不發請求。
 * access token 只放在這個閉包的記憶體變數，不寫任何持久儲存、URL、備份、錯誤或日誌。
 * 每次連接、斷線、授權失效都會讓 generation 遞增，晚到的舊回應一律丟棄。
 */
import { LearningError } from '../../core/learning-errors.js';

export const GOOGLE_GSI_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GOOGLE_SCOPES = `${DRIVE_APPDATA_SCOPE} openid email`;
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Bearer token 只允許送往這個主機上的固定路徑；呼叫端不能指定任意 URL。
 */
const API_ORIGIN = 'https://www.googleapis.com';
const ALLOWED_PATHS = Object.freeze([
  /^\/drive\/v3\/files(?:\/[A-Za-z0-9_-]{1,256})?$/,
  /^\/upload\/drive\/v3\/files$/,
  /^\/oauth2\/v3\/userinfo$/,
]);

/**
 * token 到期前預留的安全秒數，避免請求送到一半才過期。
 */
const EXPIRY_MARGIN_SECONDS = 60;
const FALLBACK_EXPIRES_SECONDS = 3000;

/**
 * 錯誤訊息固定由程式決定，只供顯示；不帶入伺服器原文，避免夾帶 token 或私人資料。
 */
const MESSAGES = Object.freeze({
  GOOGLE_NOT_CONFIGURED: 'Google 備份尚未設定（沒有填 OAuth Client ID），本機功能不受影響。',
  GOOGLE_NOT_CONNECTED: '尚未連接 Google 帳號，請先按「連接 Google」。',
  GOOGLE_CANCELLED: '已取消 Google 授權，本機資料沒有任何變動。',
  GOOGLE_POPUP_BLOCKED: '瀏覽器擋下了 Google 授權視窗，請允許彈出式視窗後再試。',
  GOOGLE_DENIED: '你拒絕了 Google 授權，無法使用雲端備份；本機資料沒有任何變動。',
  GOOGLE_AUTH_FAILED: 'Google 授權失敗，請確認設定後再試；本機資料沒有任何變動。',
  GOOGLE_SCOPE_MISSING: '授權沒有包含「應用程式資料夾」或帳號 email 權限，請重新連接並勾選所有要求的權限。',
  GOOGLE_AUTH_EXPIRED: 'Google 授權已失效或過期，請重新連接後再試。',
  GOOGLE_RATE_LIMITED: 'Google 暫時限制請求次數，請稍後再試；本機與既有雲端備份都沒有變動。',
  GOOGLE_QUOTA: 'Google 雲端硬碟空間不足，這次沒有備份；本機與既有雲端備份都沒有變動。',
  GOOGLE_OFFLINE: '無法連線到 Google，請確認網路後再試；本機資料沒有變動。',
  GOOGLE_TIMEOUT: '連線 Google 逾時，請稍後再試；本機資料沒有變動。',
  GOOGLE_UPLOAD_UNKNOWN: '無法確認上傳結果：雲端可能已經建立這份備份，也可能沒有。再次備份前會先查詢雲端。',
  GOOGLE_STALE_SESSION: 'Google 帳號已切換或中斷連線，這個舊請求的結果已丟棄。',
  GOOGLE_URL_REJECTED: '已拒絕把授權送往非 Google 固定端點的網址。',
  GOOGLE_INVALID_FILE_ID: '雲端備份的檔案識別碼不正確，已停止下載。',
  GOOGLE_NOT_FOUND: '找不到這份雲端備份，請重新整理清單。',
  GOOGLE_FORBIDDEN: 'Google 拒絕了這次存取，請重新連接後再試。',
  GOOGLE_BAD_REQUEST: 'Google 不接受這次請求，請重新整理後再試。',
  GOOGLE_SERVER_ERROR: 'Google 伺服器暫時有問題，請稍後再試。',
  GOOGLE_HTTP_ERROR: 'Google 回應異常，請稍後再試。',
  GOOGLE_INVALID_RESPONSE: 'Google 回應的格式不正確，請稍後再試。',
  BACKUP_SIZE_LIMIT: '備份資料超過 10 MiB 上限，已停止處理；本機與雲端都沒有變動。',
  INVALID_BACKUP: '備份內容或參數不正確，已停止處理。',
  INVALID_OPERATION: '請求參數不正確，已停止處理。',
});

/**
 * 建立 Google 相關的 LearningError；message 固定、details 只放結構化診斷。
 */
export function googleError(code, details = {}, message = MESSAGES[code] ?? MESSAGES.GOOGLE_HTTP_ERROR) {
  return new LearningError(code, message, details);
}

/**
 * 判斷 URL 是否為允許附帶 token 的固定 Google 端點。
 * 原始字串必須與正規化後的 origin＋path 完全一致，杜絕 `..`、編碼或帳密等繞道寫法。
 */
export function isAllowedGoogleUrl(url) {
  const raw = url instanceof URL ? url.href : url;
  if (typeof raw !== 'string' || raw.length > 4096) return false;
  let parsed;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.origin !== API_ORIGIN || parsed.username || parsed.password || parsed.hash) return false;
  if (!raw.startsWith(`${API_ORIGIN}${parsed.pathname}`)) return false;
  const rest = raw.slice(API_ORIGIN.length + parsed.pathname.length);
  if (rest !== '' && !rest.startsWith('?')) return false;
  return ALLOWED_PATHS.some(pattern => pattern.test(parsed.pathname));
}

/**
 * 把呼叫端的 headers 轉成一般物件，並移除任何自帶的 Authorization，避免被覆寫或外洩。
 */
function plainHeaders(headers) {
  let entries = [];
  if (Array.isArray(headers)) entries = headers;
  else if (headers && typeof headers.forEach === 'function') headers.forEach((value, key) => entries.push([key, value]));
  else if (headers && typeof headers === 'object') entries = Object.entries(headers);
  return Object.fromEntries(entries.filter(([key]) => String(key).toLowerCase() !== 'authorization'));
}

/**
 * 丟棄不再需要的回應內容；失敗也無妨，只是讓連線早點釋放。
 */
function discard(response) {
  try {
    const result = response?.body?.cancel?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    /* 已鎖定或已讀完的 body 無須處理 */
  }
}

const safeReason = (value) => (typeof value === 'string' && /^[A-Za-z_]{1,64}$/.test(value) ? { reason: value } : {});
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

/**
 * 建立網站授權 adapter。所有外部能力（載入 script、取得 google 物件、fetch）皆由呼叫端注入。
 */
export function createGoogleWebAuth({ config, loadScript, getGoogle, fetch: fetchImpl, onChange, now = () => Date.now() } = {}) {
  const clientId = typeof config?.webClientId === 'string' ? config.webClientId.trim() : '';
  const configured = clientId !== '';
  const doFetch = fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

  let token = null;
  let expiresAt = 0;
  let email = '';
  let generation = 0;
  let scriptPromise = null;
  let tokenClient = null;
  let pending = null;

  const status = () => ({ configured, connected: token !== null, email, generation });

  function notify() {
    if (typeof onChange !== 'function') return;
    try {
      onChange(status());
    } catch {
      /* UI 的錯誤不影響授權狀態 */
    }
  }

  /**
   * 盡力撤銷 token；SDK 未載入或撤銷失敗都不影響本地清除。
   */
  function revokeQuietly(value) {
    if (!value) return;
    try {
      getGoogle?.()?.accounts?.oauth2?.revoke?.(value, () => {});
    } catch {
      /* 撤銷失敗只代表伺服器端稍後自然過期 */
    }
  }

  /**
   * 清除記憶體中的授權並讓 generation 遞增；仍在等待的授權視窗改回 STALE。
   */
  function invalidate() {
    const old = token;
    token = null;
    expiresAt = 0;
    email = '';
    generation += 1;
    if (pending) {
      const waiting = pending;
      pending = null;
      waiting.reject(googleError('GOOGLE_STALE_SESSION'));
    }
    return old;
  }

  function ensureSdk() {
    if (!scriptPromise) {
      scriptPromise = Promise.resolve()
        .then(() => loadScript(GOOGLE_GSI_URL))
        .then(() => {
          const google = getGoogle?.();
          if (typeof google?.accounts?.oauth2?.initTokenClient !== 'function') throw new Error('sdk missing');
          return google;
        })
        .catch(() => {
          scriptPromise = null;
          throw googleError('GOOGLE_OFFLINE');
        });
    }
    return scriptPromise;
  }

  /**
   * GIS 只有一個授權視窗；回呼統一導到目前的 pending，已作廢者撤銷晚到 token。
   */
  function settle(response, failure) {
    const current = pending;
    pending = null;
    const accessToken = typeof response?.access_token === 'string' && response.access_token ? response.access_token : null;
    if (!current || current.gen !== generation) {
      revokeQuietly(accessToken);
      current?.reject(googleError('GOOGLE_STALE_SESSION'));
      return;
    }
    if (failure) {
      current.reject(googleError(failure?.type === 'popup_failed_to_open' ? 'GOOGLE_POPUP_BLOCKED' : 'GOOGLE_CANCELLED'));
      return;
    }
    if (response?.error) {
      revokeQuietly(accessToken);
      current.reject(googleError(response.error === 'access_denied' ? 'GOOGLE_DENIED' : 'GOOGLE_AUTH_FAILED', safeReason(response.error)));
      return;
    }
    if (!accessToken) {
      current.reject(googleError('GOOGLE_INVALID_RESPONSE'));
      return;
    }
    const scopes = typeof response.scope === 'string' ? response.scope.split(/\s+/) : [];
    if (!scopes.includes(DRIVE_APPDATA_SCOPE)) {
      revokeQuietly(accessToken);
      current.reject(googleError('GOOGLE_SCOPE_MISSING', { missing: 'drive.appdata' }));
      return;
    }
    const seconds = Number(response.expires_in);
    current.resolve({ accessToken, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : FALLBACK_EXPIRES_SECONDS });
  }

  function requestToken(google, gen) {
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPES,
        include_granted_scopes: false,
        callback: (response) => settle(response, null),
        error_callback: (failure) => settle(null, failure ?? {}),
      });
    }
    return new Promise((resolve, reject) => {
      pending = { gen, resolve, reject };
      try {
        tokenClient.requestAccessToken({ prompt: 'select_account' });
      } catch {
        pending = null;
        reject(googleError('GOOGLE_POPUP_BLOCKED'));
      }
    });
  }

  /**
   * 送出帶 Bearer 的請求；送出前後都核對 generation，網路錯誤轉成固定 code，不保留原始錯誤。
   */
  async function send(url, accessToken, init, gen) {
    const headers = { ...plainHeaders(init?.headers), Authorization: `Bearer ${accessToken}` };
    let response;
    try {
      response = await doFetch(url, { ...init, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch (error) {
      if (gen !== generation) throw googleError('GOOGLE_STALE_SESSION');
      const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      throw googleError(timeout ? 'GOOGLE_TIMEOUT' : 'GOOGLE_OFFLINE');
    }
    if (gen !== generation) {
      discard(response);
      throw googleError('GOOGLE_STALE_SESSION');
    }
    return response;
  }

  async function confirmAccount(accessToken, gen) {
    const response = await send(GOOGLE_USERINFO_URL, accessToken, { method: 'GET', headers: { Accept: 'application/json' } }, gen);
    if (response.status === 401) {
      discard(response);
      throw googleError('GOOGLE_AUTH_EXPIRED');
    }
    if (!response.ok) {
      discard(response);
      throw googleError('GOOGLE_HTTP_ERROR', { status: response.status });
    }
    let profile = null;
    try {
      profile = await response.json();
    } catch {
      profile = null;
    }
    if (gen !== generation) throw googleError('GOOGLE_STALE_SESSION');
    const value = profile?.email;
    if (typeof value !== 'string' || !EMAIL.test(value)) {
      revokeQuietly(accessToken);
      throw googleError('GOOGLE_SCOPE_MISSING', { missing: 'email' });
    }
    return value;
  }

  /**
   * 使用者主動連接；重新連接會先作廢舊帳號的 token 與進行中的請求。
   */
  async function connect() {
    if (!configured) throw googleError('GOOGLE_NOT_CONFIGURED');
    invalidate();
    notify();
    const gen = generation;
    const google = await ensureSdk();
    if (gen !== generation) throw googleError('GOOGLE_STALE_SESSION');
    const granted = await requestToken(google, gen);
    const confirmed = await confirmAccount(granted.accessToken, gen);
    if (gen !== generation) throw googleError('GOOGLE_STALE_SESSION');
    token = granted.accessToken;
    email = confirmed;
    expiresAt = now() + Math.max(0, granted.seconds - EXPIRY_MARGIN_SECONDS) * 1000;
    notify();
    return status();
  }

  /**
   * 斷線：先清本地狀態再盡力撤銷，撤銷失敗也不影響已清除的結果。不會為此載入 SDK。
   */
  function disconnect() {
    const old = invalidate();
    notify();
    revokeQuietly(old);
    return status();
  }

  /**
   * 只對固定 Google 端點附 Bearer；401 代表授權失效，清狀態並要求重新連接，不自動重試。
   */
  async function authorizedFetch(url, init = {}) {
    if (!isAllowedGoogleUrl(url)) throw googleError('GOOGLE_URL_REJECTED');
    if (token === null) throw googleError('GOOGLE_NOT_CONNECTED');
    if (now() >= expiresAt) {
      invalidate();
      notify();
      throw googleError('GOOGLE_AUTH_EXPIRED');
    }
    const gen = generation;
    const response = await send(url instanceof URL ? url.href : url, token, init, gen);
    if (response.status === 401) {
      discard(response);
      if (gen === generation) {
        invalidate();
        notify();
      }
      throw googleError('GOOGLE_AUTH_EXPIRED');
    }
    return response;
  }

  return { status, connect, disconnect, authorizedFetch, currentGeneration: () => generation };
}
