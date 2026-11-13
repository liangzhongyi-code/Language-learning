/**
 * 舊站搬家提示（H06／H07）：只在 CLOUD_CONFIG.legacyOrigins 列出的 origin、且設定了新網址時顯示，
 * 放在導覽列正下方，說明新網址與「用備份代碼搬移紀錄」的方法。舊站其他功能照常。
 *
 * 關閉狀態存在獨立的 localStorage key，不放進 lang-learn.prefs.v1，所以不會進入備份、也不會被還原帶走。
 * 瀏覽器停用儲存時照樣顯示、照樣能關閉，只是下次開頁會再出現。
 */
import { CLOUD_CONFIG } from '../config/cloud.js';
import { cloudMode, newSiteHref, CLOUD_MODES } from '../core/cloud-origin.js';

export const MOVE_NOTICE_KEY = 'lang-learn.move-notice.v1';

/**
 * 讀取是否已關閉；儲存不可用時視為未關閉。
 */
function dismissed() {
  try { return window.localStorage.getItem(MOVE_NOTICE_KEY) === 'dismissed'; } catch { return false; }
}

function rememberDismissed() {
  try { window.localStorage.setItem(MOVE_NOTICE_KEY, 'dismissed'); } catch { /* 停用儲存時只關閉這一頁 */ }
}

/**
 * 在 anchor（導覽列）後面插入搬家提示；不需要顯示時回傳 null。
 * base 是本頁到網站根目錄的相對前綴（根目錄頁 './'、語言子頁 '../'），站內連結一律相對路徑。
 */
export function renderLegacyBanner(anchor, base, { origin = window.location.origin, config = CLOUD_CONFIG } = {}) {
  if (!anchor || cloudMode(origin, config) !== CLOUD_MODES.LEGACY) return null;
  const href = newSiteHref(config);
  if (!href || dismissed()) return null;

  const banner = document.createElement('aside');
  banner.className = 'move-notice';
  banner.dataset.legacyBanner = '';
  banner.setAttribute('aria-label', '網站搬家提示');
  banner.innerHTML = `
    <div class="move-notice-in">
      <div class="move-notice-text">
        <p><b>本站已搬到新網址：</b><a data-new-site rel="noopener"></a>。這裡仍可照常使用，但兩邊的紀錄不會自動互通。</p>
        <p>用備份代碼搬移紀錄：在這裡的<a href="${base}index.html#backup">首頁「備份與還原」</a>按「複製代碼」，
          到新網址的首頁貼上並按「讀取代碼」。詳細步驟見<a href="${base}help.html">使用教學</a>的「紀錄會存多久」。</p>
      </div>
      <button class="move-notice-close" type="button" data-legacy-banner-close aria-label="關閉搬家提示">✕</button>
    </div>`;
  const link = banner.querySelector('[data-new-site]');
  link.href = href;
  link.textContent = new URL(href).host;
  banner.querySelector('[data-legacy-banner-close]').addEventListener('click', () => {
    rememberDismissed();
    banner.remove();
  });
  anchor.insertAdjacentElement('afterend', banner);
  return banner;
}
