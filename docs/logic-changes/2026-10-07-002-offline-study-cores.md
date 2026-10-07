# 2026-10-07-002：單機學習功能的純核心（題型、單字簿、成就、提醒、Google）

## 基本資訊

- 日期／時區：2026-10-07（Asia/Taipei）
- 類型：功能核心／題庫／資料契約
- 狀態：已驗證（Node 單元測試）；頁面接線見後續紀錄
- 核准狀態與依據：add-offline-study-suite 兩道核准（2026-10-05）
- change-id／規格：[整合任務 F20–F22、F30–F32、F41–F43、F60–F61](../../openspec/changes/add-offline-study-suite/tasks.md)、[offline-study 規格](../../openspec/changes/add-offline-study-suite/specs/offline-study.md)、[google-backup 規格](../../openspec/changes/add-offline-study-suite/specs/google-backup.md)
- 相關前次紀錄：[2026-10-07-001](2026-10-07-001-learning-store-wiring.md)
- 分支／commit：feature/add-offline-study-suite，見 Git 歷史

## 需求與原因

單機功能（個人單字簿、新題型、成就日曆、回饋與提醒）與 Google 手動多份備份都需要先有不碰 DOM、可測試的純規則，頁面與 repository 只負責保存與顯示。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 收藏／單字簿／筆記 | 無 | `library.js`：100 本、名稱 60 字、每本 15000 字、筆記 2000 字；刪簿不刪筆記與歷史；revision／epoch 擋晚到保存 |
| 單字簿交換 | 無 | `library-exchange.js`：獨立格式，只含簿與筆記；預覽同名／重複／筆記衝突／未知字；不碰統計、進度、偏好 |
| 想學／自評已會 | daily-plan 已讀 intents 但無寫入規則 | `learning-intents.js`：想學只調新字順位；自評標未驗證、可撤回、答錯解除 |
| 新題型 | 只有選擇／填空 | `practice-answers.js`（英文／假名正規化與白名單判題、IME 組字不送出）、`practice-engine.js`（同級資格、片段 instance、合法語序白名單）；英文 72、日文 86 筆人工核對種子（日文僅 N5） |
| 成就與日曆 | 無 | `achievements.js`：只計實際作答事件、固定學習時區、斷簽不抹累計、還原不重播通知 |
| 音效／語音／震動 | 無 | `feedback-policy.js`：三項獨立偏好＋安靜模式；聽力題需播放時要求使用者選擇；不接收答案、不影響判題 |
| 提醒 | 無 | `reminders.js`：區分已保存／權限／已排程／已送達；outbox 世代去重；web 明說關頁不提醒；跨裝置不搬 OS id |
| Google 備份 | 無 | `config/google.js`（Client ID 全空）、`google-web-auth.js`（按連接才載 SDK、token 只在記憶體、世代守衛）、`google-drive.js`（appDataFolder、不可變多份快照、exportId 先查再送、串流 10 MiB 止損、固定端點） |

## 規則、邊界與取捨

- kana 練習沿用 review-events 的 `typing` 模式並以 `practiceMode: 'kana'`、方向 `target2zh` 與「看中文打日文」分開能力，不新增事件模式。
- listening／pos 正解只放在 `answerKey`，UI 不得渲染；聽寫的 `speakText` 本身是答案，只能朗讀不能顯示。
- 英文排句只有 2 題具兩種以上合法語序（level 1 句子只有這兩句含可移動時間副詞）；日文 8 題。不以 zhIndex 推導語序。
- Google 上傳結果未知回 `status: 'unknown'`，重試沿用同一 exportId 先查詢；Drive 查詢可能延遲，只能做到「先查再送」，不宣稱恰好一次。
- 筆記刪除後重建 revision 從 0 起算，極端晚到保存（剛好 expectedRevision 0）仍可能覆蓋新筆記；已記為已知限制。

## 影響範圍

新增：`assets/js/core/{library,library-exchange,learning-intents,practice-answers,practice-engine,achievements,feedback-policy,reminders}.js`、`assets/js/data/{en,ja}/practice.js`、`assets/js/config/google.js`、`assets/js/ui/platform/{google-web-auth,google-drive}.js`，以及對應 `tests/*.test.js`。沒有修改既有檔案。

## 資料相容、遷移與回復

只新增純函式與種子資料；所有產出紀錄通過既有 `validateLearningRecord`。沒有資料遷移。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-07 | 各模組先 RED（模組不存在）再 GREEN | library 18、exchange 14、intents 10、answers 13、dataset 13、engine 19、achievements 13、feedback 11、reminders 15、google-auth 20、google-drive 21 項 | 頁面接線、真實 Google 授權 |
| 2026-10-07 | `node --test` 全套 | 965/965 通過 | 同上 |
| 2026-10-07 | Google 四項關鍵檢查（串流超限、未知先查、晚到丟棄、URL 白名單）刻意改壞 | 測試各自失敗，原碼已還原 | — |

## 未完成項目與發布狀態

- 頁面接線（F23、F33、F34、F41–F43 UI、F62–F63）另見後續紀錄。
- 真實 Google Client ID 未設定，真實授權與跨裝置還原（G10）未驗。
- 提交／發布證據：未發布。

## 後續更正／取代

無。
