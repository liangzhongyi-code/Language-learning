# 任務清單：語言學習網站

| 項目 | 值 |
|---|---|
| change-id | `init-lang-learn-site` |
| 依據 | `design.md`（**已核准 2026-08-21**）、`specs/` × 7 |
| 任務數 | **31** |
| 估時合計 | 約 16.5 小時（2-3 個工作天） |
| 狀態 | **待核准** |

---

## 1. 執行規則

### 1.1 TDD 紀律（不可打折）

每個標記 🔴 的任務都必須跑完整的 RED-GREEN-REFACTOR：

1. **RED** — 先寫測試，執行，**必須親眼看到它失敗**。沒看到失敗就不算完成這一步。
2. **GREEN** — 寫剛好能過的最小實作，執行，必須通過。
3. **REFACTOR** — 整理品質，保持綠燈。

先寫實作再補測試 → 停下、刪掉實作、退回 RED 重來。

本次為全新開發，所有測試都能真的看到 RED，
因此**不套用**突變檢查（那是反向工程既有程式碼時的替代方案）。

標記 👁 的任務沒有自動化測試，改以第 6 節的人工 QA 檢查表驗收。

### 1.2 commit 紀律

**任何任務都不執行 `git commit` / `git push`。**
每完成一個任務，把 commit 訊息寫成文字交付：

```
feat: <任務 ID> <一句話描述>
```

### 1.3 通用驗證指令

```bash
npm test
```

（等同 `node --test tests/`。單獨跑一支：`node --test tests/shuffle.test.js`）

### 1.4 執行順序

四個群組之間有先後：**T0 → T1 → T2 → T3 → T4 → T5**。
群組內部除非另有標註「依賴」，否則可任意順序或平行。

```
T0 骨架
  └─► T1 Core 純函式（🔴 TDD，11 項）────┐
        └─► T2 題庫資料（8 項）──────────┤
              └─► T3 外殼與樣式（4 項）──┤
                    └─► T4 UI 模組（6 項）
                          └─► T5 收尾（2 項）
```

---

## 2. T0 · 專案骨架

**T0.1 · 建立目錄結構與零依賴的測試設定** 🔴
`package.json`、`.nojekyll`、`.gitignore`、全部空目錄 ｜ 依賴：無 ｜ 15 分
- 對應 Scenario：site-shell「存在 .nojekyll」「package.json 無執行期依賴」
- 驗證：`npm test` 能執行（此時零測試也算通過）；`node -e "import('./assets/js/core/shuffle.js')"` 路徑可解析
- 完成條件：`package.json` 含 `"type":"module"` 與 `"scripts":{"test":"node --test tests/"}`，
  `dependencies` 為空；`tests/smoke.test.js` 一個 `assert.ok(true)` 綠燈
  （這支在 T1.1 完成後刪除）

---

## 3. T1 · Core 純函式（全部 🔴 TDD）

> 這一群是整個專案的正確性核心。**寫完 T1 就等於整個遊戲的邏輯已經驗證完畢**，
> 後面的 UI 只是把它畫出來。

**T1.1 · shuffle：可注入亂數源的洗牌與抽樣**
`core/shuffle.js`、`tests/shuffle.test.js` ｜ 依賴：T0.1 ｜ 20 分
- Scenario：洗牌不改變原陣列 / 洗牌不遺失也不新增元素 / 固定亂數源產生穩定結果
- 驗證：`node --test tests/shuffle.test.js`
- 完成條件：3 測全綠；`shuffle(arr, rng)` 的 `rng` 預設為 `Math.random`

**T1.2 · schema：validateWord**
`core/schema.js`、`tests/schema.test.js` ｜ 依賴：T0.1 ｜ 20 分
- Scenario：日文單字必須帶讀音 / 英文單字不需要讀音欄位內容 / 讀取英文單字題庫（格式面）
- 驗證：`node --test tests/schema.test.js`
- 完成條件：回傳結構為 `{ ok, errors:[{ id, field, message }] }`；
  `pos` 與 `level` 的列舉值都有各自的失敗測試

**T1.3 · schema：validateSentence（本群最容易寫錯的一支）**
`core/schema.js`、`tests/schema.test.js` ｜ 依賴：T1.2 ｜ 35 分
- Scenario：陣列順序表示目標語序、zhIndex 表示中文語序 / chunk 串接與完整句一致性檢查 /
  zhIndex 必須是完整連續序列 / 未知角色被擋下 / 日文句子的助詞被獨立標記
- 驗證：`node --test tests/schema.test.js`
- 完成條件：串接比對忽略空白後仍需完全相等；`zhIndex` 為 `[0,1,3]` 這種缺號必須被擋下；
  `role` 不在 `ROLES` 表中必須指出實際的錯誤字串

**T1.4 · schema：validateKana / validateDataset / findDuplicateIds**
`core/schema.js`、`tests/schema.test.js` ｜ 依賴：T1.3 ｜ 30 分
- Scenario：拗音為兩字且限三段 / 每筆假名都有例字 / 偵測重複 id /
  回報所有錯誤（不得遇到第一個就中止）
- 驗證：`node --test tests/schema.test.js`
- 完成條件：餵入 3 筆不同錯誤的題庫時，`validateDataset` 回傳長度為 3 的錯誤陣列，
  每個錯誤都帶 `id` 與欄位名

**T1.5 · stats：calcAccuracy 與 summarize**
`core/stats.js`、`tests/stats.test.js` ｜ 依賴：T0.1 ｜ 20 分
- Scenario：正確率四捨五入到整數 / **零題不得產生 NaN** / 錯題清單內容
- 驗證：`node --test tests/stats.test.js`
- 完成條件：`calcAccuracy(0,0) === 0`（不得為 `NaN` 或 `Infinity`）；
  `summarize()` 回傳 `{ total, correct, accuracy, wrongList }`，
  `wrongList` 每筆含題面、使用者答案、正解、`note`

**T1.6 · stats：loadStats / saveStats / applySession（storage 可注入）**
`core/stats.js`、`tests/stats.test.js` ｜ 依賴：T1.5 ｜ 30 分
- Scenario：一局結束後累加 / 不同語言的統計互不干擾 / 損毀的資料被安全重置 /
  舊版本被丟棄 / 正常資料被正確讀回 / 讀取失敗時降級
- 驗證：`node --test tests/stats.test.js`
- 完成條件：測試以三種假 storage 覆蓋——正常記憶體版、`getItem` 拋例外版、
  `setItem` 拋例外版；三種情況都不得拋出例外到呼叫端

**T1.7 · filter：單字搜尋與分類篩選、句型篩選**
`core/filter.js`、`tests/filter.test.js` ｜ 依賴：T0.1 ｜ 25 分
- Scenario：以中文搜尋 / 以羅馬拼音搜尋日文 / 搜尋不分大小寫 /
  搜尋與分類同時生效 / 分類清單由資料推導 / 句型清單顯示例句數
- 驗證：`node --test tests/filter.test.js`
- 完成條件：搜尋同時比對 `zh` / `target` / `reading` / `romaji` 四個欄位；
  `listCategories()` 只回傳資料中實際存在的分類

**T1.8 · grammar-layout：雙語序推導與語序差異標記**
`core/grammar-layout.js`、`tests/grammar-layout.test.js` ｜ 依賴：T1.3 ｜ 30 分
- Scenario：標示語序改變的區塊 / 語序完全相同時不加雜訊 / 日文助詞被標為附加成分
- 驗證：`node --test tests/grammar-layout.test.js`
- 完成條件：回傳 `{ zhRow:[...], targetRow:[...] }`，
  每個區塊帶 `moved:boolean`；中外語序全同的句子所有 `moved` 皆為 `false`；
  `particle` 區塊在 `zhRow` 標為 `placeholder:true`

**T1.9 · quiz-engine：干擾選項的三段遞補**
`core/quiz-engine.js`、`tests/quiz-engine.test.js` ｜ 依賴：T1.1、T1.2 ｜ 45 分
- Scenario：同類別足夠時優先同類別 / 同類別不足時往外遞補 /
  選項文字彼此相異 / **干擾選項不得與正解同義重複** / 題庫過小時明確報錯
- 驗證：`node --test tests/quiz-engine.test.js`
- 完成條件：題庫僅 3 筆時**拋出可辨識的錯誤**，絕不回傳選項少於 4 個的題目；
  題庫中存在兩筆 `target` 相同的資料時，另一筆不會成為干擾選項

**T1.10 · quiz-engine：buildSession**
`core/quiz-engine.js`、`tests/quiz-engine.test.js` ｜ 依賴：T1.9 ｜ 45 分
- Scenario：中翻外的題面與選項語言 / 外翻中的題面與選項語言 / 混合方向逐題決定 /
  單字題源只出單字 / 混合題源同時包含兩者 / 題目來源不重複 / 題數超過題庫時取全部 /
  每題四個選項且僅一個正解
- 驗證：`node --test tests/quiz-engine.test.js`
- 完成條件：60 筆題庫抽 20 題時，來源 id 去重後仍為 20；
  12 筆題庫要 20 題時回傳 12 題且不報錯

**T1.11 · quiz-engine：answer 判定與重複作答保護**
`core/quiz-engine.js`、`tests/quiz-engine.test.js` ｜ 依賴：T1.10 ｜ 20 分
- Scenario：答對的判定 / 答錯時回傳正解 / 同一題不可重複作答
- 驗證：`node --test tests/quiz-engine.test.js`
- 完成條件：對已作答的題目再次提交時，回傳已作答狀態且分數不變

> **T1 完成檢查點**：`npm test` 應有 40+ 個測試全綠。
> 此時遊戲邏輯已完全驗證，尚未寫任何一行 DOM 程式碼。

---

## 4. T2 · 題庫資料

> 資料量大但單調。這一群最適合平行處理（見第 7 節）。
> 每一項的完成條件都是「通過 T1 寫好的驗證函式」——**資料寫錯會被測試抓到**。

**T2.1 · shared：ROLES 角色表與 patterns 句型表** 🔴
`data/shared/roles.js`、`data/shared/patterns.js`、`tests/schema.test.js` ｜ 依賴：T1.3 ｜ 20 分
- Scenario：每個角色都有標籤與顏色
- 驗證：`node --test tests/schema.test.js`
- 完成條件：`ROLES` 涵蓋 subject / verb / object / time / place / adjective /
  negation / particle / other 九種，每種都有非空 `label` 與 `color`；
  英日各定義至少 4 種句型

**T2.2 · 英文單字題庫（≥ 60 筆）**
`data/en/words.js` ｜ 依賴：T2.1 ｜ 30 分
- Scenario：讀取英文單字題庫 / 英文題庫規模
- 驗證：`node --test tests/dataset.test.js`（T2.8 建立後）
- 完成條件：≥ 60 筆，分佈於 8-10 個 `category`，
  **每個 category 至少 4 筆**（否則 T1.9 的同類別干擾選項會頻繁退化為跨類別）

**T2.3 · 英文句型題庫（≥ 20 筆）**
`data/en/sentences.js` ｜ 依賴：T2.1 ｜ 45 分
- Scenario：陣列順序表示目標語序、zhIndex 表示中文語序 / 依句型篩選
- 驗證：`node --test tests/dataset.test.js`
- 完成條件：≥ 20 筆、涵蓋 ≥ 4 種 `patternId`；
  **至少 8 筆的中外語序不同**（否則語序標記功能沒東西可展示）；
  每筆都有非空 `note`

**T2.4 · 英文字母表（26 筆）**
`data/en/alphabet.js` ｜ 依賴：T2.1 ｜ 20 分
- Scenario：英文字母表完整
- 驗證：`node --test tests/dataset.test.js`
- 完成條件：26 筆、A-Z 依序、每筆有 IPA 與例字（含中文）

**T2.5 · 日文單字題庫（≥ 60 筆）**
`data/ja/words.js` ｜ 依賴：T2.1 ｜ 35 分
- Scenario：日文單字必須帶讀音 / 日文題庫規模
- 驗證：`node --test tests/dataset.test.js`
- 完成條件：≥ 60 筆，**每筆都有 `reading` 與 `romaji`**；
  category 分佈規則同 T2.2

**T2.6 · 日文句型題庫（≥ 20 筆）**
`data/ja/sentences.js` ｜ 依賴：T2.1 ｜ 50 分
- Scenario：日文句子的助詞被獨立標記 / chunk 串接與完整句一致性檢查
- 驗證：`node --test tests/dataset.test.js`
- 完成條件：≥ 20 筆；**每筆都有 `role:'particle'` 的區塊**；
  **動詞區塊一律位於 `chunks` 陣列最後**；每筆都有整句 `reading`

**T2.7 · 日文假名表（104 筆）**
`data/ja/kana.js` ｜ 依賴：T2.1 ｜ 50 分
- Scenario：四種類型的數量正確 / 清音涵蓋十行 / 濁音與半濁音的行別正確 /
  拗音涵蓋的子音行 / 羅馬拼音不重複
- 驗證：`node --test tests/dataset.test.js`
- 完成條件：`seion` 46 + `dakuon` 20 + `handakuon` 5 + `youon` 33 = 104；
  每筆都有例字與中文；濁音／半濁音需帶清音來源欄位（供 UI 顯示 `が ← か`）

**T2.8 · 題庫整體驗證測試** 🔴
`tests/dataset.test.js` ｜ 依賴：T1.4、T2.2〜T2.7 ｜ 25 分
- Scenario：正式題庫零錯誤 / 正常題庫無重複 / 各項規模與數量下限
- 驗證：`node --test tests/dataset.test.js`
- 完成條件：對英日兩份題庫跑 `validateDataset` 與 `findDuplicateIds` 皆為空；
  規模下限（60/20/26/104）以斷言寫死；
  **額外斷言「每個 category 至少 4 筆」**，保護 T1.9 的干擾選項品質

---

## 5. T3 · 外殼與樣式

**T3.1 · theme.css：深色主題與共用元件** 👁
`assets/css/theme.css` ｜ 依賴：T0.1 ｜ 40 分
- Scenario：色彩集中定義 / 文字對比度 / 手機寬度不橫向溢出 / 測驗選項可單手點擊
- 驗證：人工 QA §6.1
- 完成條件：所有色碼只出現在 `:root` 變數區塊；內文對比度 ≥ 4.5:1；
  按鈕最小點擊高度 44px

**T3.2 · nav.js 與根首頁** 👁
`assets/js/ui/nav.js`、`index.html` ｜ 依賴：T3.1 ｜ 30 分
- Scenario：首頁入口 / 導覽列標示目前位置 / 跨語言切換保持相同功能 /
  首次造訪的引導入口 / 每個頁面都能回到教學
- 驗證：人工 QA §6.2
- 完成條件：導覽列由 JS 注入（不在 12 個 HTML 裡手抄）；
  從 `en/vocabulary.html` 切語言會到 `ja/vocabulary.html` 而非 `ja/index.html`

**T3.3 · 語言首頁與統計摘要** 👁
`en/index.html`、`ja/index.html`、`ui/stats-view.js` ｜ 依賴：T1.6、T3.2 ｜ 35 分
- Scenario：英文首頁的四個入口 / 日文首頁的四個入口 / 有紀錄時顯示數值 /
  無紀錄時顯示引導文案 / 確認後清除 / 取消則不清除
- 驗證：人工 QA §6.2
- 完成條件：無紀錄時顯示引導文案而非 `0%`；清除需二次確認

**T3.4 · 使用教學頁** 👁
`help.html` ｜ 依賴：T3.2、T4.5（借用色塊樣式）｜ 40 分
- Scenario：教學頁涵蓋四個模組 / 用實際範例說明色塊拆解 /
  說明發音的降級情況 / 教學頁不依賴語言
- 驗證：人工 QA §6.5
- 完成條件：位於根目錄；內嵌一張 `我今天去打羽毛球` 的真實色塊範例並標註讀法

---

## 6. T4 · UI 模組

**T4.1 · speech.js：語音封裝、能力偵測與三段降級** 👁
`assets/js/ui/speech.js` ｜ 依賴：T3.1 ｜ 35 分
- Scenario：完全不支援時隱藏朗讀入口 / 缺少日文語音時提示但不擋用 /
  語音清單非同步載入 / 連續點擊會中斷前一段朗讀 / 朗讀空字串為安全的空動作 /
  其他模組不直接碰 API
- 驗證：人工 QA §6.3（含關閉語音包的降級情境）
- 完成條件：`grep -r speechSynthesis` 只在此檔命中；
  對外只暴露 `speak` / `isSupported` / `hasVoiceFor` 三個介面；
  正確處理 `voiceschanged` 後的重新評估

**T4.2 · 英文字母頁** 👁
`ui/kana-view.js`、`en/alphabet.html` ｜ 依賴：T2.4、T4.1 ｜ 40 分
- Scenario：字母卡內容完整 / 26 張卡片全數呈現 / 點字母卡朗讀 / 例字可獨立朗讀
- 驗證：人工 QA §6.3
- 完成條件：點例字不會同時觸發卡片本身的朗讀（事件需 `stopPropagation`）

**T4.3 · 日文假名頁（四區塊）** 👁
`ui/kana-view.js`、`ja/kana.html` ｜ 依賴：T2.7、T4.2 ｜ 45 分
- Scenario：四個區塊皆存在 / 清音表結構 / 濁音與半濁音表結構 / 拗音表結構 /
  區塊可摺疊以免頁面過長 / 平假名與片假名可切換顯示 /
  濁音與其清音來源的對應提示 / 拗音以單一音節朗讀
- 驗證：人工 QA §6.3
- 完成條件：初始為「清音展開、其餘收合」；切換平／片假名時四區同步；
  や行的 い/え 段為視覺空格而非塞入錯誤假名

**T4.4 · 單字頁（英日共用）** 👁
`ui/vocab-view.js`、`en/vocabulary.html`、`ja/vocabulary.html` ｜ 依賴：T1.7、T4.1 ｜ 45 分
- Scenario：英文單字卡內容 / 日文單字卡含讀音 / 套用分類篩選 / 顯示目前筆數 /
  無結果時的呈現 / 朗讀單字 / **日文朗讀使用讀音** / 從單字頁開始測驗
- 驗證：人工 QA §6.4
- 完成條件：兩個 HTML 共用同一支 view，只差傳入的資料模組；
  日文朗讀傳 `reading` 而非漢字 `target`

**T4.5 · 文法頁：雙排色塊與語序標記** 👁
`ui/grammar-view.js`、`en/grammar.html`、`ja/grammar.html` ｜ 依賴：T1.8、T4.1 ｜ 55 分
- Scenario：兩排色塊各自還原完整句子 / 相同角色顏色一致 / 每個色塊標註角色中文名 /
  標示語序改變的區塊 / 語序完全相同時不加雜訊 / 日文助詞被標為附加成分 /
  顯示 note / 依句型篩選 / 顯示全部 / 朗讀整句 / 朗讀單一區塊 /
  日文句子顯示假名讀音 / 文法頁提供進入測驗的入口
- 驗證：人工 QA §6.4
- 完成條件：`particle` 區塊**只出現在目標語言排**，中文排完全不顯示
  （2026-08-21 修正：原訂在中文排放「（無對應）」佔位格，改為直接濾掉。
  理由見 `design.md` 的 TD-8 與變更記錄）

**T4.6 · 測驗頁：設定 / 作答 / 結果三態** 👁
`ui/quiz-view.js`、`en/quiz.html`、`ja/quiz.html` ｜ 依賴：T1.11、T1.6、T4.1 ｜ 60 分
- Scenario：開始一局 / 最後一題後進入結果 / 中途離開不留下半局狀態 /
  答錯後 UI 同時標示錯誤與正解 / 外翻中時題面可朗讀 / 中翻外時題面不提供朗讀 /
  顯示成績 / 全對時的呈現 / 句子題的錯題附上語序說明 / 錯題可朗讀 /
  未完成的局不計入 / 寫入失敗時不影響作答
- 驗證：人工 QA §6.4
- 完成條件：三個狀態在同一頁切換；統計**只在進入結果畫面時寫入一次**；
  網址參數可預選題源（供 T4.4 / T4.5 的捷徑使用）

---

## 7. T5 · 收尾

**T5.1 · 相對路徑掃描測試** 🔴
`tests/paths.test.js` ｜ 依賴：T4.6 ｜ 20 分
- Scenario：無絕對根路徑引用 / 無外部請求
- 驗證：`node --test tests/paths.test.js`
- 完成條件：掃過全部 12 個 HTML，`href="/` 與 `src="/` 零命中；
  掃出的外部網域（`http://` / `https://` 開頭的 src/href）零命中

**T5.2 · README** 👁
`README.md` ｜ 依賴：T5.1 ｜ 30 分
- Scenario：README 含部署與本機開發說明
- 驗證：人工 QA §6.6
- 完成條件：涵蓋 ①GitHub Pages 啟用步驟 ②**本機必須跑 `npx serve .`（不能雙擊開）**
  ③如何新增一個單字 ④如何新增一個句型（含 `zhIndex` 怎麼填的範例）
  ⑤統計 schema 變更會清空舊資料的說明

---

## 8. 人工 QA 檢查表（👁 任務的驗收依據）

執行環境：`npx serve .` 後以桌機 Chrome + 375px 手機模擬各跑一輪。

### 8.1 全站
- [ ] 12 個頁面逐一開啟，Console 無 `error`
- [ ] 375px 下每頁 `document.body.scrollWidth` 不大於視窗寬度
- [ ] Network 面板無任何外部網域請求
- [ ] 所有頁面深色主題一致，無殘留白底區塊

### 8.2 導覽與首頁
- [ ] 根首頁兩個語言入口 + 教學入口皆可點
- [ ] 每個內頁導覽列標示目前位置正確
- [ ] 從 `en/vocabulary.html` 切語言 → 到 `ja/vocabulary.html`
- [ ] 首次（清空 localStorage）進語言首頁顯示引導文案而非 `0%`
- [ ] 清除統計需二次確認，取消則不清除

### 8.3 發音
- [ ] 英文字母卡 26 張，點卡朗讀、點例字獨立朗讀
- [ ] 假名頁四區塊數量正確（46 / 20 / 5 / 33）
- [ ] 平／片假名／並列三種模式切換，四區同步
- [ ] 區塊摺疊互不影響，初始為清音展開
- [ ] 連續快速點兩張卡，不會兩段語音重疊
- [ ] **降級測試**：於 DevTools 覆寫 `window.speechSynthesis = undefined` 重載，
      朗讀按鈕消失、內容仍完整可讀
- [ ] **降級測試**：覆寫 `getVoices()` 回傳無 `ja` 語音，提示出現但按鈕保留

### 8.4 單字 / 文法 / 測驗
- [ ] 單字搜尋（中文 / 羅馬拼音 / 大小寫混合）皆正確
- [ ] 搜尋 + 分類同時生效，筆數顯示正確
- [ ] 日文單字朗讀唸的是假名而非漢字誤讀
- [ ] 文法頁上下兩排色塊對齊，`particle` 不造成錯位
- [ ] 語序不同的句子有標記、語序相同的沒有多餘標記
- [ ] 從單字頁 / 文法頁的捷徑進測驗，題源已預選正確
- [ ] 答錯時同時標示「你選的」與「正解」
- [ ] 最後一題後進結果頁，成績與錯題清單正確
- [ ] 全對時顯示祝賀而非空的錯題區塊
- [ ] 作答到一半重新整理 → 回設定畫面，統計未被計入
- [ ] **降級測試**：DevTools 中讓 `localStorage.setItem` 拋例外，
      仍能完成一局並看到結果畫面

### 8.5 使用教學頁
- [ ] 四個模組段落齊全，每段都有「什麼時候該用它」
- [ ] 內嵌色塊範例與文法頁樣式一致
- [ ] 發音降級說明存在

### 8.6 README
- [ ] 照著 README 從零跑起本機環境成功
- [ ] 照著 README 加一個單字 + 一個句型，`npm test` 仍全綠

---

## 9. Phase 4 子代理評估

任務數 31 ≥ 5，**符合派子代理的觸發條件**，但依全域規則需先取得你的同意。

### 適合平行的部分

| 批次 | 任務 | 理由 |
|---|---|---|
| A | T2.2 / T2.3 / T2.4 | 三個檔案互不重疊，純資料撰寫 |
| B | T2.5 / T2.6 / T2.7 | 同上（日文側） |
| C | T4.2 / T4.4 / T4.5 | 三個 view 各自獨立，僅共用已完成的 `speech.js` |

### 必須序列的部分

- **T1 全部** — `quiz-engine.js` / `schema.js` / `stats.js` 各自有多個任務改同一個檔案，
  平行會撞在一起
- **T3** — `nav.js` 與 `theme.css` 是所有 UI 的共同基礎
- **T4.6** — 依賴最多，且與 T4.4 / T4.5 有捷徑參數的介面約定

### 建議

T1 由我序列跑完（這是正確性核心，值得逐步盯著 RED）；
T2 與 T4 的批次可以派子代理。**要不要派，等 tasks.md 核准後再問你一次。**

---

## 10. 交付進度追蹤

| 群組 | 任務數 | 估時 | 狀態 |
|---|---|---|---|
| T0 骨架 | 1 | 0.25 h | ✅ 完成 |
| T1 Core 純函式 | 11 | 5.0 h | ✅ 完成 |
| T2 題庫資料 | 8 | 4.6 h | ✅ 完成（子代理平行產出） |
| T3 外殼與樣式 | 4 | 2.4 h | ✅ 完成 |
| T4 UI 模組 | 6 | 4.7 h | ✅ 完成（子代理平行產出） |
| T5 收尾 | 2 | 0.8 h | ✅ 完成 |
| **合計** | **31** | **≈ 16.5 h** | **31 / 31 完成** |

### 測試現況

```
npm test  →  187 tests, 187 pass, 0 fail
```

| 測試檔 | 覆蓋 | 測試數 |
|---|---|---|
| `shuffle.test.js` | 洗牌與抽樣 | 9 |
| `schema.test.js` | 四種資料格式的驗證 | 55 |
| `stats.test.js` | 正確率、錯題摘要、localStorage 三種失效降級 | 28 |
| `filter.test.js` | 搜尋與篩選 | 17 |
| `grammar-layout.test.js` | 雙語序推導與 LCS 語序標記 | 13 |
| `quiz-engine.test.js` | 干擾選項、抽題、作答判定 | 28 |
| `dataset.test.js` | 真實題庫驗證 + 18 種出題組合整合檢查 | 24 |
| `structure.test.js` | **架構約定**：相對路徑、零外部資源、色碼集中、分層邊界 | 13 |

### 題庫實際規模

| | 英文 | 日文 |
|---|---|---|
| 單字 | 84 | 85 |
| 句型 | 28 | 31 |
| 發音單元 | 26 字母 | 104 假名 |

（2026-08-21 追加「我今天去打羽毛球 / I play badminton today / 私は今日バドミントンをします」
與對應單字，讓規格文件裡引用的例子在題庫中真實存在。）

### 實作階段做的判斷

| # | 判斷 | 理由 |
|---|---|---|
| 1 | 語序標記改用 **LCS**（最長共同子序列）而非逐位比對 | 逐位比對會把「一塊移到句尾」誤判成「後面每塊都移動」，整句標紅等於沒標 |
| 2 | 干擾選項加了「文字不得與正解相同」的硬性約束 | 題庫若有同義詞會產生兩個都對的選項，使用者答對也被判錯 |
| 3 | `roles.js` 的色碼改為 CSS 變數參照 | 原本兩處各有一份色碼，違反「色碼只出現在 theme.css」的規格 |
| 4 | 新增 `structure.test.js` 把架構約定變成測試 | 相對路徑、分層邊界這類規則靠 review 守容易漏 |
| 5 | 假名表在手機改為容器內橫向捲動 | 固定欄數是 inline style，優先權高於 media query，只能改捲動策略保住格狀結構 |
| 6 | 中文排直接略過助詞（原訂顯示「（無對應）」佔位） | 助詞是日文特有的語法裝置，中文排硬擠一格會讓人以為中文也有對應成分 |
