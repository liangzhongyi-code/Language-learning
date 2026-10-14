# P00b 原型工具鏈與版本依據

> 2026-10-08 閱讀更正：下方「精確直接依賴」至「官方來源與落地方式」保留原型初次盤點的歷史，不是目前工具鏈狀態。現行依賴以「Windows 實際建置」及文末核對補記為準；原型 `tauri.conf.json` 與正式 APP `tauri.app.conf.json` 的能力及 CSP 不可混用。

2026-10-08（Asia/Taipei）續做；狀態：Windows 已實際編譯、打包並在本機 WebView2 執行驗證（見文末「2026-10-08 Windows 實際建置」）；Android／iOS 待驗。

## 精確直接依賴

- npm `@tauri-apps/cli`：`2.8.4`，只放 `app/package.json` 的 devDependencies。
- Rust `tauri`：`=2.8.5`；`tauri-build`：`=2.4.1`。
- Rust `sqlx`：`=0.8.6`，停用 default features，只啟用 `runtime-tokio`、`sqlite`。
- Rust `serde`：`=1.0.219`，只啟用 `derive`，供探針結果序列化。

這是官方已發行版本的原型基準，並非宣稱最新版本。Tauri 2.8.5 官方發布紀錄明列 tauri-build 2.4.1；CLI 2.8.4 也有官方發布紀錄。SQLx API 對照精確 0.8.6 的官方 crate 文件。直接版本已固定，但沒有執行 dependency resolution／編譯，不能把這組選擇稱為本機編譯相容性已通過。間接依賴仍待真實 lockfile 鎖定。

## 本輪本機盤點及未執行事項

- `node -p 'process.version'`：`v22.18.0`。
- `Get-Command cargo,rustc -ErrorAction SilentlyContinue`：沒有找到可呼叫命令。
- `Test-Path app/src-tauri/Cargo.lock`：False；`Test-Path app/package-lock.json`：False。
- 本輪沒有安裝 Rust、MSVC、Windows SDK、Android／iOS SDK 或 npm 原生依賴，也沒有變更 PATH。
- 沒有執行 cargo check／test、Tauri dev／build、行動平台 init／build、EXE／APK／IPA 安裝。
- 沒有手寫 Cargo.lock 或 npm lockfile；後續具備工具且允許解析依賴時，才由真正的工具產生並核對。
- 2026-10-05 的整合 tasks 保留先前工具鏈盤點；本輪只重新確認 Node 與 cargo／rustc，不把先前 Android SDK 目錄存在解讀成原型建置通過。

## 已有的本機入口

在 repository 根目錄可執行：

```powershell
node --test tests/app-assets.test.js
node --test tests/app-prototype-security.test.js
node app/scripts/stage-prototype.mjs
```

`npm --prefix app run stage` 沿用原本網站 21 頁白名單。原型使用 `stage:prototype`，收集同一批網站頁面，加兩個原型頁面／外部模組到受管理 `app/dist-web`；不改 `stage-web.mjs` 或 `assets-manifest.json`。

以下是工具齊備後的待驗指令，本輪未執行：

```powershell
npm --prefix app run check:rust
npm --prefix app run test:rust
npm --prefix app run dev:prototype
```

Tauri hooks 會先呼叫 `stage:prototype`；沒有 devUrl，frontendDist 為本機 `../dist-web`。`bundle.active=false`，不提供本輪的原生安裝包成功宣稱。

## 官方來源與落地方式

- [Tauri 2.8.5 官方發布紀錄](https://v2.tauri.app/release/tauri/all-versions/#285)：此版本對應 tauri-build 2.4.1。
- [@tauri-apps/cli 2.8.4 官方發布紀錄](https://v2.tauri.app/release/@tauri-apps/cli/all-versions/#284)：npm CLI 的精確版本依據。
- [Tauri 2.8.5 WebviewWindowBuilder](https://docs.rs/tauri/2.8.5/tauri/webview/struct.WebviewWindowBuilder.html)：由 setup 手動 from_config 建立視窗；on_navigation 在載入前限制兩頁。on_new_window 對 Android／iOS 不受支援，因此不得把桌面新視窗限制稱為三平台已驗。
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)：自訂 app command 預設可被所有視窗呼叫，需 `AppManifest::commands` 納入 ACL；capability 僅本機 main、allow-prototype-probe，沒有 remote。
- [tauri-build 2.4.1 AppManifest](https://docs.rs/tauri-build/2.4.1/tauri_build/struct.AppManifest.html)：build.rs 註冊 prototype_probe，自動產生對應 allow／deny permissions；不另手寫同名 permission。
- [Tauri CSP](https://v2.tauri.app/security/csp/)：僅本機 script／style，以及必要 `ipc:`、`http://ipc.localhost` 連線來源；禁止 frame、object、base、表單提交及 unsafe-inline／unsafe-eval。
- [SQLx 0.8.6 SqliteConnection](https://docs.rs/sqlx/0.8.6/sqlx/struct.SqliteConnection.html)、[SQLx 0.8.6 Transaction](https://docs.rs/sqlx/0.8.6/sqlx/struct.Transaction.html)：固定 in-memory connection，所有交易指令共用同一連線；明確 await rollback 再查資料。
- [Tauri 官方前置條件](https://v2.tauri.app/start/prerequisites/)：供後續補工具時確認平台需求；本輪不執行安裝。

全部來源於本輪查閱；來源存在與 API 對照不等於本機原生編譯、WebView 載入或安全實測已通過。


## 2026-10-08 Windows 實際建置（更正上方版本）

上方 2.8.5／2.4.1／2.8.4 這組釘選在真實解析時失敗：`tauri =2.8.5` 允許 Cargo 選到 `tauri-runtime-wry 2.9.3`，與 wry 0.53.5 引用兩個不同版本的 `webview2-com-sys`，`cargo test` 出現 11 個型別不符錯誤。改用同一發行批次的穩定 2.x：

- Rust：`rustup 1.29.1`（winget `Rustlang.Rustup`）、`rustc 1.99.0`／`cargo 1.99.0`，toolchain `stable-x86_64-pc-windows-msvc`；Visual Studio Build Tools 2022（C++ workload）。
- npm `@tauri-apps/cli`：`2.12.1`；Rust `tauri =2.12.1`、`tauri-build =2.7.1`、`serde =1.0.229`（tauri-build 2.7.1 需要 serde ≥1.0.228）、`sqlx =0.8.6` 不變。間接依賴由 cargo 產生的 `app/src-tauri/Cargo.lock` 鎖定，`app/package-lock.json` 由 npm 產生。
- NSIS：Tauri 從官方 binary-releases 下載 `nsis-3.11.zip`（雜湊驗證通過），但在本機把解壓目錄改名為工具快取時出現 `os error 17`。處理方式：手動將 `%LOCALAPPDATA%	auri
sis-3.11` 改名為 `NSIS`，並從 tauri-apps 官方 release 下載 `nsis_tauri_utils.dll` v0.5.3，SHA-1 `75197fee3c6a814fe035788d1c34ead39349b860` 與 CLI 內建值相同後放入 `Plugins/x86-unicode/additional/`。

### 指令與結果

```powershell
npm --prefix app run test:rust      # 3 passed（原型兩頁、APP 頁面白名單、SQLite 回滾）
npm --prefix app run build:windows  # tauri build --config src-tauri/tauri.app.conf.json
node app/scripts/verify-windows.mjs <lang-learn.exe>
```

產物（`app/src-tauri/target/release/`，不進版控）：

| 檔案 | 大小 | SHA-256 |
|---|---|---|
| `bundle/nsis/語言學習_0.1.0_x64-setup.exe` | 218,860,583 bytes（208.7 MiB，含離線 WebView2 安裝器） | `e63f7ac34379215efde1d36d568e146e08f4e4eeb4772fb5ce80b2488e379a6f` |
| `lang-learn.exe` | 12,086,272 bytes | `0564f7e623f4294434c25036ff8799396d14e47ddae62cb472b2cdc7da6c6c1e` |

## 2026-10-08 文件核對補記

更正原因：初次盤點、Windows 首次實測與後續識別碼調整並存，需明確限定時點。歷史結果保留；本次只讀取來源與文件，沒有重新執行表列測試、工具安裝或建置。

- 已核對 `app/package.json` 與 `app/src-tauri/Cargo.toml`：CLI `2.12.1`、tauri `=2.12.1`、tauri-build `=2.7.1`、serde `=1.0.229`、sqlx `=0.8.6`。兩份 lockfile 均存在；上方「lockfile 不存在／尚未解析依賴」屬首次盤點，已被 Windows 建置紀錄取代。
- 原型設定仍為 `bundle.active=false`、兩個探針頁面及嚴格 CSP；正式 APP 設定啟用打包，載入網站 21 頁，且允許 `style-src 'unsafe-inline'`。上方「禁止 unsafe-inline／沒有安裝包」只適用原型當時設定。
- NSIS 快取路徑的換行為文件筆誤：上方 `%LOCALAPPDATA%\tauri\` 後斷成 `sis-3.11` 的路徑，應讀為 `%LOCALAPPDATA%\tauri\nsis-3.11`。此處只補正文字，未移動快取或重新下載工具。
- [010 Windows 紀錄](../../docs/logic-changes/2026-10-08-010-windows-build.md) 已記錄首次建置、直接執行及安裝後各 26/26、本機解除安裝；不是 S16 乾淨機離線安裝或 S19 舊版覆蓋升級驗收。現用儲存仍為 WebView2 IndexedDB，持久 SQLite repository 尚未實作。
- 上方兩個 SHA-256 與大小僅屬首次 Windows 舊識別碼 `io.github.liangzhongyi-code.langlearn` 的產物紀錄，未在本次重新計算。核對時正式設定已改成 `io.github.liangzhongyicode.langlearn`；需另留新識別碼產物及資料目錄／安裝／更新證據，不能沿用舊雜湊宣稱新包已驗。
- Android 生成工程與腳本已存在，但 SDK／工程／原生函式庫存在不等於 APK 簽署、安裝或功能驗收完成。核對時 `docs/logic-changes/2026-10-08-011-android-build.md` 不存在；010 的該引用尚無目標文件，本次未補造 011，也不據此提升 Android 狀態。
- 核對時 `app/src-tauri/gen/apple/` 不存在，沒有新增 Mac／Xcode、IPA 或 iPhone 驗證證據。`app/package.json` 尚無 `build:android`／`build:ios` scripts；tasks 中這兩個名稱是預定入口，不是目前可直接執行的 npm script。

原生未完成項以 [offline 整合 tasks](../../openspec/changes/add-offline-study-suite/tasks.md) 為準；[native tasks](../../openspec/changes/add-native-app-packaging/tasks.md) 僅導向同一清單。P00a、F50a 已勾選；P00b–c、F50b–F54、F64 與 F70–F74 尚未完成。工作包、Windows 局部成功與網站已發布的界線，另見 [006 文件交叉核對更正](../../docs/logic-changes/2026-10-08-006-review-integration.md#文件交叉核對更正2026-10-08)。

## iOS 可執行準備建議（尚未執行）

以下是交接步驟，不是執行紀錄。本輪不連線 Mac、不安裝工具、不編譯、不登入帳號，也不操作裝置。

1. **先盤點環境。** 確認可使用的 Mac、macOS／CPU 架構、完整 Xcode 與 iOS SDK、Node／npm、Rust 及 CocoaPods；取得 iPhone 型號／iOS 版本作為相容性目標。Tauri iOS 開發需 macOS 與完整 Xcode，單獨 Command Line Tools 不足。依 [Tauri 官方前置條件](https://v2.tauri.app/start/prerequisites/#ios)，後續工具準備包含真機 `aarch64-apple-ios` 與依 Mac 架構選擇的模擬器 Rust target；本次未執行安裝。
2. **先核對設定再初始化。** 固定此次要驗證的來源版本、兩份 lockfile、bundle identifier、APP 版本及同一簽署身份。原型與正式 APP 使用不同設定；正式設定目前帶 Windows NSIS 選項，需核對 iOS 合併結果、圖示與簽署設定，不能把 Windows 設定直接視為 iOS 配置已完成。先補實際 npm script 或確認 CLI 指令，避免照 tasks 執行尚不存在的 `build:ios`。
3. **可先做唯讀環境盤點。** 在後續已授權的 Mac、專案根目錄執行以下命令並記錄結果；它們只用於盤點，不代表建置通過：

   ```sh
   sw_vers
   uname -m
   xcode-select -p
   xcodebuild -version
   xcrun --sdk iphoneos --show-sdk-version
   node --version
   npm --version
   rustc --version
   cargo --version
   rustup target list --installed
   pod --version
   ```

4. **把 P00 原型與正式功能分開留證。** 工具與權限到位後，再產生 Apple 工程、驗證本機多頁載入／SQLite 探針及 IPA 產出。先證明可行性，再接 F50b–F50e 持久 repository 與 F52a Swift TTS／分享／提醒；記憶體 SQLx 回滾成功不能代替資料保存、復原或更新驗收。初始化與建置指令應先按安裝的 CLI `2.12.1` 核對 `ios --help`，本文件不宣稱已具備可成功建置的 iOS 工程。
5. **準備獨立 fixture 與證據欄位。** 涵蓋全部學習集合、偏好、收藏／筆記、每日清單、已提交半局、FSRS 狀態與備份；記錄來源版本、OS／Xcode／裝置、APP 身份／版本、IPA SHA-256、測試步驟與前後資料比對。先驗斷網冷啟動、日英實際發聲／缺語音、前後台停止、安全區、檔案取消及提醒權限，再做同身份覆蓋與續簽。模擬器結果不可充作真機語音或續簽證據。
6. **單獨安排 S18 的真實時間驗證。** 保持同一 Apple 帳號／bundle identifier 與原 APP，分別記錄首次安裝、正常續簽、到期後恢復及全資料／半局保留。Apple 說明 Personal Team provisioning profile 自核發起 7 天到期，見 [Apple 帳號與 Personal Team 限制](https://developer.apple.com/help/account/basics/about-your-developer-account/)；Sideloadly 是專案預定路徑，IPA 產出與該工具的資料保留仍需本案實測。不能以刪除重裝或短時間測試取代到期恢復，不因文件準備完成就勾選 F52b／S18。

上述準備不需要在文件或聊天保存 Apple 密碼、token 或簽署私鑰。Mac／設備尚未確認時，持續以「待準備／待驗」交接；本次文件未提交或推送。
