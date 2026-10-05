# 2026-10-05-013：跨日續答、備份競態與資料契約複查修復

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）。
- 類型：修復／資料契約／文件同步。
- 狀態：本輪修復已發布並確認 Pages 資產更新；未接線功能仍未完成。
- 核准：使用者確認複查範圍 `fd9b18a → 451fbbe`，並要求「都幫我修復」；先前已明確授權本專案確認後提交、推送及確認 Pages。
- 前次紀錄：[011 審查修復](2026-10-05-011-review-fixes.md)、[012 發布與線上 QA](2026-10-05-012-pages-qa.md)。012 的驗收版本與結果保留，不拿來冒充本次驗收。
- 規格：[每日學習](../../openspec/changes/add-daily-learning/design.md)、[整合功能](../../openspec/changes/add-offline-study-suite/design.md)。
- 分支：`feature/add-offline-study-suite`；修復前版本：`451fbbe09f7e570c8e9e21b41f0212631db5de8b`。程式修復提交：`88f81e377c7d96bf23fb3024fad95478e2d3883a`；本段發布證據由後續純文件提交補記，見本檔 Git 歷史。

## 需求、修復前後

| 已確認問題 | 修復前 | 修復後 |
|---|---|---|
| 1. 舊摘要跨日題次身份漂移 | 無題面 legacy 與完成後 skill 身份不同，舊題復活；已準備 carry 又被摘要重排 | carry 保留原 entryId，以同來源＋同題次綁定後續能力；有 carry 不重造無維度摘要卡 |
| 2. 正式備份面板讀取競態 | 較慢的檔案／代碼覆蓋新預覽，舊錯誤清掉新結果 | 檔案與代碼共用讀取世代；新讀取立即撤下舊確認，取消及匯入使舊工作失效 |
| 3. 舊備份 section 驗證不足 | 外殼合法但 progress 版本 99 仍覆寫，載入後變空 | 共用統計／進度驗證，偏好限定現有欄位及模式；壞區塊明示跳過，合法區塊獨立救回 |
| 4. 已開始新字缺介紹時間仍合法 | 可匯入但無法 prepare 續答 | prepared／completed 新字必須有 introducedAt；完整 learning 必須有相同日帳本 claim |
| 5. 能力 key 與欄位不一致 | 匯入成功但實際提交被 scheduler 拒絕 | 初始化、排程與 schema 共用 skillKeyFor；key 必須等於來源＋能力＋canonical 方向 |
| 6. repository meta 守衛不完整 | 無效時區／歷史時間／政策版本仍可開放與寫入 | ready、遷移及交易使用完整 meta schema，拒絕且保留 DB 原值 |
| 7. 跨午夜以昨天額度介紹新字 | 今天第一次介紹仍扣昨天，可能多發每日配額 | 尚未介紹新字使用已解析學習日守衛，過期回 STALE_PLAN，要求重新取得今日清單 |
| 8. 文件副本重建指令缺必要參數 | 閱讀版顯示的指令直接執行失敗 | 指令附完整輸出目錄、PowerShell quoting；檔頭明說參數或環境變數必填 |

另外修正兩項有界的文件／儲存後續問題：clearLearning 同交易重建固定收藏簿、成就政策及提醒預設，不把舊 epoch 收據放回新資料；README 不再把推送當作部署完成，也不承諾未建 Service Worker 的離線冷啟動。

## 規則、邊界與取捨

- 新 carry 只綁定同 sourceId 與 entryId，不以「同字」刪掉其他能力／方向。修復前已保存的重新產生 ID，僅認精確 `planId:review:sourceId`／已介紹 `planId:new:sourceId` 格式，限定同語言、級別、介紹時間及嚴格更晚學習日的唯一能力。任意 ID、同日、不同級別與極簡題面不推測關聯；矛盾能力／方向明確 UNSUPPORTED，歷史原件不改。新 carry 不再重造題次 ID。
- 能力狀態 direction 只接受 `target2zh`／`zh2target`。題面舊別名仍由事件入口正規化；不能把別名直接當持久能力身份。旧 v1 遷移不產生能力狀態，因此無需推測或改寫既有 n/w/due。
- 新字 status 與介紹時間雙向相符：pending／skipped 不可已介紹，prepared／completed 必須已介紹並具有帳本 claim；不讓匯入後只能報衝突卻無法續答的狀態通過。
- 只擋新字的首次 claim：昨天已 prepared 的題面可續答，carry 作 review 不再領額度。時鐘倒退沿用已建立日；改區未生效時由 `studyDayState` 注入 `resolveStudyDay`，不能用 OS 日期另發額度。沒有改區政策時使用 plan.timeZone。正式 repository 接線仍須原子讀取政策及帳本。
- 檔案／代碼新工作開始、取消、確認匯入均換代；舊 callback 與已移除 DOM 的舊確認／取消 handler 不得重畫、寫入或搶焦點。帶走備份與等待匯入仍互不清空；讀取期間複製也不覆寫輸入框。
- 舊外殼 v0／v1 保留；缺版本、字串、小數、負數、未來版拒絕。各區塊通過後才可寫；部分救回會在預覽明示跳過項目。進度缺早期 box/last/due 可原样救回。10 MiB 是 UTF-8 bytes，不是中文字數；檔案先以 size 擋超限，解析再分段計數。
- 非數字備份版本使用固定錯誤文字，不對不可信物件做字串轉型。`version: {toString: null}` 正常拒絕，不拋 TypeError 或卡在讀取狀態；純測試與真 Chromium 均涵蓋。
- 清除的新 epoch 不接受舊頁重送；新世代 operations 沒有舊收據。故障回滾連原固定集合一起保留。這不等於新清除 API 已接到正式網站。
- 文件重建指令針對 PowerShell，以單引號保留含空白／單引號的目錄；HTML escaping 與 shell quoting 分開處理。不在公開專案保存使用者個人目錄。

## 影響檔案

- `assets/js/core/daily-plan.js`：legacy carry 身份與摘要去重。
- `assets/js/core/learning-identity.js`、`learning-schema.js`、`scheduler.js`：共用能力身份、匯入形狀與啟用守衛；scheduler 原 export 位置保留，呼叫者不需改 imports。
- `assets/js/core/study-session.js`、`learning-errors.js`：首次介紹的日界守衛與 typed error。
- `assets/js/core/backup.js`、`assets/js/ui/backup-view.js`：現行正式 v1 面板讀取、預覽與寫入安全。
- `assets/js/ui/platform/web-repository.js`：meta 完整驗證與合法空資料的原子清除。
- `openspec/tools/build-doc-html.mjs`、`README.md`：可重建副本及部署／離線說明。
- 新測試：`daily-plan-legacy-carry.test.js`、`learning-contract-regressions.test.js`、`backup-preview-race.test.js`、`backup-validation-regression.test.js`、`doc-rebuild.test.js`；browser `backup-preview.mjs` 及 `repository.mjs`。
- 舊 daily／session／schema 測試 fixture 改成與正式初始化一致的 canonical state；保留題面 alias 測試，不刪除錯誤分支。

## 資料相容、遷移與回復

沒有讀取、覆寫、清除或遷移使用者真實資料。測試只用明確假資料及 runner 的隔離 context。

schema／IndexedDB 版本不變，不對損壞 v2 狀態做猜測式修復。以前可被寬鬆驗證接受、但不能提交的 alias state／缺 introducedAt 新字，現在在匯入前拒絕；原備份仍保留。正式網站尚未生成這些 v2 能力集合。原 v1 摘要／外殼支援保留。

## 驗證紀錄

主代理最終驗證（2026-10-05）；下列均為實際执行結果，非待執行計畫：

- `node --test --test-reporter=tap`：798/798，0 失敗；包含新增的舊格式資料相容與已介紹新字不可倒退成 pending／skipped。

- 主代理已確認 schema／跨午夜新增測試修復前 4 失敗、2 通過；修復後定向 66/66，追加改區守衛後新契約 7/7。
- legacy carry 執行者修復前 41 條 RED，首次修復後定向 87/87；再補修復前 ID 相容的 84 項，修復後聯合 171/171。備份執行者新增 14 項、聯合 67/67；repository 執行者兩組新增瀏覽器案例先 RED 再 GREEN。
- 主代理已執行 `npm run test:browser`：runner 3/3、backup-preview／harness／migration／repository PASS；repository 10 組皆 PASS。
- 真 Chromium 首頁實際 DOM／File.text 延遲、file↔code、新舊確認、取消、非法 section 不覆寫；1440／375 無整頁水平溢出。不是只有 mock DOM 或規格推演。
- 文件產生器實際跑參數與環境變數、含空白及單引號的目錄，從 HTML 取出指令再跑成功；缺輸出目錄 exit 1。
- 文件相對連結測試掃描公開 README、規則、邏輯變更與進行中規格：沒有缺少的本機目標；76/76 規格情境／任務映射仍完整，但不等於功能已完成。

## 未完成項目與發布狀態

本筆關閉本輪八項確定缺陷，不宣稱每日 UI／完整交易還原／FSRS／Google／三平台 APP 已完成。011 的大量歷史首次規劃成本仍未關閉；需在正式接線前完成背景化或有交易保護的索引整合，不能靠截斷歷史通過驗收。

A 階段 scheduler 仍沿用原 `srs.dueAfter` 的裝置當地時間排程；固定 timeZone 此階段用於學習日／配額／計畫鍵。這是保留既有 Leitner 的範圍說明，不把固定學習日時區冒稱已套到全部 due；原 due 不重算。B 階段／跨平台接線要另驗 adapter 的時區與保留原 due 政策。

寫稿時尚未提交／部署；發布後會追加實際提交、部署及線上資產比對證據，不由本機測試推論 Pages 更新。Chromium 不代替 iOS／Android 真機驗收。

## 發布補記（2026-10-05）

- 修復提交 `88f81e3`：26 個經查核的程式、測試與文件檔案。正常快轉推送 `451fbbe → 88f81e3` 至 Pages 使用的 main；沒有 force push，也沒有提交 `.idea`／`.cursor` 個人設定或工具檔案。
- [GitHub Pages 部署工作](https://github.com/liangzhongyi-code/Language-learning/actions/runs/37270090177)：head_sha 為完整修復 SHA，狀態 completed／success。
- 主代理從實際 Pages 讀取 `daily-plan.js`、`learning-schema.js`、新增 `learning-identity.js`、`backup-view.js`、`ui/platform/web-repository.js` 及本篇原提交版本，全部 HTTP 200；只正規化 CRLF／LF 後，內容與本機提交完全相同。
- 本段只留存已發生的發布證據，不改執行邏輯；上述本機真 Chromium 是隔離 fixture 站的功能驗證，本次線上確認是部署狀態及六份資產內容，不冒充又跑了一輪線上完整 QA。
- 後續純文件提交不改程式修復 SHA 所代表的執行行為；012 的舊 QA 與本篇新驗證保持各自版本界線。
