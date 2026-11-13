# Google 登入與帳號規格

## ADDED Requirements

### Requirement: 未登入不影響本機學習
系統 SHALL 讓未登入的使用者照常學習；在使用者按下登入之前，不載入任何 Google 腳本、不對 Google 發出請求。

#### Scenario: A01 未登入照常使用
- **GIVEN** 雲端已啟用、使用者未登入。
- **WHEN** 開啟頁面並完成作答。
- **THEN** 本機照常保存；導覽列顯示「用 Google 登入同步」；除了 `GET /api/me` 以外沒有其他雲端請求，也沒有任何對 Google 網域的請求。

### Requirement: 白名單內的 Google 帳號可以登入
系統 SHALL 以伺服器端授權碼流程（含 state 與 PKCE）完成 Google 登入，只接受 email 已驗證且被允許的帳號，並以 HttpOnly session cookie 記住登入狀態。

#### Scenario: A02 登入成功
- **GIVEN** 使用者的 email 在白名單內，且在 Google 是已驗證的 email。
- **WHEN** 按「用 Google 登入」並在 Google 同意。
- **THEN** 回到原本的頁面並顯示該 email；回應設定 `__Host-ll_session` cookie（`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，30 天）；D1 建立使用者與 session，且 session 只保存 token 的 SHA-256 雜湊。

#### Scenario: A03 白名單外的帳號被拒絕
- **GIVEN** 使用者的 email 不在白名單內，或 Google 回報 email 未驗證。
- **WHEN** 完成 Google 同意並回到本站。
- **THEN** 不建立使用者與 session，不設定 session cookie；回到原頁並顯示「此帳號尚未開放雲端同步」；本機資料不受影響。

#### Scenario: A04 取消、失效或竄改的授權
- **GIVEN** 使用者在 Google 按取消，或回呼的 state 不存在、已使用、已超過 10 分鐘，或 PKCE 驗證、授權碼交換失敗。
- **WHEN** 請求 `/api/auth/callback`。
- **THEN** 不建立 session；回到本站並顯示可重試的繁中錯誤；該 state 作廢，不能再用一次。

#### Scenario: A05 回跳位址只限本站
- **GIVEN** 登入開始時帶的 `returnTo` 是外部網址、`//` 開頭、含反斜線，或不是本站路徑。
- **WHEN** 登入流程結束並導回。
- **THEN** 一律導回本站首頁 `/`，不導向外部網址。

### Requirement: 白名單隨時可調整並即時生效
系統 SHALL 從 D1 的白名單表判斷存取權，新增或移除 email 不需重新部署；每次 API 請求都重新確認，並支援切換成開放所有已驗證的 Google 帳號。

#### Scenario: A06 移除白名單即時生效
- **GIVEN** 使用者已登入並持有有效 session。
- **WHEN** 管理者從白名單刪除他的 email，之後他發出任一需要登入的 API 請求。
- **THEN** 回 403 `{"error":"NOT_ALLOWED"}`，並刪除他的全部 session；重新加入白名單後，需要重新登入才能使用。

#### Scenario: A07 新增白名單即時生效
- **GIVEN** 某 email 原本不在白名單內。
- **WHEN** 管理者以 SQL 新增該 email，且沒有重新部署，接著該使用者登入。
- **THEN** 登入成功（同 A02）。

#### Scenario: A08 開放模式
- **GIVEN** Worker 設定 `ACCESS_MODE=open`。
- **WHEN** 任一 email 已驗證、但不在白名單內的 Google 帳號登入。
- **THEN** 登入成功；`ACCESS_MODE` 為其他值或未設定時，一律視為白名單模式。

### Requirement: 登出與 session 失效
系統 SHALL 讓使用者登出，並在 session 失效時要求重新登入；兩種情況都保留本機資料。

#### Scenario: A09 登出
- **GIVEN** 使用者已登入。
- **WHEN** 按「登出」。
- **THEN** 伺服器刪除該 session、清除 cookie；前端停止自動上傳並顯示未登入；本機學習資料保留不動。

#### Scenario: A10 session 過期或無效
- **GIVEN** session 已超過 30 天、已被刪除，或 cookie 被竄改。
- **WHEN** 發出需要登入的 API 請求。
- **THEN** 回 401 `{"error":"UNAUTHENTICATED"}`；前端顯示「需要重新登入」，保留本機資料與「尚未同步」狀態，不無限重試。

### Requirement: 跨站寫入防護
系統 SHALL 拒絕來源不是本站的寫入請求。

#### Scenario: A11 跨站請求被拒
- **GIVEN** 一個 `POST`、`PUT` 或 `DELETE` 的 `/api/*` 請求，其 `Origin` 標頭缺少或不等於本站 origin。
- **WHEN** Worker 收到請求。
- **THEN** 回 403 `{"error":"BAD_ORIGIN"}`，不讀取請求內容、不改任何資料。

### Requirement: 刪除雲端資料
系統 SHALL 讓已登入的使用者刪除自己在本站的全部雲端資料。

#### Scenario: A12 刪除我的雲端資料
- **GIVEN** 使用者已登入，雲端有他的快照。
- **WHEN** 他在確認對話框中確認「刪除我的雲端資料」。
- **THEN** 刪除他的快照、所有 session 與使用者資料列，並清除 cookie；本機資料與白名單都不變；之後再登入時，視為第一次登入。

### Requirement: 機密不外洩
系統 SHALL 確保 Google Client Secret、授權碼、Google token 與 session token 不出現在前端程式、API 回應內容、網址、日誌或備份檔中。

#### Scenario: A13 機密只留在伺服器
- **GIVEN** 完整的登入、同步、登出流程。
- **WHEN** 檢查前端原始碼、每個 API 回應內容、導回網址、Worker 日誌輸出與匯出的備份。
- **THEN** 都找不到 Client Secret、授權碼、Google access token／id token 或 session token 的原文；session token 只出現在 `Set-Cookie` 標頭。
