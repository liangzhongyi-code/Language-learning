# Spec Delta: content-data（靜態題庫資料）

> change-id: `init-lang-learn-site`

本能力定義**所有寫死在前端的學習內容**的資料格式。它是整個專案的地基：
發音、單字、文法、遊戲四個模組全部讀同一份資料，schema 定不好會全面影響。

## ADDED Requirements

### Requirement: 單字資料格式

The system SHALL 以固定 schema 的 JavaScript 物件陣列儲存單字，
並透過 ES Module 的 `export const words` 對外提供。

單字物件的欄位定義：

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | ✅ | 全域唯一，格式 `<lang>-w-<序號>`，例 `en-w-001` |
| `zh` | string | ✅ | 繁體中文 |
| `target` | string | ✅ | 目標語言寫法（英文單字／日文漢字或假名） |
| `reading` | string \| null | ✅ | 日文為假名讀音；英文固定 `null` |
| `romaji` | string \| null | ✅ | 日文為羅馬拼音；英文固定 `null` |
| `pos` | string | ✅ | 詞性，限 `noun` / `verb` / `adjective` / `adverb` / `other` |
| `category` | string | ✅ | 主題分類，用於挑選同類干擾選項 |
| `level` | number | ✅ | 難度，限 1 / 2 / 3 |

#### Scenario: 讀取英文單字題庫
- **GIVEN** `assets/js/data/en/words.js` 已存在
- **WHEN** 以 `import { words } from './data/en/words.js'` 載入
- **THEN** 回傳一個長度 ≥ 60 的陣列，且每個元素都通過 `validateWord()`

#### Scenario: 日文單字必須帶讀音
- **GIVEN** 日文單字題庫中的任一筆資料
- **WHEN** 呼叫 `validateWord(entry, 'ja')`
- **THEN** 當 `reading` 或 `romaji` 為空字串或 `null` 時回傳驗證失敗，並指出缺少的欄位名稱

#### Scenario: 英文單字不需要讀音欄位內容
- **GIVEN** 一筆英文單字 `{ id:'en-w-001', zh:'羽毛球', target:'badminton', reading:null, romaji:null, pos:'noun', category:'sport', level:1 }`
- **WHEN** 呼叫 `validateWord(entry, 'en')`
- **THEN** 回傳驗證通過

### Requirement: 單字 id 唯一性

The system SHALL 保證同一語言的題庫內不存在重複的 `id`，
且提供可在測試中執行的檢查函式。

#### Scenario: 偵測重複 id
- **GIVEN** 一個含有兩筆相同 `id` 的單字陣列
- **WHEN** 呼叫 `findDuplicateIds(words)`
- **THEN** 回傳包含該重複 `id` 的陣列

#### Scenario: 正常題庫無重複
- **GIVEN** 交付的英文與日文單字題庫
- **WHEN** 對兩者分別呼叫 `findDuplicateIds()`
- **THEN** 兩者皆回傳空陣列

### Requirement: 句型（文法）資料格式

The system SHALL 以「語意色塊（chunk）」的方式儲存句子，
使中文語序與目標語言語序都能被程式讀出並比對。

句子物件的欄位定義：

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | ✅ | 格式 `<lang>-s-<序號>` |
| `zh` | string | ✅ | 完整中文句 |
| `target` | string | ✅ | 完整目標語言句 |
| `reading` | string \| null | ✅ | 日文整句假名；英文 `null` |
| `patternId` | string | ✅ | 對應 `patterns.js` 中的句型 id |
| `chunks` | Chunk[] | ✅ | **陣列順序即目標語言語序** |
| `note` | string | ✅ | 一句話說明中外語序差異或助詞用法 |
| `category` | string | ✅ | 主題分類 |
| `level` | number | ✅ | 1 / 2 / 3 |

Chunk 物件：

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `role` | string | ✅ | 語法角色，必須存在於 `ROLES` 表 |
| `zh` | string | ✅ | 該區塊對應的中文片段 |
| `target` | string | ✅ | 該區塊對應的目標語言片段 |
| `zhIndex` | number | ✅ | **該區塊在中文句中的順序**（從 0 起算，不得重複） |

#### Scenario: 陣列順序表示目標語序、zhIndex 表示中文語序
- **GIVEN** 句子 `我今天去打羽毛球` / `I play badminton today`
- **WHEN** 讀取其 `chunks`
- **THEN** 陣列為 `[主詞(zhIndex 0), 動詞(zhIndex 2), 受詞(zhIndex 3), 時間(zhIndex 1)]`，
  依陣列順序串接 `target` 可還原 `target` 句，依 `zhIndex` 排序串接 `zh` 可還原 `zh` 句

#### Scenario: 日文句子的助詞被獨立標記
- **GIVEN** 句子 `我今天去打羽毛球` / `私は今日バドミントンをします`
- **WHEN** 讀取其 `chunks`
- **THEN** 存在 `role` 為 `particle` 的區塊（`は`、`を`），且動詞區塊位於陣列最後一個位置

#### Scenario: chunk 串接與完整句一致性檢查
- **GIVEN** 任一句子資料
- **WHEN** 呼叫 `validateSentence(entry, lang)`
- **THEN** 若依陣列順序串接的 `target` 片段無法組回 `entry.target`（忽略空白），回傳驗證失敗

#### Scenario: zhIndex 必須是完整連續序列
- **GIVEN** 一筆 `chunks` 的 `zhIndex` 為 `[0, 1, 3]` 的句子
- **WHEN** 呼叫 `validateSentence()`
- **THEN** 回傳驗證失敗，訊息指出 `zhIndex` 不是 0 起算的連續序列

### Requirement: 語法角色定義表

The system SHALL 提供共用的 `ROLES` 對照表，定義每個語法角色的中文標籤與主題色，
供文法模組畫色塊使用。

角色至少須涵蓋：`subject`（主詞）、`verb`（動詞）、`object`（受詞）、
`time`（時間）、`place`（地點）、`adjective`（形容詞）、
`negation`（否定）、`particle`（助詞）、`other`（其他）。

#### Scenario: 未知角色被擋下
- **GIVEN** 一個 `role` 為 `foobar` 的 chunk
- **WHEN** 呼叫 `validateSentence()`
- **THEN** 回傳驗證失敗，訊息指出未知的 role 名稱

#### Scenario: 每個角色都有標籤與顏色
- **GIVEN** `ROLES` 表
- **WHEN** 走訪所有角色
- **THEN** 每個角色都同時具備非空的 `label` 與 `color`

### Requirement: 英文字母資料格式

The system SHALL 以 `alphabet.js` 提供英文字母單元，
欄位為 `id` / `upper` / `lower` / `ipa` / `exampleWord` / `exampleZh`。

#### Scenario: 英文字母表完整
- **GIVEN** `alphabet.js`
- **WHEN** 載入 `letters`
- **THEN** 長度為 26，`upper` 依序為 A 到 Z，且每筆都有非空的 `ipa` 與 `exampleWord`

### Requirement: 日文假名資料格式

The system SHALL 以 `kana.js` 提供日文假名單元，
**涵蓋清音、濁音、半濁音與拗音四種類型**，並以 `type` 欄位區分。

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `id` | string | ✅ | 格式 `ja-k-<romaji>`，例 `ja-k-kya` |
| `hiragana` | string | ✅ | 平假名，拗音為兩字（如 `きゃ`） |
| `katakana` | string | ✅ | 片假名 |
| `romaji` | string | ✅ | 羅馬拼音 |
| `type` | string | ✅ | 限 `seion`（清音）/ `dakuon`（濁音）/ `handakuon`（半濁音）/ `youon`（拗音） |
| `row` | string | ✅ | 所屬行，例 `あ`、`が`、`き`（拗音以其子音假名為行） |
| `column` | string | ✅ | 段位。清濁半濁音限 `a`/`i`/`u`/`e`/`o`；拗音限 `ya`/`yu`/`yo` |
| `exampleWord` | string | ✅ | 例字（假名） |
| `exampleZh` | string | ✅ | 例字中文意思 |

#### Scenario: 四種類型的數量正確
- **GIVEN** `kana.js`
- **WHEN** 依 `type` 分組統計
- **THEN** `seion` 為 46 筆、`dakuon` 為 20 筆、`handakuon` 為 5 筆、`youon` 為 33 筆，總計 104 筆

#### Scenario: 清音涵蓋十行
- **GIVEN** `type` 為 `seion` 的假名
- **WHEN** 統計 `row` 的相異值
- **THEN** 恰為 `あ か さ た な は ま や ら わ ん` 十一組，且不含任何其他行

#### Scenario: 濁音與半濁音的行別正確
- **GIVEN** `type` 為 `dakuon` 或 `handakuon` 的假名
- **WHEN** 統計 `row` 的相異值
- **THEN** `dakuon` 為 `が ざ だ ば` 四行、`handakuon` 為 `ぱ` 一行

#### Scenario: 拗音為兩字且限三段
- **GIVEN** `type` 為 `youon` 的假名
- **WHEN** 檢查每一筆
- **THEN** `hiragana` 長度為 2、第二字為 `ゃ`/`ゅ`/`ょ` 其中之一，
  且 `column` 落在 `ya`/`yu`/`yo` 之內

#### Scenario: 拗音涵蓋的子音行
- **GIVEN** `type` 為 `youon` 的假名
- **WHEN** 統計 `row` 的相異值
- **THEN** 恰為 `き し ち に ひ み り ぎ じ び ぴ` 十一組
  （現代日語罕用的 `ぢゃ`/`ぢゅ`/`ぢょ` 不收錄，故為 33 筆而非 36 筆）

#### Scenario: 每筆假名都有例字
- **GIVEN** `kana.js` 中的任一筆
- **WHEN** 呼叫 `validateKana(entry)`
- **THEN** `exampleWord` 與 `exampleZh` 皆為非空字串，否則回傳驗證失敗

#### Scenario: 羅馬拼音不重複
- **GIVEN** `kana.js` 的全部 104 筆
- **WHEN** 統計 `romaji` 的相異值
- **THEN** 相異值數量等於 104，不存在兩筆相同的羅馬拼音

### Requirement: 題庫規模下限

The system SHALL 交付足以進行完整一局遊戲的示範題庫。

#### Scenario: 英文題庫規模
- **GIVEN** 交付後的 `data/en/`
- **WHEN** 統計筆數
- **THEN** `words` ≥ 60 筆、`sentences` ≥ 20 筆

#### Scenario: 日文題庫規模
- **GIVEN** 交付後的 `data/ja/`
- **WHEN** 統計筆數
- **THEN** `words` ≥ 60 筆、`sentences` ≥ 20 筆

### Requirement: 資料驗證可在測試中一次跑完

The system SHALL 提供 `validateDataset(dataset, lang)`，
一次驗證某語言的全部題庫並回傳所有錯誤，而非遇到第一個錯誤就中止。

#### Scenario: 回報所有錯誤
- **GIVEN** 一份含有 3 筆不同錯誤的題庫
- **WHEN** 呼叫 `validateDataset()`
- **THEN** 回傳的錯誤陣列長度為 3，且每個錯誤都帶有出錯的 `id` 與欄位名稱

#### Scenario: 正式題庫零錯誤
- **GIVEN** 交付的英文與日文完整題庫
- **WHEN** 分別呼叫 `validateDataset()`
- **THEN** 兩者皆回傳空陣列
