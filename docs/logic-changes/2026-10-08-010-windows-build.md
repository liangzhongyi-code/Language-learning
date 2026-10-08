# 2026-10-08-010：Windows 版首次實際建置與本機驗證

## 基本資訊

- 日期／時區：2026-10-08（Asia/Taipei）
- 類型：平台／打包／安全邊界
- 狀態：已驗證（本機 Windows 實際編譯、安裝、執行、解除安裝）；安裝包未公開發布
- 核准狀態與依據：使用者 2026-10-08「繼續，裝 Rust 編譯 Windows 版」；先前已授權過程權限一律同意
- change-id／規格：[APP 設計](../../openspec/changes/add-native-app-packaging/design.md)、[整合任務 P00a／F50g](../../openspec/changes/add-offline-study-suite/tasks.md)
- 相關前次紀錄：[2026-10-07-006 APP 本機原型](2026-10-07-006-app-prototype.md)
- 分支／commit：feature/add-offline-study-suite，見 Git 歷史

## 需求與原因

原型只能載入兩個探針頁、且從未編譯過。使用者要求實際裝好 Rust 並產出 Windows 版。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 工具鏈 | 本機沒有 Rust | rustup／rustc 1.99.0 MSVC、VS Build Tools 2022 |
| 依賴版本 | 釘 tauri 2.8.5，真實解析編譯失敗 | tauri 2.12.1／tauri-build 2.7.1／CLI 2.12.1，Cargo.lock 鎖定 |
| 正式 APP 設定 | 無 | `tauri.app.conf.json`：固定識別碼 `io.github.liangzhongyi-code.langlearn`、首頁 index.html、21 頁網站、NSIS（目前使用者安裝）、離線 WebView2 安裝器 |
| 導覽限制 | 只有原型兩頁 | 正式 APP 只允許本機 `/`、`index.html`、`help.html` 與 `en/`、`ja/` 下單層小寫 `.html`，以及本機 blob（備份下載）；原型識別碼仍用兩頁規則 |
| CSP | 原型專用 | `script-src 'self'`（Tauri 為內嵌模組自動加雜湊）、`style-src 'self' 'unsafe-inline'`（頁面使用 style 屬性）、只允許本機與 IPC 連線 |
| 圖示 | 無 | `app-icon.svg` 由 `tauri icon` 產生全平台圖示 |
| 驗證腳本 | 無 | `app/scripts/verify-windows.mjs` 以隨機空閒除錯埠啟動 exe，只在該埠全部頁面都是 APP 本機頁時才連線 |

## 規則、邊界與取捨

- **資料仍存在 WebView2 的 IndexedDB**（`%LOCALAPPDATA%\io.github.liangzhongyi-code.langlearn\EBWebView`），與網站同一套交易邏輯；設計中的原生 SQLite repository（F50b–F50e）尚未實作，不宣稱已完成。
- 解除安裝只移除程式與安裝紀錄、保留學習資料，覆蓋重裝或更新不會清掉紀錄；要徹底刪除需手動刪資料夾（之後可加入解除安裝時的選項）。
- 外部網址一律擋下（不另開系統瀏覽器）；Google 備份在 APP 內維持「尚未設定」，原生授權（F64）未做。
- 安裝包未簽章，Windows 可能顯示 SmartScreen 警告；不提供停用防護的指示。
- 驗證過程曾發現 9333 埠是使用者自己瀏覽器的遠端除錯埠，腳本只做讀取、未操作任何頁面即中止；已改為隨機空閒埠並驗證目標全為 APP 本機頁才連線。

## 影響範圍

- `app/package.json`、`app/package-lock.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/Cargo.lock`
- `app/src-tauri/tauri.app.conf.json`（新）、`app/src-tauri/src/lib.rs`（APP 白名單與測試）、`app/src-tauri/icons/`、`app-icon.svg`（新）
- `app/scripts/verify-windows.mjs`（新）、`app/docs/toolchain.md`、`app/.gitignore`

## 資料相容、遷移與回復

網站與 APP 的資料彼此獨立（不同來源）；搬移資料用既有備份檔／代碼。APP 內資料格式即網站 v2 學習群組。測試期間產生的 APP 資料夾已在驗證後刪除，本機沒有殘留安裝。

## 驗證紀錄

| 日期 | 指令／操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-10-08 | `npm --prefix app run test:rust` | 3 passed | — |
| 2026-10-08 | `npm --prefix app run build:windows` | 產出 `語言學習_0.1.0_x64-setup.exe`（208.7 MiB）；SHA-256 見 app/docs/toolchain.md | 未簽章 |
| 2026-10-08 | `node app/scripts/verify-windows.mjs target/release/lang-learn.exe` | 26/26：啟動本機首頁、21 頁無腳本／CSP 錯誤、每日作答保存、CSP 擋對外連線、白名單擋外部導覽、關閉重開紀錄仍在 | — |
| 2026-10-08 | 安裝包 `/S` 靜默安裝 → 對已安裝 exe 重跑同腳本 → `uninstall.exe /S` | 安裝 exit 0、HKCU 解除安裝項目建立；26/26；解除安裝 exit 0、程式與項目移除、資料保留 | 乾淨 VM、無 WebView2、斷網安裝（S16）；舊版覆蓋更新（S19） |
| 2026-10-08 | `npm test`、`node --test tests/app-*.test.js` | 見提交時全套結果 | — |

## 未完成項目與發布狀態

- 原生 SQLite repository、原生 TTS／檔案分享、S16 乾淨機離線安裝、S19 覆蓋更新資料保留、程式碼簽章、GitHub Release 皆未完成。
- Android（已有 SDK／NDK／JDK）與 iOS（需 Mac）尚未建置。
- 安裝包只存在本機建置目錄，未上傳任何地方。

## 後續更正／取代

無。
