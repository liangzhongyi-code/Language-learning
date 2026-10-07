/**
 * Google 手動備份的 OAuth 用戶端設定；全部留空時網站完全不載入 Google SDK、
 * 不發任何 Google 請求，所有本機功能照常可用。
 *
 * 設定方式（全部在 Google Cloud Console 的「同一個專案」內完成）：
 * 1. 「API 和服務 → 程式庫」只啟用 Google Drive API，不需要其他 API。
 * 2. 「OAuth 同意畫面」只加入 drive.appdata、openid、email 三個範圍；
 *    不要加完整 Drive 權限。
 * 3. 「憑證 → 建立憑證 → OAuth 用戶端 ID」依平台各建一個：
 *    - 網頁應用程式 → 填入 webClientId。
 *      「已授權的 JavaScript 來源」填 GitHub Pages 的 origin，
 *      例如 https://使用者名稱.github.io（只填 origin，不含 repo 路徑、不加結尾斜線）；
 *      本機測試可另加 http://localhost:埠號。token model 不需要重新導向 URI。
 *    - 電腦版應用程式（Windows）→ 填入 windowsClientId。
 *    - Android（套件名稱＋簽章 SHA-1）→ 填入 androidClientId。
 *    - iOS（Bundle ID）→ 填入 iosClientId。
 * 4. Client ID 屬於公開識別碼，可以放進原始碼；本專案不使用 Client Secret，
 *    也不需要 API key，請勿把任何密鑰寫進這個檔案。
 */
export const GOOGLE_CONFIG = Object.freeze({
  webClientId: '',
  windowsClientId: '',
  androidClientId: '',
  iosClientId: '',
});
