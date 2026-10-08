# 2026-10-07-006：P00b 本機 Tauri／SQLite 窄原型

## 基本資訊

- 原工作批次日期：2026-10-07；本輪續做及驗證：2026-10-08（Asia/Taipei），沿用原型邏輯批次的預留檔名。
- 類型：平台原型／資源 staging／安全契約。
- 狀態：實作中；Node 契約已驗證，原生編譯與實載未驗，不代表 P00b 整體完成或發布。
- 核准依據：整合 tasks 記錄 2026-10-05 兩道核准；使用者要求沿用已核准的整批任務繼續實作。本紀錄涵蓋其中 P00b 本機原型，必要專用測試先實跑 RED。
- 規格：[整合 tasks](../../openspec/changes/add-offline-study-suite/tasks.md) P00b／F50a／F50e、[原生設計](../../openspec/changes/add-native-app-packaging/design.md) TD1／TD2／第 7、9、12 節。
- 相關前次紀錄：無獨立前次 P00b 紀錄；沿用既有 app staging 與四個 RED 測試。
- 分支／commit：未提交；本輪沒有 commit／push／merge。

## 需求與原因

先讓最小 MPA／窄 SQLite 邊界可查閱與測試，保留原本網站及既有安全打包器。四個 P00b 測試已要求 scaffold、probe 及 prototype manifest，但來源缺席。Rust 工具不可用時仍完成原型來源與誠實的待驗文件，不安裝 SDK，也不假稱 SQLite 真執行。

## 變更前與變更後

- 之前只有網站 21 頁白名單與 stage-web，CLI 使用 `^2.0.0`；四個 P00b 契約因缺檔 RED。
- 現在有兩個本機原型 HTML、外部 ui／probe 模組與深色置中 CSS，兩頁往返後各自重新執行探針；沒有沿用上一頁的成功狀態。
- 新增獨立 prototype manifest／stage wrapper；原網站清單保留 21 頁順序，再追加兩頁。既有 stage-web、assets-manifest 與 app-assets.test.js 都未修改。
- 新增 Tauri2 Cargo／config／build.rs／main／lib／SQLx probe 來源。bundle.active=false，main create:false，由 lib setup 手動建視窗並先附導覽限制。
- 回應 learningRepository 固定 not-implemented。前端 await 後仍要核對完整格式；普通網站、invoke 拒絕或異常回應不顯示成功。

## 規則、邊界與取捨

- 僅註冊 prototype_probe，沒有任意 SQL／路徑入口，也沒有 SQL plugin、學習資料 native repository 或網站 facade 改動。
- Tauri 官方文件指出自訂 command 預設可能供所有視窗存取，因此 build.rs 使用 AppManifest::commands 將其納入 ACL，capability 僅 local main／allow-prototype-probe；security 明列 prototype，沒有 remote 或通用 core 權限。
- Rust 導覽與 command 都核對精確 origin／兩頁路徑、拒憑證／port；JS 另檢查頂層原型頁和 Tauri runtime。CSP 禁止 frame、object、base、表單與外部 script；網站 21 頁雖在資源包中，不授予廣域 invoke。
- 桌面新視窗請求拒絕；官方 API 標示 Android／iOS 不受支援，所以行動平台來源隔離與新視窗行為必須另驗，不能宣稱三平台完成。
- 每次探針使用新建單一 in-memory SQLx 連線；交易先改 state／event 兩組資料，驗交易內值，再注入 CHECK 故障，await rollback 後查舊值。只在全條件成立後回成功。
- UI 在 pending 時停用按鈕，清除舊結果；失敗顯示繁中錯誤，finally 恢復按鈕供重試。資料庫沒有真紀錄，沒有匯入／遷移／持久化。
- 直接依賴精確固定：CLI 2.8.4、tauri =2.8.5、tauri-build =2.4.1、sqlx =0.8.6、serde =1.0.219。選型與 primary API 對照完成；實際解析、間接版本鎖定與編譯相容性未驗。

## 影響範圍

- app/package.json：CLI 精確版本與 stage:prototype 入口。
- app/prototype-manifest.json、app/scripts/stage-prototype.mjs：原型資源清單與既有打包器入口。
- app/prototype/index.html、second.html、prototype.css、probe.js、ui.js：原型兩頁／導覽／探針協定及狀態。
- app/src-tauri/Cargo.toml、build.rs、tauri.conf.json、capabilities/prototype.json：原生依賴、ACL 與最小本機配置。
- app/src-tauri/src/main.rs、lib.rs、probe.rs：手動建視窗、來源篩選、固定 SQLx 回滾探針，含兩個尚未執行的 Rust 單元案例。
- tests/app-prototype-security.test.js：必要的三個 P00b/S20 專用安全契約，新增前先實跑 RED；沒有改舊測試。
- app/docs/toolchain.md、app/docs/p0-evidence.md：版本 primary docs、實跑數量、工具與平台待驗事項。
- app/dist-web：本輪 staging 生成 169 個檔案，既有 gitignore 排除；沒有原生安裝產物。
- 本文件保存原型決策與局部驗證；整批索引及全套結果另見 [2026-10-08 續作驗證](2026-10-08-001-continue-verification.md)。

## 資料相容、遷移與回復

不改網站儲存／學習契約、不讀寫使用者真資料、不建立持久 SQLite 或遷移。每次 in-memory 探針失敗即回拒絕，連線關閉或釋放即結束 fixture。staging 使用既有受管理輸出檢查，失敗保留舊包；不擴大來源或刪除任意資料。

## 驗證紀錄

以下均為 2026-10-08 本工作流親自執行：

- RED `node --test tests/app-assets.test.js`：exit 1，36 項、32 pass／4 fail；缺 scaffold／probe／prototype manifest。不是因 SDK 缺席而失敗。
- 專用 contract RED `node --test tests/app-prototype-security.test.js`：exit 1，3 項、0 pass／3 fail；缺 probe 模組／native config。
- GREEN `node --test tests/app-assets.test.js`：exit 0，36 pass／0 fail／0 skipped。
- GREEN `node --test tests/app-prototype-security.test.js`：exit 0，3 pass／0 fail／0 skipped。涵蓋網站／frame 拒絕、合法兩頁窄 invoke、capability／CSP 最小配置。
- 三個新增 JS 檔 node --check：exit 0。
- `node app/scripts/stage-prototype.mjs`：exit 0，169 個檔案；Node 資源 staging 不等於原生 WebView 兩頁實載。
- 修改前後 SHA256 相同：stage-web.mjs `C4A49709E5002AE46D6C5B1DF17E6BC16F20D372FD04488EDA5C4A9D83B97007`；assets-manifest.json `363DAF76C33A2D47AFADC443493CC072C9353C216D99E976ECAAB81FB6E86A12`；app-assets.test.js `961ACC0CAE949634FC069A7AC74C7FCFDFDA8F0F1A4D39D2F665CC2516118058`。
- 本範圍定向 Node 單元／契約合計 39 項。Rust 兩項只有來源、未執行，不納入 pass 數。
- `Get-Command cargo,rustc` 找不到；Cargo.lock 與 app/package-lock.json 均不存在。沒有 native 編譯、SQLx 真執行、ACL 真機拒絕、安裝／更新／離線語音證據。

完整後續驗收步驟見 [P0 證據](../../app/docs/p0-evidence.md)；官方版本／API 引用見 [工具鏈](../../app/docs/toolchain.md)。

## 未完成項目與發布狀態

- 缺 Rust 工具：cargo check／test、真正 dependency resolution／lockfile 仍待驗，不使用 Cargo.lock 假檔。
- Windows 原生兩頁斷網啟動／invoke／SQLx、Android／iOS 原型、P00c 離線 voice／IPA／續簽／到期仍未驗；P00a／P00b／P00c 不勾整體完成。
- 正式 native learning repository、持久資料交易／遷移／復原不在此次原型實作範圍。
- 未安裝任何 SDK，沒有原生建置假完成；未提交／未推送／未合併／未發布。
- 局部驗證與全套結果分開記錄，不以原型來源的完成代替整批驗收。

## 後續更正／取代

無。本輪日期與原工作批次不同已在基本資訊說明，沒有覆寫先前驗證證據。
