# JLPT N1 讀解 Spec Delta

## ADDED Requirements

### Requirement: 短文組資料格式
系統 MUST 在測試階段擋下格式不合的短文組，錯誤訊息指出組 id、題目 id 與欄位。

#### Scenario: R01 合法短文組
- GIVEN 一組 `ja-jr-` 短文：題型合法、level 1–5、有 1～4 題；每題四個選項不重複且包含 `answer`，`explain` 四段都非空，`focus` 合法；`sourceRef` 非空。
- WHEN 執行 `npm test`。
- THEN 通過；任何一項不符、出現未知欄位、`explain` 不是四段，皆列出並失敗。

#### Scenario: R02 單篇與雙篇
- GIVEN 一組統合理解與一組其他題型。
- WHEN 驗證。
- THEN 統合理解必須有 `passageA`、`passageB` 且 `passage` 為 null；其他題型必須有 `passage` 且兩個雙篇欄位為 null。違反時失敗。

#### Scenario: R03 劃線句
- GIVEN 一組含 `focus: 'underline'` 的題目。
- WHEN 驗證。
- THEN `underline` 必填、在原文中剛好出現一次，原文不得殘留 `⟪⟫` 標記；沒有劃線題的組，`underline` 必須是 null。

#### Scenario: R04 字數下限
- GIVEN 一組短文字數低於該題型下限（短文 140、中文 350、長文 700、統合合計 420、主張 700、情報 490）。
- WHEN 驗證。
- THEN 失敗並寫出實際字數與下限。

#### Scenario: R05 編號
- GIVEN 多組短文。
- WHEN 驗證題庫。
- THEN 組 id 整份從 `ja-jr-0001` 連號；題目 id 為「組 id-qN」，N 從 1 連號；`sourceRef` 不重複。

### Requirement: 來源可追溯
系統 MUST 能證明每組短文對應到固定 commit 的上游題組，選組可以重現，修改與排除都有原因。

#### Scenario: R06 上游檔驗證且不執行
- GIVEN 本機下載的上游題庫檔，其中一個 SHA-256 不符；另有一個合法檔，裡面混了會在執行時留下痕跡的程式碼。
- WHEN 執行 `node tools/import-yomitaku.mjs --check <目錄>`。
- THEN 雜湊不符時拒絕並指出檔名，退出碼非 0；解析合法檔時程式碼不會被執行，那個痕跡不會出現。

#### Scenario: R07 選組、修改與遞補
- GIVEN 固定種子與上游題庫。
- WHEN 執行 `--select` 兩次，並對已進版控的資料執行 `--check`。
- THEN 兩次選出的組與順序相同，且都符合字數下限與避開早期批次的規則。`--check` 會列出：與上游不同卻沒寫 `edited`、寫了 `edited` 卻與上游相同、排除沒寫原因，以及收錄不是依選組順序遞補的情況。格式正規化（`⟪⟫` 轉 `underline`、標籤轉 `focus`）不算差異。

#### Scenario: R08 授權標註
- GIVEN 第一批資料已進版控。
- WHEN 檢查 `CREDITS.md`、資料檔檔頭與目錄產物。
- THEN 都標明 Yomitaku（Mocas-12）、固定 commit 與 MIT；`CREDITS.md` 附 MIT 授權全文，並說明本專案的改動與 AI 撰寫的解說未經母語者審查。

### Requirement: 目錄與載入
系統 SHALL 按級別載入 JLPT 題庫，不讓學習者下載用不到的級別。

#### Scenario: R09 按級別拆檔
- GIVEN 測驗頁已選 JLPT 模擬、級別 N5。
- WHEN 載入題庫，並記錄網路請求。
- THEN 只請求 `ja-jlpt-1.js`，不請求 `ja-jlpt-5.js`；改選 N1 時才請求 `ja-jlpt-5.js`；選「全部」時載入五個檔。預載表與實際請求一致。

#### Scenario: R10 預設級別
- GIVEN 今日學習的級別偏好是 N1，測驗頁目前級別是「全部」。
- WHEN 切到 JLPT 模擬題源。
- THEN 級別自動改成 N1，並只載入 N1；沒有偏好時改成 N5；使用者之後手動選「全部」則照選。其他題源的級別行為不變。

### Requirement: 題型、抽題與呈現
系統 MUST 依官方題型出 N1 讀解題，按篇出題，作答後逐選項顯示繁中解說。

#### Scenario: R11 題型膠囊與官方編號
- GIVEN 級別 N1 與 N5。
- WHEN 打開 JLPT 模擬的題型篩選。
- THEN N1 顯示「問題8 內容理解（短文）」～「問題13 情報檢索」六顆，題數正確；N5 只顯示原有的五顆；只勾某一種題型時，只出那一種。

#### Scenario: R12 按篇抽題
- GIVEN 固定亂數、題數 10，題池有每篇 4 題的長文與每篇 1 題的短文。
- WHEN 出題。
- THEN 同一篇的題目相鄰並依原順序；不會只出一篇的一部分；總題數可以因最後一篇而超過 10，但不超過 10 加上該篇題數減 1。N5 一題一筆的抽題結果與變更前相同。

#### Scenario: R13 選項順序與解說同步
- GIVEN 一題情報檢索與一題內容理解。
- WHEN 出題。
- THEN 情報檢索的選項維持原順序；內容理解的選項打亂；兩者的每段解說都跟著自己的選項，`correctIndex` 指向 `answer`。

#### Scenario: R14 短文呈現
- GIVEN 一組長文含劃線句、一組統合理解。
- WHEN 顯示。
- THEN 短文在題目上方，同篇的第二題起預設收合，可以展開；劃線句用 `<u>` 呈現且經過跳脫；統合理解分別標示 A、B 兩篇。不顯示中譯、不提供朗讀。手機寬度 375px 下沒有水平捲動。

#### Scenario: R15 逐選項解說
- GIVEN 一題已作答，選錯。
- WHEN 顯示作答結果。
- THEN 先顯示「你選的」與「正解」兩個選項的繁中解說，其餘兩段可以展開查看；答對時顯示正解的解說，其餘可以展開。

#### Scenario: R16 作答紀錄與續答
- GIVEN 作答一篇長文的前兩題後關閉頁面，目錄檔已改為按級別拆檔。
- WHEN 重新打開並繼續。
- THEN 兩題的紀錄能力為 `recognition`、方向 `target2zh`，sourceId 為題目 id；續答恢復同一篇短文、劃線與選項順序，從第三題接著作答。

#### Scenario: R17 回報、每日與備份
- GIVEN 讀解題的作答紀錄。
- WHEN 產生問題回報代碼、產生今日學習清單、匯出與匯入備份。
- THEN 回報代碼含題目 id、`passageId`、題型、題目、選項、正解與使用者的選擇，不含短文全文；今日清單不含 `ja-jr-` 題目；備份驗證通過且來回不變。

#### Scenario: R18 N5 不受影響
- GIVEN 既有的 N5 JLPT 題目與測試。
- WHEN 執行全部 JLPT 相關測試並操作 N5 題源。
- THEN 題數、題型膠囊、問題號篩選、底線呈現、作答紀錄與變更前相同（目錄檔名改變除外）。
