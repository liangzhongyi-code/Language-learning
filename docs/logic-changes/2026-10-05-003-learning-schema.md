# 2026-10-05-003：F01 學習資料 schema 與錯誤契約

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）。
- 類型：純核心資料契約。
- 狀態：已驗證（F01 純核心範圍）；未發布，等待主代理接入 migration／import。
- 核准依據：使用者明示兩道 gate 已通過，核准任務清單並按順序實作至完成。
- 規格：[整合 tasks](../../openspec/changes/add-offline-study-suite/tasks.md) F01、[每日 design](../../openspec/changes/add-daily-learning/design.md)、[每日 spec](../../openspec/changes/add-daily-learning/specs/daily-learning.md)、[suite design](../../openspec/changes/add-offline-study-suite/design.md)、[offline spec](../../openspec/changes/add-offline-study-suite/specs/offline-study.md)。
- 分支：feature/add-offline-study-suite；未提交、未推送、未合併、未發布。
- 文件索引與 tasks 由主代理整合；依本次明確檔案分工，本工作不修改共享檔。

## 需求與變更前後

舊 progress／stats 的載入端僅做外層檢查，損壞內容可被默默當空庫。本次新增獨立的嚴格純資料驗證，供 migration／import 在任何寫入之前使用；不變更舊 backup.js、stats.js、progress.js，亦不實作實際儲存遷移。

驗證失敗提供帶路徑的結構化錯誤，不修補、不正規化、不截斷、不產生新歷史。完整 learning 有集合形狀與外鍵檢查；單筆接口供有限交易使用，不要求每題解析全庫。

## 公開 exports 與呼叫契約

`assets/js/core/learning-schema.js`：

- `LEARNING_SCHEMA_VERSION = 2`、`LEARNING_META_VERSION = 2`。這是資料版本；IndexedDB 物理 version 由 F03 管理，可為 1。
- `emptyLearning({ now, timeZone, dataEpoch = 'uninitialized' })`：回傳全新、獨立的空資料物件；只有固定收藏簿與提醒預設，沒有作答、session 或能力紀錄。參數不合法時 throw `LearningError('INVALID_DATA', ..., { errors })`。
- `validatePlainJson(value)`、`validateStats(value)`、`validateProgress(value)`、`validateLearning(value)`：統一回傳 `{ ok, errors: [{ code, path, message }] }`，不改動 value。成功 errors 為空陣列。
- `validateLearningRecord(collection, value)`：相同回傳契約，只驗單筆形狀及筆內規則，**不查外鍵**。collection 支援 `meta/itemStates/reviewEvents/dailyPlans/dailyLedger/sessions/operations/books/notes/intents/achievementUnlocks/calendar/reminderPreferences`。

`assets/js/core/learning-errors.js`：

- `LearningError(code, message, details = {})`：繼承 Error，帶 `name = 'LearningError'`、`code`、`details`，不依賴 Error cause 等 ES2020 之後的語法。
- `LEARNING_ERROR_CODES`：凍結字典，包含 INVALID_DATA、UNSUPPORTED_VERSION、INVALID_OPERATION、INVALID_RECEIPT、STALE_EPOCH、OPERATION_MISMATCH、REVISION_EXHAUSTED、REVISION_CONFLICT、EPOCH_MISMATCH、OPERATION_CONFLICT、ENTRY_CONFLICT、NOT_READY、STORAGE_ERROR、QUOTA_EXCEEDED、MIGRATION_FAILED、STALE_PREVIEW、CANCELLED、UNSUPPORTED。F02 沿用其 STALE_EPOCH／OPERATION_MISMATCH 語意；UI 應比對 code，不比對訊息。

## 固定欄位表

以下物件未標可省略的欄位均為必要欄位；nullable 表示須明確給 null。所有集合為 ID-keyed maps，不是陣列。資料庫可以使用 out-of-line key；本表描述可攜資料與純核心紀錄，而非強制 IndexedDB keyPath。未知結構欄位拒絕，不靜默刪除。

| 位置／單筆名稱 | 欄位 |
| --- | --- |
| learning 根 | schemaVersion、meta、itemStates、reviewEvents、dailyPlans、dailyLedger、sessions、operations、library、intents、achievements、reminderPreferences |
| meta | schemaVersion、revision、dataEpoch、migrationStatus、historyStartedAt、schedulerPolicyVersion、timeZone |
| itemStates[skillKey] | skillKey、sourceId、ability、direction、legacySummary(nullable)、schedulerName、schedulerVersion、schedulerState(nullable)、due、lastEligibleReviewAt(nullable)、learningStatus |
| reviewEvents[reviewId] | reviewId、sessionId、planId(nullable)、entryId、sourceId、skillKey、answeredAt、correct、assistance、responseMs(nullable)、questionMode、scheduleEligible、schedulerVersion、before(nullable)、after(nullable) |
| assistance | hintUsed、retry、replayCount；可省略 kanjiMode、context |
| dailyPlans[planId] | planId、sessionId(nullable)、localDate、timeZone、lang、level、policyVersion、orderedEntries、quotaSnapshot、generatedAt、status |
| orderedEntries[] | entryId、sourceId、skillKey(nullable)、kind、status、questionSnapshot(nullable)、reviewId(nullable)、introducedAt(nullable) |
| quotaSnapshot | newLimit、reviewLimit |
| dailyLedger[localDate:lang] | ledgerId、localDate、timeZone、lang、startedSourceIds、excludedSourceIds、newLimit、updatedAt |
| sessions[sessionId] | sessionId、lang、source、mode、planId(nullable)、orderedEntryIds、submittedReviewIds、questionSnapshots、status、createdAt、completedAt(nullable) |
| operations[operationId] | operationId、epoch、payloadHash、result；result 必含 revision，可帶其他 plain JSON 結果欄位 |
| library | books、notes |
| books[bookId] | bookId、name、system、wordIds、revision、createdAt、updatedAt |
| notes[wordId] | wordId、text、updatedAt、revision |
| intents[sourceId] | sourceId、wantToLearn、selfAssessedKnown、updatedAt |
| achievements | policyVersion、unlocked、calendar |
| achievementUnlocks[achievementId]（即 achievements.unlocked） | achievementId、unlockedAt、notifiedAt(nullable) |
| calendar[localDate:lang]（即 achievements.calendar） | localDate、lang、reviewCount、correctCount |
| reminderPreferences | enabled、localTime、timeZone、generation |

### 值與關聯

- meta 的 migrationStatus 為 pending／complete／cleared；schedulerPolicyVersion、plan policyVersion、achievement policyVersion 此版均為 1。historyStartedAt 表示新系統歷史開始保留的時間，不代表該時刻有作答。
- 空資料 dataEpoch 預設 `uninitialized` 僅供草稿；repository 必須在初始化／restore／clear 注入新的不重複 epoch，不能把預設值当作防止舊寫入的世代。
- 計數器及 revision 是非負安全整數；時間是非負、有效範圍內的整數 epoch 毫秒。一般有限小數可存在 JSON 題面／adapter payload，但不能當計數器。
- ability：recognition、production、listening-recognition、listening-production、assembly、grammar。direction 與 questionMode 是穩定非空 ID，不使用翻譯後 UI 文案作 key。
- schedulerName：legacy／leitner／fsrs；schedulerVersion 是非空版本字串。legacy 必保留 legacySummary 且 schedulerState=null；leitner state 為 `{ box }`。FSRS state、event before/after 保留 plain JSON envelope，其鎖定版本與演算法欄位語意由 F40 adapter 驗證，F01 不杜撰 FSRS 欄位／公式。
- learningStatus：introduced／learning／review／mastered。entry kind：new／review／reinforcement；entry status：pending／prepared／completed／skipped。plan/session status：active／completed。
- questionSnapshot／session questionSnapshots 的值為 plain JSON 物件，必有 sourceId；選項、候選詞與回報 context 保留原 JSON，不在此重建題面。
- plan.sessionId 可為 null，允許零題或未開始的計畫；不可建立零題 session。prepared／completed entry 必須保存題面，completed entry 必有唯一 reviewId。
- plan/session 的相互引用、語言、固定 entry 順序一致；event 必存在於 session.submittedReviewIds，且引用相同 sourceId 的 itemState。plan event 與 entry.reviewId 雙向一致，同 session/entry 不得有兩事件。
- session 已完成需每題已提交或在 plan 明確略過。plan 必有相同日期／語言／時區的 ledger；已介紹 new entry 必列入 startedSourceIds。
- 收據與 F02 一致：operationId／epoch 為 1–128 字元 ASCII 識別字；payloadHash 為 64 碼小寫 SHA-256；receipt.result.revision 不得大於 meta.revision，epoch 必相符。operation.expectedRevision/payload 是請求，不是收據欄位。
- favorites 為唯一系統簿且必存在。最多 100 本（含 favorites）、名稱最多 60 Unicode code points、每簿最多 15,000 個唯一 wordId、每字筆記最多 2,000 code points。未知／移除 ID 保留，不要求它存在於 itemStates，也不因此取得出題資格。
- 筆記允許 HTML 字串作**純文字資料**，顯示端仍須 textContent／跳脫；validator 不把合法文字刪除。
- reminderPreferences.localTime 為 HH:mm；不接受 OS 工作 ID、授權或通知送達狀態。restorePoints/outbox 屬本機集合，不遞迴放進可攜 learning。

## Plain JSON 安全邊界

允許 null、boolean、string、finite number、dense array、Object.prototype／null-prototype 物件。拒絕 NaN／Infinity、undefined、BigInt、函式、symbol、Date／Map／RegExp、自訂原型、accessor、不可列舉欄位、陣列額外屬性、循環引用，以及任意深度的 `__proto__`／`constructor`／`prototype` key。

不呼叫 getter 或 toJSON。深度上限 128，錯誤最多 100 筆，不因超深或大量錯誤拋出遞迴例外。外鍵必須是 own property，不能把 Object.prototype.toString 等繼承名稱當成存在的紀錄。

全庫匯入使用暫時 Map／Set 驗證引用，依紀錄數與 entry 數線性走訪；不在每次作答呼叫此路徑。原始／解碼位元組上限仍由備份層負責，F01 不靜默刪歷史或宣稱大資料均能放進聊天代碼。

## Legacy 資料相容、遷移與回復

- stats：`{ schemaVersion: 1, byScope: { scope: { answered, correct, sessions } } }`，correct 不得大於 answered。
- progress：`{ schemaVersion: 1, items: { sourceId: { n, w, box?, last?, due? } } }`，n/w 必須存在、w≤n；box 若有必須 1–5，last/due 若有必須有效毫秒。保留更早缺排程欄位的資料，不補零、不猜 due、不從累計造事件。
- 此模組沒有 storage／DOM／network API，也沒有讀取現在時間或亂數；Intl 僅驗證注入的時區名稱。
- 不變更使用者資料；失敗回傳診斷由 migration/import 決定停止，原始備份與舊來源保留。实际交易、版本升級、epoch 換代與還原點屬 F03–F06。

## 影響檔案

- assets/js/core/learning-schema.js：新純資料 validator 與空資料 factory。
- assets/js/core/learning-errors.js：新錯誤類與穩定 code 字典。
- tests/learning-schema.test.js：獨立假資料的行為與安全回歸。
- 本文件：F01 契約與實際 TDD 證據。不改 legacy 模組／package／索引／tasks。

## 實際 TDD 驗證紀錄

全部於 2026-10-05 執行；定向指令為 `node --test tests/learning-schema.test.js`。

| 階段 | 實際結果 |
| --- | --- |
| R1：所有 exports 可載入，validator stub 一律成功、factory 為空物件 | 7 tests：1 PASS／6 FAIL，exit 1；缺版本、危險 JSON 未拒絕、非法計數接受、錯誤類欄位缺失的斷言失敗，非 module-not-found |
| R2：補最小可載入完整 fixture factory，validator 仍為 stub | 12 tests：4 PASS／8 FAIL，exit 1；跨集合引用與 collection 邊界均因缺驗證行為失敗 |
| G1 | 12/12 PASS，exit 0 |
| R3：特殊原型名稱外鍵、無題計畫 | 17 tests：15 PASS／2 FAIL，exit 1；繼承名稱被誤當存在的 session；零題計畫被錯誤拒絕 |
| G2：own-property 外鍵、nullable plan session、Set 日帳本索引 | 17/17 PASS，exit 0；同時 `npm test` 514/514 PASS（包含當時其他代理已加入的測試） |
| R4：與 F02 的 SHA-256／交易 ID 限制對齊 | 19 tests：18 PASS／1 FAIL，exit 1；`hash` 被當合法收據 hash |
| 最後定向 RED 確認 | `node --test --test-name-pattern="receipts share\|trailing newlines" tests/learning-schema.test.js`：1 PASS／1 FAIL，收據仍 RED；尾端換行既有規則已拒絕，這項為回歸 PASS，沒有捏造 RED |
| 最終 GREEN | `node --test tests/learning-schema.test.js`：20/20 PASS，exit 0，202.8ms；`npm test`：521/521 PASS，exit 0，3856.6ms（包含當時並行代理的新測試；全套數量隨並行工作增加） |

這些是核心 schema 單元驗證，不等於 D/O 場景的 UI／瀏覽器完整驗收，也不取代 15k states／100k events 的 IndexedDB／原生壓測。

## 未完成與發布狀態

- F03–F06 需在 migration/import 接入嚴格驗證；實際 storage 與逐題原子性不屬本包。
- FSRS adapter version-specific state 檢查由 F40 接入；題面與評分語意由 F12/F14/F30–F34 負責。
- 主代理整合此文件索引、tasks 與其他代理的新增契約；不將其他工作包的成功條件全部勾選為已完成。
- 未提交、未推送、未合併、未發布；沒有遠端版本證據。

## 更正紀錄

- 2026-10-05：依主線最新指示，meta 資料 schemaVersion 最終為 2，IndexedDB 物理 version 可為 1；取代早期訊息的 meta=1 草案。
- 2026-10-05：收據最終採 F02 的 `result.revision`，不使用顶層 revision；完整欄位表以本文件及實作為準。
