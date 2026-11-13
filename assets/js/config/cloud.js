/**
 * 雲端主機設定（add-cloud-sync，H05–H07）。全部留空時不啟用任何雲端功能：
 * 不顯示登入入口、不發 /api 請求，也不顯示搬家提示。
 *
 * - siteOrigin：新網址（Workers）的 origin，例如 https://名稱.子網域.workers.dev；只有在這個 origin 才啟用登入與同步。
 * - legacyOrigins：舊站（GitHub Pages）的 origin 清單，例如 https://帳號.github.io；只在這些 origin 顯示搬家提示。
 * - newSiteUrl：搬家提示裡的新網址連結，必須是 http(s) 網址。
 * 只填 origin（協定＋主機＋port），不含路徑；部署步驟見設計文件 §10。
 */
export const CLOUD_CONFIG = Object.freeze({
  siteOrigin: '',
  legacyOrigins: Object.freeze([]),
  newSiteUrl: '',
});
