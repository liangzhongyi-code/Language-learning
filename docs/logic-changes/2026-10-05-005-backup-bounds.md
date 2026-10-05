# 2026-10-05-005：備份 CODE 大小界線

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）。
- 類型：資料契約／修復。
- 狀態：已驗證（本機子項；文件待主代理彙整索引）。
- 核准依據：使用者明確核准「核准任務清單，按順序實作至完成」，本次指定執行 F05 CODE 大小界線。
- 規格：`openspec/changes/add-offline-study-suite/design.md` 第 4 節、同 change `tasks.md` F05；`add-daily-learning/specs/daily-learning.md` D22；`add-native-app-packaging/specs/native-app.md` S12。
- 分支：`feature/add-offline-study-suite`；未提交、未推送、未合併。
- 相關前次紀錄：無。本項不是完整 F05／v2 實作。

## 需求與原因

舊 CODE transport 無輸入、JSON 或解壓大小限制，`drain` 收齊全部 chunks 才配置合併陣列；高度壓縮的輸入可無限制展開。必須拒絕超大匯出，避免產出因大小無法重新匯入的代碼。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| encode 原始 JSON | 未設限，即使超大仍可壓縮成功 | JSON.stringify 結果以 UTF-8 計數，超過 10 MiB 拒絕，通過後才編碼整份 bytes |
| v0 decode | base64 還原後直接轉文字 | 還原 bytes 超過 10 MiB 時拒絕，不交給 TextDecoder |
| v1 decode | 解壓全部收完、合併後轉文字 | 每個 chunk 加總 byteLength，超過 10 MiB 即 cancel；超限 chunk 不加入 chunks，不配置超限合併陣列 |
| CODE input | 直接清理不可見字元及抽取代碼 | 清理前整段輸入超過 16 MiB UTF-8 bytes 即拒絕 |
| CODE output | 直接 base64／回傳 | 先扣前綴，再按 base64 4/3 膨脹與 padding 算 bytes 預算；壓縮途中超限即取消，base64 前再次檢查 |
| 串流錯誤 | 已有提前接手 writing rejection | 保留接手，追加 cancel／abort、等待寫端結束與釋放 reader／writer lock；取消失敗不覆蓋限額原因 |

## 規則、邊界與取捨

- 1 MiB = 1,048,576 bytes。恰好 10 MiB JSON／16 MiB CODE input 可接受，超過一 byte 拒絕。
- 16 MiB 是保守的 UTF-8 bytes 限制，不是 JavaScript UTF-16 length 或畫面字數；包裝說明、換行、BOM、全形冒號、零寬字元都納入原始輸入計數。
- UTF-8 計數分段 8192 UTF-16 code units，避免拆開 surrogate pair；孤立 surrogate 依 TextEncoder 計數。先利用字串 length 作最低 bytes 的快速拒絕，不先配置無上限的 UTF-8 陣列。
- 仍會先取得 JSON.stringify 的字串；本項沒有改寫 JSON serializer。輸入字串與串流單一 chunk 本身由呼叫者／瀏覽器配置，本模組不宣稱能消除這部分配置。
- 解壓只在全體 chunks 均未超限時合併。真正 gzip bomb 使用 Node 原生 gzip 建構，沒有用 mock 取代真實解壓驗證。
- 測試直接使用正式 10／16 MiB fixture，沒有增加可注入放寬上限的公開 API；payload 的 limits 與額外參數均不能更改限制。
- 限額錯誤保留 `code = 'BACKUP_SIZE_LIMIT'`、`limitBytes = 10485760 | 16777216` 與繁中 message；v1 解壓 catch 不將其改寫為一般損壞訊息。
- 本項不做 schema 深驗證、不變更儲存；數值、群組完整性、v2 與原始檔案匯入入口仍屬其他子項。
- 分級／語言：上限不分語言，繁中／emoji 以真正 bytes 計算。

## 影響範圍與 exports 契約

- `assets/js/core/backup-code.js`：既有 exports 完全保留：`encodeBackupCode(payload): Promise<string>`、`decodeBackupCode(text): Promise<string>`、`canCompress(): boolean`、`codeSizeHint(code): { chars, chatFriendly }`、`CHAT_FRIENDLY_CHARS = 4000`。限額錯誤 class 與內部串流 helper 不公開。
- `assets/js/core/backup-limits.js`：新增唯讀數值 exports `BACKUP_JSON_MAX_BYTES = 10485760`、`BACKUP_CODE_MAX_BYTES = 16777216`；沒有 setter 或來源於備份內容的設定。後續原生資源打包須連同這個相對 import 模組納入。
- `tests/backup-code.test.js`：保留原 16 案，新增 17 案，涵蓋 S12／D22 邊界、真實 zip bomb、cancel／cancel 拒絕、writer 拒絕、truncated／CRC、Unicode 與舊瀏覽器。
- 本文件：本次實際 R/G/V 證據。依指定分工，不更新 README 索引、tasks、package、backup.js 或 UI 等共享檔。

## 資料相容、遷移與回復

不變更 `langlearn0:` 原始 base64 或 `langlearn1:` gzip/base64 格式。保留不可見字元清理、全形冒號修正、包裝文字擷取、未知版本拒絕及舊瀏覽器 v0 fallback。`decodeBackupCode` 仍回傳 JSON 文字，交由呼叫者 parseBackup。沒有資料庫寫入、遷移或已儲存資料修改；新限制會拒绝舊版本曾產出的超限代碼。

## 驗證紀錄

| 日期 | 指令／操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-05 | `node --test tests/backup-code.test.js`，變更前 | 16/16 PASS | 當時無大小測試 |
| 2026-10-05 | 同指令，新增上限測試後、實作前（RED） | 27 案：18 PASS、9 FAIL，exit 1。7 案超限仍成功而 Missing expected rejection；2 案讀到第三個 chunk 的一般錯誤，未得到限額錯誤。模組可正常載入 | 首次 mock 建構子修正後已重跑相同結果，非 module missing RED |
| 2026-10-05 | 同指令，實作大小限制後（GREEN） | 27/27 PASS，exit 0 | 尚未補 writer 時序測試 |
| 2026-10-05 | `node --unhandled-rejections=strict --test tests/backup-code.test.js` | 補齊回歸後 33/33 PASS，exit 0 | 無實機瀏覽器驗收 |
| 2026-10-05 | 暫時移除 `writing.catch`；`node --unhandled-rejections=strict --test --test-name-pattern='取消仍在等待時 writer' tests/backup-code.test.js` | 突變 0 PASS／1 FAIL，exit 1；uncaughtException 與 unhandledRejection 均被 runner 捕捉。隨後立即還原 | 故意失敗只用於確認測試敏感度 |
| 2026-10-05 | `node --unhandled-rejections=strict --test --test-reporter=spec tests/backup-code.test.js tests/backup.test.js` | 還原並重構後 47/47 PASS，約 1.51 秒 | 尚未實作的完整 v2 非此測試涵蓋 |
| 2026-10-05 | `npm test` | npm.ps1 啟動顯示 Unknown command: pm；未執行測試，不算 RED | 本機 wrapper 問題 |
| 2026-10-05 | `npm.cmd test` | 同 package test script：509/509 PASS，exit 0，約 5.51 秒 | 其他代理持續修改，為當時工作樹快照 |
| 2026-10-05 | `git diff --check -- assets/js/core/backup-code.js tests/backup-code.test.js` | exit 0；只有既有 Windows CRLF 正規化提示 | 未追蹤新檔另由檢視確認 |

## 未完成項目與發布狀態

- 本次 CODE 界線子項完成；主代理需彙整索引／tasks 及完整 F05，不能據此宣稱 S12 的 schema／原生部分皆完成。
- 未執行真實舊瀏覽器／原生 APP 測試；舊 API 缺席用能力替身驗證。
- 未修改 backup.js、UI、全 schema；原始檔案入口上限不是本子項交付。
- 未提交、未推送、未合併、未發布。

## 後續更正／取代

無。
