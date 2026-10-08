# 2026-10-08-001：逐題保存衝突恢復與續作驗證

## 基本資訊

- 日期／時區：2026-10-08（Asia/Taipei）。
- 類型：錯誤恢復、儲存、文件同步。
- 狀態：逐題保存修復已驗證；APP 原型與整批驗收另列，未發布。
- 依據：沿用使用者已核准的完整模式與 [整合任務](../../openspec/changes/add-offline-study-suite/tasks.md)，本日要求繼續實作。
- 前次：[自由測驗逐題保存](2026-10-07-008-quiz-progress.md)、[收藏接線](2026-10-07-007-vocab-favorites.md)。
- 分支：feature/add-offline-study-suite；既有 HEAD 28eaeb7。本批未提交／未推送，不以 HEAD 冒充本次修復 commit。

## 需求、原因與變更前後

兩個分頁同時續答同一局，第一頁提交後第二頁再提交同題，交易會正確拒絕，但原畫面只提供無效重試且不能換題／離開。本次針對確定性衝突提供「重新載入並同步紀錄」，讓使用者讀回已接受的答案並從下一題續答。暫時性交易中止仍使用原提交編號重試。

另兩項已落盤修復：沒有假名版本的題源提交時記錄實際漢字模式 `show`；每題保存移除完整 `legacyView` 重讀，僅在回設定時刷新範圍。FSRS ES2020 vendor 的驗證與授權另見 [FSRS 紀錄](2026-10-07-005-fsrs.md)，能力投影見 [範圍投影紀錄](2026-10-07-009-scheduler-scope-view.md)。

## 規則、邊界與取捨

- `ENTRY_CONFLICT`、`STALE_EPOCH`、`STALE_PLAN`、`OPERATION_MISMATCH` 與不支援／損壞資料提供重新載入，不提供不可能成功的相同提交重送。
- 保存中與失敗時仍禁止下一題與結束局；只有使用者按同步按鈕才重新載入，不自動丟棄他正在看見的回饋。
- 同步不強行合併答案、不重播舊世代、不以新 ID 繞過同題去重。未被接受的本題答案不會變成保存成功；讀回第一次成功的提交及固定題面。
- 其他暫時故障保留答案、時間與 reviewId，重試時不重新判題，不重複增加完成局。
- 沿用既有原生按鈕、主題與 aria-live 狀態容器；ui-ux-pro-max 的錯誤恢復指引只影響恢復動作，不改整站設計系統。

## 影響範圍與資料相容

`assets/js/ui/quiz-view.js` 增加錯誤碼與同步入口；`tests/browser/suites/quiz-conflict.mjs` 覆蓋真實分頁競爭、漢字模式及每題讀取次數。`docs/logic-changes/README.md` 同步索引與目前狀態；008 追加接線完成的事實。

不修改 schema、DB 名稱、題庫 ID、Google 權限或既有使用者資料；只調整保存失敗後的畫面路徑。若移除這個 UI 修復，已保存紀錄仍存在；不承諾被瀏覽器清除／移除 APP 的資料可自行復原。

## 驗證紀錄

- RED：隔離 `quiz-conflict` 在缺少 `[data-question-reload]` 時逾時失敗。
- GREEN（本日實跑）：`node tests/browser/run.mjs --suite quiz-conflict` PASS，第二頁同步後顯示第 2 題，沒有無效重試鈕。
- `node --test tests/quiz-service.test.js tests/quiz-view-progress.test.js`：9/9 PASS。
- `node tests/browser/run.mjs --suite quiz-progress`：PASS，涵蓋逐題立即保存、半局續答、注入交易中止後同提交重試，以及英日／填空／情境／閱讀。
- `node tests/browser/run.mjs --suite all`：10 個 suite 全 PASS（backup-preview、google-backup、harness、learning-store、migration、quiz-conflict、quiz-progress、repository、study-pages、vocab-favorites），沒有未處理的頁面例外。Google 只做模擬，不代表真帳號授權成功。
- `quiz-conflict` 另驗證 320／375／1280px 同步入口無整頁水平溢出、按鈕至少 44×44px；清除資料後的舊世代提交可同步回設定，session／事件均沒有復活。
- `node --test --test-reporter=tap`：1063/1063 PASS，0 失敗、0 跳過、0 取消，Windows Node，約 7.8 秒。原型相關 JS 契約與配置測試包含在內，不代表 Rust 已編譯。
- `node tools/build-fsrs.mjs --check`：PASS，固定上游來源、ES2020 vendor 與授權可重現；不寫 vendor。
- `node openspec/tools/check-task-coverage.mjs`：76 個情境／76 個任務映射，完整無重複。僅映射檢查，不是 76 個情境全完成。
- `node app/scripts/stage-prototype.mjs`：實際整理 169 個檔案到受管理的 `app/dist-web`，包含原網站 21 頁及原型兩頁。只建立可重現建置產物，不代表原生載入或安裝成功。
- `git diff --check`：沒有空白格式錯誤；沙箱不能讀取兩個歷史 `.gstack/qa-reports` 檔，不能把該讀取限制造成的刪除標記當成本次刪檔或納入提交。

## 未完成與發布狀態

APP 原型只驗證建置結構與窄 SQLite 探針，不能冒充可安裝 APP 或原生學習 repository。Rust 工具鏈、Mac／Xcode、真機安裝更新、離線語音、Google Client IDs 與真帳號授權仍需後續條件。大資料效能與完整分支審查尚未完成；不歸檔整合規格。

本輪不執行 commit／push／merge，未生成外部 HTML 閱讀報告。部署驗證未執行。
