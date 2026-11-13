# 雲端主機、Google 登入與同步任務

> 2026-11-13 · 分支 `feature/add-cloud-sync`（自 origin/main `51d36b9`）· 設計及任務均已核准。
> 每個任務都照 RED → GREEN → REFACTOR：先寫會失敗的測試並親眼看到失敗，再寫最小實作。核准不代表完成，完成以驗證紀錄為準。
> 驗收情境見 [specs/](specs/)；每個情境只對應一個主要任務（見文末「情境對照」）。

## 共通約定
- **測試指令**：
  - 純邏輯與 Miniflare：`node --test tests/<檔名>`。
  - 全套：`npm test`。
  - 瀏覽器：`npm run test:browser`。
  - 雲端瀏覽器套件：`node tests/browser/run.mjs --suite <名稱>`，由套件自己啟動 `wrangler dev`。
- **Miniflare 測試**：用 wrangler 提供的本機環境取得真的本機 D1（TD-8）；每個測試檔各自建立暫存資料庫並套用 migration，不共用狀態，不連任何外部網路。
- **假 Google**：`tests/helpers/fake-google.mjs` 在本機隨機 port 模擬授權與 token 端點；只在 `ENVIRONMENT=test` 時透過 `GOOGLE_OAUTH_BASE` 指向它。
- **提交方式**：每個任務完成後交付 commit 訊息；是否由 Claude 直接 commit 依使用者在第二道核准時的指示。

## 任務

2026-11-13 狀態：T01～T22 已實作並完成本機驗證。T23 正式部署及真實帳號／實體裝置驗收尚未進行。

- Node 全量：`node --test --test-concurrency=3`，1,458 項通過。
- Chromium 全站：`npm run test:browser`，3 項執行器檢查與 31 個套件通過。
- 本機 Worker 全站：`node tests/browser/run.mjs --suite all --server wrangler`，31 個套件通過；289 次 307，38 次帶查詢字串均保留，4 次 404 均為刻意查詢非網站路徑。H02 另驗 35 個非網站路徑全部 404。
- 本機 Worker、D1、假 Google 及兩個隔離瀏覽器：`node tests/browser/cloud-worker-sync.mjs` 通過，涵蓋首次同步、取消預覽零寫入、雲端較新、衝突三個選項及壞快照。

### 第 1 段：主機骨架（Cloudflare Workers）

**T01 wrangler 與 Worker 骨架**（標準，30 分）
- 檔案：`package.json`（wrangler 鎖定版本、`build:site`、`dev:worker`、`deploy` 腳本）、`wrangler.jsonc`、`tools/build-site.mjs`、`worker/src/index.js`、`worker/src/http.js`、`tests/worker-routing.test.js`、`tests/helpers/worker-env.mjs`。
- 相依：無。
- 做法：
  - 設定 `assets.directory: "."` 與 `run_worker_first: ["/api/*"]`。
  - 路由表與統一錯誤格式；未知 `/api/*` 回 404 JSON。
  - 測試檢查正式設定檔不含 `GOOGLE_OAUTH_BASE` 與 `ENVIRONMENT=test`。
- 驗證：`node --test tests/worker-routing.test.js`。
- 成功：H03、H04 的測試先紅後綠；`npx wrangler dev` 能在本機開啟首頁。

**T02 不公開非網站檔案**（簡單，15 分）
- 檔案：`tools/build-site.mjs`（T01 已建立）、`tests/structure.test.js`、`tests/build-site.test.js`。
- 相依：T01。
- 做法：
  - 測試 `dist-site/` 只含白名單項目；結構測試要求每個頂層 `.html` 都在 `SITE_ENTRIES` 中，避免新頁面忘了發布。
  - 在 `wrangler dev` 上逐一請求 H02 列出的路徑。
- 驗證：`node --test tests/structure.test.js`，以及 `node tests/browser/run.mjs --suite cloud-hosting`。
- 成功：H02 先紅後綠。

**T03 全站在 Workers 跑過既有瀏覽器套件**（複雜，45 分）
- 檔案：`tests/browser/run.mjs`、`tests/browser/server.mjs`（新增「以 `wrangler dev` 當伺服器」的模式）。
- 相依：T02。
- 做法：
  - 讓既有的全部瀏覽器套件可以改用 `wrangler dev` 當伺服器執行。
  - 記錄 `html_handling` 的 307 轉址次數與網址形式，並確認相對路徑、模組預載與題庫預載都正確。
- 驗證：`node tests/browser/run.mjs --suite all --server wrangler`。
- 成功：H01 全綠。307 的實測結果寫進邏輯變更紀錄；若不可接受，停下來回報，不自行改設計。

### 第 2 段：資料庫與權限規則

**T04 D1 schema 與存取層**（標準，30 分）
- 檔案：`worker/migrations/0001_init.sql`、`worker/src/db.js`、`tests/worker-db.test.js`。
- 相依：T01。
- 做法：
  - 全部用 `CREATE TABLE IF NOT EXISTS` 與 `CREATE UNIQUE INDEX IF NOT EXISTS`，加上 `role` 的 CHECK。
  - 測試：migration 連續套用兩次不報錯；插入第二位擁有者失敗；`role` 填錯值失敗。
- 驗證：`node --test tests/worker-db.test.js`。
- 成功：上述三項先紅後綠。這是 M13 資料庫那一半的保證，情境本身由 T13 負責。

**T05 權限總表**（簡單，15 分）
- 檔案：`worker/src/roles.js`、`tests/worker-roles.test.js`。
- 相依：無。
- 做法：`can(actorRole, action, targetRole)`，用規格的權限總表窮舉「3 種操作者 × 5 種動作 × 3 種目標」。
- 驗證：`node --test tests/worker-roles.test.js`。
- 成功：窮舉表全綠，且與 `cloud-admin.md` 的總表逐格一致。

### 第 3 段：登入與 session

**T06 登入開始與 returnTo**（標準，30 分）
- 檔案：`worker/src/auth.js`、`tests/worker-auth-start.test.js`。
- 相依：T04。
- 做法：
  - 產生 state 與 PKCE（S256），`login_states` 只存 state 的雜湊，有效 10 分鐘。
  - `returnTo` 正規化：外部網址、`//`、反斜線、控制字元一律改成 `/`。
  - 302 到 Google 的網址參數齊全。
- 驗證：`node --test tests/worker-auth-start.test.js`。
- 成功：A05 先紅後綠。

**T07 登入回呼**（複雜，60 分）
- 檔案：`worker/src/auth.js`、`worker/src/session.js`、`tests/helpers/fake-google.mjs`、`tests/worker-auth-callback.test.js`。
- 相依：T05、T06。
- 做法：
  - 用授權碼加 verifier 加 secret 換 token；檢查 id_token 的 `aud`、`iss`、`exp`、`email_verified`。
  - 查白名單後建立或更新 users，建 session（只存雜湊），cookie 加上 `__Host-` 前綴與規定屬性。
  - 處理取消、state 失效或重放、PKCE 錯誤、交換失敗、白名單外。
- 驗證：`node --test tests/worker-auth-callback.test.js`。
- 成功：A02、A03、A04 先紅後綠，並檢查 D1 內容與 `Set-Cookie` 的每個屬性。

**T08 每次請求的存取檢查**（複雜，45 分）
- 檔案：`worker/src/access.js`、`worker/src/index.js`、`tests/worker-access.test.js`。
- 相依：T07。
- 做法：
  - 一句 SQL 同時驗 session 與白名單，再區分 401 與 403，403 時刪除該使用者全部 session。
  - 支援 `ACCESS_MODE`；寫入類請求做 Origin 檢查；`GET /api/me` 回傳 `role`。
- 驗證：`node --test tests/worker-access.test.js`。
- 成功：A06、A07、A08、A10、A11 先紅後綠。A10 用注入的時鐘測過期，另測被竄改的 cookie。

**T09 登出與刪除雲端資料**（標準，20 分）
- 檔案：`worker/src/auth.js`、`worker/src/snapshot.js`、`tests/worker-account.test.js`。
- 相依：T08。
- 做法：`POST /api/auth/logout` 與 `DELETE /api/account`；刪除後白名單保持不變。
- 驗證：`node --test tests/worker-account.test.js`。
- 成功：A09、A12 的伺服器端先紅後綠（畫面部分在 T18）。

### 第 4 段：快照 API

**T10 快照上傳與下載**（複雜，60 分）
- 檔案：`worker/src/snapshot.js`、`tests/worker-snapshot.test.js`。
- 相依：T08。
- 做法：
  - meta、下載、條件式上傳（分塊、`db.batch`、`If-Match`）、409 附帶目前 meta、8 MiB 上限回 413、每小時 60 次回 429 加 `Retry-After`、保存 `upload_id`。
  - 並行測試：兩個請求以同一個基準同時上傳，只能成功一個，失敗的那個不留下任何分塊。
- 驗證：`node --test tests/worker-snapshot.test.js`。
- 成功：C07、C11（伺服器端）、C12 先紅後綠；跨帳號讀不到別人的快照。

**T11 機密不外洩**（標準，20 分）
- 檔案：`tests/worker-secrets.test.js`、`tests/structure.test.js`。
- 相依：T07～T10。
- 做法：
  - 用固定的假 secret 與假 token 跑完整流程，攔截 `console` 輸出，掃描每個回應 body 與導回網址。
  - 結構測試禁止前端原始碼出現 `client_secret` 或 token 端點網址。
- 驗證：`node --test tests/worker-secrets.test.js`。
- 成功：A13 先紅後綠（先放一行故意 log secret 的程式碼確認測試會抓到，再移除）。

### 第 5 段：管理 API

**T12 名單查詢與新增成員**（複雜，45 分）
- 檔案：`worker/src/admin.js`、`tests/worker-admin-list.test.js`。
- 相依：T05、T08。
- 做法：
  - `GET` 與 `POST /api/admin/members`；名單合併白名單、users、session 與快照時間；排序規則依規格。
  - 開放模式下不在名單的人也要列出；新增一律存成成員，忽略請求夾帶的 `role`。
- 驗證：`node --test tests/worker-admin-list.test.js`。
- 成功：M01（API）、M03、M04、M05、M06 先紅後綠。

**T13 修改、角色調整與擁有者保護**（複雜，60 分）
- 檔案：`worker/src/admin.js`、`tests/worker-admin-write.test.js`。
- 相依：T12。
- 做法：
  - `PATCH` 改暱稱或角色、`DELETE` 移除，全部經過 `roles.can()`。
  - 任何以擁有者為對象或要設成 `owner` 的操作回 409；移除後該人的 session 失效；每次請求重新讀取角色。
- 驗證：`node --test tests/worker-admin-write.test.js`。
- 成功：M08、M09、M10、M11、M12、M13、M14 先紅後綠；M07 的伺服器端權限也一併涵蓋。

### 第 6 段：前端同步核心

**T14 同步判斷純邏輯**（複雜，45 分）
- 檔案：`assets/js/core/cloud-sync.js`、`tests/cloud-sync.test.js`。
- 相依：無。
- 做法：`decide({ local, baseline, cloud, accountId })` 回傳動作（上傳、提示套用、衝突、詢問、無事），以狀態表測試涵蓋全部組合；`core/` 不碰瀏覽器全域。
- 驗證：`node --test tests/cloud-sync.test.js`。
- 成功：C01、C03、C08、C14 先紅後綠；C02、C04～C06 的判斷分支也在表內（它們的流程主任務在 T16 與 T19）。

**T15 本機變更通知與同步基準**（標準，30 分）
- 檔案：`assets/js/ui/platform/learning-store.js`、`assets/js/ui/platform/cloud-baseline.js`、`tests/cloud-baseline.test.js`、`tests/browser/suites/cloud-baseline.mjs`。
- 相依：T14。
- 做法：
  - 寫入成功後發出 `{revision, dataEpoch}`，用 BroadcastChannel 通知其他分頁。
  - `lang-learn.cloud.v1` 依帳號分開存取；確認備份檔與備份代碼都不含它。
- 驗證：`node --test tests/cloud-baseline.test.js`，以及 `node tests/browser/run.mjs --suite cloud-baseline`。
- 成功：C16 先紅後綠；既有的 learning-store 套件仍然全綠。

**T16 雲端 API 與自動上傳執行器**（複雜，60 分）
- 檔案：`assets/js/ui/platform/cloud-api.js`、`assets/js/ui/platform/cloud-sync-runner.js`、`tests/cloud-runner.test.js`。
- 相依：T14、T15。
- 做法：
  - gzip 串流、超過 8 MiB 即停止、10 秒防抖、頁面隱藏時上傳。
  - 退避重試 30 秒、1 分、2 分、5 分；結果不明時先查 meta；Web Locks 控制同時只有一個分頁上傳。
  - 時鐘、transport 與 locks 全部可注入。
- 驗證：`node --test tests/cloud-runner.test.js`。
- 成功：C04、C09、C10、C15 先紅後綠；C11 的前端那一半（不送出、不重試）也一併涵蓋。

### 第 7 段：畫面

**T17 雲端設定、網址閘門與搬家提示**（標準，30 分）
- 檔案：`assets/js/config/cloud.js`、`assets/js/ui/legacy-banner.js`、各頁啟動接線、`tests/browser/suites/cloud-gate.mjs`。
- 相依：T01。
- 做法：
  - 設定全空或 origin 不符時，不啟用雲端、零 `/api` 請求。
  - 舊站 origin 顯示可關閉的搬家提示，關閉狀態存在獨立的 key。
  - 需要時執行 `npm run build:preload`。
- 驗證：`node tests/browser/run.mjs --suite cloud-gate`。
- 成功：H05、H06、H07 先紅後綠。

**T18 導覽列登入、登出與狀態**（標準，45 分）
- 檔案：`assets/js/ui/cloud-view.js`、`assets/js/ui/nav.js`、`assets/css/theme.css`、`tests/browser/suites/cloud-auth.mjs`。
- 相依：T08、T09、T17。
- 做法：
  - 登入是一般連結；顯示 email 與同步狀態。
  - 讀取 `#cloud-error=` 並顯示繁中訊息後清掉 hash；401 時顯示需要重新登入。
  - 登出與刪除雲端資料都要確認對話框。
  - 瀏覽器套件記錄全部網路請求。
- 驗證：`node tests/browser/run.mjs --suite cloud-auth`。
- 成功：A01 先紅後綠（未登入時只有 `/api/me`、沒有任何 Google 網域請求）；A02～A04、A09、A10、A12 的畫面表現一併檢查。

**T19 套用雲端紀錄與衝突選擇**（複雜，60 分）
- 檔案：`assets/js/ui/cloud-view.js`、`assets/js/ui/learning-backup-view.js`（`source: 'cloud'` 的標示）、`tests/browser/suites/cloud-sync.mjs`。
- 相依：T16、T18。
- 做法：
  - 用兩個隔離的 context 模擬兩台裝置共用同一個 `wrangler dev`。
  - 涵蓋新裝置取得、雲端較新、兩邊都改的三個選項、雲端壞資料。
  - 還原一律走 `previewFrom(..., 'cloud')`；套用後立刻寫入同步基準。
- 驗證：`node tests/browser/run.mjs --suite cloud-sync`。
- 成功：C02、C05、C06、C13 先紅後綠；取消時本機零寫入。

**T20 管理後台頁**（複雜，60 分）
- 檔案：`admin.html`、`assets/js/ui/admin-view.js`、`assets/css/theme.css`、`tests/browser/suites/cloud-admin.mjs`。
- 相依：T13、T18。
- 做法：
  - 名單表格、新增表單、暱稱編輯、角色切換、移除確認；按鈕依角色顯示；成員只看到權限提示。
  - 暱稱一律用 `textContent` 顯示。
  - 舊站開啟時顯示「此頁只在新網址可用」。
- 驗證：`node tests/browser/run.mjs --suite cloud-admin`。
- 成功：M02、M07 先紅後綠（`<script>` 暱稱只顯示文字）；三種角色的按鈕顯示與 M01 的頁面表現一併檢查。

### 第 8 段：文件與收尾

**T21 隱私頁、說明與設定手冊**（標準，30 分）
- 檔案：`privacy.html`、`help.html`、`README.md`、`docs/cloud-setup.md`、`openspec/tools/check-task-coverage.mjs`（加入 `[HACM]` 這一組）。
- 相依：T17～T20。
- 做法：
  - 說明保存內容、刪除方式、沒有端到端加密、衝突時只能保留一邊。
  - 手冊列出部署步驟與白名單、擁有者的 SQL，只用假資料，不寫個人 email 或網址。
- 驗證：`npm test`（含結構與文件連結測試），以及 `node openspec/tools/check-task-coverage.mjs`。
- 成功：文件測試全綠；情境對照完整且不重複。

**T22 全套驗證與邏輯變更紀錄**（標準，30 分）
- 檔案：`docs/logic-changes/2026-11-13-001-cloud-sync.md`、`docs/logic-changes/README.md`，重新產生 HTML 閱讀版。
- 相依：T01～T21。
- 做法：跑 `npm test`、`npm run test:browser`，加上雲端套件與 `wrangler dev` 版的全站套件，逐項記錄實際結果；狀態標為「已驗證（本機）；未部署」。
- 驗證：上述指令全綠。
- 成功：紀錄、索引與閱讀版一致；沒有任何部署或真實帳號的宣稱。

**T23 部署與人工驗收**（需使用者參與，不計入自動化）
- 依 design §10 執行。標「使用者」的步驟由使用者本人完成：wrangler login、Google OAuth 用戶端與 secret、擁有者 email。
- 部署後對線上網址跑 H01 套件，人工驗收：
  - 真實帳號登入。
  - 白名單外的帳號被拒。
  - 兩台實體裝置的衝突選擇。
  - 三種角色的後台操作。
- 結果追加到邏輯變更紀錄，狀態改為「已部署」。
- 舊站推送搬家提示要另外取得使用者同意後才推送。

## 情境對照
| 情境 | 任務 | 驗證方式 |
|---|---|---|
| H01 | T03 | 既有瀏覽器全套改跑 `wrangler dev` |
| H02 | T02 | 結構測試＋`wrangler dev` 逐一請求 |
| H03 | T01 | Miniflare 路由測試＋設定檔檢查 |
| H04 | T01 | Miniflare 路由測試 |
| H05 | T17 | 瀏覽器網路紀錄 |
| H06 | T17 | 瀏覽器（假舊站 origin） |
| H07 | T17 | 瀏覽器 |
| A01 | T18 | 瀏覽器網路紀錄 |
| A02 | T07 | Miniflare＋假 Google |
| A03 | T07 | Miniflare＋假 Google |
| A04 | T07 | Miniflare＋假 Google |
| A05 | T06 | Miniflare |
| A06 | T08 | Miniflare（直接改白名單） |
| A07 | T08 | Miniflare |
| A08 | T08 | Miniflare（切換 ACCESS_MODE） |
| A09 | T09 | Miniflare＋瀏覽器（T18） |
| A10 | T08 | Miniflare（注入時鐘、竄改 cookie） |
| A11 | T08 | Miniflare（每個寫入端點） |
| A12 | T09 | Miniflare＋瀏覽器（T18） |
| A13 | T11 | Miniflare 全流程掃描＋結構測試 |
| C01 | T14 | 狀態表單元測試 |
| C02 | T19 | 瀏覽器兩個 context |
| C03 | T14 | 狀態表單元測試 |
| C04 | T16 | 注入時鐘與 transport |
| C05 | T19 | 瀏覽器兩個 context |
| C06 | T19 | 瀏覽器兩個 context（三個選項） |
| C07 | T10 | Miniflare 並行上傳 |
| C08 | T14 | 狀態表單元測試 |
| C09 | T16 | 注入時鐘與失敗的 transport |
| C10 | T16 | 不明結果後先查 meta |
| C11 | T10 | Miniflare 413＋執行器不送出（T16） |
| C12 | T10 | Miniflare 429 與 Retry-After |
| C13 | T19 | 瀏覽器（雲端壞資料） |
| C14 | T14 | 狀態表單元測試 |
| C15 | T16 | 注入 Web Locks |
| C16 | T15 | 單元測試＋瀏覽器匯出檢查 |
| M01 | T12 | Miniflare（API）＋瀏覽器頁面（T20） |
| M02 | T20 | 瀏覽器三種角色 |
| M03 | T12 | Miniflare |
| M04 | T12 | Miniflare |
| M05 | T12 | Miniflare（欄位與排序） |
| M06 | T12 | Miniflare（開放模式） |
| M07 | T20 | 瀏覽器（XSS）＋Miniflare 權限（T13） |
| M08 | T13 | Miniflare |
| M09 | T13 | Miniflare |
| M10 | T13 | Miniflare |
| M11 | T13 | Miniflare |
| M12 | T13 | Miniflare |
| M13 | T13 | Miniflare＋唯一索引（T04） |
| M14 | T13 | Miniflare |

## 平行可能性
可以同時進行的獨立任務：
- T05、T14 不依賴其他任務，隨時可以開始。
- T01 完成後，T02、T04、T17 可以平行。
- 前端的 T14～T16 與 Worker 的 T06～T13 互不碰同一批檔案。

T18～T20 都要改 `cloud-view.js` 與 `theme.css`，必須依序進行。

## 不在本任務清單
Tauri APP 登入、事件層級合併、自訂網域、`_headers` 安全標頭、擁有者轉讓、真實部署以外的雲端監控。
