# 三平台離線 APP 封裝提案

> change-id: add-native-app-packaging
> 日期：2026-10-05｜完整模式：使用者已確認
> 基準：main @ fd9b18a｜2026-10-05 設計已核准；詳細 tasks 待核准；尚未實作

## 目的與範圍

將現有英日文學習網站封裝成 Windows、Android、iOS APP，不上架、免登入、安裝後離線使用。Windows／Android 在 Windows 建置；iOS 在 Mac／Xcode 建置，再用 Sideloadly 側載。Windows 由 GitHub Releases 提供 EXE，不把原始碼 ZIP 或 GitHub Pages 當安裝器。

包含本機資源封裝、原生持久化、版本遷移、備份檔／代碼、原生分享／剪貼簿、離線 TTS、安裝及更新驗收。保留既有題庫、JLPT 隔離、問題回報、外觀及靜態網站部署。

不做登入／雲端同步、商店上架、自動更新、遠端程式碼載入、極光細雨等新美術功能。半局規則依每日學習擴充：保存已提交題，未提交輸入不保證恢復。iOS 免費簽署有期限，不能承諾永久免續簽；移除 APP／清除資料不保證保留紀錄。

2026-10-05 整合設計已核准：網站 IndexedDB、APP SQLite，共用逐題交易、v2 備份與個人教材；本機通知／震動另驗，詳見 O01–O20、Google G01–G10。不代表已實作。

## 先查後寫的結果

- 13 頁靜態 MPA、ES Modules、網站零執行期套件；未找到原生封裝、Service Worker 或原生 CI，openspec/changes 原為空。
- core/stats.js、progress.js 支援注入同步儲存；UI 直接取 localStorage，完成測驗時兩區塊分別寫入，有部分成功風險。
- prefs／appearance 同步初始化；非同步原生讀取需要啟動屏障，不能假裝 setItem 已落盤。
- 可沿用備份外殼與代碼格式，但匯入只檢查外殼；APP 需深化區塊驗證與失敗回復。
- speech.js 集中朗讀，但 WebView 與離線 voice 尚未驗證。
- 前一輪測試 446 項通過；本輪只有唯讀盤點，未重新跑全套。
- 原有未追蹤 .idea/ 保留、不打包。

## 本機環境

- 已找到 Node 22.18.0、npm 10.9.3、JDK 17.0.12、Android Studio、SDK API 33／35／36、NDK 27.1.12297006。
- Platform Tools 37.0.0 檔案存在；adb 執行因受限目錄無法驗證，不能當成連機已成功。
- PATH 與常見路徑未找到 Rust／Cargo／Rustup、C++ Build Tools／Windows SDK；未掃描全機。
- Mac／Xcode、裝置型號與 OS、磁碟空間待 P0 確認；沒有遠端連線或安裝工具。

## 流程與驗收

先核准 design.md，再建立 tasks.md 並另行核准，才進 RED-GREEN-REFACTOR。先三平台最小驗證，再共用儲存與平台功能，最後交付安裝器。缺 Mac／iPhone 不阻止 Windows 開發，但 iOS 未驗證時整個 change 不得歸檔為完成。

本次 spec-powers 流程不自動 commit／push／merge。

## 相關文件

- [需求情境](specs/native-app.md)
- [設計文件](design.md)
- 先前 HTML 計畫僅是背景，不代替本次設計與 tasks 核准。
