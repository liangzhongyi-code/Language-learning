# 2026-10-07-004：首頁 Google 多份手動備份面板

## 基本資訊

- 日期／時區：2026-10-07（Asia/Taipei）
- 類型：功能／授權／備份
- 狀態：已驗證（模擬 GIS／Drive 的隔離 Chromium）；真實帳號未驗；未發布
- 核准狀態與依據：add-offline-study-suite 兩道核准（2026-10-05）；Client ID 依使用者要求留空
- change-id／規格：[整合任務 F62／F63](../../openspec/changes/add-offline-study-suite/tasks.md)、[google-backup 規格 G01–G10](../../openspec/changes/add-offline-study-suite/specs/google-backup.md)
- 相關前次紀錄：[002 純核心（Google adapter）](2026-10-07-002-offline-study-cores.md)、[001 v2 備份面板](2026-10-07-001-learning-store-wiring.md)
- 分支／commit：feature/add-offline-study-suite，見 Git 歷史

## 需求與原因

使用者選定「Google 多份快照、手動選擇還原」。002 已有授權與 Drive adapter，本次接上首頁畫面，並撰寫設定手冊。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| Client ID 留空（目前狀態） | 無此面板 | 顯示「尚未設定」與說明連結；不載入 SDK、不發任何請求 |
| 設定後連接 | — | 按「連接 Google 帳號」才載入 GIS 並授權；顯示確認的 email |
| 備份 | — | 每次建立新快照（新 exportId），不覆蓋／刪除舊份；可填裝置名稱辨識 |
| 結果不明 | — | 顯示「無法確認」，重試沿用同一 exportId 先查詢 |
| 還原 | — | 分頁列出快照 → 下載固定內容 → 交給「學習紀錄」面板同一套預覽／還原點／確認流程 |
| 切帳號／中斷 | — | 清除清單、未知上傳狀態與來自雲端的預覽；晚到回應被世代守衛丟棄 |

## 規則、邊界與取捨

- 下載只產生預覽，絕不直接寫學習資料；確認時使用預覽當下的固定內容。
- token 只在分頁記憶體；面板與測試確認不寫入 localStorage、cookie 或網址。
- 上傳內容與檔案備份相同（v2 完整群組＋可攜偏好）。
- 首頁「學習紀錄」面板新增 `dismissPreview(source)`，只撤下指定來源的預覽，不影響已送出的確認交易。
- 原生 APP 授權（F64）未實作；設定手冊列出各平台用戶端類型以便日後填寫。

## 影響範圍

- `assets/js/ui/google-backup-view.js`（新）、`assets/js/ui/learning-backup-view.js`（dismissPreview）、`index.html`、`assets/css/theme.css`（`.stack-gap`）。
- `help.html`：新增「今日學習、練習、單字簿與歷程」「Google 雲端備份」說明，更新儲存方式、清除範圍與資料隱私段落。
- `docs/google-backup-setup.md`（新）。
- `tests/browser/suites/google-backup.mjs`（新）。

## 資料相容、遷移與回復

不改資料格式；雲端快照即 v2 備份 JSON。還原沿用還原點，可回到還原前。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-07 | `node tests/browser/run.mjs --suite google-backup` | PASS：G01 未設定零 Google 請求；以 route 模擬 GIS／Drive：連接顯示 email、兩次備份兩份不同 exportId（G03）、清單與下載後走共用預覽（G04）、中斷後清除清單與雲端預覽（G06）、token 不在 localStorage／cookie／網址（G05） | 真實 Google 授權與跨裝置（G10） |
| 2026-10-07 | `node --test` | 975/975 | — |

## 未完成項目與發布狀態

- 真實 Client ID 未填，真帳號授權、配額、限流與跨裝置還原需人工驗收。
- 原生三平台授權（F64）待 APP 工具鏈。
- 提交／發布證據：未發布。

## 後續更正／取代

無。
