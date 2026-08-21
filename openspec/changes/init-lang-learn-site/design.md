# 設計文件：語言學習網站

| 項目 | 值 |
|---|---|
| change-id | `init-lang-learn-site` |
| 建立日期 | 2026-08-20 |
| 分支 | `feature/init-lang-learn-site` |
| 狀態 | **待核准** |

---

## 1. Overview

### 1.1 Purpose

本文件說明「純前端語言學習網站」的架構與關鍵技術取捨。

這個專案表面上很簡單——幾個 HTML 加一點 JS——但有三個地方一旦做錯就會很痛：

1. **資料 schema**。單字、句型、假名三種格式要同時餵給四個模組（瀏覽、發音、文法、測驗）。
   schema 若沒一次定好，日後每加一個功能就要改全部題庫。
2. **可測試性**。純靜態專案很容易寫成「全部塞在 `onclick` 裡」的義大利麵，
   結果 TDD 無從下手。架構必須從一開始就把**純邏輯**與 **DOM 操作**切乾淨。
3. **語序的資料表示法**。使用者要的「主詞 + 時間 + 動詞 + 受詞」拆解，
   本質是**同一組語意區塊在兩種語言中有兩種順序**。這個雙順序要怎麼存，
   決定了文法模組能不能自動算出「哪些區塊被移動了」。

本文件的主要價值在第 3 節的八個技術決策。

### 1.2 Scope

**包含**：站台架構、資料模型、模組切分、測試策略、部署方式。

**不包含**：視覺設計細節（配色數值、字級）、題庫的實際內容（屬實作階段）、
`proposal.md` 第 3.2 節列出的所有「不做」項目。

### 1.3 Related Documents

- [`proposal.md`](./proposal.md)
- [`specs/content-data.md`](./specs/content-data.md) — 資料格式
- [`specs/site-shell.md`](./specs/site-shell.md) — 站台外殼與部署
- [`specs/pronunciation.md`](./specs/pronunciation.md) — 發音
- [`specs/vocabulary.md`](./specs/vocabulary.md) — 單字
- [`specs/grammar.md`](./specs/grammar.md) — 文法
- [`specs/quiz-game.md`](./specs/quiz-game.md) — 測驗
- [`specs/progress.md`](./specs/progress.md) — 檢討與統計

---

## 2. Architecture

### 2.1 System Context

沒有伺服器、沒有 API、沒有資料庫。整個系統就是「瀏覽器 + 靜態檔」。

```
┌──────────────────────────────────────────────────────────────┐
│                        使用者的瀏覽器                          │
│                                                              │
│   ┌────────────────────────────────────────────────────┐     │
│   │  頁面層（12 個 .html，MPA）                          │     │
│   │  index / help / en×5 / ja×5                         │     │
│   └───────────────────────┬────────────────────────────┘     │
│                           │ <script type="module">           │
│   ┌───────────────────────▼────────────────────────────┐     │
│   │  UI 層  assets/js/ui/     （碰 DOM，人工 QA）        │     │
│   │  nav · speech · quiz-view · grammar-view ·         │     │
│   │  vocab-view · kana-view · stats-view               │     │
│   └───────┬───────────────────────────────┬────────────┘     │
│           │                               │                  │
│   ┌───────▼───────────────────┐   ┌───────▼────────────┐     │
│   │  Core 層 assets/js/core/  │   │  瀏覽器 API         │     │
│   │  （純函式，零 DOM，        │   │  speechSynthesis   │     │
│   │    node:test 直接測）      │   │  localStorage      │     │
│   │  quiz-engine · shuffle ·  │   └────────────────────┘     │
│   │  stats · schema · filter  │                              │
│   └───────┬───────────────────┘                              │
│           │ import                                           │
│   ┌───────▼────────────────────────────────────────────┐     │
│   │  資料層 assets/js/data/  （寫死的 export const）      │     │
│   │  en/{words,sentences,alphabet}  ja/{...,kana}       │     │
│   │  shared/{roles,patterns}                           │     │
│   └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
              ▲
              │ 靜態檔（HTTP GET，無動態內容）
       ┌──────┴───────┐
       │ GitHub Pages │
       └──────────────┘
```

**單向依賴，不得違反**：`頁面 → UI → Core → 資料`。
Core 層不得 `import` 任何 UI 模組，也不得出現 `document`、`window`、`localStorage`。
（`stats.js` 是唯一例外處理方式：它不直接碰 `localStorage`，
而是接受一個 storage 介面參數，見 TD-7。）

### 2.2 Components

| 層 | 模組 | 職責 | 可自動測試 |
|---|---|---|---|
| Core | `shuffle.js` | 可注入亂數源的洗牌與抽樣 | ✅ |
| Core | `quiz-engine.js` | 產題、選干擾選項、判定作答、計分 | ✅ |
| Core | `stats.js` | 正確率計算、統計累加、序列化與版本檢查 | ✅ |
| Core | `schema.js` | 資料驗證（`validateWord` / `validateSentence` / `validateKana` / `validateDataset` / `findDuplicateIds`） | ✅ |
| Core | `filter.js` | 單字的分類篩選與關鍵字搜尋、句型的 patternId 篩選 | ✅ |
| Core | `grammar-layout.js` | 由 `chunks` 算出中文排／目標語排的順序，以及哪些區塊語序改變 | ✅ |
| UI | `speech.js` | Web Speech API 唯一出入口，含能力偵測與降級 | ⚠️ 介面層人工 QA |
| UI | `nav.js` | 導覽列注入、目前位置標示、跨語言同功能切換 | ❌ 人工 QA |
| UI | `quiz-view.js` | 測驗畫面：設定 → 作答 → 結果三個狀態 | ❌ 人工 QA |
| UI | `grammar-view.js` | 雙排色塊繪製、語序標記、篩選互動 | ❌ 人工 QA |
| UI | `vocab-view.js` | 單字卡列表、搜尋與篩選互動 | ❌ 人工 QA |
| UI | `kana-view.js` | 字母表／假名四區塊表格、平假名片假名切換、區塊摺疊 | ❌ 人工 QA |
| UI | `stats-view.js` | 語言首頁的統計摘要與清除操作 | ❌ 人工 QA |
| 資料 | `data/**` | 靜態題庫 | ✅ 用 schema.js 驗 |

### 2.3 Component Interactions

一局測驗的資料流：

```
 使用者按「開始」
        │
        ▼
 quiz-view 讀取設定（方向 / 題源 / 題數）
        │
        ▼
 quiz-engine.buildSession({ dataset, direction, source, count, rng })
        │  ← import words.js / sentences.js
        ▼
 回傳 Session 物件 { questions:[{ prompt, options[4], correctIndex, sourceId, direction, note }], ... }
        │
        ▼
 quiz-view 逐題渲染；使用者點選項
        │
        ▼
 quiz-engine.answer(session, questionIndex, optionIndex)  → { correct, correctIndex, correctText }
        │
        ▼
 （最後一題後）quiz-view 呼叫 stats.summarize(session) → { total, correct, accuracy, wrongList }
        │
        ├──► 結果畫面：成績 + 錯題檢討（wrongList）
        │
        └──► stats.applySession(loadStats(storage), lang, source, summary) → saveStats(storage, next)
```

**關鍵設計**：`buildSession` 回傳的 Session 是一個**完整、自足的純資料物件**。
UI 只負責渲染它和把點擊轉成 `answer()` 呼叫。這使整局遊戲的正確性
（題目不重複、選項四個、干擾選項合理、計分正確）全部可以在 `node:test` 裡驗完，
不需要開瀏覽器。

### 2.4 使用者流程

12 個頁面之間的完整動線。`help.html` 刻意放在根層級且從導覽列全域可達，
因為「不知道色塊在幹嘛」這個困惑會發生在任何一頁。

```
                        ┌──────────────┐
                        │  index.html  │  語言選擇 + 教學入口
                        └───┬──────┬───┘
              第一次來？ ────┘      └──── 選語言
                    │                        │
            ┌───────▼────────┐      ┌────────▼────────┐
            │   help.html    │      │  en/  或  ja/   │
            │  使用教學       │◄─────┤  index.html     │  四大入口 + 統計摘要
            │  （導覽列全域   │ 導覽  └──┬───┬───┬───┬─┘
            │    可達）       │         │   │   │   │
            └────────────────┘         │   │   │   └──────────────┐
                                       │   │   │                  │
                    ┌──────────────────┘   │   └──────┐           │
                    │                      │          │           │
          ┌─────────▼─────────┐  ┌─────────▼──────┐ ┌─▼─────────┐ │
          │ alphabet / kana   │  │  vocabulary    │ │  grammar  │ │
          │ 發音              │  │  單字          │ │  文法     │ │
          │ ・點卡朗讀         │  │ ・搜尋/分類篩選 │ │ ・雙排色塊 │ │
          │ ・清濁半濁拗四區塊 │  │ ・單字朗讀      │ │ ・語序標記 │ │
          │ ・平/片假名切換    │  │                │ │ ・句型篩選 │ │
          └───────────────────┘  └────────┬───────┘ └─────┬─────┘ │
                                          │               │       │
                            「開始單字測驗」│               │「用這些│
                             （題源=words）│               │句子測驗│
                                          │               │(源=句) │
                                          └───────┬───────┴───────┘
                                                  │
                                    ┌─────────────▼─────────────┐
                                    │        quiz.html          │
                                    │                           │
                                    │  ① 設定：方向/題源/題數    │
                                    │        │                  │
                                    │        ▼                  │
                                    │  ② 作答：題面+四選項       │
                                    │     ├─ 選了 → 立即判定     │
                                    │     │   對：綠            │
                                    │     │   錯：紅 + 標出正解  │
                                    │     └─ 下一題 ◄─┐         │
                                    │        │        │ 未到最後 │
                                    │        └────────┘         │
                                    │        ▼ 最後一題          │
                                    │  ③ 結果：N/M + 正確率      │
                                    │     ├─ 錯題檢討清單        │
                                    │     │   （題面/你的答案/   │
                                    │     │     正解/語序說明）  │
                                    │     └─ 寫入 localStorage  │
                                    │        │                  │
                                    │   再玩一局 ┘  或 回首頁     │
                                    └───────────────────────────┘
                                                  │
                                                  ▼
                                       語言首頁的統計摘要更新
```

**流程上的三個刻意設計**

1. **兩條捷徑進測驗**：單字頁與文法頁都能直接開一局，且題源已預選好。
   使用者剛看完一批單字，最想做的事就是馬上測，不該再逼他回首頁繞一圈。
2. **測驗中途不可回頭**：作答後該題鎖定，不提供「上一題」。
   這是刻意的——回頭改答案會讓正確率失去意義。
3. **結果畫面是唯一的統計寫入點**：中途離開不計入
   （見 `specs/progress.md`「未完成的局不計入」）。

---

## 3. Technical Decisions

### TD-1：翻譯對照寫死在前端，不接翻譯 API

**Context**
使用者直接問了「翻譯轉換可以直接在前端寫死嗎」。需要決定內容從哪來。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. 靜態寫死在 JS 模組 | 零成本、零延遲、可離線、無金鑰外洩風險、題庫完全可控、可進版控 diff | 題庫更新要 push；規模受限於載入體積 |
| B. 呼叫翻譯 API（Google / DeepL） | 內容無限、不用自己維護題庫 | **純前端會把 API key 寫死在原始碼裡，等同公開**；有費用與額度；離線失效；翻譯品質不穩，選擇題的正解可能有爭議 |
| C. 靜態為主 + API 補充查詢 | 兼具兩者 | 仍有金鑰問題；複雜度加倍換來的價值很低 |

**Decision** — 選 **A**，全部靜態寫死。

**Rationale**
純前端 + GitHub Pages 的組合下，選項 B 的金鑰問題無解：任何寫進前端的 key 都能被讀走。
更重要的是**選擇題需要「唯一正解」**——機器翻譯給出的譯文常常有多種合理說法，
拿它當正解會出現「我答的也對但被判錯」的爛體驗。教學內容本來就該是策展過的，
不是即時生成的。至於體積，1000 筆單字的 JS 約 100KB 未壓縮，
遠低於任何會造成問題的量級。

**Consequences**
- ✅ 網站可完全離線運作，載入後零網路請求
- ✅ 題庫進版控，改了什麼一目了然
- ⚠️ 新增內容必須 push；接受此摩擦，並用 README 把「加一筆單字」的步驟寫清楚
- ⚠️ 題庫成長到數千筆時要改為分檔動態 `import()`；本次以單檔為主，
  但資料層路徑設計已預留分檔空間

---

### TD-2：ES Modules，本機開發用靜態伺服器

**Context**
零建置的靜態站，JS 要怎麼組織？直接影響「能不能用 `node:test` 測」。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. `<script type="module">` + `export`/`import` | 有真正的模組邊界、無全域污染、**Node 可直接 import 同一份檔案來測** | `file://` 直接雙擊開會被 CORS 擋，本機需跑靜態伺服器 |
| B. 傳統 `<script>` + 全域變數 | `file://` 雙擊即可開 | 全域命名空間污染、載入順序脆弱、Node 測試要靠 hack 才能載入 |
| C. 打包器（Vite/esbuild）輸出單檔 | 兩者兼得 | 引入建置步驟，與「零建置」的前提衝突 |

**Decision** — 選 **A**。本機開發用 `npx serve .`（或 VS Code Live Server）。

**Rationale**
決定性因素是**可測試性**。TDD 要求先寫失敗的測試，測試必須能載入待測程式碼。
選項 A 讓 `node --test` 能直接 `import` 生產程式碼，**測試與網站跑的是同一份檔案**，
沒有任何轉譯或複製。選項 B 會逼我們為了測試而複製邏輯或搞 hack，那是最糟的情況。
「本機要跑一個指令」這個代價很小，寫進 README 就好；而且部署到 Pages 之後，
使用者端根本不受影響。

**Consequences**
- ✅ `core/` 的每個函式都能被 `node:test` 直接測，零轉譯
- ✅ 相依關係在 `import` 語句裡一目了然
- ⚠️ 本機不能雙擊 HTML 直接開；README 必須把這點寫在最前面，
  否則日後自己會踩到「打開一片空白，Console 一堆 CORS」
- ⚠️ `package.json` 需 `"type": "module"`

---

### TD-3：多頁式（MPA），不做前端路由

**Context**
11 個頁面要用 11 個 HTML 檔，還是 1 個 HTML + hash router？

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. MPA，11 個 `.html` | 直觀對應網址、可各自加書籤、瀏覽器上一頁天然可用、Pages 直出、每頁只載自己要的 JS | 導覽列等共用結構要在每頁重複，或用 JS 注入 |
| B. SPA + hash router | 共用結構只寫一次、切頁無白屏 | 要自己寫路由與狀態管理；一次載入全部題庫；深連結需 hash；為這種規模引入不必要的複雜度 |

**Decision** — 選 **A**，MPA。共用的導覽列由 `nav.js` 在執行期注入，避免手抄 11 次。

**Rationale**
使用者的需求本來就是「分成英文跟日文的頁面」——這是頁面導向的心智模型，
MPA 直接對應。而且每頁只載自己需要的資料模組（字母頁不需要載句型題庫），
在手機上載入更快。SPA 的好處（切頁不白屏）在這種以閱讀為主的站台上幾乎沒有價值。

**Consequences**
- ✅ 網址即狀態，`en/grammar.html` 可以直接分享或加書籤
- ✅ 每頁 JS 體積最小
- ⚠️ 每個 HTML 都有一段樣板；透過 `nav.js` 注入導覽列把重複壓到最低
- ⚠️ 測驗進行中重新整理會回到設定畫面——這已寫進
  `specs/quiz-game.md` 的「中途離開不留下半局狀態」，是刻意行為不是缺陷

---

### TD-4：Web Speech API 三段降級

**Context**
`speechSynthesis` 的可用性在各平台差異很大：
桌機 Chrome / Edge / Safari 通常有英文語音；
**日文語音在 Windows 上需安裝語言包，在部分 Android 裝置缺失**。
另外 Chrome 的 `getVoices()` 首次呼叫常回傳空陣列，要等 `voiceschanged` 事件。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. 直接呼叫，不偵測 | 實作最簡單 | 沒語音時完全靜音且無任何提示，使用者以為網站壞了 |
| B. 三段降級（皆可用／無語音但仍嘗試／API 不存在） | 每種情況都有明確回饋，功能不會整個掛掉 | 需處理非同步的語音清單載入 |
| C. 內建 fallback 音檔 | 覆蓋率最高 | 要準備上百個音檔，體積與製作成本都高，與「小型示範題庫」的定位不符 |

**Decision** — 選 **B**。三段行為定義於 `specs/pronunciation.md`。

**Rationale**
最糟的使用者體驗不是「沒有聲音」，而是「沒有聲音而且不知道為什麼」。
選項 B 用很小的成本（一個能力偵測 + 一則提示）消除了這個困惑。
選項 C 的成本與本次「小型示範題庫」的定位完全不成比例；
若日後日文發音真的成為痛點，可以只為 46 個假名補音檔，那是獨立的後續需求。

**Consequences**
- ✅ 在無日文語音的裝置上，網站其餘功能完全不受影響
- ✅ 所有 API 呼叫集中在 `speech.js`，日後要換成音檔方案只需改一個檔
- ⚠️ 需處理 `voiceschanged` 的非同步時序，並在事件觸發後重新評估提示狀態
- ⚠️ 日文單字朗讀傳 `reading`（假名）而非 `target`（漢字），避免語音引擎誤讀

---

### TD-5：只對 Core 層做自動化測試，UI 層走人工 QA

**Context**
TDD 是本流程的硬性要求，但純靜態專案不該為了測 DOM 而引入
jsdom / Playwright / Vitest 一整套工具鏈——那等於推翻「零建置」的前提。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. Node 內建 `node:test`，只測 `core/` 純函式 | 零依賴、跑得快、與生產碼同一份檔案；把最容易出錯的邏輯（抽題、計分、驗證）全覆蓋 | DOM 行為無自動化保護 |
| B. 加 jsdom 測 UI | 覆蓋率高 | 引入依賴；jsdom 不支援 `speechSynthesis`，仍需大量 mock；測出來的東西與真實瀏覽器有落差 |
| C. Playwright 端對端 | 最貼近真實 | 依賴最重、跑最慢；對這種規模的專案是殺雞用牛刀 |

**Decision** — 選 **A**。並以「架構強制可測」補足：
把所有值得測的邏輯都推進 `core/`，UI 層只剩「讀資料 → 塞 DOM → 綁事件」的薄殼。

**Rationale**
測試的價值來自它保護了什麼。這個專案真正會出錯的地方是
**抽題重複、選項只有 3 個、干擾選項含正解、正確率算成 NaN、統計覆蓋錯誤、題庫資料打錯字**
——這些全部是純函式邏輯，選項 A 百分之百覆蓋得到。
反觀「按鈕點下去有沒有變色」，用瀏覽器看三秒就知道，花在 jsdom 上的工程時間不划算。
關鍵在於**架構要逼自己把邏輯放對地方**：若 UI 層開始出現 `if` 分支與計算，
就是訊號，該把它移進 `core/`。

**Consequences**
- ✅ `npm test` 零安裝即可跑（Node ≥ 18 內建 `node:test`）
- ✅ 迫使 UI 與邏輯徹底分離，這本身就是好架構
- ⚠️ DOM 迴歸只能靠人工 QA；Phase 5 需要一份明確的手動 QA 檢查表
- ⚠️ `core/` 內不得出現任何 DOM API，需在 review 時把關

---

### TD-6：干擾選項採「同類別 → 同難度 → 全域」三段遞補

**Context**
四選一測驗的品質幾乎全由干擾選項決定。
若干擾選項隨機抽，正解常常一眼可辨（例如問「蘋果」，選項是 apple / run / beautiful / quickly），
題目就失去訓練價值。反過來，干擾選項若與正解語意相同，題目會變成無解。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. 全域隨機抽 3 個 | 實作最簡單 | 題目太好猜，訓練價值低 |
| B. 同 `category` 優先，不足時依 `level` 遞補，再不足時全域 | 干擾選項語意相近，題目有鑑別度；小題庫也不會失敗 | 需處理多段遞補與去重 |
| C. 依字串相似度（編輯距離）挑最像的 | 對拼字訓練最有效 | 對「中文→外語」方向沒意義；容易挑出語意無關但拼法像的怪選項 |

**Decision** — 選 **B**，並附加兩條硬性約束：
1. 干擾選項的顯示文字不得與正解顯示文字相同（避免同義詞造成雙正解）
2. 三個干擾選項彼此文字不得重複

**Rationale**
選項 B 直接對應學習目標——把容易混淆的同類詞放在一起，才是真的在練。
`category` 這個欄位本來就要有（單字頁的篩選功能需要它），所以這個策略是零額外資料成本。
三段遞補則保證了小題庫也不會產生瑕疵題：**寧可干擾選項跨類別，也不能出現選項不足四個的題目**。
選項 C 留給日後若要做「拼字模式」時再考慮。

**Consequences**
- ✅ 題目有鑑別度，且策略完全由資料驅動，不需硬編任何規則
- ✅ 題庫總筆數 < 4 時明確拋錯，不會靜默產生壞題
- ⚠️ `category` 成為題庫的必填欄位，且分類的粒度會直接影響題目難度
  ——分太細會退化成全域隨機，分太粗則題目太難
- ⚠️ 需要一個測試專門驗證「同義詞不會同時出現在選項中」

---

### TD-7：統計以「語言 × 題源」為粒度，單一 key、帶版本號、storage 可注入

**Context**
localStorage 是唯一的持久化手段，但它有三個現實問題：
無痕模式可能拋例外、容量可能滿、**格式一旦寫出去就很難改**。
另外 `core/stats.js` 要能被 `node:test` 測，就不能直接碰 `localStorage`。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. 多個 key（每語言每模式一個） | 讀寫粒度細 | key 散落難清理；跨 key 一致性差 |
| B. 單一 key 存整包 JSON，含 `schemaVersion` | 好清理、好備份、版本升級策略單純 | 每次寫入是整包覆寫（此規模下無感） |
| C. 存每一局的完整明細 | 未來可做趨勢圖 | 資料無上限成長；且本次明確不做錯題本與趨勢圖 |

**Decision** — 選 **B**。
key 為 `lang-learn.stats.v1`，結構為
`{ schemaVersion:1, byScope:{ "en:words":{answered,correct,sessions}, ... } }`。
`core/stats.js` **不直接引用 `localStorage`**，而是接受一個
`{ getItem, setItem, removeItem }` 介面；UI 層傳入真的 `localStorage`，
測試傳入記憶體假物件。

**Rationale**
版本號是這個決策裡最重要的部分。今天存 `{answered, correct}`，
半年後想加「最佳連續答對數」時，舊資料一定會撞上。
**先付這個小成本（一個欄位 + 一個檢查），未來就永遠有一條乾淨的退路：
版本不符就重置。** 統計資料本來就不是不可再生的重要資產，重置是完全可接受的。
storage 注入則同時解決了「可測試」與「無痕模式降級」兩個問題——
只要傳入一個永遠拋例外的假 storage，就能測出降級路徑。

**Consequences**
- ✅ `stats.js` 全部邏輯可自動化測試，包含 storage 失敗的降級路徑
- ✅ 清除統計 = 刪一個 key
- ⚠️ 未來 schema 變更會丟失既有統計；已判定可接受，並會在 README 註明
- ⚠️ 不保留逐局明細，所以做不出趨勢圖；這符合本次「不做」清單

---

### TD-8：語序以「chunks 陣列順序 = 目標語序，`zhIndex` = 中文語序」表示

**Context**
這是文法模組的核心資料設計。使用者要的是
「我今天去打羽毛球 → 主詞 + 日期 + 動詞」這種拆解，
而其真正的教學價值在於**呈現中外語序的差異**
（英文時間副詞常在句尾、日文動詞一定在句尾）。
所以資料必須同時表達「哪些語意區塊」與「兩種語言各自的排列順序」。

**Options Considered**

| 選項 | 優點 | 缺點 |
|---|---|---|
| A. 只存 pattern 字串（`"主詞+時間+動詞+受詞"`） | 資料最省 | 只是一行標籤，程式無法算出對應關係，也畫不出色塊 |
| B. 兩個獨立陣列 `zhChunks[]` / `targetChunks[]` | 兩種語序都直觀 | 兩邊的區塊要靠額外欄位配對，**資料容易寫到不同步**（一邊 4 塊一邊 5 塊也不會被發現） |
| C. 單一 `chunks[]`，陣列順序即目標語序，每個 chunk 帶 `zhIndex` 表示中文位置 | 單一真實來源、雙語序可完整推導、可自動驗證「串接回原句」、可自動算出哪些區塊移動了 | 手寫資料時要自己填 `zhIndex`，稍微費神 |

**Decision** — 選 **C**。

**Rationale**
選項 C 最關鍵的性質是**可驗證**：因為每個區塊只存在一份，
程式可以檢查「依陣列順序串接 `target` 是否等於完整句」以及
「依 `zhIndex` 排序串接 `zh` 是否等於中文句」。
這兩條驗證讓題庫資料幾乎不可能默默寫錯——這對一個會長期手動增補的題庫來說至關重要。
選項 B 沒有這種自我一致性，兩個陣列不同步時只能靠肉眼發現。
而「哪些區塊語序改變了」（`specs/grammar.md` 要求的視覺標記）在選項 C 下
只是比較 `chunk` 的陣列索引與 `zhIndex` 的排名，一行程式即可算出。

日文的助詞（`は`、`を`）沒有中文對應，處理方式是給它 `role: 'particle'`、`zh: ''`。
**助詞仍要佔一個 `zhIndex` 號碼**（否則連續性規則要開特例），但由於中文語序中沒有它的位置，
一律**取尾端號碼**：實詞依中文語序拿 `0 … k-1`，助詞接在後面拿 `k … n-1`。
因為助詞的 `zh` 是空字串，依 `zhIndex` 排序串接時不貢獻任何字，規則二自然成立。

渲染時**中文排直接略過助詞**，只畫有中文對應的區塊；助詞只出現在目標語言排，
以較窄的樣式呈現。這比在中文排塞「（無對應）」佔位更誠實——
助詞是日文特有的語法裝置，中文排硬擠一格反而讓人以為中文也有對應成分。

**Consequences**
- ✅ 題庫資料可被自動驗證，寫錯會在測試階段就被抓到
- ✅ 語序差異標記可由資料自動推導，不需人工標註
- ✅ 同一份 `chunks` 未來可直接支援「語序排列遊戲」（本次不做，但架構已支援）
- ⚠️ 手寫句型資料時要填 `zhIndex`，較費神；README 需附一個填寫範例
- ⚠️ 中文與目標語言若無法一對一切塊（意譯句），此結構不適用
  ——題庫應避免收錄這類句子，或拆成較粗的區塊

---

## 4. Data Design

### 4.1 資料模型總覽

```
shared/roles.js      ROLES        角色 → { label, color }
shared/patterns.js   patterns[]   { id, name, roles[], desc }
                                        ▲
                                        │ patternId
<lang>/words.js      words[]       ─────┼──── 測驗題源（單字題）
<lang>/sentences.js  sentences[]  ──────┘      測驗題源（句子題）＋文法頁
<lang>/alphabet.js   letters[]                 英文發音頁
<lang>/kana.js       kana[]                    日文發音頁
```

### 4.2 範例資料（決定性的三筆）

```js
// words.js — 最單純的結構
{ id:'en-w-001', zh:'羽毛球', target:'badminton',
  reading:null, romaji:null, pos:'noun', category:'sport', level:1 }

// sentences.js（英文）— 時間區塊從中文的第 2 位移到英文的第 4 位
{ id:'en-s-001',
  zh:'我今天去打羽毛球', target:'I play badminton today', reading:null,
  patternId:'en-p-svo-time',
  chunks:[
    { role:'subject', zh:'我',     target:'I',         zhIndex:0 },
    { role:'verb',    zh:'去打',   target:'play',      zhIndex:2 },
    { role:'object',  zh:'羽毛球', target:'badminton', zhIndex:3 },
    { role:'time',    zh:'今天',   target:'today',     zhIndex:1 },
  ],
  note:'英文的時間副詞多半放句尾，中文放在主詞後面。',
  category:'daily', level:1 }

// sentences.js（日文）— 動詞在句尾，助詞獨立成塊
{ id:'ja-s-001',
  zh:'我今天去打羽毛球', target:'私は今日バドミントンをします',
  reading:'わたしはきょうバドミントンをします',
  patternId:'ja-p-sotv',
  chunks:[
    { role:'subject',  zh:'我',     target:'私',           zhIndex:0 },
    { role:'particle', zh:'',       target:'は',           zhIndex:4 },
    { role:'time',     zh:'今天',   target:'今日',         zhIndex:1 },
    { role:'object',   zh:'羽毛球', target:'バドミントン', zhIndex:3 },
    { role:'particle', zh:'',       target:'を',           zhIndex:5 },
    { role:'verb',     zh:'去打',   target:'します',       zhIndex:2 },
  ],
  note:'日文動詞永遠放句尾，助詞「は」標示主題、「を」標示受詞。',
  category:'daily', level:1 }
```

> **助詞的 `zhIndex` 取尾端號碼**（此例為 4 與 5），實詞則依中文語序拿 `0…3`。
> 依 `zhIndex` 排序串接得到「我 / 今天 / 去打 / 羽毛球 / '' / ''」＝ `我今天去打羽毛球`，
> 規則二成立。助詞照樣佔號碼，所以連續性規則也不必開特例。
>
> 渲染時**中文排直接略過助詞**（只畫 zhIndex 0–3 這四塊），
> 助詞只出現在日文排。

### 4.3 Session 物件（執行期，不持久化）

```js
{
  lang:'en', source:'words', direction:'zh2target',
  questions:[{
    sourceId:'en-w-001', direction:'zh2target',
    prompt:'羽毛球', promptLang:'zh',
    options:[{ text:'badminton', isCorrect:true }, ...],   // 長度恆為 4
    optionLang:'en',
    note:null,                                              // 句子題才有
    answeredIndex:null,                                     // 尚未作答
  }],
  cursor:0,
}
```

### 4.4 localStorage 結構

```js
// key: 'lang-learn.stats.v1'
{ schemaVersion:1,
  byScope:{
    'en:words':     { answered:40, correct:33, sessions:4 },
    'en:sentences': { answered:20, correct:14, sessions:1 },
    'ja:words':     { answered:10, correct:6,  sessions:1 },
  } }
```

---

## 6. Implementation Approach

### 6.1 Technology Stack

| 項目 | 選擇 | 版本／備註 |
|---|---|---|
| 標記 | HTML5 | 無樣板引擎 |
| 樣式 | 原生 CSS + CSS 變數 | 無 Tailwind、無前處理器 |
| 腳本 | 原生 JavaScript（ES2022 模組） | 無框架、無打包器 |
| 發音 | Web Speech API | 瀏覽器內建 |
| 持久化 | localStorage | 單一 key |
| 測試 | `node:test` + `node:assert/strict` | Node ≥ 18 內建，零安裝 |
| 本機開發 | `npx serve .` | 或任何靜態伺服器 |
| 部署 | GitHub Pages（分支直出） | 需 `.nojekyll`，無 CI |
| **執行期依賴** | **無** | `package.json` 的 `dependencies` 保持為空 |

### 6.2 Code Organization

```
lang-learn/
├── .nojekyll
├── README.md                    # 部署、本機開發、如何加題
├── package.json                 # { "type":"module", "scripts":{ "test":"node --test tests/" } }
├── index.html                   # 語言選擇
├── help.html                    # 使用教學（不分語言）
├── en/  index · alphabet · vocabulary · grammar · quiz  (.html × 5)
├── ja/  index · kana      · vocabulary · grammar · quiz  (.html × 5)
├── assets/
│   ├── css/theme.css
│   └── js/
│       ├── core/    shuffle · quiz-engine · stats · schema · filter · grammar-layout
│       ├── ui/      speech · nav · quiz-view · grammar-view · vocab-view · kana-view · stats-view
│       └── data/
│           ├── shared/  roles · patterns
│           ├── en/      words · sentences · alphabet
│           └── ja/      words · sentences · kana
├── tests/           shuffle · quiz-engine · stats · schema · filter · grammar-layout · dataset
└── openspec/        changes/ · archive/
```

**命名與風格約定**
- 檔名 kebab-case，函式 camelCase，常數 UPPER_SNAKE
- Core 層一律具名匯出（named export），不用 default export
- 註解使用繁體中文，區塊註解一律三行式（頭尾分行），遵循全域規範

---

## 9. Testing Strategy

### 9.1 分層

| 層 | 方式 | 涵蓋 |
|---|---|---|
| Core 純函式 | `node --test`（RED → GREEN → REFACTOR） | 抽題、干擾選項、計分、統計、驗證、篩選、語序推導 |
| 題庫資料 | `tests/dataset.test.js` 對真實題庫跑 `validateDataset` + `findDuplicateIds` | 全部題庫 |
| UI / DOM | 人工 QA 檢查表（Phase 5 產出） | 渲染、互動、RWD、Console |
| 語音 | 人工 QA（含「關閉語音包」的降級情境） | `speech.js` |

### 9.2 Scenario → 測試對照（節錄，完整對照在 `tasks.md`）

| Spec | Scenario | 測試檔 | 自動化 |
|---|---|---|---|
| content-data | 日文單字必須帶讀音 | `schema.test.js` | ✅ |
| content-data | zhIndex 必須是完整連續序列 | `schema.test.js` | ✅ |
| content-data | chunk 串接與完整句一致性檢查 | `schema.test.js` | ✅ |
| content-data | 正式題庫零錯誤 | `dataset.test.js` | ✅ |
| content-data | 四種類型的數量正確（46/20/5/33） | `dataset.test.js` | ✅ |
| content-data | 拗音為兩字且限三段 | `schema.test.js` | ✅ |
| content-data | 羅馬拼音不重複 | `dataset.test.js` | ✅ |
| pronunciation | 拗音以單一音節朗讀 | 人工 QA | ❌ |
| site-shell | 教學頁涵蓋四個模組 | 人工 QA | ❌ |
| quiz-game | 選項文字彼此相異 | `quiz-engine.test.js` | ✅ |
| quiz-game | 干擾選項不得與正解同義重複 | `quiz-engine.test.js` | ✅ |
| quiz-game | 同類別不足時往外遞補 | `quiz-engine.test.js` | ✅ |
| quiz-game | 題庫過小時明確報錯 | `quiz-engine.test.js` | ✅ |
| quiz-game | 題數超過題庫時取全部 | `quiz-engine.test.js` | ✅ |
| quiz-game | 固定亂數源產生穩定結果 | `shuffle.test.js` | ✅ |
| quiz-game | 同一題不可重複作答 | `quiz-engine.test.js` | ✅ |
| quiz-game | 答錯後 UI 同時標示錯誤與正解 | 人工 QA | ❌ |
| progress | 零題不得產生 NaN | `stats.test.js` | ✅ |
| progress | 舊版本被丟棄 | `stats.test.js` | ✅ |
| progress | 讀取失敗時降級 | `stats.test.js`（注入會拋例外的假 storage） | ✅ |
| grammar | 標示語序改變的區塊 | `grammar-layout.test.js` | ✅ |
| grammar | 日文助詞被標為附加成分 | `grammar-layout.test.js` | ✅ |
| vocabulary | 以羅馬拼音搜尋日文 | `filter.test.js` | ✅ |
| vocabulary | 搜尋不分大小寫 | `filter.test.js` | ✅ |
| site-shell | 無絕對根路徑引用 | `tests/paths.test.js`（掃 HTML 原始碼字串） | ✅ |
| site-shell | 手機寬度不橫向溢出 | 人工 QA | ❌ |

### 9.3 突變檢查不適用

本次為**全新開發**，所有測試都會先於實作寫出並確實看到 RED，
因此不套用 spec-powers 針對「反向工程既有程式碼」的突變檢查替代流程。
若後續有為既有程式碼補測試的任務，再另行套用。

### 9.4 測試指令

```bash
npm test
```

（等同 `node --test tests/`，零安裝、零設定。）

---

## 10. Deployment

1. 在 GitHub 建立 repo，push 本專案的預設分支
2. Settings → Pages → Source 選 `Deploy from a branch`，
   分支選預設分支、資料夾選 `/ (root)`
3. 等待 Pages 發布，網址為 `https://<user>.github.io/<repo>/`
4. 因全站使用相對路徑，repo 名稱可任意，不需調整任何設定
5. **無建置步驟、無 GitHub Actions、無 secrets**

**回退方式**：Pages 直接吃分支內容，回退等同 `git revert` 後 push。

---

## 12. Open Questions

- [ ] GitHub repo 名稱尚未決定 —— 已用相對路徑使其不影響實作，可在最後再定
- [x] ~~日文題庫是否要涵蓋濁音／半濁音／拗音？~~
      **已確認：全部涵蓋。** 清音 46 + 濁音 20 + 半濁音 5 + 拗音 33 = 104 筆。
      拗音不收現代日語罕用的 `ぢゃ`/`ぢゅ`/`ぢょ`，故為 33 而非 36。
      假名頁改為四區塊分表呈現（清音展開、其餘預設收合），見 `specs/pronunciation.md`
- [ ] 單字的 `category` 分類粒度要多細？影響 TD-6 的題目難度，
      實作時先訂 8-10 類，Phase 5 依實際出題手感調整

---

## 13. Change Log

| 日期 | 變更 |
|---|---|
| 2026-08-20 | 初版 |
| 2026-08-21 | 日文假名擴充為清音／濁音／半濁音／拗音四類共 104 筆；新增 `help.html` 使用教學頁；補 §2.4 使用者流程圖 |
| 2026-08-21 | **修正 TD-8 與 §4.2 的日文範例錯誤**。原範例的 `zhIndex` 依序給 0-5，排序串接會得到「我今天羽毛球去打」，違反自己訂的規則二。正確做法為「實詞依中文語序拿 0…k-1，助詞取尾端號碼」。連帶修正 `specs/grammar.md`：中文排改為**直接略過助詞**，不再顯示「（無對應）」佔位格 |
