# JLPT 模擬題源設計

> 2026-10-22 · add-jlpt-mock-source · 完整模式
> 設計待核准；分支 feature/add-offline-study-suite，基準 2268bb4。尚未修改生產程式或題庫。

## 1. Overview

### 1.1 Purpose
讓日文學習者用 JLPT 原題型練習：題面、問法、四個選項都照考試形式固定，不由引擎從題庫抽干擾選項。第一批收 N5 文字・語彙・文法形式 260 題。

### 1.2 Scope
新增資料格式與 schema、匯入對照工具、目錄建置、`jlpt` 題源、測驗設定（按問題號篩選）、題面底線呈現、作答後繁中解說。作答事件、續答、問題回報沿用既有機制。每日學習、英文、排序題、閱讀、聽力不在本批（見 [proposal](proposal.md)）。

### 1.3 Related Documents
- [proposal.md](proposal.md)：來源、授權、已決定事項、分批。
- [specs/jlpt-mock.md](specs/jlpt-mock.md)：J01–J16。
- [tasks.md](tasks.md)
- [題庫匯入手冊](../../../assets/js/data/IMPORTING.md)：本批完成時追加「JLPT 模擬題」一節。

## 2. Architecture

### 2.1 System Context
```text
JLPTSuccess 固定 commit 的 JSON（本機下載，不進版控）
        ↓ tools/import-jlptsuccess.mjs（驗 SHA-256 → 產生草稿 / --check 對照）
assets/js/data/ja/jlpt/n5-*.js（人工逐題審過、寫繁中 note，進版控）
        ↓ npm test：schema 擋格式錯誤
        ↓ tools/build-catalog.mjs
assets/js/data/catalog/ja-jlpt.js ＋ meta.js 筆數
        ↓ loadDataset('ja', 'jlpt')
quiz-service（題源、問題號篩選）→ quiz-engine buildJlptQuestion → quiz-view 呈現
        ↓ 作答
既有逐題事件（choice → recognition）、續答、問題回報
```

### 2.2 Components
- **資料檔** `assets/js/data/ja/jlpt/n5-moji.js`、`n5-goi.js`、`n5-bunpou.js`，加上 barrel `ja/jlpt.js`。物件字面值，id 自己連號（`ja-j-0001` 起），一批一個檔，可單獨 revert。
- **共用定義** `assets/js/core/jlpt-mondai.js`：區段（moji／goi／bunpou）與問題號的合法組合、題型名稱、題面形式（底線或括號空格），以及自寫的日文問法和中文對照。
  - 2026-10-22 實作時調整：原設計放在 `assets/js/data/shared/`，改放 `core/`。原因是 `quiz-engine.js` 要用它，而歷程頁會經由 `stats.js` 載入 `quiz-engine.js`；放在 `data/` 底下會讓歷程頁多一個題庫路徑的請求，違反「歷程不為未使用的題庫或索引發出請求」的既有瀏覽器測試。它是考試結構的定義，不是題庫資料。
- **schema** `validateJlpt`：J01、J02 的規則；接進 `schema.js` 的驗證表。
- **匯入對照工具** `tools/import-jlptsuccess.mjs`：讀本機下載的上游檔，先驗每個檔的 SHA-256，不符就拒絕。`--draft` 產生草稿（題面、選項、正解、上游英文解說放註解供撰寫 note 參考）；`--check` 比對已進版控的資料與上游，列出差異、核對修改與排除清單（排除清單在各批次檔，見 TD6）。
- **目錄建置** `tools/build-catalog.mjs`：輸出 `catalog/ja-jlpt.js`，`meta.js` 加 `jlpt`、`jlptByLevel`、`jlptByMondai`，`sourceHash` 一併納入。`tools/build-preload.mjs` 的預載表同步。
- **題源** `quiz-engine.js`：`SOURCE_KIND.jlpt = 'choice'`、`poolOf('jlpt')`、`buildJlptQuestion`。`quiz-service.js`／`quiz-view.js`：題源清單、標籤、筆數、問題號篩選、題面呈現。
- **問題回報** `issue-code.js`：題面快照帶 `underline` 與 `mondai`，題目能被完整重現。

### 2.3 Interactions
1. 設定頁只在日文顯示「JLPT 模擬」；目前級別筆數為 0 時停用，沿用情境題的停用規則。
2. 選了題源才載入 `catalog/ja-jlpt.js`（按需載入，與其他題源一致）。
3. 可勾選問題號（例如只練「問題2 表記」）；預設全部。篩選後不足 1 題不能開始。
4. 出題：依級別與問題號取池、抽題、每題四個選項打亂順序。
5. 作答後顯示正解、繁中 note 與問法的中文對照；作答事件照 choice 走既有入口。

## 3. Technical Decisions

### TD1：獨立題源（使用者 2026-10-22 決定）
- Context：JLPT 題的選項是出題者為該題設計的（同形漢字、相近讀音、文法誤用），與單字題「從同分類抽干擾選項」的邏輯不同。
- Options：併入既有選擇題（篩選無法分題型，統計混在一起）；獨立題源（多一條接線）。
- Decision：獨立 `jlpt` 題源，保留區段與問題號。
- Consequences：題源清單、筆數、預載、按需載入、測試都要加一份；之後第二、三批可以沿用。

### TD2：選項固定在資料裡，引擎只打亂順序
- Context：讀法題的錯誤選項（かくせい／がくせ）必須跟正解只差一個音，隨機抽的干擾選項做不到。
- Decision：資料固定 4 個選項與正解，做法比照 `buildSceneQuestion`；不呼叫 `pickDistractors`，因此也不會有跨級干擾選項。
- Consequences：選項品質完全靠資料與人工審查（TD6）。

### TD3：資料格式與空格（空格為使用者 2026-10-22 決定）
```js
{
  id: 'ja-j-0001',
  level: 1,
  section: 'moji',          // moji | goi | bunpou
  mondai: 1,                // 必須是該區段合法的問題號
  stem: 'あの 人は 学生 です。',
  underline: '学生',         // 底線形式的題型必填，且在 stem 中只出現一次；括號形式為 null
  options: ['かくせ', 'かくせい', 'がくせ', 'がくせい'],
  answer: 'がくせい',
  note: '「学」唸がく、「生」唸せい……',
  sourceRef: 'moji-1.1',     // 上游題號，供 --check 對照
  edited: null,             // 與上游不同時寫原因（繁中），例如修正重複選項
}
```
- 保留上游 N5 的分かち書き空格，`stem` 與選項都不去空格；只去除頭尾空白，全形與半形空格原樣保留。
- 題面依問題號分三種形式（定義在 `jlpt-mondai.js`），上游實際分布已於 2026-10-22 逐題確認：
  | 形式 | 問題號 | 規則 | 上游現況 |
  |---|---|---|---|
  | 底線 | moji 問題1、問題2 | `underline` 必填，在 `stem` 中剛好出現一次；不得有括號空格 | 100 題都剛好一個 `<u>` |
  | 括號空格 | goi 問題3、bunpou 問題1 | `underline` 為 null；`stem` 剛好一個 `（　　）` | 110 題都剛好一個 |
  | 整句言い換え | goi 問題4 | `underline` 為 null、沒有括號空格；整句就是要換說法的對象 | 50 題，都以「A: 」開頭 |
- 底線用獨立欄位 `underline` 標示，不在字串裡放 HTML；畫面用 DOM 節點包 `<u>`，避免 innerHTML 注入。
- 括號空格統一成 `（　　）`（全形括號＋兩個全形空格）。
- 格式正規化由匯入工具統一處理，不算內容修改、不寫 `edited`：拿掉 `<u>` 標籤改填 `underline`、統一括號空格寫法、拿掉言い換え題開頭的「A: 」。
- 正解用 `answer` 字串比對選項，與情境題一致；不另存 index，避免兩份資料不同步。

### TD4：問法自己寫，不搬上游原文
- 上游的問法（「（　）に いちばん いい ものを えらんでください」等）是短的功能性句子；本專案在 `jlpt-mondai.js` 自寫每個問題號的日文問法與中文對照，題面顯示日文、作答後附中文。
- 日文問法用 N5 程度的假名寫法，與題面一致。

### TD5：只寫繁中解說（使用者 2026-10-22 決定）
- `note` 必填、繁中，說明為什麼正解對、主要錯誤選項錯在哪；不放英文或印地文。
- 撰寫方式：參考上游英文解說，由 Claude 撰寫繁中 note，不是逐字翻譯。上游解說中的套話（例如「元の解説：…」）不帶進來。
- 誠實標示：note 由 AI 撰寫；交付時說明哪些題目經使用者看過、哪些沒有，不宣稱母語者審查。

### TD6：品質關卡與修改紀錄
每題進資料前逐題檢查：
1. 正解唯一：其他三個選項放進題面都不成立。
2. 日文自然、符合 N5 程度；題面與選項沒有錯字。
3. 選項彼此不重複（`moji-6.12` 須改掉重複的「画きます」）。
4. note 的說法與題面一致。

與上游不同時（修題面、換選項、改正解）在該題 `edited` 寫原因；整題不收的放進該批次檔的 `excluded` 並寫原因，`--check` 會列出。不默默修改上游內容。

2026-10-22 實作時調整：排除表原寫「放在匯入工具裡」，改為每個批次檔各自匯出 `excluded`，由 `ja/jlpt.js` 匯總成 `jlptExcluded`。原因：三個區段分開撰寫時，共用一份工具內的表會互相衝突；排除原因跟題目放在一起也比較好查。

### TD7：能力與方向對應
- 作答型態是 `choice`，沿用 `review-events.js` 的對應，能力為 `recognition`。
- 題面與選項都是日文，方向記為 `target2zh`（閱讀目標語作答）；不新增能力或方向別名，所以 `learning-identity.js`、`learning-schema.js` 與備份格式不用改。
- sourceId 為 `ja-j-NNNN`，符合 `skillKeyFor` 的字元規則；同一題的作答紀錄不會跟單字題混在一起。

### TD8：不接每日學習
- 每日清單目前只排單字與已核准的練習題型；JLPT 題要不要排程另立需求。本批確認每日清單不會抽到 `ja-j-` 題目（J14）。

## 4. 資料相容、遷移與回復
- 新增題源與資料檔，不改既有題庫、學習紀錄、備份格式。
- 舊版備份還原後沒有 `ja-j-` 紀錄，行為不變；新版作答產生的 `ja-j-` 紀錄在舊版會被當成找不到題目的紀錄，與既有「題目被移除」的處理相同（實作時確認並寫測試，J15）。
- 回復：revert 該批資料檔與接線 commit，重新建置目錄即可；學習紀錄中的 `ja-j-` 項目保留，不刪資料。

## 5. Testing
- schema 單元測試：J01、J02 的合法與違規案例。
- quiz-engine：固定亂數重現打亂結果、正解索引、問題號篩選、級別隔離。
- catalog／preload：筆數一致、按需載入、英文沒有此題源。
- 匯入工具：SHA 不符拒絕、修改與排除清單一致、上游題號一對一。
- 瀏覽器隔離測試：設定、作答、續答、問題回報、底線與空格呈現。
- 規格情境對任務的對照：`openspec/tools/check-task-coverage.mjs` 擴充讀取本變更（J 開頭）。
