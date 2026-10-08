# 2026-10-08-008：自由測驗與練習開局只讀交易 metadata

## 基本資訊

- 日期／時區：2026-10-08（Asia/Taipei）；類型：修復／效能／交易。
- 狀態：已驗證（定向 Node、隔離 IndexedDB）；未提交／未推送／未發布。
- 核准：使用者要求 TDD 消除 quiz-service／practice-service start 的全 sessions 讀取，保留 store 的 epoch／revision／版本守衛。
- 規格：[每日學習](../../openspec/changes/add-daily-learning/design.md)、[單機學習](../../openspec/changes/add-offline-study-suite/design.md)。
- 前次紀錄：[本機範圍查詢](2026-10-08-004-scoped-query.md)、[逐題保存](2026-10-07-008-quiz-progress.md)、[整批審查](2026-10-08-006-review-integration.md)。分支／commit：未提交。

## 需求與原因

兩種 start 都只建立新 session，build 不使用既有 sessions；原先每次開局、每次 revision 衝突重試仍載入並複製所有歷史題面，成本隨累積局數增加。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 新開局或衝突後重試 | `stores: ['sessions']` 全量快照 | `stores: []`，同一唯讀交易只讀並驗證 meta |
| 寫入 | 經 learning-store／repository 提交 | 完全沿用原交易流程、operationId、revision／epoch、large 設定及結果 |
| 指定單字簿練習 | 先讀 books 取得資格 | 保留必要 books 讀取；不擴大本次效能範圍 |

## 規則、邊界與取捨

- `readAll([])` 的實際 consumer 是 web-repository：建立含 meta 的唯讀交易，驗證版本，沒有 sessions getAll／cursor。
- 新局仍先保存再回傳；開局不提前加作答／完成局數；舊 session 不刪不改。
- 不直接呼叫 repository 寫入。REVISION_CONFLICT 重讀 metadata、沿用 operationId；換 epoch 必須失敗，不能復活舊意圖。
- 保留 quiz 的 start 就緒後、首次快照前 epoch 檢查，及 store 重試間 epoch 檢查。沒有擴大 practice 的既有持久化契約。
- 不改 learning-store、web-repository、review-commit 或其他人的既有 suite；不改 submit／skip 的讀取策略。

## 影響範圍

- `assets/js/ui/platform/quiz-service.js`、`assets/js/ui/platform/practice-service.js`：start 的 stores 及契約註解。
- `tests/review-session-start.test.js`：兩服務各自驗證只讀 meta、保留歷史、衝突重試、epoch、版本錯誤、交易失敗；另測 quiz 提前 epoch 守衛。
- `tests/browser/suites/review-session-start.mjs`：真 IndexedDB seed 八局後開第九局，攔截 sessions 讀取 API，確認零次讀取且資料保留。

## 資料相容、遷移與回復

不改 session 格式、備份格式或資料版本，不需遷移。原資料、事件及收據保留。回復兩個 stores 設定只會恢復全量讀取，不需改資料；交易失敗不留下半局。

## 驗證紀錄

| 日期 | 指令／操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-08 RED | `node --test tests/review-runtime-compat.test.js tests/review-session-start.test.js` | 當時 17 項中 6 失敗；兩服務開局及衝突重試各因讀取 sessions 失敗，共 4 項 | 另 2 項相容性失敗見 007 |
| 2026-10-08 GREEN | 同一指令（加入 bookId 回歸之前） | 17/17 通過 | 非效能耗時 benchmark |
| 2026-10-08 擴大回歸 | [007 所列完整指令](2026-10-08-007-runtime-es2020.md#驗證紀錄) | 109/109 通過、0 略過 | 不宣稱整批平行修改全部通過 |
| 2026-10-08 Chromium | `node tests/browser/run.mjs --suite review-session-start` | PASS；兩種開局 sessions 讀取皆為 0，revision +1、epoch 不變、八局歷史保留 | 未做大型真機耗時／記憶體壓測 |
| 2026-10-08 並行修復後複查 | `node --test --test-reporter=spec tests/downstream-storage-regressions.test.js` | 7/7 通過；先前跨日同 entryId 失敗在最新來源已不重現 | 本修復未編輯該 suite 或每日服務 |

初輪額外包含 `tests/downstream-storage-regressions.test.js` 的命令為 111/112；其中跨日同 entryId 案例失敗，屬並行每日修復範圍，未在本修復改檔。後續獨立複查為 7/7，不將兩個時點混成同一快照或覆寫初輪結果。

## 未完成項目與發布狀態

- 本次以實際 I/O 呼叫次數驗證改善，不以微型 fixture 推論大型資料耗時。
- 整批每日修復最終驗證由 006 統整；本批未提交／未推送／未發布。

## 後續更正／取代

無。
