# 2026-10-08-006：整批接線審查與回歸修復

> 閱讀提示（2026-10-08 追加）：本文保留各階段歷史；目前發布與原生進度請併讀文末「文件交叉核對更正」，不要將早期「尚未提交」或「三平台未編譯」視為目前狀態。

## 基本資訊

- 日期／時區：2026-10-08（Asia/Taipei）。類型：修復／交易／相容性／功能接線。
- 狀態：已驗證（Node 全套＋全部隔離 Chromium suite）；已發布 04066a1（見文末發布補記）。
- 核准：使用者要求審查「這次變更＋工作區」，沒有阻擋問題後先推送再 QA；另明確選擇「每日清單補齊對應題型，依原能力複習」。
- 審查基線：`2565338ad2bce2a8328e56f2a929eff15264b361` → `28eaeb73f2c4a447babddbd76a1f29b693af2dbc` 加工作區與本次功能未追蹤檔；不含 IDE 個人設定。
- 規格：[每日學習](../../openspec/changes/add-daily-learning/design.md)、[單機學習與 Google 備份](../../openspec/changes/add-offline-study-suite/design.md)。
- 前次紀錄：[按需載入](2026-10-08-005-demand-pages.md)、[本機範圍查詢](2026-10-08-004-scoped-query.md)、[逐題保存](2026-10-07-008-quiz-progress.md)。

## 需求與原因

既有全套測試通過，仍未覆蓋還原世代、跨日重複提交、延遲 UI 操作及真實資料累積的部分交界。本次以凍結快照平行追查呼叫端、資料層、業務規則、移除行為、效能與相容性，再用新增失敗案例驗證修復。以下列的是本次修復契約，完成與否以末節實測紀錄為準，不把待實作項列為已通過。

## 變更前後與修復契約

| 情境 | 審查發現 | 修復目標 |
|---|---|---|
| 還原後的舊每日頁 | 可將舊答案提交給新世代題面 | 題面攜帶 epoch；寫入時拒絕舊世代，不產生事件 |
| 跨日同題次 | 不同計畫可對同一 entry 重複統計 | 穩定 entry 首次有效完成，交易檢查跨計畫收據 |
| 每日略過／自評已會 | 晚到刷新可覆蓋後來選的級別 | 操作鎖、設定快照與世代檢查涵蓋刷新 |
| 每日額度調整 | 清單完成但 session 與完成局數未同步 | 同交易結束該局，完成局只計一次 |
| 標記想學 | 已建立的今日清單不更新順位 | 返回今日頁時重排未開始的新字，保留已開始題次與額度 |
| 非辨認能力到期 | 每日頁只有四選一而卡住 | 使用相符能力、方向與級別的練習題面；不改成辨認題 |
| 日曆及成就資料多於 1,000 筆 | 截斷讀取可能把當日次數改小 | 讀取所需完整資料／正確範圍，不以截斷結果覆寫 |
| 按需切換測驗題源 | 暫時空池導致易錯範圍被重設 | 待真正資料到齊再判斷範圍，不以 loading 空陣列修改選擇 |
| 練習提交等待中 | 答案／回清單可與非同步提交競態 | 提交內容固定並鎖住相關操作，保存後才顯示回饋 |
| 語音播放失敗 | 嘗試播放便被當作已成功 | 成功播放才開放聽力作答；失敗不計分 |
| 單字簿草稿與網址 | 更新意向丟草稿；原型屬性當成書本 | 保存輸入狀態；書本 ID 必須為自有項目 |
| 只有收藏／意向／設定 | 完整備份被誤判為空 | 檢查實際可攜內容；真正空資料仍停用匯出 |
| 舊備份 hideKanji 偏好 | 先合併預設值造成舊設定遷移失效 | 先遷移匯入偏好，再與現有值合併 |
| Google 慢下載 | 晚到雲端檔蓋掉後選本機預覽 | 點選時就加入共用預覽世代；下載也受同一守衛 |
| 舊瀏覽器 | ES2021+ 語法／API 造成硬失敗 | 應用模組符合 ES2020，避免未降級的新 API |
| 新開一局 | 無用途讀取全部歷史 sessions | 僅取交易所需 meta／指定列，保留衝突保護 |

## 規則、邊界與取捨

- 每日不同能力不互相代替：答案、方向及能力必須和固定題面一致；題庫尚未提供時保留紀錄並說明，不能假裝複習成功。
- 多題型沿用人工題庫、固定快照及既有判題，不用機器臨時編造閱讀／語法題，也不跨級補題。
- 語音成功的自動化測試使用明確 mock；不宣稱已驗證真機聲音、所有系統語音或離線語音可用性。
- 備份／還原與操作競態以真實隔離 IndexedDB 驗證，不讀寫使用者的瀏覽器紀錄，也不登入 Google。
- 保留版本／epoch 的原子衝突檢查；效能改善不能以繞過交易為代價。
- 文件同步更正測驗頁「未完成不計統計」舊文案、FSRS／第三方本機來源註解、資料重建步驟與 Google 備份未知結果的限制。舊驗證紀錄保留，不覆寫成此次證據。

## 影響範圍

- 每日頁、daily-service、review-commit：題次生命周期、排程與成就。
- quiz／practice／library view 及相關 service：非同步操作、草稿、開局讀取。
- learning-backup／Google 備份面板、prefs、web repository：可攜資料與還原安全。
- 排程 adapter、歷程、單字頁與成就核心：瀏覽器相容性。
- 新增定向 Node／隔離瀏覽器回歸；整批驗證與發布另記以下。

## 資料相容、遷移與回復

保留既有 ID、排程能力與學習紀錄，不清空資料來避開錯誤。沿用現有 v2 備份與交易式儲存；舊偏好僅在匯入時按既有規則遷移。尚未保存的操作失敗不標為已保存；還原後舊頁必須重讀，不將舊答案套用到新資料。更新仍不等於原生 APP 安裝／升級資料保留已驗收。

## 驗證紀錄

| 時點 | 操作 | 實際結果 | 限制 |
|---|---|---|---|
| 修復前基線 | `npm test` | 1076 通過，0 失敗／略過 | 不涵蓋本次新增邊界 |
| 修復前基線 | `npm run test:browser` | runner 3 項及 14 組 Chromium suite 通過 | 不是新修復的驗證 |
| 修復前基線 | catalog／FSRS 重建檢查 | 通過 | 非部署／真機驗收 |
| 2026-10-08 本次修復後 | 每日人工題元件常駐 live region／輸入框與焦點修正後 `node tests/browser/run.mjs --suite daily-practice-question` | 修正前 FAIL（無效作答重建 status 節點）；修正後 PASS，`daily-practice-integration` PASS | 真機螢幕閱讀器未測 |
| 2026-10-08 本次修復後 | `npm test` | 1121/1121 通過，0 失敗 | 不含真機與真 Google |
| 2026-10-08 本次修復後 | `node --test tests/browser/runner-checks.mjs` 與逐一執行 `tests/browser/suites/*.mjs` 全部 23 組 | runner 3/3；23 組全 PASS（約 143 秒） | Chromium 以外的瀏覽器、真機 |
| 2026-10-08 本次修復後 | `node tools/build-fsrs.mjs --check`、`node tools/build-catalog.mjs --check` | 兩者 PASS | 非部署驗收 |

## 未完成項目與發布狀態

- 修復與每日多題型接線已完成並通過全套回歸；每日人工題元件最後補上常駐 live region、保留輸入草稿／游標與鍵盤焦點。
- 最終版本尚未提交／推送；GitHub Pages 目前查到的部署來源仍是基線 main。
- Google 真帳號、三平台原生編譯／安裝／更新、真機語音及大量資料壓測仍未完成。
- 只有全部上線阻擋問題通過後才進入推送；之後須再核對 Pages 部署與瀏覽器 QA。

## 後續更正／取代

2026-10-08：補記最終全套驗證結果，狀態由「實作中」改為「已驗證」；發布與 Pages 核對另行追加。

## 發布補記（2026-10-08）

- 程式與文件提交 `04066a1`（143 個檔案，不含 `.idea`／`.cursor` 個人設定）；正常快轉推送 `2565338 → 04066a1` 至 Pages 使用的 main，並推送 `feature/add-offline-study-suite`。沒有 force push。
- [GitHub Pages 部署工作](https://github.com/liangzhongyi-code/Language-learning/actions/runs/37735355736)：head_sha `04066a10b31a26579a3935f9cee3d736e264eef7`，completed／success。
- 線上資產比對：`index.html`、`ja/daily.html`、`en/practice.html`、`daily-practice-question.js`、`daily-service.js`、`ts-fsrs.js`、`fsrs-adapter.js`、`catalog/meta.js` 共 8 檔，正規化 CRLF 後與提交內容完全相同。
- 線上冒煙（隔離 Playwright context，不碰使用者瀏覽器資料）：首頁、日文首頁、英日每日頁、日文練習、英文單字簿、日文歷程、日文測驗、使用教學 9 頁無頁面例外；日文每日頁實際作答一題顯示「已保存。」。
- 仍未驗：真機（iOS／Android）、真 Google 帳號、原生 APP 編譯／安裝／更新、大量資料壓測。

## 文件交叉核對更正（2026-10-08）

狀態：文件核對完成；僅更正文義，不影響執行行為。本次依 006、[010 Windows 建置紀錄](2026-10-08-010-windows-build.md)、[專案 README](../../README.md)、[工具鏈紀錄](../../app/docs/toolchain.md)、[native 任務入口](../../openspec/changes/add-native-app-packaging/tasks.md) 與 [offline 整合 tasks](../../openspec/changes/add-offline-study-suite/tasks.md) 核對。

### 發布與平台證據的適用範圍

- 「最終版本尚未提交／推送」是發布前快照，已被上方 `04066a1` 的發布補記取代；1121 項 Node、23 組 Chromium 與 Pages 冒煙結果只引用既有紀錄，本次未重跑或重新查驗線上部署。
- 「原生 APP 編譯／安裝／更新仍未驗」須按平台拆開：010 已記錄 Windows 首次 Rust 測試 3/3、建置、本機執行 26/26、安裝後 26/26 與解除安裝；不能再總稱 Windows 從未編譯／安裝。S16 乾淨機離線安裝、S19 舊版覆蓋更新仍未驗，解除安裝保留資料不能代替覆蓋更新驗收。
- Windows 目前以 WebView2 IndexedDB 儲存學習資料；記憶體 SQLite 探針不是持久原生 repository。Windows 局部成功不足以勾選 P00b、P00c 或 F50g 整包完成。
- 核對時 `tauri.app.conf.json` 的識別碼已為 `io.github.liangzhongyicode.langlearn`；010 的首次 Windows 驗證使用舊識別碼 `io.github.liangzhongyi-code.langlearn`。舊產物雜湊與驗證不能直接證明新識別碼的安裝、資料目錄或更新相容性。
- 核對時 Android 已出現生成工程與打包／驗證腳本，僅證明有工作區內容；尚無足以確認整包驗收完成的紀錄。010 所指的 `2026-10-08-011-android-build.md` 此時不存在，不能當作 Android 建置、簽署、安裝或更新成功的證據。
- README「完整離線 APP 仍在規劃」已不足以表達進度：應區分「網站沒有 Service Worker，離線重開不保證可用」與「Windows 已有本機驗證的初版，完整三平台原生能力與驗收仍在進行」。本次不修改 README、010、索引或 tasks，由主代理整合。
- native tasks 是整合 tasks 的入口，並非另一套完成清單。整合 tasks 開頭已承認 Windows 首次建置；末尾較早的「找不到工具／Rust 未編譯」等追加紀錄只代表當時狀態，以後續工具鏈與 010 證據補充，不刪除歷史。

### 原生尚未完成的工作

| 工作包 | 尚缺的實作／驗收 |
|---|---|
| P00b／P00c | Android、iOS 原型載入與 SQLite 編譯／呼叫證據；三平台離線語音、iOS IPA 與真實到期觀察。Windows 正式 APP 冒煙不能代替原型全部條件 |
| F50b–F50e | 持久 SQLite schema／遷移、revision／epoch／收據交易、崩潰與故障回滾、一致性備援與三還原點、窄命令橋接及 web↔native 備份契約 |
| F50f／F53 | 原生檔案／分享／剪貼簿與 TTS；ready、返回與保存中導覽控制、安全邊界。現況封鎖外部網址，尚非規格要求的系統瀏覽器開啟 |
| F50g | Windows 新識別碼對應產物重驗、S16 乾淨機完整離線安裝、S19 舊版 fixture 覆蓋升級與全部資料／半局保留 |
| F51a／F51b | Android 返回／安全區／TTS／分享／提醒與權限、固定 package／key 簽署及 S17 覆蓋更新／錯簽章拒絕 |
| F52a／F52b | Mac／Xcode 可用性、Apple 工程與 Swift 能力、IPA、iPhone 安裝與 S18 同身份更新／續簽／真實到期恢復 |
| F64 | 三平台真實 Google Client ID 與外部授權、PKCE／state／callback 及同帳號還原；網站 mock 成功不等於原生授權完成 |
| F54／F70–F74 | 平台交付清單、雜湊與更新／回滾手冊、最終審查回歸及情境逐項驗收；真機 a11y／語音、15k states／100k events 壓測仍待證據，安裝包未公開發布 |

### iOS 準備與本次限制

先確認可用 Mac／完整 Xcode／iPhone 與固定簽署身份，準備隔離學習 fixture、合併設定與驗收欄位，再在獲授權環境驗證原型、IPA 及續簽。具體準備步驟與官方依據見 [工具鏈文件的 iOS 準備建議](../../app/docs/toolchain.md#ios-可執行準備建議尚未執行)。Mac 尚未確認可用，不能宣稱 iOS 已建置。

本次只追加本文件及 `app/docs/toolchain.md`；未修改資料、程式、010、索引或 tasks，無遷移需求。驗證限於讀取文件／設定、`git status`／`git log`、檔案存在檢查及差異檢查；沒有編譯、安裝、裝置操作或 commit／push。本次文件修正仍在本機，先前發布狀態不代表此次更正已發布。
