# 三平台離線 APP 設計

> change-id: add-native-app-packaging｜2026-10-05
> 完整模式；2026-10-05 設計已核准；詳細 tasks 待第二道核准，未進入 TDD。
> 分支 feature/add-offline-study-suite，基準 main @ fd9b18a；共用整合 tasks，避免三條互相依賴的分支。

## 1. Overview

### 1.1 Purpose
將同一套網站封裝成可安裝的本機 APP。真正的成功條件不是編譯成功，而是三平台實際安裝、斷網啟動、保存學習結果、升級／iOS 續簽後仍能取得資料。

### 1.2 Scope
沿用既有 13 頁 MPA、JS 題庫及核心邏輯，新增頁面納入明確資源清單；新增 Tauri 2、平台介面、原生交易儲存、離線 TTS 與檔案／分享整合。Windows／Android 在 Windows 建置，iOS 需 Mac。不上架、免登入、不做新背景特效、自動更新或雲端同步。配合每日學習與單機學習整合設計，保存已提交的未完成局；尚未提交的輸入不承諾復原。

### 1.3 Related Documents
- [proposal.md](proposal.md)
- [specs/native-app.md](specs/native-app.md)：S01–S22
- [tasks.md](tasks.md) 指向整合任務清單，已建立並待第二道核准；本設計不代替 tasks。

## 2. Architecture

### 2.1 System Context
```text
現有 13 頁 HTML／UI → bootstrap（等待就緒）→ 平台 facade
           │                                  ├─ 網站：IndexedDB 學習資料／localStorage 偏好／Web Speech
           ↓                                  └─ APP：限定 native commands
       純 core 演算法                                      │
       與靜態題庫                         SQLite 交易／原生 TTS／檔案與分享

網站 ↔ 備份格式 v2（相容匯入 v1）／langlearn0:、langlearn1: 編碼 ↔ APP
GitHub Pages = 網站；GitHub Releases = 安裝包下載
```

### 2.2 Components
- 打包器：以明確白名單收集 HTML／assets 至 APP staging 目錄，檢查相對路徑；不複製整個 repo。
- bootstrap：偵測可靠的原生 runtime，等待平台 ready，然後動態載入既有頁面初始化；失敗顯示重試／復原，不用空資料繼續寫入。
- 平台 facade：讀快照、提交、匯入、清除、檔案、剪貼簿、分享、語音的非同步統一入口。
- core：維持不依賴 DOM／原生 API。既有同步 storage 注入可用純記憶體快照計算，不能直接冒充已持久化。
- Native Repository：Rust command 擁有 SQLite transaction，原子更新資料與操作紀錄；前端不能傳任意 SQL／DB 路徑。
- 原生裝置橋接：Windows 能力驗證；Android Kotlin TTS／分享；iOS Swift TTS／分享。現成官方插件滿足能力才採用，不預先承諾同一插件全平台支援。

### 2.3 Interactions
1. 頁面啟動 → ready → 讀取 revision、epoch 及 stats／progress／learning／prefs → 初始化 UI。appearance 的模組頂層副作用移到就緒後。
2. 每題提交 → core 從快照計算 stats／progress／learning、日誌、排程、每日清單與續答位置 → commit(operationId, expectedRevision, epoch, changes) → Rust 同連線 transaction → 成功回新 revision → UI 更新「已保存」。結果頁不再次累計同一題。
3. 寫入失敗保留待重試操作；同 operationId 重試不重算／不重複計分。舊 revision 衝突重新讀取並重新計算，不強制覆蓋。
4. 提交期間避免內部換頁；外部強制結束仍以交易保護。偏好寫入序列化並等待完成，不能依賴 pagehide 的非同步存檔。
5. 匯入先 decode／深度 validate／preview；確認後一次交易保存還原點及整組學習資料，再廣播 prefs 更新。取消保留原資料。網站偏好獨立儲存，必須分別回報結果，不宣稱跨 IndexedDB 與 localStorage 原子提交。

## 3. Technical Decisions

### TD1：Tauri 2 共用外殼
- Context：現有靜態網站不需要前端框架重寫，但需桌面與行動原生能力。
- Options：Tauri 2 共用（一套外殼、需 Rust）；Tauri + Capacitor（手機生態熟悉、維護兩套橋接）；Electron（桌面成熟、無同一套原生手機路線）；PWA（安裝輕量、資料與平台能力仍受瀏覽器政策）。
- Decision：優先 Tauri 2，先做三平台最小原型。
- Rationale：保留 MPA／題庫，統一 bridge 及發行結構，符合三平台目標。
- Consequences：需補 Rust／C++ 工具；多頁路由、iOS IPA 與原生功能未驗證前不能承諾完成。P0 失敗要回設計審核，不默默換框架。

### TD2：SQLite 交易式原生儲存
- Context：統計及逐題紀錄必須一起保存，且要處理重試、崩潰及資料版本。
- Options：沿用 WebView localStorage（改動小但非原生交易）；Tauri Store JSON（簡單但額外處理跨區塊落盤／恢復）；SQLite（明確交易與遷移，增加 Rust／SQL 邊界）。
- Decision：APP 採 Rust 端 SQLite／sqlx，由自訂窄命令負責完整交易；網站採 IndexedDB 保存學習群組、localStorage 保存偏好，不引入 SQLite Wasm。兩端實作同一 repository 契約。
- Rationale：交易將 stats、progress、learning、日誌、排程、revision、epoch、operationId 一起提交，避免部分作答保存與跨平台資料格式分歧。
- Consequences：這是對先前初步 Store 候選的設計收斂，尚未實作。要新增原生整合測試及遷移；不讓前端透過連線池分別呼叫 BEGIN／UPDATE／COMMIT，亦不暴露通用 SQL 權限。

### TD3：非同步 facade 與啟動屏障
- Context：prefs／appearance 目前在模組載入時讀 localStorage；原生讀寫是非同步。
- Options：本機快取假裝同步（容易假成功／跨頁丟寫入）；把純 core 全改 async（波及大）；UI 非同步協調 + core 快照計算（分層清楚）。
- Decision：第三種；UI 保存入口明確 await，core 只計算，所有頁面經 bootstrap。
- Rationale：避免預設值覆蓋與未落盤成功訊息，也保持純函式測試。
- Consequences：會調整多個 UI 呼叫點與測試；theme-boot 的瀏覽器快取只能用來預先上色，原生資料才是 APP 真實來源。

### TD4：手動發行及自用側載
- Context：不上架且不購買 Apple 開發者會員是目前使用方向。
- Options：商店（審核／費用）；自動更新（需額外簽章與供應鏈）；手動安裝包（簡單、需使用者下載及續簽）。
- Decision：EXE／簽署 APK／自用 IPA；Windows 放 GitHub Releases，首版手動更新。iOS Mac 建置，Sideloadly 可在 Windows／Mac 安裝續簽。
- Rationale：符合現有使用條件，先驗證資料不丟再增加更新自動化。
- Consequences：免費 iOS 約 7 天到期；需要連線與電腦續簽。Windows 未購可信簽章可能警告；不要求停用防護。公開 Release 不包含私人簽署憑證或學習紀錄。

## 4. Data Design

SQLite 位於固定 APP 私有資料目錄，APP identifier 首次安裝前定案並固定。WebView localStorage 不作 APP 學習資料真實來源。

- meta：schema_version、revision、epoch、舊資料遷移完成或禁止重新遷移標記。
- 領域資料：stats／progress／learning／prefs、單字簿、筆記、學習意向、每日計畫與續答；日誌及排程按查詢需求建索引，不把全部歷史塞進每次必須解析的單一 JSON。不重新編號既有題目。
- operations：epoch 與 operation_id 複合鍵及提交結果，用於去重；資料量與保留策略在 tasks 訂明，首版不依賴自動刪除去重紀錄。
- restore_points：匯入／遷移前快照，最多保留最近三份；移除舊還原點與新提交在同一交易。
- 同一 DB 內還原點只能處理誤操作，不能救回卸載或 DB 損壞；遷移前一致性外部備份是另一道保護。通知排程透過交易內 outbox 記錄待同步操作，原生系統呼叫不屬於 DB 交易；啟動時依 epoch／排程世代核對與重試。
- 所有建表使用 CREATE TABLE IF NOT EXISTS；寫入用 UPSERT／受主鍵約束，不拼接使用者輸入 SQL。遷移表版本化且測重跑。
- schema 較新／DB 損壞：不回空值覆蓋。資料庫層錯誤對使用者轉為繁中訊息，細節不含私人紀錄。

## 5. API Design

以下為擬定介面，tasks 核准後用測試定型：
- ready()：平台能力與儲存可用性。
- readSnapshot()：schemaVersion、revision、epoch、stats／progress／learning／prefs；大集合使用分頁查詢。
- commit({operationId, expectedRevision, epoch, changes})：成功 revision 或 typed error；原生 transaction 完成才 resolve。
- restoreBackup({validatedLearningGroup, validatedPrefs, operationId, expectedRevision, epoch})：保存還原點並交易式替換學習群組。v1 先按明確遷移規則轉換，v2 群組任一區塊不合法就整組拒絕。
- exportFile／pickFile／share／copyText：分開表示 success、cancelled、unsupported、error。
- listVoices／speak／stop：語言、離線能力、聲音 identifier，無本機 voice 時不走雲端退路。

網站 facade 保證 IndexedDB 學習群組交易，不宣稱與 localStorage 偏好跨儲存原子性；APP 原子承諾由原生 transaction 達成。新版備份驗證器共用，覆蓋範圍須明確確認；OS 通知權限、工作識別碼不隨備份搬移。

## 6. Implementation Approach

### 6.1 Technology Stack
- 靜態 HTML／CSS／ES Modules 不換框架。
- Tauri 2.x、Rust stable、SQLite／sqlx；精確相容版本在 P0 驗證後鎖入 lockfile，不盲用 latest。
- 原生 JS API 僅在 APP build 綁入 local bundle；瀏覽器走 facade 的 web 分支，不需解析未安裝套件的 bare import。
- Node node:test 保留；Rust cargo test 測交易／命令；原生安裝、TTS、簽署以真機驗收。
- Android JDK／NDK 用產生專案的相容版本，不因本機已有 JDK 17 就視為全部前置齊備。

### 6.2 Code Organization
```text
app/package.json                    # 原生建置依賴，不污染網站 runtime
app/src-tauri/                      # Rust、config、capabilities、mobile generated
app/src-tauri/src/storage/          # DB、transaction、migrations
app/src-tauri/src/commands/         # 限定能力
app/scripts/                       # 資源白名單、bridge bundling、建置檢查
app/dist-web/                       # 生成資源，gitignore
assets/js/ui/platform/             # web/native facade 與 bootstrap
assets/js/core/                     # 純資料驗證／計算，禁止平台 API
tests/platform*.test.js            # 注入式平台測試
```

預期影響：既有 13 頁與後續核准新增頁面的啟動 script、prefs、appearance、theme-boot、quiz-view、stats-view、backup-view、speech、voice-check、nav、備份驗證及 structure 測試範圍。正式頁面依資源清單完整驗證；不可透過固定舊頁數或縮小測試範圍漏掉新頁面。

先 P0 多平台原型／工具鏈驗證；P1 共用初始化與交易；P2 Windows；P3 Android；P4 iOS；P5 全平台回歸。P2／P3 可在共享介面穩定後平行，P4 的 IPA／續簽風險在 P0 就先測。

## 7. Security
- 不開遠端頁面 bridge；外部連結交系統瀏覽器，拒絕未知 scheme／任意檔案路徑。
- Native commands 按用途與本機來源配置最小 capabilities；CSP 配合現有 inline scripts 改外部模組／hash，不允許一鍵全開。
- SQLite 檔案不能從頁面指定路徑；參數化 SQL；原生端也驗證 payload／key／大小，不能只信 JS。
- 備份上限：原檔及解壓後各 10 MiB，代碼文字 16 MiB；解壓逐塊累計，不先收完整結果才檢查。
- 原生憑證／keystore／Apple 帳號不入版控、不由聊天接收密碼。第一版 iOS 在本機 Mac 簽署，不把 Apple 帳密放 CI。
- APP 私有沙箱不是資料加密；使用者匯出的檔案／代碼仍可讀，保留提醒。

## 8. Performance
不把整份題庫存 DB，DB 只放使用者資料。以 15,000 筆逐題紀錄 fixture 測載入、存檔、匯出；記錄實機耗時再訂合理門檻。UI 非同步不阻塞主執行緒，連續偏好更新依序提交。原生包容量、WebView2／語音包容量以實際產物量測，不用網站資源大小推算。

## 9. Testing Strategy

每個 Scenario 對應獨立案例。tasks 階段將拆成含檔案、相依、指令與成功條件的 5–60 分鐘任務。

- S01：三平台 airplane-mode cold start 實機腳本及資源請求稽核。
- S02：Node 打包器 fixture，缺檔／多放模擬機密時 RED。
- S03：MPA 連結與 query 整合；Android 返回實機、半局確認 cancel。
- S04：平台延遲 Promise 測試，故意拿掉 ready 屏障時必失敗。
- S05：每題提交於 SQLite 的 stats／progress／learning／日誌／排程／清單／收據之間故障注入，驗全組回滾及結果頁不重算。
- S06：重送 operationId 與雙 revision 衝突的原生交易測試。
- S07：子程序交易中斷／重啟整合，加真機強制結束。
- S08：損壞 DB／未來 schema fixture，不可覆蓋原檔。
- S09：舊版 DB fixture 遷移重跑及中途故障。
- S10：v1 匯入迁移與 v2 完整群組跨 web/native 往返，涵蓋 JSON、langlearn0、langlearn1 編碼。
- S11：學習群組深驗證／預覽／還原點及失敗回滾，網站偏好分開回報。
- S12：邊界大小、zip-bomb 型 fixture、NaN／負值／非法計數。
- S13：原生能力替身三態測試，加實機 file/share/clipboard。
- S14：日英 voice 真機斷網發聲、停止與背景生命週期；不以 API resolve 代替耳聽或音訊證據。
- S15：缺包／網路 voice 的替身與真機檢查。
- S16：乾淨 Windows VM／測試機無 WebView2、斷網安裝。
- S17：Android 同簽章升級、錯簽章失敗真機案例。
- S18：Mac build + iPhone 側載／續簽／到期恢復；7 天觀察不自動設排程，未測完保持未完成。
- S19：Windows 前一版升級 fixture，持久化資料比對。
- S20：非法 invoke／來源／scheme／路徑測試。
- S21：現有全套 Node 回歸 + 舊 localStorage 到 IndexedDB 遷移及純靜態網站端到端。
- S22：鍵盤／觸控／live region／安全區的 DOM 與三平台人工驗收。

TDD：新邏輯先看到案例因缺少行為而失敗，再最小實作；缺 SDK／無法啟動測試不算 RED。既有行為補測採突變檢查。原生人工案例先記錄基準未滿足及驗收腳本，完成後附證據，不把尚未執行標成 PASS。

## 10. Deployment

Windows 先 x64 EXE／WebView2 offlineInstaller，ARM64 視目標裝置另加；Android 先 arm64 真機，必要 ABI 依裝置清單；iOS 真機 ARM64。最低 OS 版本依 P0 工具鏈和實際裝置定案，不承諾未測平台。

首次正式安裝前固定 identifier、package id、簽署金鑰及資料路徑。Release 附版本、SHA-256、安裝／更新手冊；官方桌面 tauri-action 不能直接當三平台完整 pipeline。先本機 build，核准後再加入 Windows／Android CI；目前不建立 workflow 或 Release。

回滾不是直接拿舊 APP 打開新 DB：更新前備份，舊版遇未來 schema 應拒寫；用相容備份恢復。iOS 更換 Apple 帳號／bundle id 或刪除重裝不得宣稱保留資料。

## 11. Migration

### 更新包資料保留契約（2026-10-05 補充）
- 一般更新採覆蓋安裝，不需要使用者每次匯出再匯入。程式／題庫資源與使用者資料分開；SQLite 放 OS 指定的持久資料目錄，不放安裝資源、cache 或 temporary 目錄。
- 保留範圍包括統計、逐題進度、偏好，以及 add-daily-learning 導入的每日清單、已提交的未完成局、複習日誌、排程狀態；另含 add-offline-study-suite 的單字簿、筆記、學習意向、分能力進度、成就及提醒偏好。OS 通知需重新核對，不直接套用其他裝置的工作識別碼。尚未提交的輸入不在承諾內。
- 固定 Windows identifier、安裝模式及資料目錄；Android package id、簽署金鑰；iOS 有效 bundle identifier／簽署身份與同一側載帳號。每平台以正常覆蓋更新實測，不以刪掉再裝替代更新驗收。
- 資料庫遷移前先透過 SQLite 一致性備份或關閉連線後的完整快照留可恢復副本；不得直接複製仍在寫入且有 WAL 的單一 DB 檔。備份失敗則停止遷移，舊資料不動。
- 遷移採 transaction、版本檢查及可重跑設計；失敗回滾並提供恢復。偵測到未來 schema 的舊 APP 拒絕寫入，不清空、不自動降級 DB。
- S17／S18／S19 驗收需含相同 schema 更新與需要 schema 遷移的更新，逐集合比對資料及實際續答；S09 注入遷移失敗。版本發布前保存實測結果。
- 使用者刪除 APP／清除資料、換機或改變 APP 身份不承諾資料仍在；仍保留可攜式備份。iOS 免費簽署到期是可啟動性問題，不能教使用者透過刪除 APP 解決，也不能在未驗證前保證所有續簽工具行為。

網站紀錄不會自動進 APP。首次使用透過相容 v1／v2 的代碼或檔案匯入；原始備份留存。APP 暫未正式發行，沒有既有 native DB 要搬；S09 使用前一版 fixture 建立更新契約。web 的 hideKanji 等舊偏好遷移繼續使用。清除学习群組時先在交易內寫入禁止重遷移標記、提升 epoch 並清除還原點，再清理舊 localStorage，避免中斷後舊資料復活。

## 12. Open Questions 與進入實作的限制

- Windows 架構、Android／iPhone 型號及 OS 尚待確認；不阻礙文件核准，但阻礙相應安裝驗收。
- Mac／Xcode 可用時間未確認；可以先做 Windows，不得宣稱 iOS 完成。
- Rust／C++／SDK 安裝在 tasks 核准後才進行；涉及安裝／授權提示依工具規則處理。
- P0 驗證 MPA、SQLite 編譯、離線語音、免費簽署的 IPA 產出；任一需重大換架構，回到設計核准。
- 第一道設計核准已通過；共用 feature/add-offline-study-suite 與整合 tasks，第二道任務核准後開始 APP 生產程式。

## 13. Change Log 與來源

- 2026-10-05：完整模式確認；從初步 JSON Store 候選收斂為 SQLite 原生交易，待設計核准。
- [Tauri 前置條件](https://v2.tauri.app/start/prerequisites/)
- [Tauri SQL：SQLite 及三平台支援、sqlx／migration](https://v2.tauri.app/plugin/sql/)；本設計以自訂 Rust 命令封裝，不採前端任意 SQL API。
- [SQLite 交易與中斷一致性](https://www.sqlite.org/transactional.html)
- [Tauri 原生 Kotlin／Swift 插件](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [Windows 安裝器與離線 WebView2](https://v2.tauri.app/distribute/windows-installer/)
- [Apple Personal Team 7 天限制](https://developer.apple.com/help/account/basics/about-your-developer-account/)
- [Sideloadly 官方功能與 FAQ](https://sideloadly.io/index.html)
- [Android 開發者驗證／自用安裝政策](https://developer.android.com/developer-verification/guides/faq)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
