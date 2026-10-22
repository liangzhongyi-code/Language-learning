# 2026-10-22-001：JLPT 模擬題源（第一批 N5 文字・語彙・文法形式）規劃

## 基本資訊

- 日期／時區：2026-10-22（Asia/Taipei）
- 類型：功能／題庫／資料契約
- 狀態：規劃中（尚未修改生產程式或題庫）
- 核准狀態與依據：使用者 2026-10-22「照報告的建議決定（保留空格、N5 閱讀下限 60 字、獨立 JLPT 題源、只寫繁中解說），開第一批的 openspec」。四項方向已決定；設計與任務兩道核准尚未通過。
- change-id／規格：[add-jlpt-mock-source](../../openspec/changes/add-jlpt-mock-source/proposal.md)，[設計](../../openspec/changes/add-jlpt-mock-source/design.md)，[情境 J01–J16](../../openspec/changes/add-jlpt-mock-source/specs/jlpt-mock.md)，[任務](../../openspec/changes/add-jlpt-mock-source/tasks.md)
- 相關前次紀錄：無
- 分支／commit：feature/add-offline-study-suite，見 Git 歷史

## 需求與原因

日文題庫沒有 JLPT 典型題型（漢字讀法、表記、文脈規定、言い換え、文法形式），N4 以上幾乎只有單字題。使用者要找開源授權的日檢題庫補上。

2026-10-22 評估了 GitHub 上的候選，選定 JLPTSuccess（MIT，內容聲明原創）。固定 commit `708a995` 機械全檢全部題目、人工抽 91 題：選擇題品質可用，★排序題約三成有問題。決定分三批收，本筆只規劃第一批（260 題）。

不在此次範圍：排序題、`questions.json`、閱讀、聽力、文章的文法、每日學習、英文。

## 變更前與變更後（規劃）

| 情境 | 變更前 | 變更後（實作後） |
|---|---|---|
| 日文測驗題源 | 單字、句型、單字＋句型、填空、情境、閱讀 | 多一個「JLPT 模擬」，N5 有 260 題 |
| 選項來源 | 單字與句型題從題庫抽干擾選項 | JLPT 題的四個選項寫在資料裡，只打亂順序 |
| 篩選 | 依級別 | JLPT 題源另可按問題號篩選 |
| 空格 | 題庫不使用分かち書き | JLPT 題保留上游 N5 的詞間空格；既有題庫不變 |
| 解說 | 繁中 note | 同；不收上游英文、印地文解說 |

## 規則、邊界與取捨

- 正常路徑：見設計 §2.3。
- 空資料：N4–N1 沒有 JLPT 題時題源停用；英文不提供此題源。
- 分級：選項固定，不會跨級抽干擾選項。
- 已決定事項（使用者 2026-10-22）：保留空格；獨立題源；只寫繁中解說；N5 閱讀下限 60 字（屬第三批，本批不實作）。
- 取捨：選項品質完全依賴資料與人工審查，所以每題都要過 TD6 檢查，與上游不同的地方寫 `edited` 原因。note 由 Claude 撰寫，不宣稱母語者審查。

## 影響範圍（規劃，尚未修改）

- `assets/js/data/ja/jlpt/*.js`、`assets/js/data/ja/jlpt.js`、`assets/js/data/shared/jlpt-mondai.js`：新題庫與題型定義。
- `assets/js/core/schema.js`、`assets/js/core/quiz-engine.js`、`assets/js/core/issue-code.js`：驗證、出題、回報快照。
- `assets/js/ui/platform/quiz-service.js`、`assets/js/ui/quiz-view.js`：題源、篩選、呈現。
- `assets/js/data/catalog.js`、`tools/build-catalog.mjs`、`tools/build-preload.mjs`：目錄與載入。
- `tools/import-jlptsuccess.mjs`：上游對照工具。
- `CREDITS.md`、`assets/js/data/IMPORTING.md`：授權與手冊。

## 資料相容、遷移與回復

本筆只新增規格文件，沒有資料改動。實作後的相容與回復方式見設計 §4。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-22 | 上游題型形式逐題統計（底線、括號空格、整句） | moji 100 題各一個底線；goi 問題3、bunpou 問題1 共 110 題各一個括號空格；goi 問題4 50 題無標記、以「A: 」開頭 | 只確認格式，不代表內容正確 |
| 2026-10-22 | 功能實作與測試 | 未執行 | 全部 J01–J16 |

## 未完成項目與發布狀態

- 尚待處理：設計與任務核准；T1–T8 全部。
- 提交／發布證據：規格文件見 Git 歷史；功能未實作、未發布。

## 後續更正／取代

- 2026-10-22：評估報告寫第一批「310 題」是加總錯誤，正確為 260 題（文字 100＋語彙 100＋文法形式 60）。本筆與規格都用 260。
- 2026-10-22：「JLPTSuccess（MIT）」的授權判斷有誤。上游 `LICENSE` 的雙授權說明寫明 MIT 只涵蓋程式碼，題目等教學內容採 CC BY-SA 4.0。實作改依 CC BY-SA 4.0 標註與釋出，見 [2026-10-22-002](2026-10-22-002-jlpt-mock-implementation.md)。
