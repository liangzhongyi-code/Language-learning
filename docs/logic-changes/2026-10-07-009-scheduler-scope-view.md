# 2026-10-07-009：FSRS 排程狀態的首頁與測驗 scope 相容視圖

## 基本資訊

- 邏輯批次日期：2026-10-07（Asia/Taipei）；本次查證與補記：2026-10-08。
- 類型：進度讀取／範圍篩選／資料相容；本次只同步文件，不修改執行邏輯。
- 狀態：已驗證（指定 Node 測試）；未提交／未推送／未發布。
- 核准依據：使用者要求沿用已核准 add-offline-study-suite 繼續實作；本紀錄補記 FSRS／相容投影這個獨立邏輯批次。
- change-id／規格：[每日學習能力隔離與排程](../../openspec/changes/add-daily-learning/specs/daily-learning.md)、[整合任務 F40](../../openspec/changes/add-offline-study-suite/tasks.md)。
- 前次紀錄：[交易儲存接線](2026-10-07-001-learning-store-wiring.md)、[005 FSRS 預設排程](2026-10-07-005-fsrs.md)。
- commit：本批實作與文件未提交；沒有本批發布或部署證據。

## 需求與原因

FSRS 合格複習更新能力狀態及摘要 due，但保留摘要的舊 Leitner box。原 scope 直接讀摘要時，舊 box 4 的來源可能一直被視為畢業；舊 box 1 的來源則可能在 FSRS 能力都 mastered 後仍列為易錯。來源摘要的 due 也不能代替同來源所有已建立能力的最早到期時間。

## 變更前與變更後

原 `legacyView()` 讀取 stats、progress 並直接回傳 v1 摘要。工作區現在一次讀取 `stats`、`progress`、`itemStates` 的一致快照，將 progress 交給純函式 `projectLearningProgress()`，再回傳相同 v1 形狀的瞬時視圖。

首頁 `stats-view.js` 已以該視圖呼叫 `progressOfLang`；測驗頁已以該視圖呼叫 `weakest`／`dueIds`。本次只查證這些呼叫，不修改 UI，也不把這個來源級視圖冒充逐能力排程或新增能力的流程。

## 規則、邊界與取捨

- 以 sourceId 彙整現有 itemStates。來源只要有至少一個 `schedulerName === 'fsrs'`，便對該來源的既有 progress 記錄投影 box 與 due；只含 Leitner／legacy 或沒有能力的來源保留原 progress 值。
- 啟用投影後，納入該來源全部已建立能力與方向，包含尚未轉成 FSRS 的能力。全部 `learningStatus === 'mastered'` 才將視圖 box 設為 `GRADUATED_BOX`（目前為 4），否則設為 1。這個 box 是舊篩選器的相容標記，不表示真實 Leitner 升盒，也不表示尚未建立的能力已學會。
- 視圖 due 取全部已建立能力的最小值，包含非 FSRS 能力及合法的 `due = 0`。其他 sourceId 的狀態不能影響它；畢業與到期獨立，mastered 來源仍可進入到期清單。
- 沒有 progress 記錄的孤立 itemState 不補造來源進度；沒有 FSRS 的來源連缺 box／due 的舊欄位也保持原樣，沿用原篩選器的行為。空資料得到空 items。
- `n`、`w`、`last`、其他摘要欄位與 schemaVersion 保留，回傳新物件而不修改輸入。`weakest` 與首頁 weak 計數仍要求 `w > 0` 且未畢業，不能將「尚未 mastered」寫成一定會列入易錯。
- 投影不取現在時間、不存取儲存、不重新計算 FSRS；到期比較由消費端傳入時間。投影函式不另外驗證 FSRS 狀態或修復壞資料，資料合法性仍依上游儲存／驗證邊界。
- `legacyView` 的 scope 讀取只取這三個集合，不讀 reviewEvents，不逐 source 查詢；這是三集合的完整快照，不能宣稱只讀目前語言或候選題目的有限列。共用逐題提交路徑仍使用自身的有限查詢，沒有把 scope 投影加入逐題寫入。
- 取捨：先按能力掃描、再按 progress 投影，資料處理量隨這兩個集合增長；每次重讀需要完整集合。此次未量測大資料讀取時間、記憶體或 UI 延遲，不宣稱已符合全套效能目標。

## 影響範圍

以下是既有實作與測試的查證範圍：

- `assets/js/core/learning-progress.js`：來源級純投影。
- `assets/js/ui/platform/learning-store.js`：`legacyView` 三集合快照與 v1 相容回傳；`exportBackup` 仍匯出原始儲存資料。
- `assets/js/core/progress.js`、`assets/js/core/srs.js`：既有 weak／due／畢業篩選規則；未改演算法。
- `assets/js/ui/stats-view.js`、`assets/js/ui/quiz-view.js`：已存在的視圖消費端；本次不修改。
- `tests/learning-progress.test.js`：混合能力、缺欄位、孤立狀態、純函式與讀取範圍。
- `tests/fsrs-downstream.test.js`：以正式 adapter 產生 mastered／Again 狀態，驗證下游篩選、備份與突變。
- 本紀錄同步文件：本文件、005 FSRS 排程紀錄與 `CREDITS.md` 的第三方授權；相關實作與測試檔案如上。

## 資料相容、遷移與回復

沒有資料遷移、schema 升版或新持久化欄位。repository 的原摘要 box／n／w／due 與 itemStates 不因讀取視圖而改變，revision 與 operation 收據也不因投影而增加；備份仍為 v2，保留原摘要與能力狀態。

因此視圖 box 可能與備份中的原始 box 不同，這是既有摘要相容的取捨。停用投影雖不需要反向搬資料，仍會恢復舊 box 與摘要 due 的篩選偏差；本次沒有實作回退。私人學習資料與真備份未讀寫。

## 驗證紀錄

2026-10-08，Windows／Node `v22.18.0`：

- `node --test tests/fsrs.test.js tests/fsrs-downstream.test.js tests/learning-progress.test.js`：26 項通過、0 失敗、0 跳過、0 取消，退出碼 0。與 005 為同一次三檔執行，不重複加總測試數。
- scope 測試涵蓋全部能力 mastered、混合能力與方向、非 FSRS 能力 due=0、其他來源隔離、缺舊欄位、孤立狀態、凍結輸入不變，以及 `weakest`／`dueIds`／`progressOfLang` 的相容結果。
- memory repository 測試確認 `legacyView` 一次 `readAll(['stats', 'progress', 'itemStates'])`，沒有事件讀取或逐 source 查詢；視圖與 export 不增加提交，不回寫原摘要，保留備份能力狀態。
- `learning-progress.test.js` 有手動覆寫 learningStatus／due 的投影 fixture；不能把其 `learning` 案例稱為 d1 的真實排程輸出。`fsrs-downstream.test.js` 另以正式 adapter 產生 mastered 狀態，再經實際 Again 與 learning store 驗證回到 weak，並檢查只看 FSRS／忽略 due=0 的記憶體突變會被斷言攔下。
- 文件寫入後執行 `node --test tests/documentation-links.test.js`：1 項通過、0 失敗、0 跳過，退出碼 0；與 005 引用同一次執行。
- 索引更新後重跑同一文件連結測試：0 項通過、1 項失敗，退出碼 1；`docs/logic-changes/README.md` 指向當時尚不存在的 `2026-10-07-006-app-prototype.md`。與 005 引用同一次執行，不將前次通過結果冒充最新整合結果。
- 006 原型紀錄落盤後再次執行 `node --test tests/documentation-links.test.js`：1 項通過、0 失敗、0 跳過，退出碼 0；前述缺檔失敗已解除。與 005 引用同一次執行，只代表本機 Markdown 連結檢查通過。

## 未完成項目與發布狀態

本次文件同步未執行全套 Node 測試或首頁／測驗瀏覽器端到端驗證，也未驗證原生 Windows／Android／iOS／WebView 或完整大資料效能。memory repository 的讀取與備份結果不能當作真瀏覽器 IndexedDB、原生儲存或發布驗收結果。

本批實作與文件未提交／未推送／未發布；本次文件同步未執行 commit、push 或 merge。

本紀錄的驗證僅限所列測試；整合索引與其他工作流成果另見 [Oct8-001](2026-10-08-001-continue-verification.md)。

## 後續更正／取代

無。本文件為 2026-10-08 查證後新增的補記，保留 2026-10-07 批次檔名；後續能力策略或視圖行為改變時另留紀錄。
