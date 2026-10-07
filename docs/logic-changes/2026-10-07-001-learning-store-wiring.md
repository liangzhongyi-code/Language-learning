# 2026-10-07-001：網站學習寫入改走交易儲存

## 基本資訊

- 日期／時區：2026-10-07（Asia/Taipei）
- 類型：資料契約／儲存／平台
- 狀態：已驗證（本機 Node 與隔離 Chromium）；未發布
- 核准狀態與依據：add-offline-study-suite 設計與任務兩道核准（2026-10-05）；使用者 2026-10-07 要求「繼續實作」
- change-id／規格：[整合任務 F06／F07／F08](../../openspec/changes/add-offline-study-suite/tasks.md)、[每日學習設計 TD2](../../openspec/changes/add-daily-learning/design.md)
- 相關前次紀錄：[007 交易與遷移底座](2026-10-05-007-transaction-foundation.md)、[010 完整備份與還原候選](2026-10-05-010-learning-backup-restore.md)
- 分支／commit：feature/add-offline-study-suite，提交雜湊見 Git 歷史

## 需求與原因

007／010 已有 IndexedDB 交易、遷移與 v2 備份的核心，但正式頁面仍直接讀寫 localStorage：測驗結束兩把 key 分別寫入可能只成功一半，首頁與備份面板也沒有接上 v2 完整群組與還原點。本次把網站所有學習讀寫接到同一個交易入口。偏好設定仍留 localStorage（不屬學習群組）。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 開任一學習頁 | 同步讀 localStorage，壞資料安靜回空 | 先經就緒屏障；第一次自動把舊 stats／progress 搬進 IndexedDB（與完成標記同交易），之後不再讀舊 key |
| 測驗結束 | stats、progress 兩次 setItem，可能半成功 | 一次交易寫入該局碰到的 key；保存中／已保存／失敗可重試（同 operationId）分別顯示 |
| 兩個分頁同時結束測驗 | 後寫覆蓋先寫 | revision 衝突自動重讀重算，兩局都入帳 |
| 首頁清除紀錄 | 兩把 key 分別刪，可能只清一半 | 一次交易清除全部學習集合並換 epoch；舊分頁晚到的寫入被拒 |
| 首頁備份 | v1：只帶 stats／progress／prefs | v2：完整學習群組（含每日清單、作答歷程、單字簿、筆記）＋偏好 |
| 匯入備份 | 直接覆寫 localStorage | 共用 restore controller 預覽；確認時同交易保存還原點（最多 3 份）再整組替換、換新 epoch；可選擇只還原學習或只還原偏好 |
| 回到之前的狀態 | 不可能 | 首頁列出還原點，可回到還原前（回復本身也先存一個還原點） |
| 儲存不可用／舊資料壞掉 | 安靜當作空白 | 顯示原因與重試；遷移失敗可下載舊原始檔、或保留舊 key 不動改以空白開始；測驗頁可選「先練習（不保存）」並在結果頁明說未保存 |

## 規則、邊界與取捨

- `learning-store.js` 是頁面唯一學習寫入入口；`commit()` 以 build(rows, meta) 產生 changes，遇 REVISION_CONFLICT 最多重讀重算 3 次。衝突代表前次未落盤，因此沿用同一 operationId 不會造成重複收據。
- `store.ready()` 只遷移一次，之後每次重讀 meta，不回傳第一次的快取 revision／epoch。
- 還原交易：讀取目前全部可攜集合→存還原點→清除（不含 restorePoints）→寫入新列→meta 換 epoch。任何一步失敗整筆回滾，原資料與還原點數量不變。還原點不進可攜備份、清除紀錄時一併刪除（O18）。
- 備份大小：一般操作的 canonical JSON 上限仍為 1 MiB；整組還原放寬到 24 MiB 雜湊上限（輸入本身已受 10 MiB 備份上限約束）。
- 舊 `backup-view.js`（v1 localStorage 面板）保留模組與原測試，首頁已不再使用；之後若確認不需要再另筆移除。
- 遷移失敗的「以空白開始」只寫清除標記，不讀不刪舊 localStorage，原檔仍可手動救援。

## 影響範圍

- `assets/js/ui/platform/learning-store.js`（新）：就緒屏障、遷移、一致讀取、衝突重試、整局入帳、清除、v2 匯出、還原點。
- `assets/js/ui/platform/web-repository.js`：新增 `readAll`（單一唯讀交易多集合）、`restoreLearning`（還原／回到還原點）。
- `assets/js/core/learning-snapshot.js`（新）：集合列與可攜群組互轉；achievements 以 `policy`／`unlock:`／`calendar:` 前綴同存一個集合。
- `assets/js/core/learning-operations.js`：`canonicalJson` 可由呼叫端放寬上限（預設不變）。
- `assets/js/ui/storage-gate.js`（新）：載入中／失敗救援畫面。
- `assets/js/ui/stats-view.js`、`assets/js/ui/quiz-view.js`：改讀寫交易儲存。
- `assets/js/ui/learning-backup-view.js`（新）、`index.html`：v2 備份面板。
- `tests/browser/suites/learning-store.mjs`（新）。

## 資料相容、遷移與回復

舊 localStorage 的 stats／progress 原樣搬入，n/w/box/last/due 不改；舊 key 不刪，作為復原來源，遷移完成後不再雙寫也不再讀取。v0／v1 備份仍可匯入（明示整組替換）。還原前自動存還原點，可在首頁回復。偏好仍在 localStorage。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-07 | `node --test` | 965/965 通過（含平行新增的核心測試） | 不含真瀏覽器交易 |
| 2026-10-07 | `node tests/browser/run.mjs --suite learning-store` | PASS：遷移、整局入帳、同 ID 異內容拒絕、兩分頁同時入帳、v2 往返、換 epoch、還原點上限 3、回到還原點、舊頁 STALE_EPOCH、還原交易故障原資料不變 | iOS／Android WebView 未測 |
| 2026-10-07 | 本機 serve＋內建瀏覽器實際操作 `ja/quiz.html` 完成 10 題、`ja/index.html`、首頁 | 結果頁顯示「這一局已保存」，revision 2、10 筆逐題紀錄，首頁統計與 v2 匯出正確 | 真實舊使用者資料未測（只用假資料） |

## 未完成項目與發布狀態

- 自由測驗仍為「整局入帳」；逐題事件與能力排程（F16）於每日學習接線後處理。
- 尚待處理：舊 v1 面板模組移除與測試改寫；每日學習／單字簿／新題型頁面接線。
- 提交／發布證據：未發布。

## 後續更正／取代

無。
