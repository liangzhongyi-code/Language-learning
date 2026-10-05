# Native APP 規格異動

> 2026-10-05 設計已核准；tasks 待核准。每個 S 編號須有獨立測試，原生／實機案例不能用 Node 測試取代。

## ADDED Requirements

### Requirement: 本機封裝與導覽
The system SHALL 在安裝包包含完整頁面、題庫與必要資源，不以遠端網站為主畫面。

#### Scenario: S01 斷網冷啟動
- GIVEN 已安裝 APP 且沒有網路。
- WHEN 關閉程序後啟動，開啟英日文頁面並完成測驗。
- THEN 發行白名單內全部頁面（原有 13 頁及核准新增頁）的本機連結及作答可用，不因遠端 HTML／JS／CSS／字型請求失敗而阻塞；TTS 另外驗收。

#### Scenario: S02 打包白名單
- GIVEN 專案包含 .git、.idea、測試、報告及模擬 secret.key。
- WHEN 產生 frontendDist。
- THEN 只含明列頁面與必要 assets，不含上述檔案；缺必要頁面時建置失敗。

#### Scenario: S03 多頁與返回
- GIVEN APP 開啟日文測驗頁。
- WHEN 切換語言、返回首頁或按 Android 返回鍵。
- THEN 合法本機連結可用，切語言遵循同功能對應；已提交題可續答，未提交輸入離開前提醒並可取消；保存期間不得先放行換頁。

### Requirement: 原生資料生命週期
The system MUST 在私有目錄交易式保存資料，提交前不得回報已保存。

#### Scenario: S04 啟動屏障
- GIVEN 已有淺色偏好與學習進度，原生讀取延遲。
- WHEN 任一 MPA 頁面啟動。
- THEN 資料就緒前顯示載入狀態、不啟動寫入；載入後使用舊資料，不被預設值覆蓋。

#### Scenario: S05 逐題原子提交
- GIVEN 已知 stats／progress／learning 與一筆已確認作答事件。
- WHEN 保存成功或注入任一集合寫入失敗。
- THEN 成功時日誌、排程、統計、清單及去重收據同時更新；失敗時均維持舊值並提供重試；結果頁不再整局重計。

#### Scenario: S06 防重與衝突
- GIVEN operationId 已提交，或其他視窗已提高 revision。
- WHEN 重送相同操作或提交舊 revision。
- THEN 相同操作不重複計分；舊 revision 明確回報衝突，不覆寫較新資料。

#### Scenario: S07 異常中斷
- GIVEN 保存已成功回報，或原生交易尚未完成。
- WHEN 強制結束 APP 後重啟。
- THEN 已成功狀態保留；未完成交易只有完整舊狀態或完整新狀態，不出現區塊各半。

#### Scenario: S08 損壞或未來版本
- GIVEN DB 損壞或 schemaVersion 高於支援版本。
- WHEN 啟動。
- THEN 顯示錯誤，不初始化空 DB 覆蓋；允許取得可讀的原始備援檔或提供復原指引，不宣稱不可讀資料已救回。

#### Scenario: S09 舊版遷移
- GIVEN 支援的舊 DB fixture。
- WHEN 升級並再次執行遷移。
- THEN 紀錄與題目 id 保留，遷移冪等；失敗回滾，不重複新增。

### Requirement: 備份與原生檔案
The system SHALL 支援原有檔案／代碼格式，匯入前須驗證、預覽、確認並提供還原點。

#### Scenario: S10 網站與 APP 往返
- GIVEN 有效 v2 stats／progress／learning／prefs 備份，含書簿、筆記、每日清單與未完成局，另有 v1 遷移案例。
- WHEN 網站匯出 → APP 匯入 → APP 匯出 → 網站匯入。
- THEN 各區塊語意相等（不比較本機 epoch／revision 與匯出時間），偏好及複習排程保留；v1 不捏造新增歷史，OS 通知權限與裝置語音 ID 不搬移。

#### Scenario: S11 學習組完整性
- GIVEN v2 學習組任一區塊／關聯損壞而 prefs 有效，另有缺新歷史的 v1。
- WHEN 讀取並確認匯入。
- THEN v2 stats／progress／learning 整組拒絕，不混新舊；prefs 可獨立確認；v1 明示會替換現有新歷史／清單。替換前保存一致性還原點，失敗不寫入。

#### Scenario: S12 輸入界線
- GIVEN 未來備份版本、原始檔超過 10 MiB、解壓後超過 10 MiB、代碼輸入超過 16 MiB 或非法數值紀錄。
- WHEN 讀取／解碼。
- THEN 相應讀取／串流階段停止並說明，不改資料、不建立無限制大字串。

#### Scenario: S13 匯出／分享／取消
- GIVEN 點擊存檔、分享或複製。
- WHEN 成功、拒絕權限或取消系統面板。
- THEN 寫檔成功才顯示已儲存；分享只描述平台可確認狀態，不承諾對方收到；取消不清待匯入預覽；剪貼簿失敗有手動退路。

### Requirement: 離線發音
The system SHALL 偵測日英本機語音能力；缺包不阻止學習。

#### Scenario: S14 本機語音
- GIVEN 已有合適離線日英語音。
- WHEN 飛航模式朗讀，接著切題／切頁／退背景。
- THEN 實際可發聲；舊朗讀停止，不重疊播放。

#### Scenario: S15 語音缺包
- GIVEN 只有網路 voice 或缺指定語言。
- WHEN 檢查語音或點朗讀。
- THEN 顯示離線語音準備指引，非聽力題仍能作答；聽力入口不可開始無聲題，不默默把文字送雲端。

### Requirement: 安裝與更新
The system MUST 固定 APP 身份並明示簽署限制。正常覆蓋更新 MUST 保留學習統計、逐題進度、偏好，以及每日學習擴充後的清單、已提交的未完成局、複習日誌與 FSRS 狀態；不得要求每次更新手動匯出匯入。首次開啟新版若需資料遷移，MUST 先建立一致性備援、交易式執行且失敗回滾，禁止清空重建。刪除 APP、清除資料、換裝置或改變 APP 身份不屬覆蓋更新保證。

#### Scenario: S16 Windows 離線安裝
- GIVEN 目標機沒有 WebView2 且斷網。
- WHEN 執行完整離線 EXE。
- THEN 處理所需 runtime 或明確回報權限問題；完成後可啟動，不把下載 bootstrapper 標成離線安裝包。

#### Scenario: S17 Android 更新
- GIVEN 固定 package id、簽署金鑰與目標裝置允許的側載／ADB 路徑。
- WHEN 舊 APK 建立紀錄後覆蓋安裝新 APK。
- THEN 新版能啟動且上述全部資料語意保留、未完成學習可續答；錯誤簽章不得當作成功更新，也不得建議先卸載來繞過。以舊版 fixture 比對各資料集合，遷移失敗符合 S09。

#### Scenario: S18 iOS 安裝與續簽
- GIVEN Mac 產出 IPA、固定有效 bundle identifier／簽署身份、自有同一 Apple 帳號、iPhone 與 Sideloadly 配對，且未刪除原 APP。
- WHEN 側載、更新／續簽，並完成到期恢復測試。
- THEN 有真機啟動及上述全部資料保留、續答證據；說明免費約 7 天限制，續簽不是卸載重裝；換帳號／bundle id 不承諾承接原資料。沒有 Mac／實機時標未驗證，不以成功安裝推定保留成功。

#### Scenario: S19 Windows 更新
- GIVEN 舊版已有紀錄、固定 identifier 及資料目錄。
- WHEN 執行新版 EXE 覆蓋更新。
- THEN 上述全部資料語意保留且可續答，遷移符合 S09；安裝器只能更新程式資源，不覆蓋用戶資料庫；升級時不得走清除用戶資料的卸載分支。卸載／清除資料不在保留保證範圍。

### Requirement: 原生安全邊界
The system MUST 限定本機合法頁面及最小權限。

#### Scenario: S20 外部網址與非法路徑
- GIVEN 外部網址、任意 DB 路徑或未授權 invoke。
- WHEN 嘗試導覽或呼叫。
- THEN 外部連結交系統瀏覽器；非法路徑／命令被拒；沒有通用 SQL、任意檔案寫入或 shell 執行能力。

## MODIFIED Requirements

### Requirement: 共用網站不退化
The system SHALL 保留靜態網站部署與舊資料，並為 APP 增加非同步平台介面。

#### Scenario: S21 網站回歸
- GIVEN 一般瀏覽器與既有 localStorage。
- WHEN 部署並執行測驗、篩選、外觀與備份。
- THEN 不需原生 API／登入／新增 CDN，舊學習資料經冪等遷移進 IndexedDB、偏好維持可讀；保留 446 項原有測試意圖，必要的改寫須有等價替代。

#### Scenario: S22 可存取狀態
- GIVEN 桌面鍵盤或手機觸控使用者。
- WHEN 載入、保存失敗、分享取消、缺語音或關閉系統面板。
- THEN 狀態可見且可被輔助科技通知，焦點可回觸發控制項；安全區不遮操作，主要觸控目標至少 44 CSS px。

## REMOVED Requirements

無；網站仍零執行期依賴，原生套件僅在 APP 建置範圍。
