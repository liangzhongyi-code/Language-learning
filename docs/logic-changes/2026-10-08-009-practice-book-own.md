# 2026-10-08-009：練習題源單字簿只接受自有項目

## 基本資訊

- 日期／時區：2026-10-08（Asia/Taipei）；類型：修復／題源契約。
- 狀態：已驗證（定向 Node、隔離 IndexedDB）；未提交／未推送／未發布。
- 核准：使用者追加要求在本次擁有的 practice-service 對 bookId prototype 路徑作最小守衛，James 繼續處理 view。
- 規格：[單機學習設計](../../openspec/changes/add-offline-study-suite/design.md)。
- 前次紀錄：[整批審查](2026-10-08-006-review-integration.md)、[開局讀取](2026-10-08-008-session-start-meta.md)。分支／commit：未提交。

## 需求與原因

`eligibility` 直接讀 `rows.books[bookId]`，網址指定 `toString` 等繼承屬性時會當成有書本；其 wordIds 是 undefined，傳入 eligiblePractice 後套用預設 null，實際回退整個級別題庫。這違反「指定簿缺題不得全庫補題」契約。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 不存在、但與 Object 原型同名的 bookId | 誤當成書本，回退全庫 | 先以 ES2020 的 hasOwnProperty.call 檢查；回既有找不到單字簿訊息 |
| 對無效 bookId 開局 | 可以建立非指定題源 session | UNSUPPORTED，零 session／事件／統計寫入 |
| 真正自有的 toString／hasOwnProperty ID | 是合法資料 ID | 仍可使用，不以名稱黑名單誤擋 |

## 規則、邊界與取捨

- 只加自有屬性守衛，不修改書本資料、題庫、UI、URL 或既有 missing-book 錯誤契約。
- 正常單字簿仍只依簿內 wordIds、語言、題型及級別篩選；沒有 bookId 的既有行為不變。
- 不用較新的 Object.hasOwn，避免重新破壞 ES2020 基線。
- 不更動其他 worker 的 view 修復或既有 suite；沒有新依賴。

## 影響範圍

- `assets/js/ui/platform/practice-service.js`：eligibility 查簿與註解。
- `tests/review-session-start.test.js`：新增 5 個不存在書本及 3 個自有書本案例。
- `tests/browser/suites/review-session-start.mjs`：真 IndexedDB 的 toString 不存在案例。

## 資料相容、遷移與回復

無 schema／格式／權限變更，不需遷移；保留合法既有 ID。沒有刪除或改寫任何使用者資料。若回復守衛會恢復錯誤題源，不以清除紀錄作回復方式。

## 驗證紀錄

| 日期 | 指令／操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-08 RED | `node --test --test-name-pattern='practice book' tests/review-session-start.test.js` | 4/8 失敗：toString、__proto__、constructor、hasOwnProperty 被誤判為可用且回全庫；普通不存在及三個自有 ID 通過 | view 由 James 處理 |
| 2026-10-08 GREEN／擴大回歸 | [007 所列完整指令](2026-10-08-007-runtime-es2020.md#驗證紀錄) | 109/109 通過，包含全部 8 個 bookId 案例 | 非整站 UI 回歸 |
| 2026-10-08 Chromium | `node tests/browser/run.mjs --suite review-session-start` | PASS；真 repository 的 toString 資格為 false | 未重複其他 worker 的頁面測試 |

## 未完成項目與發布狀態

- service 修復已完成；view／整批驗證依 006 統整。
- 未提交／未推送／未發布。

## 後續更正／取代

無。
