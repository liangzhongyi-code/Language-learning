# 2026-10-22-002：JLPT 模擬題源（第一批 N5）實作

## 基本資訊

- 日期／時區：2026-10-22（Asia/Taipei）
- 類型：功能／題庫／資料契約
- 狀態：已驗證（本機 Node 全套、隔離瀏覽器全套、預覽頁人工操作）；未發布
- 核准狀態與依據：使用者 2026-10-22「核准設計與任務，照 T1–T8 的順序開始實作」
- change-id／規格：[add-jlpt-mock-source](../../openspec/changes/add-jlpt-mock-source/proposal.md)，[設計](../../openspec/changes/add-jlpt-mock-source/design.md)，[情境 J01–J16](../../openspec/changes/add-jlpt-mock-source/specs/jlpt-mock.md)，[任務](../../openspec/changes/add-jlpt-mock-source/tasks.md)
- 相關前次紀錄：[2026-10-22-001 規劃](2026-10-22-001-jlpt-mock-source.md)
- 分支／commit：feature/add-offline-study-suite，見 Git 歷史

## 需求與原因

照 001 的規劃，把 JLPTSuccess 的 N5 文字・語彙・文法形式收成獨立的「JLPT 模擬」題源，選項照考試形式固定在資料裡。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 日文測驗題型 | 單字、句型、混合、填空、情境、閱讀 | 多「JLPT 模擬（255）」，可按問題號複選篩選 |
| 出題 | 單字與句型從題庫抽干擾選項 | JLPT 題用資料裡的四個選項，只打亂順序；一題就能開局 |
| 題面 | — | 上方是日文問法；底線字用 `<u>` 呈現；作答後附繁中 note 與問法的中文對照；不提供朗讀 |
| 漢字模式 | — | 對 JLPT 題無效，設定頁說明原因，偏好值不變 |
| 英文頁 | — | 沒有此題源；`?source=jlpt` 退回單字 |
| 作答紀錄 | — | 沿用 choice → recognition、方向 target2zh、sourceId `ja-j-NNNN`；續答、統計 `ja:jlpt`、備份照常 |
| 每日學習 | — | 不排入 JLPT 題 |
| 問題回報 | — | 代碼多帶題型 `mondai` 與底線字 `underline` |

## 題庫結果（T3）

上游固定 commit `708a995` 的 260 題：收錄 **255**、排除 **5**、修改 **33**。

| 區段 | 收錄 | 排除 | 修改 |
|---|---|---|---|
| 文字（問題1、2） | 100 | 0 | 6 |
| 語彙（問題3、4） | 99 | 1 | 11 |
| 文法（問題1） | 56 | 4 | 16 |

- 排除原因都是「要換兩個以上選項才修得好」，寫在各批次檔的 `excluded`。
- 修改多數是「某個錯誤選項放進題面也說得通」，換掉該選項並在 `edited` 寫原因。
- 改正解的有 2 題：文法 `ja-j-0233`（原正解會變成「ありませんです」）、語彙 `ja-j-0169`（原正解多加了「すこし」）。
- 改題面的有 2 題：文字 `ja-j-0070`（刪掉「らいねん に」的「に」）、`ja-j-0082`（題面與底線範圍）。
- 撰寫方式：三個區段由三個子代理平行審查、撰寫 note，主代理抽查 16 題後再修 2 題。
  - `ja-j-0094`：「云います」與正解同義，已換掉。
  - `ja-j-0249`：「した うえで」與正解同義，已換掉。
- 子代理回報「有疑慮但沒改」的題目共約 25 題，多為罕用寫法或口語邊緣說法，保留在原題。這些題目值得母語者複查。

## 規則、邊界與取捨

- **授權更正**：規劃時寫「題目內容是 MIT」是誤判。上游 `LICENSE` 的雙授權說明寫明，教學內容採 CC BY-SA 4.0。
  - 實作改依 CC BY-SA 4.0 處理：`CREDITS.md`、三個批次檔的檔頭與目錄產物 `catalog/ja-jlpt.js` 都已標註。
  - 衍生資料（含繁中 note）同樣以 CC BY-SA 4.0 釋出，與既有 NGSL／TSL 單字的做法一致。
- **id 規則**：草稿期三個區段各占一段號碼；語彙排除 1 題後，文法區段整段往前補，從 0200 起，使整份從 0001 連號。
- **排除表的位置**：設計原寫放在匯入工具內，改為放在各批次檔，避免平行撰寫時衝突。設計 TD6 已追記。
- **最少題數**：JLPT 題源一題就能開局；其他題源仍須四題。
- **題型定義的位置**：設計原寫放在 `data/shared/jlpt-mondai.js`，實作時改放 `core/jlpt-mondai.js`。
  - 原因：歷程頁會經由 `stats.js` 載入 `quiz-engine.js`。定義放在 `data/` 底下時，歷程頁多一個題庫路徑的請求，瀏覽器測試 `page-loading` 抓到了這個回歸。
  - 設計文件已追記這次調整。
- **commit 拆分**：任務原寫「一個批次檔一個 commit」。實際上三個批次檔由子代理平行完成，再一起對照與驗證，所以題庫與接線合併成一個 commit；題庫仍可依檔案單獨 revert。
- **note 品質**：全部由 AI 撰寫，未經母語者或使用者審查；`CREDITS.md` 與檔頭已明示。

## 影響範圍

- **資料**：
  - `assets/js/data/core/jlpt-mondai.js`：題型、問法、題面形式。
  - `assets/js/data/ja/jlpt.js`、`assets/js/data/ja/jlpt/n5-{moji,goi,bunpou}.js`：題庫。
  - `assets/js/data/catalog/ja-jlpt.js`、`meta.js`：生成目錄。
- **核心**：
  - `assets/js/core/schema.js`：`validateJlpt`、流水號與上游題號檢查。
  - `assets/js/core/quiz-engine.js`：`jlpt` 題源、`buildJlptQuestion`、問題號篩選。
  - `assets/js/core/issue-code.js`：回報快照欄位。
- **畫面**：
  - `assets/js/ui/quiz-view.js`：題源膠囊、題型複選、底線與問法呈現。
  - `assets/js/ui/platform/quiz-service.js`：允許 `jlpt` 續答。
  - `assets/js/ui/data-preload.js`、各頁預載區塊：按需預載。
  - `assets/css/theme.css`：底線與中文對照樣式。
  - `ja/quiz.html`、`ja/index.html`、`ja/guide.html`、`README.md`：題型數說明。
- **工具**：
  - `tools/import-jlptsuccess.mjs`：上游對照。
  - `tools/build-catalog.mjs`：輸出 JLPT 目錄與授權標註。
  - `openspec/tools/check-task-coverage.mjs`：納入 J 情境。
- **測試**：
  - 新增 `tests/jlpt-schema.test.js`、`tests/jlpt-import.test.js`、`tests/jlpt-quiz.test.js`、`tests/jlpt-records.test.js`。
  - 修改 `tests/catalog.test.js`、`tests/browser/suites/module-preload.mjs`。
- **文件**：`CREDITS.md`、`assets/js/data/IMPORTING.md` 第九節、openspec 文件。

## 資料相容、遷移與回復

- 只新增題源與資料，不改學習紀錄、備份格式、能力或方向定義。
- 舊備份沒有 `ja-j-` 紀錄，行為不變。
- 回復方式：revert 本批 commit 並重建目錄。已產生的 `ja-j-` 學習紀錄保留在使用者瀏覽器，不刪資料。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-22 | `node tools/import-jlptsuccess.mjs --check <上游目錄>` | 上游 260 題：收錄 255、排除 5，對照一致 | 只證明與上游的對應關係，不證明題目正確 |
| 2026-10-22 | JLPT 定向測試（schema 10、import 6、quiz 6、records 5、catalog J10 1） | 全部通過 | — |
| 2026-10-22 | `node openspec/tools/check-task-coverage.mjs` | 規格情境 92／任務映射 92，完整無重複 | 文件完整性，不是功能驗證 |
| 2026-10-22 | `node --test`（全套） | 第一次 1190/1191：失敗的是文件連結測試，因為當時本紀錄還沒建立；建立後重跑 **1191/1191 通過** | — |
| 2026-10-22 | `npm run test:browser`（隔離 Chromium 全套，含 `ja/en quiz.html?source=jlpt` 預載核對） | 第一次 `page-loading` 失敗：歷程頁多了一個 `/assets/js/data/` 請求（見下方說明）。修正後重跑，**25 組全部 PASS**，退出碼 0 | Safari／實體手機未測 |
| 2026-10-22 | 預覽頁人工操作（`npx serve`，`ja/quiz.html?source=jlpt`） | 見下方說明 | 未在實體手機、Safari、原生 APP 上驗證 |

預覽頁人工操作的結果：

- 題源顯示 255 題，題型膠囊分別是 50／50／50／49／56。
- 只勾「問題2 表記」時顯示 50 題；全部取消勾選時，開始鍵停用並顯示提示。
- 作答畫面：
  - 題面上方是日文問法，底線用 `<u>` 呈現，截圖可見底線。
  - 不提供朗讀鍵。
  - 作答後顯示 note 與「問法：…」，並顯示「已保存。」。
- 重新整理後出現「繼續JLPT 模擬（1/10）」，續答回到第 2 題，題面與底線完整。
- 英文頁 `?source=jlpt` 退回單字題源，也不顯示 JLPT 題源。
- 首頁有 JLPT 作答紀錄時正常顯示；主控台沒有錯誤。

## 未完成項目與發布狀態

- 題目與 note 未經日語母語者審查；子代理列出的約 25 題「有疑慮但沒改」，值得優先複查。
- 第二批（排序題、`questions.json`）與第三批（閱讀、N5 下限 60 字）尚未開始。
- 提交／發布證據：已 commit 並推到 feature 分支，見 Git 歷史；尚未合併到 main，未部署 GitHub Pages。

## 後續更正／取代

無。
