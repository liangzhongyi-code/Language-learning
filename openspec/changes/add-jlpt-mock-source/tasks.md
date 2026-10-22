# JLPT 模擬題源任務

> 2026-10-22 · 任務已核准；核准不代表完成，完成以驗證紀錄為準。
> 2026-10-22 進度：T1–T8 已實作，驗證結果見 [實作紀錄](../../../docs/logic-changes/2026-10-22-002-jlpt-mock-implementation.md)。題目未經母語者審查，尚未發布。
> 驗收情境見 [specs/jlpt-mock.md](specs/jlpt-mock.md)；每個情境只對應一個任務。

## 任務順序
1. **T1 格式與 schema**：`core/jlpt-mondai.js`（區段、問題號、題面形式、自寫問法與中文對照）；`validateJlpt` 接進 `schema.js`；先寫違規案例的測試。
2. **T2 匯入對照工具**：`tools/import-jlptsuccess.mjs`，記錄固定 commit 與每個上游檔的 SHA-256；`--draft`、`--check`、排除表；工具測試用假資料，不把上游原始檔放進版控。
3. **T3 題庫第一批**：依序 `n5-moji.js`（100）、`n5-goi.js`（100）、`n5-bunpou.js`（60），每題經 TD6 檢查並寫繁中 note；一個檔一個 commit；`CREDITS.md`、`IMPORTING.md` 同步。
4. **T4 目錄與載入**：`build-catalog.mjs` 輸出 `ja-jlpt.js` 與筆數；`catalog.js` 的 `loadDataset`；`build-preload.mjs` 預載表。
5. **T5 題源與出題**：`quiz-engine.js` 的 `jlpt` 題源、`buildJlptQuestion`；`hasKanaVersion` 不含 `jlpt`。
6. **T6 設定與呈現**：`quiz-service.js`、`quiz-view.js` 的題源清單、筆數、級別停用、問題號篩選、底線與問法呈現、作答後解說。
7. **T7 紀錄、回報與相容**：確認作答事件與續答、每日清單排除、備份還原、`issue-code.js` 快照欄位。
8. **T8 驗證與文件**：完整 `npm test`、隔離瀏覽器測試、`check-task-coverage.mjs` 擴充讀取本變更、更新邏輯變更紀錄與索引、重新產生 HTML 閱讀版。

## 情境對照
| 情境 | 任務 | 驗證方式 |
|---|---|---|
| J01 | T1 | schema 單元測試 |
| J02 | T1 | schema 單元測試 |
| J03 | T6 | 目錄建置測試＋瀏覽器畫面 |
| J04 | T2 | 工具測試（竄改假上游檔） |
| J05 | T2 | 工具測試＋對真實資料執行 `--check` |
| J06 | T3 | 文件檢查測試 |
| J07 | T6 | quiz-service 測試＋瀏覽器 |
| J08 | T6 | quiz-service 測試 |
| J09 | T5 | quiz-engine／view 測試 |
| J10 | T4 | catalog／預載測試＋瀏覽器網路紀錄 |
| J11 | T5 | quiz-engine 固定亂數測試 |
| J12 | T6 | 瀏覽器畫面＋跳脫測試 |
| J13 | T7 | 逐題保存與續答測試 |
| J14 | T7 | daily-plan 測試 |
| J15 | T7 | 備份與 learning-schema 測試 |
| J16 | T7 | issue-code 測試 |

## 不在本任務清單
第二批（排序題、`questions.json`）、第三批（閱讀、N5 下限 60 字）、聽力與文章的文法另開任務。
