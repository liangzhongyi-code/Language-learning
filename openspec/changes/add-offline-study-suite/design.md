# 單機學習與 Google 備份整合設計

> 2026-10-05｜完整模式｜設計已核准；tasks 待第二道核准。分支 feature/add-offline-study-suite。
> 每日／原生／Google 契約一併核准；實際驗證狀態逐項記在 tasks，不把文件完成當成程式完成。

## 1. Overview

### 1.1 Purpose
每日清单可續答，個人教材可整理，多種練習各自記錄能力；資料留在裝置，Google 是選用的手動搬移與備份，不取代本機真實來源。

### 1.2 Scope
proposal.md 全部功能分批完成。保留原有 N1～N5 篩選、漢字三模式、問題回報與備份代碼。不做自動雲端合併、伺服器、多人或上架。網站離線冷啟動未另建 service worker 前不能冒充 APP 的離線承諾。

### 1.3 Related Documents
沿用 ../add-daily-learning/design.md、D01～D24 與 ../add-native-app-packaging/design.md、S01～S22；新增 specs/offline-study.md O01～O20、specs/google-backup.md G01～G10。衝突以本次核准的整合契約為準，所有原規格仍須驗收。

## 2. Architecture

### 2.1 System Context
```text
每日／單字簿／測驗／備份 UI
        ↓ 非同步 controller、revision／epoch 與 operationId
共享 repository ─────────── 純 core：計畫／判題／排程／驗證
        ├─ 網站 IndexedDB（學習群組）＋ localStorage（偏好）
        └─ APP SQLite（交易、遷移、持久目錄）

Google 面板 → 授權 adapter → 限定 Drive appDataFolder REST
                         ↓ 下載／深驗證／預覽／確認
                     同一 repository 還原入口
```

### 2.2 Components
- core 僅處理純資料、輸入正規化、判題與備份驗證，不接觸 DOM、網路或平台 API。
- repository 統一作答、每日清單、筆記、匯入、清除；不讓舊的 localStorage 路徑繼續雙寫。
- practice metadata 保存人工核對的提示、可接受答案、重組順序與詞性語境；不從分類推測詞性。
- Google auth／Drive adapter 位於 ui/platform，注入傳輸與授權以測試；設定預設空白。
- 原生語音、通知、檔案經平台 bridge；權限不可從備份偽造。

### 2.3 Interactions
啟動先 ready／遷移再顯示可寫畫面。每题提交把日誌、能力排程、清單、統計、續答游標及防重收據一起提交，成功後才換題。匯入先深驗證與預覽，確認時檢查 revision／epoch，保留還原點並原子替換學習群組。Google 下載只產生預覽，絕不直接修改學習紀錄。

## 3. Technical Decisions

### TD-1：一套資料契約
- Context：新題型、備份與 APP 都要寫學習資料；現有多個 setItem 可部分成功。
- Options：繼續多 key（風險延續）；巨型 JSON（重寫成本）；IndexedDB／SQLite（交易但需 async）。
- Decision：沿用每日設計的 IndexedDB／SQLite 與統一 repository，web 偏好仍獨立。
- Rationale：防止半次作答、半份還原及清除後資料復活。
- Consequences：所有寫入端一起改；web 偏好與學習群組分別回報，不承諾跨儲存原子性。

### TD-2：意向不是熟練度
- Context：想學、自稱已會與答對是不同證據。
- Options：直接改熟練分數（污染排程）；分開意向與觀測紀錄（較多欄位）。
- Decision：想學只提升未開始新字順位；自評已會標示未驗證並跳過新字介紹、可撤回，不取消已存在到期；今日略過只替換未開始新字，不退還已用額度。真正答錯解除自評已會。
- Rationale：不能用手動勾選冒充通過測驗。
- Consequences：同時更新計畫需 revision 檢查，跨級別仍共用每日語言額度。

### TD-3：分能力與明確答案
- Context：四選一、拼寫、聽寫並不等價，翻譯與語序可能多解。
- Options：共用 sourceId 分數（失真）；每 UI 開關一張卡（過碎）；能力加實際方向（明確）。
- Decision：recognition／production／listening-recognition／listening-production／assembly／grammar 分開；提示及重播記上下文。有選詞的填空不是自由產出。接受答案與合法語序由人工 metadata 指定。
- Rationale：不把漢字猜題或有提示重試計為自由產出熟練。
- Consequences：日文同音字需語境或排除；英文一字多詞性不得只用既有 pos 判斷。題庫不足明示，不跨 N 級湊題。

### TD-4：Google 手動多份快照
- Context：使用者已選多份備份，兩裝置可能各自進步。
- Options：單檔覆蓋（可能丟失）；自動合併（需事件衝突模型）；新增不可變快照（可選復原）。
- Decision：每次主動備份建立新快照，不覆寫／刪除舊快照；列表分頁，顯示時間、資料版本與裝置標籤。還原採替換而非合併，確認前顯示影響。
- Rationale：避免另一台覆蓋唯一版本，維持無伺服器。
- Consequences：占用帳號儲存空間；首版不提供自動清理。上傳逾時先按 exportId 查詢，不能盲目重送宣稱恰好一次。

### TD-5：網站與原生授權分開
- Context：Google 不支援把同一網站授權流程硬套所有 WebView。
- Options：全塞嵌入頁（不可靠）；自架 OAuth server（超出需求）；官方平台流程＋共用 Drive 層。
- Decision：網站 GIS token model；Windows 系統瀏覽器 PKCE＋loopback；Android 官方授權 API；iOS Google SDK，授權由系統介面處理。各平台 OAuth Client ID 留空，統一 Google Cloud 專案；不放 Client Secret、不需要為直接 Bearer REST 額外加入 API key。
- Rationale：最少權限與公開用戶端模式，不收帳密。
- Consequences：請求 drive.appdata，加 openid/email 顯示確認帳號；token 不進 localStorage、SQLite 學習表、URL、備份或日誌。首版不自行保存 refresh token；平台 SDK 管理的登入狀態另依官方契約。真實 Client ID／原生 SDK 尚未驗證前只標未設定或未驗收。

### TD-6：有限本機復原與平台能力
- Context：通知與資料庫不是同一交易；DB 內還原點不能救 DB 遺失。
- Options：宣稱全部原子（不實）；明確區分可回復資料與外部副作用。
- Decision：保留最近三個還原點、不遞迴匯出；DB 遷移另做一致性外部副本。通知 outbox 在交易內記意圖，系統工作以 epoch／世代核對、取消與重試。
- Rationale：能辨識已保存設定、已授權、已排程與實際送達的差別。
- Consequences：web 關頁無可靠提醒；原生也不保證準點或強制關閉後送達。卸載仍須外部備份。

## 4. Data Design
- learning v2 擴充 library、intents、能力事件、排程、計畫／續答、成就投影與提醒偏好；與 stats／progress 作為完整學習群組。prefs 可獨立匯入。
- 單字簿引用既有 canonical wordId；首版不增加自訂字庫。一本最多 15,000 個引用、100 本、名稱 60 字；筆記每字最多 2,000 字。收藏為固定系統簿；刪簿不刪共同單字與歷史。
- 未知／移除 wordId 保留筆記並標不可出題，不偷偷換成別字。筆記保存檢查 revision／epoch，延遲保存不能復活已刪資料。
- 英文答案 NFKC、trim、空白折疊；一般不分大小寫，但有區別的題目明定 caseSensitive。保留重音、標點與縮寫，替代拼法白名單，不模糊判對。
- 日文 NFKC、片假名轉平假名，保留促音、長音、拗音、濁音、じ／ぢ等差別；IME composition 中 Enter 不提交。拼組使用明定的字母／假名片段，重複片段有 instanceId，但互換相同文字不判錯。
- 成就由版本化真實事件計算；解鎖通知已展示標記獨立，重放／還原不重新獎勵。日曆以固定學習時區計算，登入不算學習。
- Drive 快照包含 exportId、schemaVersion、exportedAt、可編輯非敏感裝置標籤與 payload。標籤只供辨識，不當作授權依據；內容以 payload 深驗證為準。雲端資料沒有額外端到端加密，不宣稱 Google 看不到。
- 原檔／解壓後各限 10 MiB，代碼 16 MiB；串流途中即限額，不完整下載後才檢查。帳號權限、token、原生工作 ID 不進備份。

## 5. API Design
readSnapshot／submitReview／prepareEntry／updateIntent／saveBook／setMembership／saveNote／previewBackup／confirmRestore／clearLearning 經統一 repository；每次改動帶 expectedRevision、epoch、operationId。

Google adapter 提供 connect／disconnect／listSnapshots／uploadSnapshot／downloadSnapshot，回傳 typed error。每個請求捕捉帳號 sessionGeneration，斷線／切帳號／取消使晚到回應失效；取消上傳只代表本地停止等待，遠端可能已建立，重新連接後須重新列出確認。還原確認使用已驗證的固定 bytes，不在確認時偷下載另一版。

## 6. Implementation Approach
### 6.1 Technology Stack
維持靜態 MPA、ES2020、零前端框架；node:test、注入時鐘／亂數／transport。IndexedDB 學習 repository，原生 Tauri／SQLite 依既有設計。FSRS 依每日計畫 B 階段接入，版本與授權鎖定後實作，不自行杜撰公式。

### 6.2 Code Organization
core 新增學習 schema、library、practice、achievement 純模組；ui/platform 放 repository、Google auth／Drive、speech／notification adapter；data/shared/practice 放經核對 seed。設定預定 assets/js/config/google.js，各平台 Client ID 為空字串。tests 按 core、repository、UI race 分開；APP bridge 在 app/，不污染網站裸模組。

先資料／備份與每日核心，再 Google 網站、單字簿與新練習，最後平台功能；可獨立的 core 與測試平行。所有功能留在交付範圍，分批不等於刪減。

## 7. Security
只有按連接後才載入 Google SDK；未設定不載入、不請求。Drive scope 不使用完整磁碟權限；SDK／API 網域固定，不把使用者提供的 URL 或 redirect 當請求目的地。空設定有繁中說明；CSP 授權域僅必要項。

備份深驗證版本、數量、長度、計數與關聯，拒絕原型污染 key；筆記純文字顯示。所有資料遷移前保留原始副本；clearLearning 在交易內寫禁止重新遷移標記，再刪舊 localStorage，防中斷後復活。OAuth 權限與目前帳號先驗證才提供雲端操作。

## 8. Performance
15,000 筆進度壓測、單字簿分頁、日曆摘要索引，不每次按鈕解析全歷史。Google 列表按需分頁；下載串流限制；上傳不阻塞本機練習，備份使用固定一致快照，標示備份時間。

## 9. Testing Strategy
O01～O20、G01～G10 與既有 D／S 各有獨立案例；先 RED 再最小 GREEN，舊行為補測做突變。檔案、代碼、Google 三種入口共用相同還原測試。必測跨分頁、清除／匯入同時提交、失敗回滾、OAuth 取消／401／缺 scope／帳號切换、失效回應、未知上傳結果、XSS／超大檔。

新練習每個支援語言／模式至少 10 個人工核對種子；日文先覆蓋 N5，其他級別未補齊就禁用該模式並解釋，不跨級補題。音訊必須離線真機試聽；缺本機 voice 不計錯題。320／375／768／1440 寬度、鍵盤、IME、觸控與 live region 回歸。新增測試不得用調低原測試範圍方式過關。

## 10. Deployment／Migration
Google Cloud Console 待使用者填 Client ID、啟用 Drive API、設定授權來源與測試使用者。GitHub Pages origin 不含 repo 路徑；APP 各平台 ID、簽署與 redirect 待工具鏈原型確認。不在本次自動登入、上傳真實紀錄或建立 Release。

v1 匯入明示缺每日／筆記等欄位的替換影響；新舊格式不靜默合併。回退舊網站不能讀 IndexedDB 新格式，回滾需明示版本與相容備份。APP 覆蓋安裝保留私有資料路徑、固定 identity／簽署；刪除重裝不保證。

## 11. 核准與分期
使用者採用功能方向與多份 Google 快照。詳細整合與執行任務呈現後仍需依 spec-powers 核准，未核准前不改正式測驗。實作批次：資料安全 → 每日／Google → 單字簿 → 輸入／拼組／詞性 → 聽力／回饋 → 成就／提醒／FSRS → 三平台安裝與升級驗收。

## 12. Open Questions
- Google Client ID 留空：可以完成 mock 與未設定 UI，但真實跨裝置授權仍須補設定後驗收。
- Mac／iPhone、Android 與 Windows 測試設備尚待可用；缺設備只阻擋該平台真機驗收，不宣稱成功。
- 原生 OAuth SDK 與側載身份在 P0 驗證；Android 不套用桌面 loopback 或已停用的自訂 URI 流程。

## 13. Sources／Change Log
2026-10-05：Google 多份快照由使用者選定；修訂整合契約，未宣稱生產功能完成。
- [Google 網站 token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)
- [網站 Client ID 設定](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [原生 OAuth 與 PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
