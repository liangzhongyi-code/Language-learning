# 2026-10-08-011：Android 建置與隔離驗證

## 基本資訊

- 日期／時區：2026-10-08，Asia/Taipei。
- 狀態：已驗證（Debug 測試 APK，於專用空白模擬器）；未發布安裝包，正式簽章未做。
- 依據：已核准的三平台 APP 設計與整合任務；使用者要求接續實作，並選擇「先只做測試 APK，暫不作長期使用的正式安裝包」。
- 規格：[三平台設計](../../openspec/changes/add-native-app-packaging/design.md)、[整合任務](../../openspec/changes/add-offline-study-suite/tasks.md)。
- 前次：[Windows 首次建置](2026-10-08-010-windows-build.md)。

## 需求、變更與邊界

Android 套件名稱不能含連字號，首次正式發行前統一識別碼為 `io.github.liangzhongyicode.langlearn`。010 所載 Windows 產物使用舊識別碼，不能把它視為本識別碼的更新驗收。

- 打包流程須重新建置兩個 ABI 並核對版本、設定與資源，不能只靠既有 `.so` 存在便宣稱新版本已封裝。
- 現有 APK 是 Debug 測試用途；正式版需要固定、受保護的簽署金鑰。Debug 覆蓋測試不等同正式版更新已驗收。
- 驗證腳本原本先解除安裝 APP，會移除資料。改為只接受明確指定、名稱為 `LangLearn_QA_` 開頭且未裝此套件的測試模擬器；既有安裝立即拒絕，不自動清除。
- 頁面清單取自打包白名單；離線開啟、作答後強制結束重開，以及同 APK 覆蓋安裝，逐一核對畫面與全部 IndexedDB 集合／偏好。
- 模擬器測試不代表真機、原生語音、檔案分享、跨版本遷移或 iOS 已驗收。

## 資料相容與回復

目前 APP 學習資料仍使用 WebView IndexedDB。持久 SQLite repository 尚待實作，不能以打包成功取代儲存設計驗收。網站與 APP 來源不同，資料搬移沿用備份檔或代碼；正式更新要固定套件名和簽署金鑰。

## 影響檔案

- `app/scripts/package-android.mjs`、Android generated project、正式 Tauri 設定。
- `app/scripts/verify-android.mjs`、`android-verification.mjs`、對應 Node 測試。
- 平台文件、邏輯變更索引與原生任務狀態。

## 驗證紀錄

- 驗證目標保護與精確本機來源：先確認新模組缺失造成 RED，再實作；Node 2/2 通過。
- 未發布 GitHub Release，正式簽章與真機仍待驗。

## 2026-10-14 實際建置與驗證結果

### 兩個修正（皆有測試）

1. **打包腳本拒絕了自己的真實產出。** `package-android.mjs` 的一般檔案檢查要求 nlink 為 1，但 Cargo 的最終 `.so` 一定是 `deps/` 同名檔的硬連結（nlink 2），導致 Rust 已編譯成功仍被判失敗。新增 `cargoArtifact()`：只有當第二個連結正是同目錄 `deps/` 下同 dev／inode 的檔案（且 nlink 剛好 2）才接受；其他硬連結、三個以上連結或符號連結仍拒絕。其餘檔案維持 nlink 1 規則。新增 Node 測試以實際檔案與硬連結驗證接受與拒絕情境。
2. **驗證腳本在強制結束重開後卡住。** Playwright 的裝置物件會快取舊程序的 WebView，`webView({ pkg })` 立即回傳已關閉的舊 socket，`page()` 無限等待。改為先讀 `pidof`，只接受 `pkg` 相同且 `pid` 等於目前程序的 WebView。

### 結果

| 日期 | 指令／操作 | 實際結果 | 未覆蓋 |
|---|---|---|---|
| 2026-10-14 | `node --test tests/app-android-package.test.js tests/app-android-package-flow.test.js tests/app-android-verification.test.js` | 34/34 通過（含新增 Cargo 硬連結案例） | — |
| 2026-10-14 | `node app/scripts/package-android.mjs`（隔離 Cargo 目錄重建 arm64-v8a、x86_64，strip 後 Gradle 打包） | 成功；`app-universal-debug.apk` 26,612,257 bytes，SHA-256 `85e3023000e9a95479b5f2b1256e8e42a4f797b9404e96973eaac24538a5075e`；receipt 在 `app/src-tauri/target/android-debug-*/receipt-debug.json`（已忽略） | Debug 簽章，非正式版 |
| 2026-10-14 | `node app/scripts/verify-android.mjs <apk> emulator-5554`，模擬器 `LangLearn_QA_20261008`（API 33 x86_64，`-wipe-data` 開機、未安裝本套件） | 32/32：安裝、飛航模式＋Wi-Fi 關閉、本機首頁、21 頁無錯誤且無水平溢出、每日作答保存、CSP 擋對外連線、白名單擋外部導覽、強制結束重開後全部 IndexedDB 集合與偏好完全相同且紀錄仍在、同 APK 覆蓋安裝後全部集合與偏好完全相同 | 真機、arm64 實機執行、原生語音／分享、不同版本間更新、正式簽章 |

驗證時曾因只輸出頁面計數而遺失其他檢查結果，依規則重新 wipe 模擬器後完整重跑一次；上表為完整重跑結果。驗證後模擬器已關閉。

## 未完成與後續更正

- 正式版需要使用者自行保管的固定簽署金鑰（不放 repo、不在聊天提供密碼）；目前只有 Android Debug 金鑰簽的測試 APK。
- 原生 SQLite repository、原生 TTS／分享／提醒、真機與跨版本更新（S17）待辦。
