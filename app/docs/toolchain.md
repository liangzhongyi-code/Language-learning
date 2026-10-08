# P00b 原型工具鏈與版本依據

2026-10-08（Asia/Taipei）續做；狀態：原型來源與 Node 契約已驗證，原生編譯／執行待驗。

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
