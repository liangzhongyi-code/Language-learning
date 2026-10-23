# JLPT N1 讀解任務

> 2026-10-23 · 任務待核准；核准不代表完成，完成以驗證紀錄為準。
> 驗收情境見 [specs/jlpt-reading.md](specs/jlpt-reading.md)；每個情境只對應一個任務。

## 任務順序
1. **T1 題型定義與 schema**：`core/jlpt-mondai.js` 加入讀解六種題型（鍵值、`mondaiByLevel`、字數下限、`shuffle`、問法）；`validateJlptReading` 與題庫層級檢查；先寫違規案例。
2. **T2 匯入對照工具**：`tools/import-yomitaku.mjs`。內容包括固定 commit、6 檔 SHA-256、只當資料解析、`--select`（固定種子）、`--draft`、`--check`；測試用假資料。
3. **T3 目錄按級別拆檔**：`build-catalog.mjs` 輸出 `ja-jlpt-1..5.js` 與新的筆數；`catalog.js` 的 `loadDataset` 支援 `level`；`data-preload.js` 與 `build-preload.mjs` 同步。
4. **T4 出題**：`poolOf('jlpt')` 攤平短文組；按篇抽題且不截斷最後一篇；`buildJlptQuestion` 支援讀解、選項打亂規則、解說隨選項移動。
5. **T5 設定與呈現**：題型膠囊依級別、預設級別、短文與雙篇、劃線、逐選項解說、手機版面。
6. **T6 題庫第一批**：六個題型各 25 組，照選組順序逐題審查、寫逐選項繁中解說，排除就遞補；同步 `CREDITS.md`、`IMPORTING.md`。可由子代理按題型平行撰寫，主代理抽查。
7. **T7 紀錄、回報與相容**：續答、問題回報欄位、每日清單排除、備份來回、N5 回歸。
8. **T8 驗證與文件**：完整 `npm test`、隔離瀏覽器測試、覆蓋檢查、邏輯變更紀錄與索引、HTML 閱讀版。

## 情境對照
| 情境 | 任務 | 驗證方式 |
|---|---|---|
| R01 | T1 | schema 單元測試 |
| R02 | T1 | schema 單元測試 |
| R03 | T1 | schema 單元測試 |
| R04 | T1 | schema 單元測試 |
| R05 | T1 | schema 單元測試 |
| R06 | T2 | 工具測試（竄改雜湊、含程式碼的假檔） |
| R07 | T2 | 工具測試＋對真實資料執行 `--select`／`--check` |
| R08 | T6 | 文件檢查測試 |
| R09 | T3 | catalog 測試＋瀏覽器網路紀錄 |
| R10 | T5 | 瀏覽器隔離測試 |
| R11 | T5 | quiz-view 測試＋瀏覽器 |
| R12 | T4 | quiz-engine 固定亂數測試 |
| R13 | T4 | quiz-engine 測試 |
| R14 | T5 | 瀏覽器畫面、跳脫測試、375px 版面 |
| R15 | T5 | 瀏覽器畫面 |
| R16 | T7 | 逐題保存與續答測試 |
| R17 | T7 | issue-code、daily-plan、備份測試 |
| R18 | T7 | 既有 JLPT 測試全數通過＋瀏覽器操作 N5 |

## 不在本任務清單
Yomitaku 其餘題目、N1 的文字・語彙・文法與聽解、N2～N4 讀解、短文中譯與朗讀，另開任務。
