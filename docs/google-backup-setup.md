# Google 雲端備份設定手冊

本網站的 Google 備份是**選用**功能。`assets/js/config/google.js` 內所有用戶端 ID 預設為空字串，此時網站不載入 Google SDK、不發出任何 Google 請求，所有本機功能照常使用。

本手冊說明網站管理者如何設定。不要在 issue、聊天或文件中貼出任何 token；本功能不需要 Client Secret 或 API key。

## 1. 建立 Google Cloud 專案

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立一個專案（網站、Windows、Android、iOS 共用同一個專案）。
2. 「API 和服務」→「程式庫」→ 啟用 **Google Drive API**。
3. 「OAuth 同意畫面」：
   - 使用者類型依實際情況選擇；尚未送審前保持「測試」狀態並把要使用的 Google 帳號加入**測試使用者**。
   - 範圍只加入 `https://www.googleapis.com/auth/drive.appdata`、`openid`、`email`。不要加入完整 Drive 權限。

## 2. 網站（GitHub Pages）

1. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 類型選**網頁應用程式**。
2. 「已授權的 JavaScript 來源」填網站的 origin，例如 `https://<帳號>.github.io`。**只填 origin，不含 repo 路徑**。本機測試可另加 `http://localhost:<埠號>`。
3. 不需要「已授權的重新導向 URI」（網站使用 Google Identity Services 的 token model 彈出視窗）。
4. 把用戶端 ID 填入 `assets/js/config/google.js` 的 `webClientId`，提交並部署。

## 3. Windows／Android／iOS APP（原生封裝完成後）

原生 APP 不使用網站的彈出視窗，各平台使用官方支援的授權方式（見 `openspec/changes/add-offline-study-suite/design.md` TD-5）：

| 平台 | 用戶端類型 | 備註 |
|---|---|---|
| Windows | 桌面應用程式 | 系統瀏覽器＋PKCE＋loopback redirect |
| Android | Android（套件名稱＋簽署憑證 SHA-1） | 官方授權 API；套件名稱與簽署金鑰須與發行版一致 |
| iOS | iOS（bundle ID） | Google Sign-In SDK；bundle ID 須與側載版一致 |

填入 `windowsClientId`、`androidClientId`、`iosClientId`。原生授權尚未實作與驗收，詳見 APP 任務 F64。

## 4. 驗證

設定完成後，以測試使用者在首頁「Google 雲端備份」：

1. 按「連接 Google 帳號」，確認顯示的 email 正確。
2. 按兩次「備份到 Google」，再按「列出雲端備份」，應看到兩份不同時間的快照。
3. 對其中一份按「預覽還原」，在「學習紀錄」面板確認內容後再按確認。
4. 按「中斷連接」，清單與來自雲端的預覽應立即清除。

## 5. 已知限制

- 雲端快照沒有額外端到端加密；Google 帳號空間會被占用，首版沒有自動清理。
- 上傳逾時時結果為「無法確認」；重試會先以 exportId 查詢，但 Drive 查詢可能有延遲，無法保證只建立一份。重複的快照在清單中可由同一個匯出時間辨識。
- token 只存在分頁記憶體；關閉分頁需重新連接。
- 本專案的自動化測試只以模擬的 GIS 與 Drive 驗證流程；真實帳號授權與跨裝置還原（規格 G10）需在填入 Client ID 後人工驗收。
