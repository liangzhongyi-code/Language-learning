# JLPT 模擬題源 Spec Delta

## ADDED Requirements

### Requirement: 題庫資料格式
系統 MUST 在測試階段擋下格式不合的 JLPT 題目，錯誤訊息指出題號與欄位。

#### Scenario: J01 合法題目
- GIVEN 一筆 `ja-j-` 題目，區段與問題號是合法組合，level 1–5，四個選項彼此不同且包含 `answer`，`note` 為非空繁中，`sourceRef` 非空。
- WHEN 執行 `npm test`。
- THEN 通過；少任何一項、選項不是剛好四個、選項重複（例如上游 `moji-6.12`）、`answer` 不在選項內、id 重複或跳號，皆列出錯誤並失敗。

#### Scenario: J02 題面形式
- GIVEN 底線形式（moji 問題1、2）、括號形式（goi 問題3、bunpou 問題1）、整句形式（goi 問題4）各一題。
- WHEN 驗證。
- THEN 底線形式的 `underline` 在 `stem` 中剛好出現一次且沒有括號空格；括號形式 `underline` 為 null、`stem` 剛好一個 `（　　）`；整句形式兩者皆無。違反時失敗。

#### Scenario: J03 保留空格
- GIVEN 上游題面「あの 人は 学生 です。」。
- WHEN 匯入、建置目錄、在測驗頁顯示。
- THEN 詞間空格在資料、目錄與畫面上都保留；只去頭尾空白。

### Requirement: 來源可追溯
系統 MUST 能證明每一題對應到固定 commit 的上游題目，修改與排除都有原因。

#### Scenario: J04 上游檔案驗證
- GIVEN 本機下載的上游檔，其中一個檔案的 SHA-256 與工具內記錄的不符。
- WHEN 執行 `node tools/import-jlptsuccess.mjs --check <目錄>`。
- THEN 拒絕執行並指出不符的檔案，退出碼非 0；不產生或比對任何資料。

#### Scenario: J05 修改與排除對照
- GIVEN 已進版控的資料，有題目的題面或選項與上游不同，也有上游題目沒收。
- WHEN 執行 `--check`。
- THEN 每個 `sourceRef` 只對應一題；與上游不同但 `edited` 為 null 的題目、排除表沒寫原因的題目、不在排除表也沒收的上游題目，皆列出並失敗。格式正規化（`<u>`、括號空格、「A: 」）不算差異。

#### Scenario: J06 授權標註
- GIVEN 第一批資料已進版控。
- WHEN 檢查 `CREDITS.md` 與資料檔檔頭。
- THEN `CREDITS.md` 有 JLPTSuccess 一節，含 MIT 授權全文、上游網址與固定 commit；每個資料檔檔頭標註來源與授權。

### Requirement: 題源與設定
系統 SHALL 只在有題目的語言與級別提供「JLPT 模擬」題源，並可按問題號篩選。

#### Scenario: J07 語言與級別
- GIVEN 日文 N5 有 260 題、N4–N1 為 0；英文沒有此題源。
- WHEN 打開日文與英文的測驗設定。
- THEN 日文顯示「JLPT 模擬」與正確筆數，選 N4–N1 時停用並說明沒有題目；英文不顯示此題源；網址帶 `?source=jlpt` 進英文頁時退回預設題源，不顯示內部代號錯誤。

#### Scenario: J08 問題號篩選
- GIVEN 日文 N5、JLPT 模擬題源。
- WHEN 只勾「問題2 表記」。
- THEN 這一局只出表記題，筆數顯示 50；全部取消勾選時不能開始並提示。

#### Scenario: J09 漢字顯示模式
- GIVEN 使用者偏好是「只顯示假名」。
- WHEN 選 JLPT 模擬題源。
- THEN 漢字模式設定不顯示或標明對此題源無效，題面照原樣出漢字（JLPT 本身就在考漢字），偏好值不被改掉。

#### Scenario: J10 按需載入
- GIVEN 首次打開測驗頁、還沒選 JLPT 模擬。
- WHEN 載入頁面，然後切到 JLPT 模擬。
- THEN 頁面載入時不下載 `catalog/ja-jlpt.js`；切換後才載入；載入失敗可重試，與其他題源一致；預載表與實際載入一致。

### Requirement: 出題與作答
系統 MUST 用資料裡的固定選項出題，作答紀錄、續答與問題回報沿用既有機制。

#### Scenario: J11 固定選項出題
- GIVEN 固定亂數序列與一題 JLPT 題目。
- WHEN 產生題目。
- THEN 四個選項就是資料裡的四個（只打亂順序），`correctIndex` 指向 `answer`；同一局不重複出同一題；不使用任何其他題目的內容當選項。

#### Scenario: J12 題面呈現與解說
- GIVEN 一題底線形式、一題括號形式、一題整句形式。
- WHEN 顯示與作答。
- THEN 題面上方顯示該問題號的日文問法；底線字用 `<u>` 呈現且經過跳脫；作答後顯示正解、繁中 `note` 與問法的中文對照。

#### Scenario: J13 作答紀錄與續答
- GIVEN 作答三題 JLPT 題後關閉頁面。
- WHEN 重新打開並繼續。
- THEN 三題的紀錄存在，能力為 `recognition`、方向為 `target2zh`、sourceId 為 `ja-j-NNNN`；續答恢復同一題面（含底線與問題號），不重算已答題目。

#### Scenario: J14 不進每日學習
- GIVEN 有 JLPT 題的作答紀錄。
- WHEN 產生今日學習清單。
- THEN 清單不含 `ja-j-` 題目；既有每日清單的結果與沒有 JLPT 題時相同。

#### Scenario: J15 備份與舊版相容
- GIVEN 含 `ja-j-` 紀錄的備份，以及不認得 JLPT 題的舊版資料。
- WHEN 匯出、匯入、還原；以及題目從題庫移除後讀取紀錄。
- THEN 備份驗證通過且內容不變；找不到題目時沿用既有「題目已移除」的處理，不報錯、不刪紀錄。

#### Scenario: J16 問題回報
- GIVEN 一題底線形式的 JLPT 題已作答。
- WHEN 產生問題回報代碼並解碼。
- THEN 代碼含 sourceId、問題號、題面、底線字、選項、正解與使用者的選擇，足以重現題目；不夾帶整份學習紀錄。
