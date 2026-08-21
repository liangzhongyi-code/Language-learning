# Spec Delta: vocabulary（單字瀏覽）

> change-id: `init-lang-learn-site`

## ADDED Requirements

### Requirement: 單字清單頁面

The system SHALL 在 `<lang>/vocabulary.html` 以卡片列表顯示該語言的全部單字，
每張卡片顯示中文、目標語言寫法、詞性標籤與分類標籤；
日文另外顯示假名讀音與羅馬拼音。

#### Scenario: 英文單字卡內容
- **GIVEN** 開啟英文單字頁
- **WHEN** 檢視任一張單字卡
- **THEN** 卡片上可見中文、英文、詞性、分類，且不出現空白的讀音欄位

#### Scenario: 日文單字卡含讀音
- **GIVEN** 開啟日文單字頁
- **WHEN** 檢視任一張單字卡
- **THEN** 卡片上同時可見漢字／假名寫法、假名讀音與羅馬拼音

### Requirement: 依分類篩選

The system SHALL 提供分類篩選，讓使用者只看某個主題的單字。

#### Scenario: 套用分類篩選
- **GIVEN** 單字頁的分類清單中有 `食物`
- **WHEN** 點選 `食物`
- **THEN** 只顯示 `category` 為食物的單字，且該分類按鈕呈現選取狀態

#### Scenario: 分類清單由資料推導
- **GIVEN** 題庫中實際出現的分類共 8 種
- **WHEN** 載入單字頁
- **THEN** 分類清單恰好顯示這 8 種加上「全部」，不出現題庫中沒有的分類

#### Scenario: 顯示目前筆數
- **GIVEN** 套用了某個分類篩選
- **WHEN** 檢視頁面
- **THEN** 顯示「目前 N 筆」，N 等於篩選後的實際卡片數

### Requirement: 關鍵字搜尋

The system SHALL 提供搜尋框，同時比對中文、目標語言與讀音欄位。

#### Scenario: 以中文搜尋
- **GIVEN** 題庫中有 `羽毛球 / badminton`
- **WHEN** 在搜尋框輸入 `羽毛`
- **THEN** 該筆單字出現在結果中

#### Scenario: 以羅馬拼音搜尋日文
- **GIVEN** 日文題庫中有 `雨 / あめ / ame`
- **WHEN** 輸入 `ame`
- **THEN** 該筆單字出現在結果中

#### Scenario: 搜尋不分大小寫
- **GIVEN** 題庫中有 `badminton`
- **WHEN** 輸入 `BADMIN`
- **THEN** 該筆單字出現在結果中

#### Scenario: 無結果時的呈現
- **GIVEN** 輸入一個題庫中不存在的字串
- **WHEN** 搜尋完成
- **THEN** 顯示「找不到符合的單字」，而非空白畫面

#### Scenario: 搜尋與分類同時生效
- **GIVEN** 已選取分類 `食物`
- **WHEN** 再輸入搜尋關鍵字
- **THEN** 結果同時滿足分類條件與關鍵字條件

### Requirement: 單字朗讀

The system SHALL 為每張單字卡提供朗讀按鈕，朗讀其目標語言寫法。

#### Scenario: 朗讀單字
- **GIVEN** 一張英文單字卡 `badminton`
- **WHEN** 點擊朗讀按鈕
- **THEN** 以 `en-US` 朗讀 `badminton`

#### Scenario: 日文朗讀使用讀音
- **GIVEN** 一張日文單字卡，`target` 為漢字 `雨`、`reading` 為 `あめ`
- **WHEN** 點擊朗讀按鈕
- **THEN** 以 `ja-JP` 朗讀，且傳入語音引擎的文字為 `reading`（避免漢字被誤讀）

### Requirement: 進入測驗的入口

The system SHALL 在單字頁提供直接開始單字測驗的按鈕。

#### Scenario: 從單字頁開始測驗
- **GIVEN** 開啟英文單字頁
- **WHEN** 點擊「開始單字測驗」
- **THEN** 導向 `en/quiz.html`，且題源預設已選為 `words`
