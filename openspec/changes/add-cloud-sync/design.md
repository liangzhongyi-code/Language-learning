# 雲端主機、Google 登入與同步設計

> 2026-11-13｜add-cloud-sync｜完整模式｜待核准（v3：使用者已採用 TD-2、TD-4、TD-5、TD-6 與 C08 的方向；管理後台改為擁有者、管理員、成員三層，TD-9 待核准）
> 原始文件以本檔為準；HTML 只是閱讀副本。

## 1. Overview

### 1.1 Purpose
把純靜態網站搬到 Cloudflare Workers，並在同一個網址加上最小的後端：Google 登入、白名單、session，以及「整份快照＋版本號」的學習紀錄同步。未登入的使用者行為完全不變；登入的人在多台裝置之間自動延續紀錄。遇到衝突時由使用者選擇，不靜默覆蓋任何一邊。

### 1.2 Scope
- **包含**：Workers 靜態資源與 `/api/*` 路由、D1 schema 與 migrations、Google OAuth 授權碼流程加 PKCE、白名單與開放模式、session cookie、快照上傳與下載、同步判斷邏輯、登入與同步 UI、管理後台、舊站搬家提示、隱私頁、部署手冊。
- **不包含**：Tauri APP 登入、事件層級合併、自訂網域、端到端加密、Drive 備份的任何改動、`_headers` 安全標頭（列在 Open Questions）。

### 1.3 Related Documents
- [proposal.md](proposal.md)
- [specs/cloud-hosting.md](specs/cloud-hosting.md)（H01–H07）
- [specs/cloud-auth.md](specs/cloud-auth.md)（A01–A13）
- [specs/cloud-sync.md](specs/cloud-sync.md)（C01–C16）
- [specs/cloud-admin.md](specs/cloud-admin.md)（M01–M14）
- 既有設計：[add-offline-study-suite/design.md](../add-offline-study-suite/design.md) TD-4、TD-5，資料契約與還原流程沿用

## 2. Architecture

### 2.1 System Context

```
瀏覽器（https://<name>.<sub>.workers.dev）
 ├─ 頁面／JS／題庫 ──────────────► Workers 靜態資源（不經 Worker，免費、不計請求數）
 └─ fetch('/api/…', 同網域 cookie) ► Worker（run_worker_first: /api/*）
                                       ├─ D1：allowed_emails／users／sessions／
                                       │       login_states／snapshots／snapshot_chunks／upload_log
                                       └─ Google OAuth（只在登入時由 Worker 呼叫 token 端點）

登入：瀏覽器 ─GET /api/auth/start─► Worker ─302─► accounts.google.com
       ◄─302 /api/auth/callback?code&state── Google
       Worker ─POST token 端點（code＋verifier＋secret）─► Google ─► id_token
       Worker 驗 aud/iss/exp/email_verified → 查白名單 → 建 session → Set-Cookie → 302 回原頁

舊站（https://<帳號>.github.io/<repo>/）：同一份前端，origin 不符 → 不啟用雲端，只顯示搬家提示
```

### 2.2 Components

| 元件 | 位置 | 職責 |
|---|---|---|
| Worker 入口與路由 | `worker/src/index.js` | 分派 `/api/*`、Origin 檢查、錯誤格式、未知路徑 404 |
| 授權 | `worker/src/auth.js` | start／callback、state 與 PKCE、token 交換、id_token 欄位驗證、`returnTo` 正規化 |
| session 與存取權 | `worker/src/session.js`、`worker/src/access.js` | session 建立、查詢、刪除；白名單與 `ACCESS_MODE` 判斷 |
| 快照 | `worker/src/snapshot.js` | meta、下載、條件式上傳、分塊、大小與頻率上限、刪除帳號 |
| 管理 API | `worker/src/admin.js` | 名單列表、新增成員、改暱稱、調整角色、移除；每次請求重新讀取角色，依權限總表判斷 |
| 權限規則 | `worker/src/roles.js` | 純函式 `can(actorRole, action, targetRole)`，權限總表只在這裡定義一次 |
| 管理後台頁 | `admin.html`、`assets/js/ui/admin-view.js` | 名單表格、新增表單、暱稱編輯、角色切換、移除確認；按鈕依角色顯示；成員只看到權限提示 |
| D1 存取層 | `worker/src/db.js` | 全部 SQL 集中於此，路由不直接寫 SQL |
| 雲端設定 | `assets/js/config/cloud.js` | `siteOrigin`、`legacyOrigins`、`newSiteUrl`；全空時不啟用 |
| 同步判斷 | `assets/js/core/cloud-sync.js` | 純函式：輸入本機 meta、同步基準、雲端 meta，輸出動作（上傳、提示套用、衝突、暫停、無事） |
| 同步 adapter | `assets/js/ui/platform/cloud-api.js`、`assets/js/ui/platform/cloud-sync-runner.js` | API 呼叫、gzip、防抖、退避、Web Locks、同步基準存取 |
| UI | `assets/js/ui/cloud-view.js`、`assets/js/ui/nav.js`、首頁 | 導覽列登入與狀態、衝突選擇、提示；還原一律交給既有 `previewFrom(readText, 'cloud')` |
| 搬家提示 | `assets/js/ui/legacy-banner.js` | 只在 `legacyOrigins` 顯示 |
| 本機變更通知 | `assets/js/ui/platform/learning-store.js` | 寫入成功後發出 `{revision, dataEpoch}`，並以 BroadcastChannel 通知其他分頁 |

### 2.3 Component Interactions
1. 頁面載入時，`cloud-view` 檢查 origin；符合時呼叫 `GET /api/me`。
2. 已登入就啟動 `cloud-sync-runner`：讀取本機 meta 與同步基準，查 `GET /api/snapshot/meta`，交給 `core/cloud-sync.decide()`。
3. 依 `decide()` 的結果：
   - **上傳**：在 Web Lock 內匯出 v2 備份、gzip 後 `PUT`。
   - **提示套用或衝突**：顯示選項；使用者選「用雲端」時，以 `previewFrom(() => 下載並解壓, 'cloud')` 交給首頁面板。
4. 確認還原後，`restore-controller` 回傳新的 `revision`／`dataEpoch`，runner 把它記為同步基準，並標記「來自雲端」，避免觸發 C08 的詢問。
5. `learning-store` 每次寫入成功就通知 runner：同一個 epoch 排程防抖上傳；epoch 改變則依 C08 詢問。

## 3. Technical Decisions

### TD-1：主機用 Workers 靜態資源加同一個 Worker 的 API
- **Context**：要有後端存紀錄，登入狀態要能跨頁、跨分頁記住。
- **Options**：
  1. 留在 GitHub Pages，API 另放 Workers。缺點是跨站 cookie，會被 Safari 等瀏覽器擋，還要處理 CORS。
  2. Cloudflare Pages 加 Functions。可行，但官方近年新功能主推 Workers。
  3. Workers 靜態資源加同一個 Worker 的 `/api/*`。
- **Decision**：選 3。設定 `assets.directory: "."`，用 `.assetsignore` 排除非網站檔案，`run_worker_first: ["/api/*"]`。
- **Rationale**：同網域 cookie 最單純，沒有 CORS。官方說明靜態資源請求「免費且不限量」，只有 API 請求消耗每天 10 萬次的額度。網站本身不需要建置步驟，可以直接發布。
- **Consequences**：
  - `.assetsignore` 漏寫就會公開原始碼，由 H02 守住。
  - 預設的 `html_handling: auto-trailing-slash` 會把 `/en/quiz.html` 以 307 轉到 `/en/quiz`。站內相對路徑仍然正確（同一層目錄），但每次站內換頁會多一次轉址、網址列不帶 `.html`。由 H01 實測，結果不可接受時改 Open Questions 的替代方案。
  - GitHub Pages 與 Workers 會是兩個 origin，瀏覽器資料不共通，需要搬家（H06）。

### TD-2：登入採伺服器端轉址授權碼流程加 PKCE
- **Context**：要知道使用者是誰（email），session 由伺服器發，前端不碰任何 token。
- **Options**：
  1. GIS「Sign in with Google」按鈕取得 ID token 再 POST。不需 secret，但要在頁面載入時先載 Google 腳本才能畫按鈕，違反 A01，還要自己抓 JWKS 驗簽。
  2. GIS 授權碼彈窗。要 secret；彈窗必須在點擊當下同步開啟，等腳本載完再開會被擋，一樣得預載腳本。
  3. 一般連結 `/api/auth/start` 轉址到 Google，回呼由 Worker 換 token。
- **Decision**：選 3。`response_type=code`、`scope=openid email`、`prompt=select_account`，加上 `state` 與 `code_challenge`（S256）。
- **Rationale**：前端零 Google 腳本、沒有彈窗被擋的問題，所有瀏覽器都能用。id_token 是 Worker 透過 HTTPS、以 Client Secret 直接向 Google token 端點取得的，Google 文件說明這種情況可以不另外驗簽；仍會檢查 `aud`、`iss`、`exp`、`email_verified`。
- **Consequences**：
  - 登入會離開目前頁面再回來。作答已逐題保存，影響小；`returnTo` 只允許本站路徑（A05）。
  - Client Secret 以 `wrangler secret` 保存，不進版控（A13）。

### TD-3：session 存在 D1，cookie 只放隨機 token
- **Context**：要能立刻登出、刪除帳號，並讓白名單移除即時生效（A06）。
- **Options**：
  1. 簽章 JWT cookie，無狀態。撤銷困難，白名單移除要等到過期。
  2. D1 session 表。cookie 是 32 bytes 隨機值，表裡只存它的 SHA-256。
- **Decision**：選 2。有效期 30 天、不滑動延長；cookie 名稱 `__Host-ll_session`，屬性為 `HttpOnly; Secure; SameSite=Lax; Path=/`。
- **Rationale**：可以隨時撤銷；資料庫外洩時也拿不到可用的 token；每次請求的雜湊運算成本極低，在 10ms CPU 內。
- **Consequences**：每個需要登入的 API 都多一次 D1 查詢（session 與白名單合併成一句 SQL）。過期的 session 在登入時順便清理。

### TD-4：白名單放 D1 資料表，加上存取模式開關
- **Context**：使用者要求白名單可以隨時調整。
- **Options**：
  1. 只用 Google 同意畫面「測試使用者」。最多 100 人，名單在 Google 後台，跟本站資料分開，且只能擋登入、不能撤銷既有 session。
  2. Worker 環境變數。修改等於部署一個新版本。
  3. D1 `allowed_emails` 表，搭配 `ACCESS_MODE` 變數（`allowlist` 為預設，`open` 開放）。
- **Decision**：選 3。用 `wrangler d1 execute` 執行一行 SQL 就能新增或移除，比對前一律把 email 轉小寫並去除空白。
- **Rationale**：不用部署就能即時生效，名單和使用者資料在同一個地方，也能撤銷 session（A06、A07）。
- **Consequences**：
  - 日常增刪成員改用管理後台（TD-9）；SQL 指令保留在手冊，作為設定第一位管理員與緊急處理用。
  - Google 同意畫面改為「正式版」：只用 `openid email` 屬非敏感範圍，不需 Google 審查；實際上線前仍需人工確認。
  - 名單不進版控，因為 email 屬個資。

### TD-5：快照存在 D1 並分塊，不使用 R2 或 KV
- **Context**：快照壓縮後可能超過 1 MB；D1 單列上限是 2,000,000 bytes。
- **Options**：
  1. R2 物件儲存。沒有單檔問題，但跟 D1 之間無法做到同一交易，開通時可能要求綁付款方式（未確認）。
  2. KV。有最終一致性，最長約 60 秒，不適合用版本號判斷衝突；免費版每天只能寫 1,000 次。
  3. D1 `snapshot_chunks`，每塊最多 1,900,000 bytes，由 meta 列記錄 revision 與塊數。
- **Decision**：選 3。壓縮後上限 8 MiB，最多 5 塊。
- **Rationale**：meta 與分塊可用 `db.batch()` 在同一個交易內完成條件式更新，沒有半寫入的問題；免費版單一資料庫 500 MB，白名單規模足夠。
- **Consequences**：
  - 開放模式且人數大增時要改 R2，介面不變，只換 `snapshot.js` 的儲存實作。
  - 每次上傳寫入的列數是「塊數＋2」，遠低於免費版每天的寫入額度。

### TD-6：同步模型用整份快照加樂觀鎖
- **Context**：使用者選擇自動上傳、衝突時自己選；既有設計也拒絕自動合併。
- **Options**：
  1. 最後寫入者勝。會默默蓋掉另一台的進度。
  2. 逐題事件合併。要重新設計衝突模型，FSRS 狀態也無法簡單合併。
  3. 整份快照加 revision，上傳帶 `If-Match`，版本不符回 409。
- **Decision**：選 3。伺服器只保存最新一份；本機在替換前已經有還原點（最多 3 份）可以回復。
- **Rationale**：沿用既有的 v2 備份格式、深驗證與還原流程；行為可以預期，也容易測試。
- **Consequences**：兩台裝置同時練習，必定會出現衝突選擇，只能保留其中一邊的新進度，這點要在 help.html 明確寫出。

### TD-7：本機變更以 repository 的 revision 與 dataEpoch 判斷
- **Context**：要分辨「本機有增量變更」與「整組替換」，並且不能每次都比對整份資料。
- **Options**：
  1. 每次匯出整份資料並計算雜湊。成本高，也無法分辨替換與增量。
  2. 讀 repository meta 既有的 `revision`（每次寫入加 1）與 `dataEpoch`（替換或清除時換新）。
- **Decision**：選 2。同步基準記錄 `{accountId, cloudRevision, localRevision, localEpoch, origin: 'upload'|'cloud'}`，存在 `localStorage` 的 `lang-learn.cloud.v1`，依帳號分開保存。
- **Rationale**：web 與 native repository 都已經有這兩個欄位；判斷是常數時間。
- **Consequences**：
  - `lang-learn.cloud.v1` 不在備份範圍內（C16），清除網站資料時會跟著消失，之後依 C01～C03 重新判斷。
  - 套用雲端快照後必須立刻寫入新的同步基準，否則會被誤判為整組替換（C08）。

### TD-8：測試分三層，不打真實的 Google 與 Cloudflare
- **Context**：專案規定測試不得連外，也不得使用個人資料；同時要驗證真實的 D1 SQL。
- **Options**：
  1. 全部 mock。SQL 錯誤會漏掉。
  2. 每次都部署到 Cloudflare 測試。慢、需要帳號，也違反隔離原則。
  3. 純邏輯用 `node:test` 加注入的介面；SQL 與路由用 wrangler 的本機模擬環境（Miniflare，本機 D1）；端到端用 `wrangler dev` 加 Playwright，Google 端點以本機假伺服器取代。
- **Decision**：選 3。Google 端點的基底網址可以透過 `GOOGLE_OAUTH_BASE` 覆寫，但只在 `ENVIRONMENT=test` 時生效。正式設定檔不得含這兩個變數，由測試檢查。
- **Rationale**：每一層都能在本機重現、不連外，而且真的跑過 D1 SQL。
- **Consequences**：wrangler 加入 devDependencies 並鎖定版本；真實 Google 登入與跨裝置同步列為人工驗收項目，不能以 mock 通過代替。

### TD-9：管理後台採擁有者、管理員、成員三層角色
- **Context**：使用者希望在網頁上直接新增成員、取暱稱，並看到誰登入過。站長本人要永遠保有最高權限；可以找人幫忙加成員，但幫忙的人不能刪人。
- **Options**：
  1. 只用 SQL 指令。不需要開發，但每次操作都要開終端機。
  2. 兩層：管理員與成員，管理員之間權限相同。任何一位管理員的 session 被盜用，都能把其他人（包含站長）移除或降級。
  3. 三層：擁有者、管理員、成員。同站 `admin.html` 加 `/api/admin/*`，沿用同一套 session 與 Origin 防護，角色存在白名單表的 `role` 欄位。
- **Decision**：選 3。權限依 [cloud-admin.md](specs/cloud-admin.md) 的總表：
  - 擁有者可以新增、移除、改暱稱、升降管理員。
  - 管理員只能新增成員（一律成員身分）、改成員與自己的暱稱、查詢名單。
  - 擁有者只能用 SQL 設定，後台的任何 API 都不能移除、降級或新增擁有者。資料庫以部分唯一索引保證最多一位擁有者。
- **Rationale**：日常操作用網頁完成，同時把破壞性操作（刪人、改角色）集中在擁有者一人。就算管理員的 session 被盜用，對方最多只能多加幾個成員，不能刪除任何人或提升權限；擁有者也不會被任何後台操作鎖在門外。
- **Consequences**：
  - 權限判斷集中在 `roles.js` 的一張表，API 與畫面都依它決定，避免兩邊規則不一致。
  - 擁有者的 session 被盜用時，對方能移除與升降其他人，但仍然無法取代擁有者；處理方式是用 SQL 刪除擁有者的 session。
  - 更換擁有者（例如轉讓網站）要用 SQL，不在後台提供。
  - 後台要防範暱稱裡的 XSS，一律以 `textContent` 顯示。
  - `admin.html` 也會出現在 GitHub Pages 舊站，但舊站沒有啟用雲端，只會顯示「此頁只在新網址可用」。

## 4. Data Design

D1 migrations（`worker/migrations/0001_init.sql`，全部 `CREATE TABLE IF NOT EXISTS`，可重複執行）：

| 表 | 欄位 | 說明 |
|---|---|---|
| `allowed_emails` | `email TEXT PRIMARY KEY`、`nickname TEXT`、`role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member'))`、`created_at INTEGER`、`added_by TEXT` | email 存小寫；暱稱最多 40 字；`added_by` 記錄新增者的 `users.id`，SQL 新增時為空。另建 `CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON allowed_emails(role) WHERE role = 'owner'`，保證最多一位擁有者 |
| `users` | `id TEXT PRIMARY KEY`、`google_sub TEXT UNIQUE NOT NULL`、`email TEXT NOT NULL`、`created_at`、`last_login_at` | `id` 是隨機值，不外露 `google_sub` |
| `sessions` | `token_hash TEXT PRIMARY KEY`、`user_id TEXT NOT NULL`、`created_at`、`expires_at` | 索引：`user_id` |
| `login_states` | `state_hash TEXT PRIMARY KEY`、`code_verifier TEXT`、`return_to TEXT`、`expires_at` | 10 分鐘有效、一次性（讀取後刪除） |
| `snapshots` | `user_id TEXT PRIMARY KEY`、`revision INTEGER NOT NULL`、`upload_id TEXT`、`schema_version INTEGER`、`byte_size INTEGER`、`chunk_count INTEGER`、`device_label TEXT`、`updated_at INTEGER` | 每個帳號一列 |
| `snapshot_chunks` | `user_id`、`revision`、`idx`、`data BLOB`，主鍵是三者組合 | 每塊不超過 1,900,000 bytes |
| `upload_log` | `user_id`、`at INTEGER` | 用來計算 1 小時 60 次的頻率上限，順便清掉超過 1 小時的紀錄 |

條件式上傳（一個 `db.batch()`，在同一個交易內）：
1. 依序 `INSERT` 新 revision（基準 + 1）的每個分塊。兩個上傳同時以同一個基準寫入時，主鍵衝突會讓整批失敗，失敗即回 409。
2. 寫入 meta：`INSERT INTO snapshots … ON CONFLICT(user_id) DO UPDATE SET … WHERE snapshots.revision = ?基準`。
3. 刪除該帳號中 revision 不等於 meta 目前 revision 的分塊。
4. 批次完成後讀取 meta：revision 等於基準 + 1 回 200，否則回 409。第 3 步已經刪掉了這次寫入的分塊（C07）。

前端：
- 上傳內容 = `exportLearningBackup()` 的 JSON 經 gzip（`CompressionStream`）。
- `lang-learn.cloud.v1` = `{ [accountId]: { cloudRevision, localRevision, localEpoch, origin, paused, updatedAt } }`。
- `accountId` 是伺服器回傳的 `users.id`，不是 email。

## 5. API Design

除了 auth 的 start 與 callback 以外，其餘都回 JSON。錯誤格式一律是 `{"error":"CODE"}`；寫入類請求需通過 Origin 檢查（A11）。

| 方法與路徑 | 登入 | 說明與回應 |
|---|---|---|
| `GET /api/auth/start?returnTo=/ja/` | 否 | 建立 state 與 verifier，302 轉到 Google |
| `GET /api/auth/callback?code&state` | 否 | 換 token、驗證、查白名單、建 session。成功 302 回 `returnTo`，失敗 302 回 `returnTo#cloud-error=<CODE>`（`DENIED`、`NOT_ALLOWED`、`STATE_INVALID`、`EXCHANGE_FAILED`） |
| `GET /api/me` | 選用 | 已登入 200 `{accountId, email, role}`（開放模式下不在名單的人，`role` 為 `member`）；未登入 401 |
| `POST /api/auth/logout` | 是 | 204，清除 cookie |
| `GET /api/snapshot/meta` | 是 | 200 `{revision, uploadId, schemaVersion, byteSize, deviceLabel, updatedAt}`；沒有快照時回 `{revision:0}` |
| `GET /api/snapshot` | 是 | 200 `application/gzip`，`X-Revision` 標頭；沒有快照 404 |
| `PUT /api/snapshot` | 是 | 標頭 `If-Match: <revision>`（第一次上傳為 0）、`X-Upload-Id`、`X-Schema-Version`、`X-Device-Label`，body 是 gzip bytes。回應：200 `{revision}`、409 `{error:'REVISION_MISMATCH', current:{…}}`、413、429 帶 `Retry-After` |
| `DELETE /api/account` | 是 | 204，刪除快照、session 與使用者列（A12） |
| `GET /api/admin/members` | 擁有者、管理員 | 200 `{members:[{email, nickname, role, inAllowlist, createdAt, addedBy, lastLoginAt, activeSessions, snapshotUpdatedAt}]}`；白名單與 `users` 以 email 合併。成員或未登入回 403／401 |
| `POST /api/admin/members` | 擁有者、管理員 | body `{email, nickname}`，角色固定 `member`；201、400 `INVALID_EMAIL`／`INVALID_NICKNAME`、409 `ALREADY_EXISTS` |
| `PATCH /api/admin/members/:email` | 依權限總表 | body `{nickname}` 或 `{role}`（只接受 `admin`、`member`）。改暱稱：擁有者可以改任何人，管理員只能改成員與自己，違反回 403 `FORBIDDEN`。改角色：只有擁有者，違反回 403 `OWNER_ONLY`。目標是擁有者，或 `role` 為 `owner`，回 409 `OWNER_PROTECTED` |
| `DELETE /api/admin/members/:email` | 擁有者 | 204，並刪除該 email 對應使用者的全部 session；管理員回 403 `OWNER_ONLY`；目標是擁有者回 409 `OWNER_PROTECTED` |

所有需要登入的請求，都以一句 SQL 同時驗 session 與存取權：

```sql
SELECT … FROM sessions s
JOIN users u ON s.user_id = u.id
WHERE s.token_hash = ? AND s.expires_at > ?
  AND (?mode = 'open' OR EXISTS (SELECT 1 FROM allowed_emails WHERE email = u.email))
```

查無結果時，再區分回 401（session 無效）或 403（不在白名單，並刪除他的全部 session）。

## 6. Implementation Approach

### 6.1 Technology Stack
- **Worker**：JavaScript ES modules，不加框架；用 Web Crypto 產生隨機值、計算 SHA-256 與 PKCE。
- **工具與測試**：wrangler 鎖定版本放 devDependencies，`compatibility_date` 固定；測試沿用 `node:test` 與 Playwright。
- **前端**：維持 ES2020、零框架、相對路徑；分層 `頁面 → ui → core → data`，`core/cloud-sync.js` 不得碰瀏覽器全域。

### 6.2 Code Organization

```
wrangler.jsonc               name、main、compatibility_date、assets（directory "."、run_worker_first）、d1_databases、vars
.assetsignore                node_modules、app、tests、openspec、docs、tools、worker、.*、*.md、package*.json、wrangler.jsonc
worker/src/index.js          路由
worker/src/{auth,session,access,snapshot,admin,roles,db,http}.js
admin.html                   管理後台頁
worker/migrations/0001_init.sql
assets/js/config/cloud.js
assets/js/core/cloud-sync.js
assets/js/ui/platform/{cloud-api,cloud-sync-runner}.js
assets/js/ui/{cloud-view,legacy-banner,admin-view}.js
privacy.html
tests/cloud-*.test.js        純邏輯
tests/worker-*.test.js       Miniflare 本機 D1
tests/browser/suites/cloud-*.mjs   wrangler dev 加假 Google 的端到端測試
docs/cloud-setup.md          Cloudflare 與 Google Cloud 設定手冊（不含個人 email 或網址）
```

`README.md`、`help.html` 與 `tests/structure.test.js` 要配合調整：`.assetsignore` 的覆蓋檢查要加入結構測試；`privacy.html` 要納入相對路徑與外部資源的檢查。

## 7. Security
- **機密**：Client Secret 只用 `wrangler secret put GOOGLE_CLIENT_SECRET` 保存；`GOOGLE_CLIENT_ID` 屬公開值，可以放 `vars`。Worker 不記錄 token、授權碼或 cookie 的原文。
- **CSRF**：
  - `SameSite=Lax` 的 cookie 本身就會擋下跨站 POST。
  - 寫入類請求額外比對 `Origin`。
  - 登入回呼以一次性的 state 加 PKCE 防止授權碼注入。
- **開放轉址**：`returnTo` 必須以單一 `/` 開頭，不含 `//`、`\` 或控制字元，最後以 `new URL(returnTo, siteOrigin)` 的結果仍是本站 origin 為準；不符就改成 `/`。
- **存取**：所有快照查詢都以 session 推得的 `user_id` 為條件，不接受前端傳入的帳號 ID。
- **管理權限**：`/api/admin/*` 每次請求都重新讀取角色，依 `roles.js` 的權限總表判斷（M01、M08、M10、M12、M14）。後台 API 不接受 `owner` 這個角色值，也不能以擁有者為操作對象（M13）；最多一位擁有者由資料庫唯一索引保證。名單只回傳 email、暱稱、角色與時間資訊，不含 `google_sub`、session 或快照內容。
- **濫用**：大小上限 8 MiB、每小時 60 次；白名單是預設模式。
- **隱私**：伺服器只保存 email、Google `sub` 與學習快照。`privacy.html` 要說明保存內容、用途、刪除方式，以及「沒有端到端加密」。
- **錯誤訊息**：一律用代碼，不回傳堆疊或 SQL 內容。

## 8. Performance
- **Worker CPU**：免費版每次請求 10ms。
  - 上傳只複製 bytes 並寫入 D1，不在伺服器解壓或驗證 JSON；驗證交給前端既有的深驗證。
  - session 的雜湊是 32 bytes，成本可以忽略。
- **請求量**：
  - 已登入的使用者每次開頁大約 2 次（`/api/me`、`/api/snapshot/meta`）。
  - 上傳以 10 秒防抖合併。
  - 白名單規模遠低於每天 10 萬次。
- **D1 每日額度**：第三方整理為每天讀 500 萬列、寫 10 萬列，官方已公告超過會失敗；部署前再核對官方數字。
- **前端**：同步全部非同步執行，不阻塞作答；gzip 用串流，大小超過上限時立刻停止。

## 9. Testing Strategy

| 情境 | 層級 | 方法 |
|---|---|---|
| H01 | 端到端 | `wrangler dev` 上跑既有瀏覽器套件，部署後再對線上網址跑一次 |
| H02 | 結構測試、端到端 | 檢查 `.assetsignore` 涵蓋清單；`wrangler dev` 逐一請求應回 404 |
| H03、H04 | Miniflare | 讀設定檔，並請求頁面與未知 API |
| H05–H07 | 瀏覽器 | 以不同 origin（`serve` 本機、假舊站 origin）開頁，檢查網路紀錄與 DOM |
| A01 | 瀏覽器 | 未登入時記錄全部請求：只有 `/api/me`，沒有 Google 網域 |
| A02–A05 | Miniflare 加假 Google | start 與 callback 全流程：cookie 屬性、D1 內容、state 重放、PKCE 錯誤、取消、外部 `returnTo` |
| A06–A08 | Miniflare | 直接操作 `allowed_emails` 後再發請求；切換 `ACCESS_MODE` |
| A09、A10、A12 | Miniflare 加瀏覽器 | 登出、過期（注入時鐘）、竄改的 cookie、刪除帳號 |
| A11 | Miniflare | 缺少或錯誤的 Origin，對每個寫入端點各測一次 |
| A13 | 結構測試、Miniflare | 掃描前端原始碼與回應 body；攔截 `console` 輸出 |
| C01–C08、C14 | 純邏輯 | `core/cloud-sync.decide()` 的狀態表測試，加上瀏覽器端兩個 context 模擬兩台裝置 |
| C07、C11、C12 | Miniflare | 並行同基準上傳、超過大小上限、頻率上限 |
| C09、C10 | 純邏輯加瀏覽器 | 注入時鐘與失敗的 transport；不明結果時先查 meta |
| C13 | 瀏覽器 | 雲端放入壞資料，套用時應與檔案匯入的錯誤一致，且本機零寫入 |
| C15 | 瀏覽器 | 兩個分頁同時觸發，只送出一次 PUT |
| C16 | 單元測試 | 匯出的 JSON 與備份代碼解碼後，找不到同步相關 key |
| 權限總表 | 純邏輯 | `roles.can()` 以「3 種操作者 × 每種動作 × 3 種目標」窮舉，對照規格的權限總表 |
| M01、M02、M14 | Miniflare 加瀏覽器 | 未登入、成員、被降級的管理員分別呼叫後台 API；三種角色的導覽列入口與按鈕顯示 |
| M03、M04 | Miniflare 加瀏覽器 | 擁有者與管理員各新增一次；請求夾帶 `role:'admin'` 仍存成成員；重複、格式錯誤、超長暱稱 |
| M05、M06 | Miniflare | 準備登入過、未登入、登入中、開放模式下不在名單的資料，檢查欄位與排序（擁有者排第一） |
| M07、M08 | Miniflare 加瀏覽器 | 擁有者改任何人、管理員改成員與自己成功，改擁有者與其他管理員回 403；暱稱放入 `<script>` 後檢查 DOM 只有文字 |
| M09、M10 | Miniflare | 擁有者移除成員與管理員後 session 失效；管理員移除任何人都回 403 |
| M11、M12 | Miniflare | 擁有者升降管理員後下一次請求即生效；管理員改角色回 403 |
| M13 | Miniflare | 移除、降級擁有者與設定 `role:'owner'` 都回 409；直接以 SQL 插入第二位擁有者被唯一索引拒絕 |

每個情境都先寫會失敗的測試（RED）。人工驗收另外列出：真實 Google 帳號登入、白名單外的帳號、兩台實體裝置的衝突選擇、線上部署後跑一次 H01，結果記錄在邏輯變更紀錄。

## 10. Deployment

以下標「使用者」的步驟必須由使用者本人在瀏覽器完成，Claude 不代為登入或建立帳號。

1. **（使用者）** `npx wrangler login` 授權本機的 wrangler。
2. `npx wrangler d1 create lang-learn`，把回傳的 `database_id` 填入 `wrangler.jsonc`（此 ID 不是機密）。
3. 執行 `npx wrangler d1 migrations apply lang-learn --remote`。
4. **（使用者）** 在 Google Cloud Console 建立「網頁應用程式」OAuth 用戶端：
   - 重新導向 URI 填 `https://<worker 網址>/api/auth/callback`，本機另加 `http://localhost:8787/api/auth/callback`。
   - 同意畫面填寫名稱、首頁、隱私權頁，範圍只加 `openid`、`email`。
5. **（使用者）** 執行 `npx wrangler secret put GOOGLE_CLIENT_SECRET`，貼上 secret。`GOOGLE_CLIENT_ID` 與 `ACCESS_MODE=allowlist` 寫在 `vars`。
6. **（使用者提供 email）** 設定擁有者：`npx wrangler d1 execute lang-learn --remote --command "INSERT INTO allowed_emails(email, nickname, role, created_at) VALUES ('…', '…', 'owner', unixepoch()) ON CONFLICT(email) DO UPDATE SET role = 'owner'"`。之後的成員與管理員都從管理後台處理。
7. 把 `assets/js/config/cloud.js` 的 `siteOrigin` 填成 Worker 網址、`legacyOrigins` 填舊站，然後 `npx wrangler deploy`。
8. 對線上網址跑 H01，並做人工驗收。
9. 推送 GitHub 讓舊站帶上搬家提示（同一份前端程式）。

**Rollback**：`npx wrangler rollback` 回到上一版；舊站一直都可用。D1 schema 只做新增，回滾程式不需要回滾資料。

## 11. Migration
- 瀏覽器資料綁 origin，新網址第一次開啟時本機是空的。搬家的方式有兩種：在舊站產生備份代碼，貼到新站匯入；或者在任何一台已登入的新站裝置上傳後，其他裝置依 C02 取得。
- 舊站維持完整功能，不自動轉址（使用者的決定）；搬家提示可以關閉，關閉狀態存在 `lang-learn.prefs.v1` 以外的獨立 key，不進備份。
- 不改動學習資料格式；`lang-learn.cloud.v1` 是新的獨立 key。

## 12. Open Questions
- [ ] **Worker 名稱**：決定網址 `<name>.<sub>.workers.dev`，部署前由使用者決定。
- [ ] **html_handling 的 307 轉址**：H01 實測後確認可以接受。若不能，替代方案是把站內連結改成不帶 `.html` 的形式，或改用 Worker 回應 `.html`（會消耗請求數），屆時另開決策。
- [ ] **安全標頭**：是否加上 `_headers`（CSP、`X-Content-Type-Options`、`Referrer-Policy`）。不在本次範圍，建議日後另開。
- [ ] **Google 同意畫面**：改為正式版時，是否會因為品牌資訊需要驗證而延遲；人工上線時確認。
- [ ] **D1 每日額度**：部署前核對官方的免費額度數字。
- [ ] **擁有者轉讓**：目前只能用 SQL 更換擁有者。若日後要在後台轉讓，另開變更並加上二次確認。

## 13. Change Log
- 2026-11-13：初版，待使用者核准。
- 2026-11-13（v2）：使用者採用 TD-2、TD-4、TD-5、TD-6 與 C08 的方向，確認取代舊規格「不做自架伺服器」。追加管理後台：新增 [specs/cloud-admin.md](specs/cloud-admin.md)（M01–M10）、TD-9，白名單表加入 `nickname`、`is_admin`、`added_by`，並補上管理 API、安全、測試與部署步驟。
- 2026-11-13（v3）：使用者要求改成三層角色。`is_admin` 改為 `role`（owner／admin／member）加上「最多一位擁有者」的唯一索引；擁有者是站長本人、只能用 SQL 設定且後台無法移除或降級；管理員可以新增成員但不能刪除；新增的人預設為成員。規格改為 M01–M14，TD-9 重寫，新增 `roles.js` 權限總表。
