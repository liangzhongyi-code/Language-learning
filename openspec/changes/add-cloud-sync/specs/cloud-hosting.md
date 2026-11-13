# 雲端主機與搬家規格

## ADDED Requirements

### Requirement: 網站在 Workers 照常運作
系統 SHALL 由 Cloudflare Workers 靜態資源提供全部既有頁面與資源，相對路徑、模組與題庫預載的行為與 GitHub Pages 版一致。

#### Scenario: H01 全站頁面可用
- **GIVEN** 已部署到 Workers 的版本（或本機 `wrangler dev`）。
- **WHEN** 依序開啟首頁、`en/` 與 `ja/` 各頁，並完成一局測驗。
- **THEN** 每頁最終回應 200，沒有資源 404 或 Console 錯誤；作答照常保存；既有瀏覽器測試套件對該網址全部通過。

### Requirement: 不公開非網站檔案
系統 SHALL 只發布網站需要的檔案；開發、測試、規格、APP 與後端原始碼不得被下載。

#### Scenario: H02 非網站路徑一律 404
- **GIVEN** 已部署的版本。
- **WHEN** 請求 `/node_modules/`、`/tests/`、`/openspec/`、`/docs/`、`/app/`、`/tools/`、`/worker/`、`/.git/config`、`/package.json`、`/wrangler.jsonc` 底下的任一檔案。
- **THEN** 一律回 404，不回傳檔案內容。

### Requirement: 靜態請求不經 Worker
系統 SHALL 只讓 `/api/*` 先進 Worker，其餘請求直接由靜態資源回應，不消耗 Worker 每日請求額度。

#### Scenario: H03 Worker 只處理 API
- **GIVEN** `wrangler.jsonc` 設定。
- **WHEN** 讀取靜態資源的路由設定，並請求一個頁面與一個 `/api/me`。
- **THEN** `run_worker_first` 只包含 `/api/*`；頁面由靜態資源回應，`/api/me` 由 Worker 回應。

#### Scenario: H04 未知 API 路徑
- **GIVEN** 已部署的版本。
- **WHEN** 請求 `/api/` 底下不存在的路徑。
- **THEN** 回 404 JSON（`{"error":"NOT_FOUND"}`），不退回網站頁面。

### Requirement: 雲端功能只在設定的網址啟用
系統 SHALL 只在目前網址的 origin 等於雲端設定的 `siteOrigin` 時，顯示登入入口並呼叫 `/api`。

#### Scenario: H05 其他網址不啟用雲端
- **GIVEN** 雲端設定為空，或目前網址是 GitHub Pages、本機 `npx serve` 等其他 origin。
- **WHEN** 任一頁面載入並操作。
- **THEN** 不顯示登入入口，不發出任何 `/api` 或 Google 請求；本機功能照常。

### Requirement: 舊站搬家提示
系統 SHALL 在 GitHub Pages 舊網址顯示搬家提示，說明新網址與搬移紀錄的方法；舊站其他功能照常。

#### Scenario: H06 舊網址顯示搬家提示
- **GIVEN** 網站在設定的舊站 origin 開啟。
- **WHEN** 任一頁面載入。
- **THEN** 頁面上方顯示搬家提示，包含新網址連結與「用備份代碼搬移紀錄」的說明；可以關閉，關閉後同一瀏覽器不再顯示；學習、匯出與匯入照常可用。

#### Scenario: H07 新網址不顯示搬家提示
- **GIVEN** 網站在新網址或其他非舊站 origin 開啟。
- **WHEN** 任一頁面載入。
- **THEN** 不顯示搬家提示。
