# 2026-10-08-003：導覽先顯示與分級題庫資源

## 基本資訊
- 日期：2026-10-08（Asia/Taipei）。類型：效能／載入與錯誤恢復。
- 依據：使用者採用完整分批修正。狀態：實作中，未提交／未發布。
- 前次：[001](2026-10-08-001-continue-verification.md)；相關：[002 背景](2026-10-08-002-appearance-effects.md)、[004 查詢](2026-10-08-004-scoped-query.md)、[005 頁面](2026-10-08-005-demand-pages.md)。

## 需求與變更前後
原首頁為筆數下載完整 words／sentences，renderNav 要等所有靜態依賴。19 頁改用 page-boot：導覽先顯示，頁面再取得資料。首頁用可重現 metadata，今日字庫只取偏好級別；歷程／練習頁移除原本未使用的全字庫／句庫。只有需要題庫的分支才動態讀 catalog，索引故障不阻斷導覽。

## 規則、影響與取捨
tools/build-catalog.mjs 從原批次生成 17 個標記資源，ID、欄位、順序與授權保留；--check 可核對。原批次仍為編寫來源，修改後須重建。catalog.js 按語言／級別／題型讀取，保留整庫 API。「全部」仍須取得全部，詞庫與備份不刪減。頁面失敗提供重新載入；用新文件重建 module map，不宣稱同一失敗 import Promise 可直接復活。首頁統計與今日字庫獨立初始化。
影響：19 個 HTML、ui/page-boot.js、data/catalog.js、catalog/*、tools/build-catalog.mjs、tests/catalog.test.js、browser/page-loading.mjs。純前端相對 URL，沒有後端或資料遷移，不讀真資料。

## 證據與未完成
基線：本機空 context、200000 bytes/s、延遲120ms、CPU4倍、fixture無gzip，日文首頁 DOMContentLoaded6537ms／72資源／31資料模組。公開 Pages 的另一單次條件無限速：44資源／30資料模組 encoded216287bytes；兩組不能直接比秒數，線上不是本機最新版本。
第一輪本機相同限速，日文首頁導覽1274ms、46資源、4資料模組；歷程／練習導覽約925／983ms。這是中途單次結果，不是最終百分比或全部頁面的效能保證。
catalog 原實作逐筆一致3/3；大小護欄另抓出英文生成檔膨脹。待套用 compact 修補已於暫存生成器驗證：4033／7608筆一致，EN184939對原240603bytes、JA524476對原591118bytes。但專案生成檔與4/4仍須重跑，不把暫存證據稱為專案完成。
page-loading 的初版正式流程 PASS。兩項載入失敗路徑修補需新增真瀏覽器故障回歸；最終全套測試、同條件重測與部署仍待驗。未提交／未推送；不歸檔整合規格。

## 2026-10-08 收尾追加

暫存修補已套進專案，生成器已重跑：`npm run check:catalog` 對 17 檔一致，`node --test tests/catalog.test.js` 4/4 PASS。4033 個英文及 7608 個日文字的每個欄位、ID、順序與分級相同；生成字庫合計 EN 184939、JA 524476 bytes，低於來源的 240603／591118 bytes。這是未壓縮檔案大小，不冒充線上 transfer bytes。

`page-loading` 新增英／日各兩條真 Chromium 故障路徑：abort metadata 或第一級字庫，導覽與外觀可操作、統計不空白、今日卡提供重載；解除故障後按重載恢復。英／日歷程頁資料模組請求皆為 0。以 route 注入舊式 eager metadata／耦合統計版本分別重現缺少 topbar／stats，證明回歸斷言會抓到缺陷；未修改正式程式以製造 RED。最新定向 `page-loading` PASS、runner 失敗偵測 3/3 PASS、全專案 Node 1075/1075 PASS。

首頁統計等待儲存 ready，沒有為加速繞過遷移。metadata 到達比導覽晚屬預期，測試等待具體筆數，不把初始破折號誤判成資料遺失。生成器維護指令與題源／級別取捨已同步 README。完整瀏覽器、最終效能與原生／部署驗收依後續追加，不預先宣稱完成。

真網路故障另發現 quiz／daily 的原「重試載入」仍取同一 document 的失敗 module map：解除 abort 後兩頁都無法恢復（定向 RED）。正式 page-boot 注入 `onDataRetry`；quiz 重建頁面且以網址保留題源，daily 只在字庫錯誤時重建頁面，儲存／計畫錯誤仍沿用原重試。舊陣列或自訂 provider 呼叫者不注入時維持原地重試。

最新 `page-loading` PASS：英／日測驗與每日的真字庫失敗、解除後重試皆恢復；每日第 3 級偏好保留、情境題源仍選取。quiz 的臨時級別／方向／題數會重設，錯誤提示已明說；已保存 session、進度與每日偏好不刪除，不改備份格式。catalog 的 Promise cache 註解更正，不再誤稱能清掉瀏覽器快取。

APP 靜態 staging 已更新為 183 個受管理檔案，資源／原型安全契約 39/39 PASS；僅整理網站資源，不等於 Rust 編譯、安裝包或更新保留資料已驗證。

## 最終資源與可操作時間複測

2026-10-08 10:32:59–10:33:31，獨立工作流使用穩定來源快照、loopback fixture、每頁全新 Chromium context，下載 200000／上傳 100000 bytes/s、延遲 120ms、CPU 4 倍；無 gzip／快取／外連。以下每頁單次，依序為「導覽可見／DOMContentLoaded／功能可操作」毫秒，不是多次中位數：

- 全站首頁：1372／1355／3447；35 個資源，0 個 data 模組，body 合計 314970 bytes。
- 日文首頁：1345／1313／4141；46 個資源，4 個 data 模組（50632 bytes），body 合計 470207 bytes。
- 日文歷程：1167／1109／3118；35 個資源，0 個 data 模組，body 合計 298728 bytes。
- 日文練習：1225／1169／3972；47 個資源，2 個 data 模組（20695 bytes），body 合計 461890 bytes。
- 日文自由測驗：1176／1128／7035；50 個資源，8 個 data 模組（530611 bytes），body 合計 991363 bytes。
- 日文單字頁：1160／1115／6996；43 個資源，9 個 data 模組（534427 bytes），body 合計 849769 bytes；初始渲染 300 筆。

nav 使用動畫幀取樣，DCL 與可操作是不同量測點；body bytes 不含 headers，CDP request 總數也可能含文件／圖示，不能冒充壓縮後線上流量。ready 為今日卡與統計完成、備份讀取鍵、歷程提醒保存鍵、測驗開始鍵或單字搜尋／可收藏鍵。六頁沒有逾時、HTTP／console／頁面例外與外連。這是正常載入的有界複測，不宣稱和前輪基線完全等價或全部頁面都有速度提升；故障恢復另由 page-loading 驗證。

維護護欄追加到一般 Node 測試：17 個資源／metadata 逐檔生成一致，句型、情境、閱讀及問題筆數也對原始來源深比對；`catalog` 5/5 PASS，最新全專案 Node 1076/1076 PASS。這防止修改原句庫後忘記生成而網頁仍讀舊題庫；不新增網站執行期建置需求。

## 本次整合驗證結論

`node tests/browser/run.mjs --suite all` 最終 exit 0：appearance-effects、backup-preview、demand-pages、google-backup、harness、learning-store、migration、page-loading、quiz-conflict、quiz-progress、repository、scoped-queries、study-pages、vocab-favorites 全部 14 組 PASS，沒有未處理頁面例外。背景完整代表套件 24 組像素／24 組 computed，38422ms、0 失敗。`node --test` 1076/1076 PASS，0 skipped／cancelled；runner 自我檢查 3/3 PASS，題庫生成核對 PASS。

本次背景與載入修正狀態為「本機已驗證，未提交／未發布」。程式與邏輯紀錄均已位於專案，不再只依賴 Desktop 暫存 patch；保留其他工作區修改。沒有操作真實學習資料、Google 帳號、安裝包／真機、遠端或 Git 發布；整體 spec 的大資料／原生平台閘門仍未完成，不歸檔，也不宣稱公開 Pages 已更新。
