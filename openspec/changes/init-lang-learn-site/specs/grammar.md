# Spec Delta: grammar（句型結構拆解）

> change-id: `init-lang-learn-site`

這是使用者需求中的核心：把
「我今天去打羽毛球 = 主詞 + 時間 + 動詞 + 受詞」
這種語序結構**畫出來**，讓中文與目標語言的差異一眼可見。

## ADDED Requirements

### Requirement: 句型卡的雙排色塊呈現

The system SHALL 為每個句子繪製上下兩排色塊：
上排為中文語序（依 `zhIndex` 排序），下排為目標語言語序（依 `chunks` 陣列順序）。
同一個語法角色在兩排中使用**相同顏色**。

#### Scenario: 兩排色塊各自還原完整句子
- **GIVEN** 句子 `我今天去打羽毛球` / `I play badminton today`
- **WHEN** 顯示句型卡
- **THEN** 上排色塊由左至右為「我 / 今天 / 去打 / 羽毛球」，
  下排為「I / play / badminton / today」

#### Scenario: 相同角色顏色一致
- **GIVEN** 任一句型卡
- **WHEN** 比對上下兩排的色塊
- **THEN** 角色為 `subject` 的色塊在上下兩排使用同一顏色，其餘角色同理

#### Scenario: 每個色塊標註角色中文名
- **GIVEN** 任一色塊
- **WHEN** 檢視色塊
- **THEN** 色塊上或下方顯示該角色的中文標籤（主詞／時間／動詞／受詞／助詞⋯）

### Requirement: 語序差異的視覺標示

The system SHALL 在中文語序與目標語言語序不一致時，明確標示出被移動的區塊。

#### Scenario: 標示語序改變的區塊
- **GIVEN** 句子的時間區塊在中文為第 2 個、在英文為第 4 個
- **WHEN** 顯示句型卡
- **THEN** 該時間區塊被加上「語序不同」的視覺標記（例如外框或箭頭），
  其他語序未變的區塊不加此標記

#### Scenario: 語序完全相同時不加雜訊
- **GIVEN** 一個中外語序完全一致的句子
- **WHEN** 顯示句型卡
- **THEN** 沒有任何區塊被加上語序標記

#### Scenario: 日文助詞只出現在目標語言排
- **GIVEN** 日文句 `私は今日バドミントンをします`
- **WHEN** 顯示句型卡
- **THEN** `は`、`を` 兩個 `particle` 區塊以較窄的樣式出現在日文排，
  **中文排完全不顯示這兩塊**（中文沒有對應成分，硬塞佔位格會誤導），
  且中文排的四塊依序為「我 / 今天 / 去打 / 羽毛球」

#### Scenario: 中文排的順序由 zhIndex 決定而非陣列順序
- **GIVEN** 任一句子，其助詞的 `zhIndex` 取尾端號碼
- **WHEN** 計算中文排
- **THEN** 先濾掉 `zh` 為空字串的區塊，再依 `zhIndex` 由小到大排列，
  串接結果必須等於該句的 `zh`

### Requirement: 句型說明文字

The system SHALL 在每張句型卡下方顯示該句的 `note`，說明語序差異或助詞用法。

#### Scenario: 顯示 note
- **GIVEN** 一筆句子的 `note` 為「英文的時間副詞多半放句尾」
- **WHEN** 顯示句型卡
- **THEN** 該說明文字顯示於色塊區下方

### Requirement: 句型分類與篩選

The system SHALL 讓使用者依 `patternId` 篩選句子，只看某一種句型的所有例句。

#### Scenario: 依句型篩選
- **GIVEN** 句型清單中選擇「主詞 + 時間 + 動詞 + 受詞」
- **WHEN** 套用篩選
- **THEN** 只顯示 `patternId` 為該句型的句子，數量與該句型的例句數一致

#### Scenario: 顯示全部
- **GIVEN** 已套用某個句型篩選
- **WHEN** 選擇「全部」
- **THEN** 顯示題庫中的所有句子

#### Scenario: 句型清單顯示例句數
- **GIVEN** 開啟文法頁
- **WHEN** 檢視句型篩選清單
- **THEN** 每個句型旁顯示其例句數量，且數量為 0 的句型不出現在清單中

### Requirement: 整句朗讀

The system SHALL 為每張句型卡提供整句朗讀，以及個別區塊朗讀。

#### Scenario: 朗讀整句
- **GIVEN** 一張英文句型卡
- **WHEN** 點擊卡片的朗讀按鈕
- **THEN** 以 `en-US` 朗讀完整的 `target` 句

#### Scenario: 朗讀單一區塊
- **GIVEN** 一張句型卡
- **WHEN** 點擊下排某個色塊
- **THEN** 只朗讀該色塊的 `target` 片段

#### Scenario: 日文句子顯示假名讀音
- **GIVEN** 一張日文句型卡且該筆資料有 `reading`
- **WHEN** 顯示句型卡
- **THEN** 完整句下方顯示整句假名讀音

### Requirement: 句型題可作為測驗題源

The system SHALL 讓文法題庫中的句子能被測驗模組當作整句翻譯題使用。
（詳細出題規則見 `specs/quiz-game.md`）

#### Scenario: 文法頁提供進入測驗的入口
- **GIVEN** 開啟文法頁
- **WHEN** 點擊「用這些句子做測驗」
- **THEN** 導向該語言的測驗頁，且題源預設已選為 `sentences`
