# 2026-10-07-007：F23 單字頁收藏接線

## 基本資訊

- 日期／時區：2026-10-07（Asia/Taipei）。
- 類型：功能、儲存接線、可及性。
- 狀態：已驗證（本次收藏接線）；全專案另有 3 個範圍外測試失敗，未發布。
- 核准依據：使用者要求延續 F23，限定四個檔案，保留既有草稿、先跑 RED、不改 CSS／索引／quiz、不 commit／push。
- 規格：[整合任務 F23](../../openspec/changes/add-offline-study-suite/tasks.md)、[單機學習規格 O04–O06](../../openspec/changes/add-offline-study-suite/specs/offline-study.md)。
- 前次紀錄：[共用儲存接線](2026-10-07-001-learning-store-wiring.md)、[個人教材核心](2026-10-07-002-offline-study-cores.md)、[學習頁面](2026-10-07-003-study-pages.md)。本次補齊前次列出的 vocabulary 收藏缺口。
- commit：未提交；未推送、未發布。

## 需求與原因

英日單字頁原本只有搜尋、分類／等級篩選、分頁展開與朗讀；收藏必須到單字簿頁操作。本次在每張單字卡加入可用鍵盤操作的收藏星號，使用既有固定收藏簿，重載後保留。既有 10 個 RED 測試草稿保留並補充邊界驗證。

## 變更前與變更後

- 單字頁：新增原生 `button`，具體 `aria-label` 包含操作、單字與中文；`aria-pressed`、空心／實心 SVG 同步表示讀回的狀態。裝飾 SVG 使用 `aria-hidden`。
- 未就緒或讀取失敗：收藏按鈕停用，搜尋、篩選、分頁及朗讀仍可使用；提供「重新讀取收藏」。
- 收藏／取消：透過 `libraryService.setMember(FAVORITES_BOOK_ID, wordId, member)` 保存，交易完成且讀回後才更新星號。
- 保存中：所有收藏按鈕暫停，`aria-busy` 與狀態區說明保存中；即使搜尋重繪或重複點擊也不重送。
- 保存失敗：保留前次讀回的收藏，明示未保存並允許再按星號重試；不顯示假成功。
- 保存成功、後續讀取失敗：明示「已保存，但收藏讀取失敗」，停寫並只重試讀取，避免再次反向切換。
- 重載、返回分頁：從共用 IndexedDB 讀取；`focus`／可見 `visibilitychange` 更新其他頁面的收藏變更。

## 規則、邊界與取捨

- 唯一持久來源為 `getLearningStore()` 的 IndexedDB `books.favorites`。頁面 `Set` 僅為顯示快照，不建立第二份 localStorage 收藏。
- 使用畫面狀態決定明確加入／移除意向；服務依最新交易內容重算，因此另一頁已加入時，落後畫面按加入不會反向取消。
- 同頁序列保存，以簡單的全頁收藏鎖避免多筆寫入後讀取互相覆蓋；讀取請求合併，保存期間不啟動額外讀取。服務既有 revision 衝突重試沿用，未改核心或 repository。
- 收藏簿缺失或 `wordIds` 不是陣列時停止寫入，不能當成空收藏。未知字 ID 留在原簿，不改出題資格。
- 保存只更新收藏按鈕，不重建卡片。原按鈕仍存在且使用者未移到別處時恢復鍵盤焦點；搜尋重建或使用者改焦點時不搶回。
- 沿用 `btn ghost` 的主題／focus／disabled 樣式；控制欄只加入局部 inline 版面設定，收藏點擊範圍為 44×44px，與朗讀垂直間隔 8px，未修改 CSS 檔。
- 英日共用接線，日文朗讀仍使用假名；原有 120ms 搜尋去抖與每頁 300 筆保留。
- 本次範圍不含完整 F23 CRUD／匯出入／指定簿練習驗收，不將這項接線視為全部 F23 完成。
- 使用 ui-ux-pro-max 的原生控制、狀態標示、具體名稱、等待回饋及觸控範圍指引；不增加外部 UI 依賴。

## 影響範圍

- `assets/js/ui/vocab-view.js`：卡片收藏按鈕、共用服務接線、讀取／保存／重試與返回分頁更新。
- `tests/vocab-favorites.test.js`：保留原有 10 案，追加 ready 失敗、收藏簿缺失、取消失敗及多卡保存鎖。
- `tests/browser/suites/vocab-favorites.mjs`：隔離真 Chromium、真 IndexedDB、實際英日頁面、鍵盤、重載、單字簿互通、窄螢幕及故障案例。
- 本文件：規則、取捨與實際驗證紀錄。依本次明確指示不修改文件索引。

## 資料相容、遷移與回復

不變更 schema、DB 名稱、既有收藏格式或備份格式。既有收藏與其他學習集合保留；本次操作只透過既有服務更動固定收藏簿。保存失敗由既有交易回滾；成功後讀取失敗可重新讀取。移除本次頁面接線不會刪除已保存收藏，仍可由單字簿頁操作。

## 驗證紀錄

- `node --test tests/vocab-favorites.test.js`：實作前 10/10 RED，均因缺收藏控制或接線；保留原有案例並追加 4 個邊界測試後 14/14 PASS。
- `node tests/browser/run.mjs --suite vocab-favorites`：PASS。包含英日實際頁面 Tab／Enter／Space、保存後焦點、44×44、320／375／1280px 無整頁水平溢出、重載保留、另一頁單字簿移出後更新；fixture 就緒等待、保存等待／去重、QuotaExceededError 真交易中止、讀取失敗／重試、301 筆展開與日文假名朗讀屬性。
- `npm test`：驗證當下 1024 案，1006 PASS／18 FAIL。失敗為 `tests/app-assets.test.js` 16 案（S02／P00b 的既有獨立草稿）及 `tests/quiz-service.test.js` 2 案（F16 既有獨立草稿）。本次未修改這些檔案或其實作，不擴大修復範圍；其他工作流可能正在更新它們。
- `node --test`（等同 `npm test` 的腳本）：最終回歸當下 1043 案，1040 PASS／3 FAIL。同步工作流修改後前述部分失敗已消失；剩下 P00b 缺 `app/src-tauri/tauri.conf.json`、缺 `app/prototype/probe.js`，及 F17 vendor ES2020 解析失敗 `Unexpected token (796:21)`。`node --test --test-name-pattern='P00b|ES2020' tests/app-assets.test.js tests/fsrs.test.js` 個別重跑確認 3 案同樣失敗。這些檔案不在本次寫集。
- `npm run test:browser`：runner 檢查 3/3 PASS，9 個 suite 全 PASS：backup-preview、google-backup、harness、learning-store、migration、quiz-progress、repository、study-pages、vocab-favorites。每個 suite 使用各自隔離 context。
- `node --check` 檢查本次 3 個 JS／MJS 檔皆成功；本次寫集 `git diff --check` 成功。
- 測試使用 runner 新建隔離 context、隨機 loopback origin、阻擋外部網路、Service Worker；故障案例另建 `fixture-vocab-favorites-<UUID>` DB 與空假 legacy storage。不連使用者瀏覽器，不存取真實學習資料。
- 未覆蓋：實體裝置／螢幕閱讀器實聽、原生平台、真實語音播放、部署。

## 未完成項目與發布狀態

- 本次指定的收藏接線與驗證已完成；全專案剩餘 3 個測試失敗及原生／實體裝置驗收由各自工作流處理。
- 文件索引依使用者本次要求保留未改；其他工作流的全套 RED 不列為收藏功能假成功。
- 未提交／未推送／未發布；沒有生成 HTML 報告。

## 後續更正／取代

無。
