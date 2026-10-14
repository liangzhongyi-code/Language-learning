# 2026-10-14-001：APP 學習資料改存原生 SQLite

## 基本資訊

- 日期／時區：2026-10-14（Asia/Taipei）
- 類型：資料契約／儲存／平台
- 狀態：已驗證（Rust 單元測試、Node、Windows 安裝版與 Android 模擬器實機，含舊版覆蓋更新）；安裝包未發布
- 核准狀態與依據：三平台 APP 設計 TD2（SQLite 交易式原生儲存）；使用者 2026-10-14「繼續，做原生 SQLite 儲存」
- change-id／規格：[APP 設計](../../openspec/changes/add-native-app-packaging/design.md)、[整合任務 F50b／F50c／F50e](../../openspec/changes/add-offline-study-suite/tasks.md)
- 相關前次紀錄：[2026-10-08-010 Windows](2026-10-08-010-windows-build.md)、[2026-10-08-011 Android](2026-10-08-011-android-build.md)、[2026-10-07-001 交易儲存](2026-10-07-001-learning-store-wiring.md)
- 分支／commit：feature/add-offline-study-suite，見 Git 歷史

## 需求與原因

APP 先前沿用網站的 WebView IndexedDB。設計要求 APP 以原生 SQLite 作為真實來源，交易、去重與還原由原生端一次完成，並在更新時保留資料。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| APP 學習資料位置 | WebView IndexedDB | `app_local_data_dir/learning.sqlite3`（Windows：`%LOCALAPPDATA%\io.github.liangzhongyicode.langlearn\`；Android：APP 私有目錄） |
| 寫入 | IndexedDB 交易 | Rust 單一連線（Mutex 序列化）`BEGIN IMMEDIATE` 交易；epoch、revision、操作收據核對與網站規則相同；內容雜湊由 Rust 自行計算 |
| 頁面程式 | — | 不變：`native-repository.js` 提供與 `web-repository.js` 相同介面，`getLearningStore()` 偵測到 Tauri 原生命令時自動改用 |
| 網站 | IndexedDB | 不變（沒有 Tauri 命令時仍用 IndexedDB） |
| 舊版 APP 更新 | — | 第一次開啟新版時，若舊 WebView IndexedDB 已有資料，整組驗證後搬入 SQLite（與完成標記同交易）；舊 IndexedDB 保留不刪作為回復來源 |
| 還原點 | IndexedDB 內 | SQLite 內保存原始集合列（`native-rows-1`），對外轉成與網站相同的可攜格式；仍最多三份、清除時一併刪除 |

## 規則、邊界與取捨

- 資料表：`meta`（單列）與 `records(store, key, value)`；索引欄位以 `json_extract` 運算式索引（與網站索引欄位相同），不是單一大 JSON。`PRAGMA user_version = 1`；較新版本或損毀檔案原樣保留並拒絕讀寫，不重建。
- 命令只開放固定動作（open／get／read_all／query／by_index／list／commit／clear／restore／migrate），每次核對呼叫者是 main 視窗且位於 APP 打包頁；不接受 SQL、檔案路徑或任意集合。正式 APP 設定改為 `withGlobalTauri: true` 並只啟用 `app-storage` capability。
- 可攜資料的驗證與轉換仍在 JS 核心（`rowsFromPortable`／`portableFromRows`），避免兩套規則分家；Rust 端再檢查集合白名單、key 與大小。
- 回到還原點：前端讀出還原點並以核心驗證後整組送出，Rust 在交易內確認該還原點仍存在（還原點寫入後不會修改）。
- 網站原 localStorage 舊紀錄的遷移路徑在 APP 內同樣可用；APP 從未有過網站資料時寫入合法空資料。
- 測試工具修正：Windows 結束 APP 後等待其 WebView2 子程序全部退出再啟動下一次（殘留子程序會讓以不同除錯參數啟動時 WebView2 環境建立失敗而立即結束，屬測試時序）。Android 升級測試第一次曾在首次連線 WebView 時卡住，重跑時該步驟 14 秒後通過；已加入步驟記錄，列為測試工具可能不穩定處。

## 影響範圍

- Rust：`app/src-tauri/src/storage.rs`（新）、`commands.rs`（新）、`lib.rs`、`build.rs`、`Cargo.toml`／`Cargo.lock`（`serde_json =1.0.151`、`sha2 =0.10.9`，皆為既有間接依賴版本）、`capabilities/app-storage.json`（新）、`tauri.app.conf.json`。
- JS：`assets/js/ui/platform/native-repository.js`（新）、`learning-store.js`（選擇儲存並標示 `storageKind`）。
- 驗證：`app/scripts/windows-cdp.mjs`（新，共用啟動／比對）、`verify-windows.mjs`、`verify-android.mjs`、`verify-upgrade-windows.mjs`（新）、`verify-upgrade-android.mjs`（新）；`tests/native-repository.test.js`（新）。

## 資料相容、遷移與回復

資料格式（集合與每列內容）與網站 v2 完全相同，備份檔／代碼互通。舊版 APP 資料一次性搬入，舊 IndexedDB 保留；若搬移來源不合法則停止並保留原資料（MIGRATION_INVALID）。網站資料不受影響。

## 驗證紀錄

| 日期 | 指令／操作 | 實際結果 | 未覆蓋 |
|---|---|---|---|
| 2026-10-14 | `npm --prefix app run test:rust` | 14/14（新增 9 項：S05／S06 提交、重送、異內容、衝突、舊 epoch；S05／S07 注入故障全集合回滾且無收據；S07 重開資料仍在；S08 未來版本與損毀檔拒絕且原檔不變；S09 遷移只做一次；S11 還原保留三點並換 epoch；O18 清除；S20 拒絕不合法集合／key／超量；查詢契約） | 子程序強制結束的原生測試 |
| 2026-10-14 | `node --test tests/native-repository.test.js` | 7/7 | — |
| 2026-10-14 | `node --test`（全套） | 見提交時結果 | — |
| 2026-10-14 | `npm --prefix app run build:windows` → `verify-windows.mjs target/release/lang-learn.exe` | 30/30：21 頁、作答保存、`storageKind=native-sqlite`、`learning.sqlite3` 在私有目錄、未建立 IndexedDB 學習庫、CSP／導覽阻擋、重開後全部集合完全相同 | 未簽章 |
| 2026-10-14 | `verify-upgrade-windows.mjs <舊版 IndexedDB 安裝檔 f525b71d…> <新版>` | 9/9：舊版作答（IndexedDB）→ 新版覆蓋安裝 → 改用 SQLite、全部集合原樣搬入、舊 IndexedDB 保留、今日進度仍在、可繼續作答；結束後解除安裝並刪除測試資料 | 乾淨機離線安裝 |
| 2026-10-14 | `node app/scripts/package-android.mjs` → `verify-android.mjs <apk> emulator-5554`（空白 `LangLearn_QA_20261008`） | 35/35：含飛航模式、`native-sqlite`、私有目錄 `./learning.sqlite3`、未建立 IndexedDB、強制結束重開與同 APK 覆蓋安裝後全部集合與偏好完全相同 | 真機、正式簽章 |
| 2026-10-14 | `verify-upgrade-android.mjs <舊版 IndexedDB APK 85e30230…> <新版 APK> emulator-5554`（重新 wipe） | 8/8：舊版作答 → 新版覆蓋安裝 → SQLite、全部集合原樣搬入、舊 IndexedDB 保留、可繼續作答、重開後完全相同 | 跨正式簽章版本 |

產物（不進版控）：Windows `語言學習_0.1.0_x64-setup.exe` 220,808,727 bytes，SHA-256 `49db3eca77ac29c593b15ca5cec40937e8f76d7055b9e14b307c88b8fee4ffaa`；Android `app-universal-debug.apk` 27,817,369 bytes，SHA-256 `3ae1a9cf543db6791e33eb25af375692b8cdce881ba1b13def3c1f77b2596757`。

## 未完成項目與發布狀態

- F50d：未來原生 schema 升級前的一致性備援（含 WAL 快照）尚未需要也未實作；目前只有 v1。
- 原生 TTS／分享（F50f）、乾淨機離線安裝（S16）、Android 正式簽章、iOS 仍待辦。
- 安裝包未發布。

## 後續更正／取代

無。
