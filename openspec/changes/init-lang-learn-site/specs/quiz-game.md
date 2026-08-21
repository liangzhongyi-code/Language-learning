# Spec Delta: quiz-game（雙向選題遊戲）

> change-id: `init-lang-learn-site`

本能力是網站的**主要功能**：中翻外／外翻中的四選一測驗。
所有抽題、出干擾選項、計分的邏輯都必須是**無 DOM 的純函式**，以便用 `node:test` 測。

## ADDED Requirements

### Requirement: 支援雙向出題

The system SHALL 支援三種出題方向：`zh2target`（中翻外）、`target2zh`（外翻中）、
`mixed`（每題隨機挑一個方向）。

#### Scenario: 中翻外的題面與選項語言
- **GIVEN** 方向為 `zh2target`、語言為 `en`
- **WHEN** 產生一題
- **THEN** 題面文字為該筆資料的 `zh`，四個選項文字全部取自各資料的 `target`

#### Scenario: 外翻中的題面與選項語言
- **GIVEN** 方向為 `target2zh`、語言為 `en`
- **WHEN** 產生一題
- **THEN** 題面文字為該筆資料的 `target`，四個選項文字全部取自各資料的 `zh`

#### Scenario: 混合方向逐題決定
- **GIVEN** 方向為 `mixed`、題數為 20
- **WHEN** 產生整局題目
- **THEN** 每一題都各自帶有自己的 `direction` 欄位，且整局同時出現 `zh2target` 與 `target2zh` 兩種值

### Requirement: 支援兩種題源

The system SHALL 支援 `words`（單字題）、`sentences`（整句題）、`mixed`（兩者混合）三種題源。

#### Scenario: 單字題源只出單字
- **GIVEN** 題源為 `words`
- **WHEN** 產生整局題目
- **THEN** 每一題的來源 `id` 都符合 `<lang>-w-` 前綴

#### Scenario: 混合題源同時包含兩者
- **GIVEN** 題源為 `mixed`、題數為 20、兩種題庫都足量
- **WHEN** 產生整局題目
- **THEN** 產生的題目中同時存在 `-w-` 與 `-s-` 前綴的來源 id

### Requirement: 每題四個選項且僅一個正解

The system SHALL 為每一題產生正好 4 個選項，其中恰有 1 個為正解，3 個為干擾選項。

#### Scenario: 選項數量與正解數量
- **GIVEN** 任一產生出來的題目
- **WHEN** 檢查其 `options`
- **THEN** 長度為 4，且其中 `isCorrect` 為 `true` 的元素恰好 1 個

#### Scenario: 選項文字彼此相異
- **GIVEN** 任一產生出來的題目
- **WHEN** 取出四個選項的文字
- **THEN** 去重後仍為 4 個，不存在兩個文字完全相同的選項

#### Scenario: 干擾選項不得與正解同義重複
- **GIVEN** 題庫中存在兩筆 `target` 相同但 `id` 不同的資料
- **WHEN** 以其中一筆為正解產生題目
- **THEN** 另一筆不會被選為干擾選項

### Requirement: 干擾選項的挑選策略

The system SHALL 依「同 `category` → 同 `level` → 全域」的順序遞補干擾選項，
使干擾選項盡量與正解同一個語意範疇，避免題目過於好猜。

#### Scenario: 同類別足夠時優先同類別
- **GIVEN** 正解的 `category` 為 `food`，且題庫中同為 `food` 的其他項目 ≥ 3 筆
- **WHEN** 產生該題
- **THEN** 三個干擾選項的 `category` 全部為 `food`

#### Scenario: 同類別不足時往外遞補
- **GIVEN** 正解的 `category` 為 `sport`，且題庫中同為 `sport` 的其他項目僅 1 筆
- **WHEN** 產生該題
- **THEN** 仍產生 3 個干擾選項，其中 1 個為 `sport`，另外 2 個由其他類別遞補

#### Scenario: 題庫過小時明確報錯而非產生瑕疵題
- **GIVEN** 題庫總筆數為 3（不足以湊出 1 正解 + 3 干擾）
- **WHEN** 呼叫產生題目的函式
- **THEN** 拋出可辨識的錯誤，訊息指出題庫筆數不足，且**不**回傳選項少於 4 個的題目

### Requirement: 一局之內題目不重複

The system SHALL 保證同一局測驗中，同一筆來源資料不會被出兩次。

#### Scenario: 題目來源不重複
- **GIVEN** 題庫 60 筆、題數設定為 20
- **WHEN** 產生整局題目
- **THEN** 20 題的來源 `id` 去重後仍為 20 個

#### Scenario: 題數超過題庫時取全部
- **GIVEN** 題庫 12 筆、題數設定為 20
- **WHEN** 產生整局題目
- **THEN** 回傳 12 題，不重複、不報錯

### Requirement: 隨機性可注入以便測試

The system SHALL 讓所有洗牌與抽樣函式接受可選的亂數來源參數，
預設使用 `Math.random`，測試時可傳入固定序列的假亂數。

#### Scenario: 固定亂數源產生穩定結果
- **GIVEN** 傳入一個回傳固定序列的假亂數函式
- **WHEN** 以相同題庫與相同參數連續呼叫兩次產題
- **THEN** 兩次結果完全相同

#### Scenario: 洗牌不改變原陣列
- **GIVEN** 一個陣列 `arr`
- **WHEN** 呼叫 `shuffle(arr)`
- **THEN** 回傳新陣列，且 `arr` 本身的元素順序未被改動

#### Scenario: 洗牌不遺失也不新增元素
- **GIVEN** 任一陣列
- **WHEN** 呼叫 `shuffle()`
- **THEN** 回傳陣列與原陣列長度相同，且元素集合相同

### Requirement: 作答判定與即時回饋

The system SHALL 在使用者選擇答案後立即判定對錯，
標示所選選項與正解，並在該題鎖定後才允許進入下一題。

#### Scenario: 答對的判定
- **GIVEN** 一題已產生、使用者尚未作答
- **WHEN** 提交正解選項的索引
- **THEN** 回傳 `{ correct: true }`，該題狀態變為已作答

#### Scenario: 答錯時回傳正解
- **GIVEN** 一題已產生、使用者尚未作答
- **WHEN** 提交非正解選項的索引
- **THEN** 回傳 `{ correct:false, correctIndex:<正解索引>, correctText:<正解文字> }`

#### Scenario: 同一題不可重複作答
- **GIVEN** 一題已經作答完畢
- **WHEN** 再次對同一題提交答案
- **THEN** 回傳已作答的狀態，且累計分數不再改變

#### Scenario: 答錯後 UI 同時標示錯誤與正解
- **GIVEN** 使用者在測驗畫面上點了錯誤的選項
- **WHEN** 畫面更新完成
- **THEN** 被點的選項顯示為錯誤樣式，正解選項同時顯示為正確樣式，
  且「下一題」按鈕變為可點擊

### Requirement: 一局的設定與流程

The system SHALL 讓使用者在開始前選擇方向、題源與題數（10 / 20 / 全部），
並在最後一題作答完畢後自動進入結果畫面。

#### Scenario: 開始一局
- **GIVEN** 使用者位於測驗頁的設定畫面
- **WHEN** 選好方向與題源、按下開始
- **THEN** 顯示第 1 題，並顯示「1 / N」的進度指示

#### Scenario: 最後一題後進入結果
- **GIVEN** 使用者正在作答第 N 題（最後一題）
- **WHEN** 作答完並按下「看結果」
- **THEN** 畫面切換為結果畫面，不再顯示題目

#### Scenario: 中途離開不留下半局狀態
- **GIVEN** 使用者作答到一半
- **WHEN** 重新整理頁面
- **THEN** 回到設定畫面，且該未完成的局不計入任何統計

### Requirement: 題面朗讀

The system SHALL 在題面或選項為目標語言時，提供朗讀按鈕。

#### Scenario: 外翻中時題面可朗讀
- **GIVEN** 方向為 `target2zh`、語言為 `en`
- **WHEN** 顯示題目
- **THEN** 題面旁出現朗讀按鈕，點擊後以英文語音朗讀題面文字

#### Scenario: 中翻外時題面不提供朗讀
- **GIVEN** 方向為 `zh2target`
- **WHEN** 顯示題目
- **THEN** 題面（中文）不提供朗讀按鈕；作答完畢後正解（目標語言）旁出現朗讀按鈕
