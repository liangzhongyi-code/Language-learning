# 2026-10-05-007：交易防重、IndexedDB與舊資料遷移底座

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）
- 類型：資料契約／平台。
- 狀態：實作中；底層定向測試通過，尚未接正式UI。
- 核准：[整合 tasks](../../openspec/changes/add-offline-study-suite/tasks.md) F02/F03/F04。
- 分支：feature/add-offline-study-suite；未提交／未發布。

## 需求與前後差異

原本統計及進度分別寫localStorage且只在結算存。新增交易底座，將有限集合變更、版本與去重收據同交易提交；正式測驗仍未切入新入口，不能宣稱逐題保存已上線。

## 規則與邊界

operationId、epoch、expectedRevision和內容SHA256共同辨識操作。先檢查epoch，再查成功收據，最後檢查revision；重送取舊成功結果，異內容同ID拒絕。SHA計算在交易之前，避免IndexedDB交易因await提前結束。回傳成功以transaction complete為準，故障rollback。

舊stats/progress採嚴格驗證，保留due/n/w，不fabricate新歷史。遷移資料與完成標記同交易；完成／清除後不再讀舊key。清除更換epoch並寫blocked標記，舊頁請求被拒，舊key即使殘留也不重遷入。web prefs仍獨立，不宣稱跨儲存原子性。

## 影響檔案

core/learning-operations.js、learning-migration.js；ui/platform/web-repository.js；tests/learning-operations.test.js、learning-migration.test.js；tests/browser/suites/repository.mjs、migration.mjs。

## 資料相容與回復

目前只對隔離fixture執行，不自動碰正式頁面的使用者紀錄。舊來源保留；壞JSON／future版本／非法計數停止，不覆寫空庫。新DB位於IndexedDB，schema2／物理DBversion1；仍需後續F06完整還原與F07/F08UI切換。

## 實際驗證

| 命令 | 結果 |
|---|---|
| node --test tests/learning-operations.test.js（stub→實作） | RED 8失敗；GREEN 8/8 |
| node tests/browser/run.mjs --suite repository | RED缺格式/交易行為；GREEN，含重送、跨頁衝突、故障回滾、重開、清除、future DB |
| node --test tests/learning-migration.test.js | RED 4失敗；GREEN 4/4。曾誤加不存在的stats.lastAt到fixture，查實舊格式後移除；未放寬validator |
| node tests/browser/run.mjs --suite migration | RED缺migration入口；GREEN，含完成標記、重跑、失敗、損毀、清除後不復活 |
| node tests/browser/run.mjs --suite repository（遷移整合後） | PASS |

## 未完成／取捨

交易底座尚在獨立審查；F03大量索引／分頁與其他故障邊界未完成，不能勾整包完成。正式UI、完整v2備份還原、領域關聯檢查及原生SQLite尚未接入。測試資料不等同實機更新驗收。

## 後續更正

後續審查結果另追加，原始RED/GREEN記錄保留。
