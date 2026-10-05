# Google 手動多份備份規格

## ADDED Requirements

### Requirement: 空設定
系統 SHALL 顯示尚未設定，不載入 Google SDK／請求，所有本機功能可用，不要求 API key 或 Client Secret。

#### Scenario: G01 空設定
- **GIVEN** 所有 OAuth Client ID 留空。
- **WHEN** 開首頁或點連接入口。
- **THEN** 顯示尚未設定，不載入 Google SDK／請求，所有本機功能可用，不要求 API key 或 Client Secret。

### Requirement: 主動授權與帳號
系統 SHALL 核對 drive.appdata 與帳號身份；成功顯示確認帳號，其他路徑繁中提示且本機零寫入。

#### Scenario: G02 主動授權與帳號
- **GIVEN** 已填對應平台 Client ID。
- **WHEN** 使用者主動連接並接受、拒絕、取消或未授完整 scope。
- **THEN** 核對 drive.appdata 與帳號身份；成功顯示確認帳號，其他路徑繁中提示且本機零寫入。

### Requirement: 新增多份快照
系統 SHALL 建立不同 exportId 的不可變檔案，不覆寫或自動刪舊份，只回報已確認成功的快照。

#### Scenario: G03 新增多份快照
- **GIVEN** 同帳號已有備份、兩裝置可能同時操作。
- **WHEN** 按備份到 Google。
- **THEN** 建立不同 exportId 的不可變檔案，不覆寫或自動刪舊份，只回報已確認成功的快照。

### Requirement: 清單與還原預覽
系統 SHALL 按需分頁，顯示日期版本範圍；取消零寫入，確認採固定下載 bytes 並通過共用深驗證／還原點流程。

#### Scenario: G04 清單與還原預覽
- **GIVEN** 雲端有多頁不同版本快照。
- **WHEN** 選指定快照並預覽、取消或確認。
- **THEN** 按需分頁，顯示日期版本範圍；取消零寫入，確認採固定下載 bytes 並通過共用深驗證／還原點流程。

### Requirement: token 及授權失效
系統 SHALL 要求重新連接，不無限重試或假報成功，token 不入持久資料、URL、備份及錯誤日誌。

#### Scenario: G05 token 及授權失效
- **GIVEN** token 過期、API 401 或使用者撤權。
- **WHEN** 開始或進行上下載。
- **THEN** 要求重新連接，不無限重試或假報成功，token 不入持久資料、URL、備份及錯誤日誌。

### Requirement: 切帳號與晚到結果
系統 SHALL 清掉 A 的 token／清單／預覽，世代守衛拒絕晚到回應，不能上傳到誤認帳號；已發送上傳結果未知要明示。

#### Scenario: G06 切帳號與晚到結果
- **GIVEN** A 的授權／下載／上傳仍未完成。
- **WHEN** 斷線或切 B 後 A 結果返回。
- **THEN** 清掉 A 的 token／清單／預覽，世代守衛拒絕晚到回應，不能上傳到誤認帳號；已發送上傳結果未知要明示。

### Requirement: 覆蓋競態
系統 SHALL revision／epoch 不合拒絕並重預覽，X 不蓋 Y，檔案／代碼／Google 入口共享同一請求失效策略。

#### Scenario: G07 覆蓋競態
- **GIVEN** 預覽後另一頁寫了新答案，或先選 X 再選 Y。
- **WHEN** 確認還原或旧下載返回。
- **THEN** revision／epoch 不合拒絕並重預覽，X 不蓋 Y，檔案／代碼／Google 入口共享同一請求失效策略。

### Requirement: 上傳結果未知
系統 SHALL 先按 exportId 查詢並顯示不確定狀態，不盲目新增或宣稱恰好一次；若重複存在列表可識別同一次匯出。

#### Scenario: G08 上傳結果未知
- **GIVEN** 請求逾時但伺服器可能已建立檔案。
- **WHEN** 再次嘗試備份。
- **THEN** 先按 exportId 查詢並顯示不確定狀態，不盲目新增或宣稱恰好一次；若重複存在列表可識別同一次匯出。

### Requirement: 資料與網路邊界
系統 SHALL 串流限制大小、拒絕非法 payload，錯誤可重試但不更改本機或舊雲端份；不對任意輸入 URL 發送 token。

#### Scenario: G09 資料與網路邊界
- **GIVEN** 錯版本、畸形計數、超大檔、配額不足、限流或離線。
- **WHEN** 上下載、解壓或預覽。
- **THEN** 串流限制大小、拒絕非法 payload，錯誤可重試但不更改本機或舊雲端份；不對任意輸入 URL 發送 token。

### Requirement: 原生授權与可攜性
系統 SHALL 各平台使用受支援授權介面與同 Cloud 專案，保留學習格式、不匯出認證，缺設定／設備明示未驗收而非成功。

#### Scenario: G10 原生授權与可攜性
- **GIVEN** Windows／Android／iOS 各自有合法用戶端設定。
- **WHEN** 外部系統授權及同帳號跨平台備份還原。
- **THEN** 各平台使用受支援授權介面與同 Cloud 專案，保留學習格式、不匯出認證，缺設定／設備明示未驗收而非成功。
