# 2026-10-05-009：逐題事件與能力隔離

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）；類型：資料契約／排程修復。
- 狀態：實作中；核准：完整模式任務清單及本次全部 review 修正。
- 規格：`openspec/changes/add-daily-learning/` D14–D17；前次紀錄：[003 schema](2026-10-05-003-learning-schema.md)。
- 分支 `feature/add-offline-study-suite`；未提交、未發布。

## 需求、變更與原因

事件必須反映實際答案，並按 sourceId＋能力＋實際方向獨立排程。原實作在缺 previousState 時，拿會持續更新的 source 累計進度當成舊版摘要，讓首次輸入題繼承選擇題 box4，答對一次便變成 box5。

修正為明確分開 `sourceProgress`（累計）及 `initialization`（初始化來源）：新能力使用 `{ kind: 'new' }`，真正舊版遷移使用 `{ kind: 'legacy', progress: 原始摘要 }`。缺少能力狀態時必須明示來源；已有狀態時不能再次初始化。不保留會靜默混算的 legacyProgress 參數別名。

## 規則、邊界與取捨

- `createReviewEvent` 僅接受完整提交；題型映射 recognition／production／listening-recognition／listening-production／assembly／grammar。
- 選擇題雙向仍是 recognition，有候選詞填空是 assembly，不冒充自由產出。
- 題面明示的 ability／questionMode 與實際模式須一致；choice 外形可承載 listening／pos，不能默默降成 recognition。carry 與事件共用解析；英日舊方向別名轉成既有 canonical key，不改寫固定題面。
- 真正答對仍累計正確；提示／重試只把排程評為 Again。當局有限事件控制升階與重設次數，補強不動長期排程。
- 明確初始化增加呼叫端責任，但消除不可靠的自動猜測；不能把一種能力的資料當另一種的遷移摘要。
- 不新增或刪除保存資料；API 尚未接正式頁面，呼叫方必須採新契約。失敗拋出 typed error，不回傳部分成功候選。

## 影響範圍與驗證

`assets/js/core/review-events.js`、`scheduler.js`、`tests/review-events.test.js` 與 `tests/ability-isolation.test.js`；跨模組案例另見 tests/review-fixes.test.js。變更前30個回歸案例實際失敗；修正後定向52/52通過，包括256組 mode／雙方向交叉組合、未到期的其他能力、真正舊摘要與非法初始化。補齊carry模式與別名後，相關五檔98/98通過。主代理最終整合 `npm test -- --test-reporter=spec` 結果649/649通過；瀏覽器底層測試亦通過，不能當成正式學習 UI 驗收。

## 未完成與後續更正

`applyReview` 回傳 event／itemState／progress／stats 候選；尚須由 repository 與 plan/session/收據同交易保存。FSRS、正式 UI、原生 APP 仍不在本次修復完成範圍。未提交／未發布。後續更正：無。
