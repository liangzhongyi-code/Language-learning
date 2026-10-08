# 2026-10-07-008：自由測驗逐題保存與續答

## 基本資訊

- 日期／時區：2026-10-07，Asia/Taipei。
- 狀態：實作中，未提交／未發布。
- 依據：使用者要求重新閱讀文件後繼續實作；沿用已核准的 [F16 任務](../../openspec/changes/add-offline-study-suite/tasks.md)。
- 前次：[003 學習頁面](2026-10-07-003-study-pages.md)。

## 變更前後與邊界

原自由測驗只在整局結束時入帳。此批改為固定題面先保存、逐題提交事件與能力排程、未完成局可續答，結果頁不再重算。未提交的填空輸入不承諾保存；失敗保留提交編號、答案與时间供重試，落盤前不得換題。完成局數僅於最後一題交易增加一次。

## 資料相容、影響與取捨

沿用 v2 集合與共用交易入口，不建立第二份 localStorage 學習來源；不變更題庫 ID。新增 quiz-service 與正式 quiz-view 接線及回歸測試。舊摘要保留，能力由真實作答建立；不偽造歷史。其他頁面與備份必須回歸。

## 驗證與未完成

上一輪新增服務層六項測試，先因缺模組失敗，實作後 6/6 通過。正式 UI 接線、隔離瀏覽器驗證與全套測試尚未完成；本段不拿服務測試冒充畫面已驗收。後續在本稿追加實際結果。未完成整個整合規格，不歸檔。

## 2026-10-08 進度更正與驗證追加

前述「尚未接正式 UI」是草稿當時的狀態，現已完成自由測驗接線。前段「时间」應為「時間」，不影響程式行為。此追加保留原始階段紀錄，不將後續結果回填成當時已完成。

- `quiz-service` 保存固定題面、語言、等級、出題方向與實際漢字模式。每次提交在同一交易更新事件、能力、進度、統計、日曆與 session；半局不算完成局，最後一題才計完成，結果畫面不重算。
- 日文情境／閱讀等沒有假名版本的題源一律記錄實際 `show`，不把上一個題源隱藏的 `kana` 偏好誤記為輔助方式。
- 保存中與保存失敗禁止換題。暫時故障維持同一答案、提交編號與提交時間重試；跨分頁同題競爭或清除／還原造成的世代失效，提供明確的重新載入同步入口，不強行覆蓋已保存的答案。新細節見 [續作驗證](2026-10-08-001-continue-verification.md)。
- 未提交的填空輸入不保存；重開頁面只恢復已提交前綴與下一個固定題面。損壞的快照或游標關係在續答前明確拒絕。
- 每題保存不再重讀完整能力投影；返回設定時才刷新範圍與續答列表。

影響檔案：`assets/js/ui/platform/quiz-service.js`、`assets/js/ui/quiz-view.js`、`tests/quiz-service.test.js`、`tests/quiz-view-progress.test.js`、`tests/browser/suites/quiz-progress.mjs`、`tests/browser/suites/quiz-conflict.mjs`。沿用 v2 schema 與唯一 IndexedDB 來源，沒有題庫 ID 或備份格式遷移；故障由既有交易回滾。

本日實跑：`node --test tests/quiz-service.test.js tests/quiz-view-progress.test.js` 9/9 PASS；`node tests/browser/run.mjs --suite quiz-progress` PASS；`node tests/browser/run.mjs --suite quiz-conflict` 先因缺 `[data-question-reload]` 失敗，新增恢復入口後 PASS。全部使用隔離 Chromium 與假資料，不連 Google、不讀真實學習紀錄。

狀態更新：上述接線已驗證，未提交／未推送／未發布。全套結果另記續作驗證文件，不以這三個命令冒充全功能驗收。大題數 session 逐題序列化效能、15k states／100k events 尺度、原生安裝／更新／真機語音與 Google 真帳號仍待驗；完整規格維持未歸檔。
