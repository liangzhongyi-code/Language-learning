# 每日學習 Spec Delta

## ADDED Requirements

### Requirement: 固定每日清單與配額
系統 SHALL 依語言、級別、固定學習時區及個人進度生成並保存有序單字清單。

#### Scenario: D01 首次學習
- GIVEN 無歷史，選日文 N5，每日新字 5。
- WHEN 建立今日清單。
- THEN 最多 5 個 N5 新字、複習零個；顯示待複習、新字、已完成與開始入口。

#### Scenario: D02 重開續答
- GIVEN 清單已完成兩個項目。
- WHEN 重新整理或關閉後重開。
- THEN ID、順序、完成狀態相同，從下一項繼續，不重新發新字。

#### Scenario: D03 跨級配額
- GIVEN 日文額度 5，N5 已開始三個新字。
- WHEN 切 N4。
- THEN 最多再開始兩個新字，N5 進度保留；題目、干擾詞不能跨級。

#### Scenario: D04 日界與時區
- GIVEN 前日有未完成項目，已固定學習時區。
- WHEN 日期前進或系統時區改變。
- THEN 未完成複習優先帶入；已開始的新字不重算陌生字；未確認的系統時區變動不重置額度，已建立學習日不改寫。

### Requirement: 複習優先與工作量
系統 SHALL 區別全部到期數與每段題數，保留複習排序。

#### Scenario: D05 積欠排序
- GIVEN 到期 35 個，每段 20，新字額度 5。
- WHEN 開始今日學習。
- THEN 按 due、last、穩定 ID 排序取前 20，餘 15 明示；到期積欠清完前暫緩新字。

#### Scenario: D06 少量及零題
- GIVEN 同級完整池足夠四個不同選項，到期只有一至三個；另有完全無可學項目的案例。
- WHEN 開始。
- THEN 少量照常出题，干擾詞取同級完整池；零題顯示今日完成，不跨級或強迫重考。

#### Scenario: D07 中途新增到期
- GIVEN 已保存今日清單，稍後另有題目到期。
- WHEN 繼續原清單。
- THEN 原順序及目標不變，新增到期另顯示，可選繼續複習附加一段，不推翻已完成狀態。

### Requirement: 先教再考與補強
系統 SHALL 區分已介紹、已作答與熟練，提供讀音、意思及存在的例句。

#### Scenario: D08 新字介紹
- GIVEN 一個從未學過的字。
- WHEN 閱讀教學卡並前進。
- THEN 只記已介紹、不虛構答對或熟練；缺例句不現編；完成實際回想後才產生作答紀錄。

#### Scenario: D09 短期補強
- GIVEN 答錯或使用提示。
- WHEN 還有其他項目。
- THEN 每字每段最多一次補強，至少隔兩個其他項目；不足則段尾補強且可結束；有日誌但不刷升多個長期階段。

#### Scenario: D10 改額度或略過
- GIVEN 已開始三個新字，還有未開始項目。
- WHEN 額度改零或略過未開始的新字。
- THEN 已開始可完成但不再開新字；略過只替換未開始項目，保存當日排除名單，不重置已用額度。

### Requirement: 逐題保存
系統 MUST 在已確認作答後原子保存事件、排程、統計與每日進度，提供明確失敗及重試。

#### Scenario: D11 中途關閉
- GIVEN 已提交三題，第四題只填一半。
- WHEN 關閉後重開。
- THEN 三題仍在，第四題恢復保存的題面，不承諾未提交輸入；結果頁不得再加三次計數。

#### Scenario: D12 失敗與重送
- GIVEN 寫入錯誤，或成功但回應遺失。
- WHEN 相同 reviewId 重試。
- THEN 錯誤不回報已保存，保留重試；成功者只記一次；同 ID 不同內容拒絕，落盤前不放行下一題。

#### Scenario: D13 競態與清除
- GIVEN 兩頁共享舊 revision，或一頁已清除／匯入。
- WHEN 另一頁提交。
- THEN 一般衝突重讀重算、不同事件不丟；epoch 改變則拒絕舊事件；同一 entry 只接受首次有效完成，不復活被清掉資料。

### Requirement: 記憶維度與 FSRS
系統 SHALL 分開辨認與產出；B 階段 MUST 接上可離線執行的 FSRS 預設排程。

#### Scenario: D14 能力隔離
- GIVEN 同一字日翻中選擇答對。
- WHEN 查中翻日或填空能力。
- THEN 不直接標為已熟；記錄實際方向、題型、漢字及提示；句子填空不把所有詞都寫成已學。

#### Scenario: D15 自由練習防刷階
- GIVEN 尚未到期的同一維度。
- WHEN 反覆自由練習答對或答錯。
- THEN 真實作答全記；未到期答對不推遠 due，答錯可重設一次並標補強；同日補強不當成多次間隔成功。

#### Scenario: D16 FSRS 首用
- GIVEN B 啟用、離線且沒有足夠個人歷史。
- WHEN 合格到期事件提交。
- THEN 鎖定版本使用預設參數給出可重現狀態；錯誤／用提示為 Again，無提示答對為 Good；不憑耗時虛構 Hard／Easy，不假稱已訓練個人參數。

#### Scenario: D17 舊進度漸進遷移
- GIVEN 舊 n／w／box／last／due。
- WHEN 初次載入及之後首次實際複習。
- THEN 保留累計、舊 due 和 legacy 標記；不偽造歷史或其他維度熟練；實際複習才建立相應新排程，不全庫重排為到期。

## MODIFIED Requirements

### Requirement: 本機交易儲存
系統 MUST 維持 core 純計算；網站以 IndexedDB、APP 以 SQLite 實作共用非同步 repository。

#### Scenario: D18 舊網站遷移
- GIVEN localStorage 舊 stats／progress。
- WHEN 初始化新版學習库。
- THEN 匯入與遷移標記同交易，重跑不重加；舊 key 保留復原但不雙寫；IndexedDB 不可用時顯示失敗，不偷偷產生第二份真實來源。

#### Scenario: D19 損壞／中斷
- GIVEN 交易中斷、損壞內容或未來 schema。
- WHEN 啟動／提交。
- THEN 舊或新狀態完整一致，不以空預設覆蓋；提供重試／資料救援；ready 前不開始作答。

### Requirement: 備份與容量
系統 SHALL 使用外殼 v2 備份完整學習組及偏好，接受 v1 遷移，保持 langlearn0／1 編碼容器。

#### Scenario: D20 新格式往返
- GIVEN 清單、日誌、維度狀態及未完成題面。
- WHEN 檔案／代碼匯出再匯入更新版網站／APP。
- THEN 內容與順序完整恢復；本機 epoch／revision 重新產生，不重播加分；舊客戶端拒絕 v2 不靜默漏資料。

#### Scenario: D21 舊格式與損壞
- GIVEN v1 無新歷史或 v2 學習組關聯錯誤。
- WHEN 預覽。
- THEN v1 替換須明示清掉現有新歷史／清單；v2 壞學習組整組拒絕，偏好可獨立確認；取消不改資料。

#### Scenario: D22 過期預覽與限額
- GIVEN 預覽後已有新作答，或大小超限／儲存不足。
- WHEN 確認匯入／匯出。
- THEN 過期預覽要求重看；大小限額及早拒絕，不生成自己無法再匯入的成功備份，不靜默截斷歷史。

### Requirement: UI 與原功能回歸
系統 SHALL 保留自由測驗、回報、漢字、難度及外觀，支援觸控與鍵盤。

#### Scenario: D23 裝置與操作
- GIVEN 320／375／1280px、深淺模式、觸控與鍵盤。
- WHEN 開始、提交、失敗重試、續答及完成。
- THEN 無橫向溢位、主要按鈕至少 44px、焦點及 live status 明確；舊題型與備份回歸通過。

#### Scenario: D24 局數語意
- GIVEN 一局中途離開後恢復完成。
- WHEN 顯示統計。
- THEN 答題數及答對數逐題累計，完成局數只加一次；暫停局不冒充完整局。
