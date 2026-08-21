# Spec Delta: progress（作答檢討與統計）

> change-id: `init-lang-learn-site`

**範圍界定**：本次只做「每局結束的錯題檢討」與「跨局累計的答對率統計」。
**不做**持久化錯題本、不做間隔重複複習、不做跨裝置同步。

## ADDED Requirements

### Requirement: 每局結束的成績摘要

The system SHALL 在一局測驗結束時顯示答對題數、總題數與正確率百分比。

#### Scenario: 顯示成績
- **GIVEN** 一局 10 題、答對 7 題
- **WHEN** 進入結果畫面
- **THEN** 顯示「7 / 10」與「70%」

#### Scenario: 正確率四捨五入到整數
- **GIVEN** 一局 3 題、答對 2 題
- **WHEN** 呼叫 `calcAccuracy(2, 3)`
- **THEN** 回傳 `67`

#### Scenario: 零題不得產生 NaN
- **GIVEN** 總題數為 0
- **WHEN** 呼叫 `calcAccuracy(0, 0)`
- **THEN** 回傳 `0`，且不回傳 `NaN` 或 `Infinity`

### Requirement: 每局結束的錯題檢討

The system SHALL 在結果畫面列出該局所有答錯的題目，
每筆包含題面、使用者選的答案、正確答案，以及該題的附加說明。

#### Scenario: 錯題清單內容
- **GIVEN** 一局中第 3 題答錯
- **WHEN** 進入結果畫面
- **THEN** 錯題清單包含該題的題面文字、使用者所選的選項文字、正解文字

#### Scenario: 句子題的錯題附上語序說明
- **GIVEN** 答錯的題目來源是句型題庫
- **WHEN** 在錯題清單中顯示該題
- **THEN** 一併顯示該句子的 `note` 欄位內容

#### Scenario: 全對時的呈現
- **GIVEN** 一局全部答對
- **WHEN** 進入結果畫面
- **THEN** 不顯示錯題清單區塊，改為顯示全對的祝賀訊息

#### Scenario: 錯題可朗讀
- **GIVEN** 錯題清單中的一筆
- **WHEN** 點擊該筆的朗讀按鈕
- **THEN** 以目標語言語音朗讀該題的目標語言文字

### Requirement: 跨局累計統計

The system SHALL 將每一局的結果累加至 localStorage，
並依「語言 × 題源」分別統計總作答題數、總答對題數與遊玩局數。

#### Scenario: 一局結束後累加
- **GIVEN** 既有統計為 `en/words: { answered:10, correct:6, sessions:1 }`
- **WHEN** 完成一局 `en/words` 且答對 8 / 10
- **THEN** 統計更新為 `{ answered:20, correct:14, sessions:2 }`

#### Scenario: 不同語言的統計互不干擾
- **GIVEN** 已有英文的統計紀錄
- **WHEN** 完成一局日文測驗
- **THEN** 英文的統計數值不變，日文另外新增一筆紀錄

#### Scenario: 未完成的局不計入
- **GIVEN** 使用者作答到第 5 題就離開頁面
- **WHEN** 重新開啟頁面查看統計
- **THEN** 該局的作答數與答對數皆未被計入

### Requirement: 語言首頁顯示統計

The system SHALL 在各語言首頁顯示該語言的累計正確率與遊玩局數。

#### Scenario: 有紀錄時顯示數值
- **GIVEN** 英文已累計 answered 50、correct 40
- **WHEN** 開啟英文首頁
- **THEN** 顯示「累計正確率 80%」與總局數

#### Scenario: 無紀錄時顯示引導文案
- **GIVEN** localStorage 中沒有英文的統計紀錄
- **WHEN** 開啟英文首頁
- **THEN** 顯示「尚未有紀錄，開始第一局吧」之類的引導文案，而非 `0%` 或空白

### Requirement: 統計可清除

The system SHALL 提供清除統計的操作，並在清除前要求二次確認。

#### Scenario: 確認後清除
- **GIVEN** 已有統計紀錄
- **WHEN** 點擊清除並在確認對話框選擇確定
- **THEN** localStorage 中的統計 key 被移除，畫面回到「尚未有紀錄」狀態

#### Scenario: 取消則不清除
- **GIVEN** 已有統計紀錄
- **WHEN** 點擊清除但在確認對話框選擇取消
- **THEN** 統計紀錄維持不變

### Requirement: 儲存格式帶版本號且失效時安全重置

The system SHALL 以單一 localStorage key（`lang-learn.stats.v1`）儲存統計，
內容含 `schemaVersion` 欄位；當版本不符或內容無法解析時，
SHALL 安靜地重置為初始狀態，不得讓頁面出錯。

#### Scenario: 損毀的資料被安全重置
- **GIVEN** localStorage 中該 key 的值為 `"{ 這不是 JSON"`
- **WHEN** 呼叫 `loadStats()`
- **THEN** 回傳初始統計物件，且不拋出例外

#### Scenario: 舊版本被丟棄
- **GIVEN** 儲存的資料 `schemaVersion` 為 `0`，而目前版本為 `1`
- **WHEN** 呼叫 `loadStats()`
- **THEN** 回傳初始統計物件

#### Scenario: 正常資料被正確讀回
- **GIVEN** 先呼叫 `saveStats(stats)` 寫入一份合法統計
- **WHEN** 接著呼叫 `loadStats()`
- **THEN** 回傳的物件與寫入的內容相等

### Requirement: localStorage 不可用時不得中斷功能

The system SHALL 在 localStorage 被停用或寫入失敗（例如 Safari 無痕模式、容量已滿）時，
降級為「本次瀏覽期間有效的記憶體統計」，並且測驗功能完全不受影響。

#### Scenario: 讀取失敗時降級
- **GIVEN** `localStorage.getItem` 會拋出例外的環境
- **WHEN** 呼叫 `loadStats()`
- **THEN** 回傳初始統計物件，且不拋出例外

#### Scenario: 寫入失敗時不影響作答
- **GIVEN** `localStorage.setItem` 會拋出例外的環境
- **WHEN** 完成一局測驗
- **THEN** 結果畫面正常顯示成績與錯題清單，僅累計統計無法保存
