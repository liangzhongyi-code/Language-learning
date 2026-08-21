# Spec Delta: pronunciation（字母基礎發音）

> change-id: `init-lang-learn-site`

英文區為 26 字母 + IPA 音標；日文區為清音五十音（平假名／片假名對照）。
發音一律使用瀏覽器內建的 Web Speech API，不夾帶任何音檔。

## ADDED Requirements

### Requirement: 英文字母表頁面

The system SHALL 在 `en/alphabet.html` 以格狀排列顯示 26 個英文字母卡，
每張卡顯示大寫、小寫、IPA 音標與一個例字（含中文意思）。

#### Scenario: 字母卡內容完整
- **GIVEN** 開啟英文字母頁
- **WHEN** 檢視任一張字母卡
- **THEN** 卡片上同時可見大寫字母、小寫字母、IPA 音標、例字與例字中文

#### Scenario: 26 張卡片全數呈現
- **GIVEN** 開啟英文字母頁
- **WHEN** 統計字母卡數量
- **THEN** 共 26 張，順序為 A 到 Z

### Requirement: 日文假名頁面涵蓋四種假名類型

The system SHALL 在 `ja/kana.html` 分成**清音、濁音、半濁音、拗音**四個區塊呈現，
每個區塊各自為一張表格，每格顯示平假名、片假名與羅馬拼音。

#### Scenario: 四個區塊皆存在
- **GIVEN** 開啟日文假名頁
- **WHEN** 檢視頁面
- **THEN** 依序出現「清音」「濁音」「半濁音」「拗音」四個區塊標題，
  各區塊的格子數分別為 46、20、5、33

#### Scenario: 清音表結構
- **GIVEN** 清音區塊
- **WHEN** 檢視表格
- **THEN** 依 `あ か さ た な は ま や ら わ ん` 分行呈現，
  空位（如 や行 的 い / え 段）以視覺上的空格呈現而非塞入錯誤假名

#### Scenario: 濁音與半濁音表結構
- **GIVEN** 濁音與半濁音區塊
- **WHEN** 檢視表格
- **THEN** 濁音依 `が ざ だ ば` 四行 × 五段呈現，半濁音為 `ぱ` 一行 × 五段

#### Scenario: 拗音表結構
- **GIVEN** 拗音區塊
- **WHEN** 檢視表格
- **THEN** 依 `き し ち に ひ み り ぎ じ び ぴ` 十一行 × `ya`/`yu`/`yo` 三段呈現

#### Scenario: 區塊可摺疊以免頁面過長
- **GIVEN** 開啟日文假名頁
- **WHEN** 點擊某個區塊的標題
- **THEN** 該區塊的表格收合或展開，其餘區塊不受影響，
  且頁面初始狀態為「清音展開、其餘收合」

#### Scenario: 平假名與片假名可切換顯示
- **GIVEN** 開啟日文假名頁
- **WHEN** 切換「平假名 / 片假名 / 兩者並列」的顯示模式
- **THEN** **四個區塊**的表格內容同時更新為對應模式，
  羅馬拼音在所有模式下都持續顯示

#### Scenario: 濁音與其清音來源的對應提示
- **GIVEN** 濁音區塊中的 `が`
- **WHEN** 檢視該格
- **THEN** 格內顯示其清音來源 `か`，讓使用者看得出濁點的變化規則

### Requirement: 點擊即朗讀

The system SHALL 讓每一張字母／假名卡在被點擊時，以對應語言的語音朗讀該發音單元。

#### Scenario: 點字母卡朗讀
- **GIVEN** 瀏覽器支援 Web Speech API 且有英文語音
- **WHEN** 點擊字母 `B` 的卡片
- **THEN** 以 `lang='en-US'` 朗讀，且卡片出現朗讀中的視覺狀態

#### Scenario: 點假名卡朗讀
- **GIVEN** 瀏覽器支援 Web Speech API 且有日文語音
- **WHEN** 點擊 `あ` 的格子
- **THEN** 以 `lang='ja-JP'` 朗讀該假名

#### Scenario: 拗音以單一音節朗讀
- **GIVEN** 拗音區塊中的 `きゃ`
- **WHEN** 點擊該格
- **THEN** 傳入語音引擎的文字為 `きゃ`（兩字一併），
  而非拆成 `き` 與 `ゃ` 兩次朗讀

#### Scenario: 例字可獨立朗讀
- **GIVEN** 一張字母卡上有例字 `apple`
- **WHEN** 點擊例字旁的朗讀按鈕
- **THEN** 朗讀的是 `apple` 而非字母 `A`，且不觸發卡片本身的朗讀

#### Scenario: 連續點擊會中斷前一段朗讀
- **GIVEN** 正在朗讀字母 `A`
- **WHEN** 立刻點擊字母 `B`
- **THEN** 停止 `A` 的朗讀並改唸 `B`，不會兩段語音重疊

### Requirement: 語音能力偵測與降級

The system SHALL 在頁面載入時偵測 Web Speech API 與目標語言語音的可用性，
並依下列三段降級處理，任何一段都不得讓頁面出錯或卡住。

| 情況 | 行為 |
|---|---|
| API 與目標語言語音皆可用 | 正常朗讀 |
| API 可用但找不到目標語言語音 | 仍嘗試以 `lang` 屬性朗讀，並在頁面頂端顯示一次性提示，說明此裝置可能沒有該語言語音 |
| API 完全不可用 | 隱藏所有朗讀按鈕，顯示說明文字，其餘內容照常可讀 |

#### Scenario: 完全不支援時隱藏朗讀入口
- **GIVEN** `window.speechSynthesis` 為 `undefined`
- **WHEN** 開啟發音頁
- **THEN** 不顯示任何朗讀按鈕，改顯示「此瀏覽器不支援語音朗讀」的說明，
  字母／假名內容仍完整可見

#### Scenario: 缺少日文語音時提示但不擋用
- **GIVEN** `getVoices()` 回傳的清單中沒有任何 `ja` 開頭的語音
- **WHEN** 開啟日文假名頁
- **THEN** 顯示一次性提示說明可能無法發音，朗讀按鈕仍保留可點

#### Scenario: 語音清單非同步載入
- **GIVEN** 首次呼叫 `getVoices()` 回傳空陣列（Chrome 的已知行為）
- **WHEN** `voiceschanged` 事件觸發後
- **THEN** 重新偵測可用語音並更新提示狀態，不會永久停留在「無語音」的判定

### Requirement: 語音封裝為單一模組

The system SHALL 將所有 Web Speech API 的呼叫集中在 `assets/js/ui/speech.js`，
對外只暴露 `speak(text, lang)`、`isSupported()`、`hasVoiceFor(lang)` 三個介面。

#### Scenario: 其他模組不直接碰 API
- **GIVEN** 專案原始碼
- **WHEN** 搜尋 `speechSynthesis` 字串
- **THEN** 只在 `assets/js/ui/speech.js` 中出現

#### Scenario: 朗讀空字串為安全的空動作
- **GIVEN** 語音功能可用
- **WHEN** 呼叫 `speak('', 'en-US')`
- **THEN** 不呼叫底層 API、不拋出例外
