# 提案：語言學習網站（純前端 / GitHub Pages）

| 項目 | 值 |
|---|---|
| change-id | `init-lang-learn-site` |
| 建立日期 | 2026-08-20 |
| 模式 | 完整模式 |
| 分支 | `feature/init-lang-learn-site` |
| 狀態 | 待核准 |

---

## 1. 目的

建立一個**零後端、零建置**的語言學習網站，部署在 GitHub Pages 上，
讓使用者可以在瀏覽器（含手機）上做三件事：

1. **學基礎發音** — 英文字母／音標、日文五十音，點了會唸。
2. **學句型文法** — 用「主詞 + 時間 + 動詞 + 受詞」這種色塊拆解，
   把中文句子與目標語言句子的**語序差異**視覺化。
3. **玩選題小遊戲** — 中翻英／英翻中（日文同理）雙向選擇題，
   每局結束顯示錯題檢討與累計答對率。

核心價值主張是**摩擦力極低**：打開網址就能玩，不用註冊、不用登入、不用連 API、
沒有 loading，離線也能跑（靜態資源被瀏覽器快取後）。

## 2. 問題陳述

現有語言學習 App（Duolingo 等）的問題：
- 要註冊、要連網、有廣告與訂閱牆
- 題庫是別人的，塞不進自己想背的單字
- 文法教學多半是「給你一個例句」，沒有把**語序結構**明確標出來

本站鎖定的使用者是**自學者本人（專案擁有者）**：想要一個題庫完全由自己掌控、
可以隨時 push 新增內容、且能一眼看懂中文與外語語序差異的練習工具。

成功長什麼樣子：
- 使用者能在 GitHub Pages 網址上完成一局 10 題的測驗並看到成績
- 新增一個單字只需要在資料檔加一行物件，不需要動任何邏輯程式碼
- 所有頁面在手機 Safari / Chrome 上可正常操作

## 3. 範圍

### 3.1 做什麼

| # | 能力 | spec 檔 |
|---|---|---|
| 1 | 站台外殼：首頁、語言首頁、**使用教學頁**、共用導覽、深色主題 | `specs/site-shell.md` |
| 2 | 靜態題庫資料結構（單字／句型／音節三種 schema） | `specs/content-data.md` |
| 3 | 基礎發音模組（英文字母＋音標、**日文清音／濁音／半濁音／拗音**） | `specs/pronunciation.md` |
| 4 | 單字瀏覽模組 | `specs/vocabulary.md` |
| 5 | 文法句型拆解模組 | `specs/grammar.md` |
| 6 | 雙向選題遊戲引擎（中↔外、單字題＋句子題） | `specs/quiz-game.md` |
| 7 | 作答檢討與 localStorage 統計 | `specs/progress.md` |

### 3.2 明確不做什麼

以下項目**本次不實作**，避免範圍蔓延：

- ❌ **持久化錯題本 / 間隔重複（SRS）** — 錯題只在該局結束時檢討，不跨局保存。
  （已與使用者確認：本次只要「每局結束的錯題回饋 + 累計答對率」）
- ❌ **後端、帳號、跨裝置同步** — 純前端，統計只存在該瀏覽器的 localStorage
- ❌ **即時機器翻譯 API** — 所有對照都是靜態寫死的，理由見 design.md 決策 TD-1
- ❌ **語音辨識 / 跟讀評分** — 只做「聽」，不做「說」的評分
- ❌ **文法語序排列遊戲** — 文法模組本次只做瀏覽與拆解顯示，不做拖拉排序遊戲
- ❌ **使用者自行新增題目的 UI** — 新增題目走「改資料檔 + push」
- ❌ **英文以外的第三語言** — 架構上要能擴充，但本次只交付英文與日文
- ❌ **建置工具 / 框架 / npm 執行期依賴** — 網站本體零依賴（測試工具除外）

## 4. 受影響的元件

全新專案，無既有程式碼受影響。預計產生的目錄結構：

```
lang-learn/
├── index.html                  # 語言選擇首頁
├── help.html                   # 使用教學（不分語言）
├── en/                         # 英文區
│   ├── index.html              #   英文首頁（四個入口）
│   ├── alphabet.html           #   字母與發音
│   ├── vocabulary.html         #   單字瀏覽
│   ├── grammar.html            #   句型拆解
│   └── quiz.html               #   選題遊戲
├── ja/                         # 日文區（同上五頁）
│   ├── index.html
│   ├── kana.html
│   ├── vocabulary.html
│   ├── grammar.html
│   └── quiz.html
├── assets/
│   ├── css/theme.css           # 深色主題與共用元件樣式
│   └── js/
│       ├── core/               # 純邏輯，無 DOM，可被 node:test 直接測
│       │   ├── quiz-engine.js  #   抽題、干擾選項、計分
│       │   ├── shuffle.js      #   可注入亂數源的洗牌
│       │   ├── stats.js        #   統計計算與 localStorage 讀寫
│       │   └── schema.js       #   資料驗證
│       ├── ui/                 # DOM 綁定層
│       │   ├── speech.js       #   Web Speech API 封裝與降級
│       │   ├── quiz-view.js
│       │   ├── grammar-view.js
│       │   └── nav.js
│       └── data/               # 靜態題庫（寫死）
│           ├── en/{words,sentences,alphabet}.js
│           └── ja/{words,sentences,kana}.js
├── tests/                      # node:test，僅開發期使用
├── package.json                # 只為了跑測試，網站本體不需要
└── openspec/                   # 本流程文件
```

## 5. 使用者影響

| 面向 | 影響 |
|---|---|
| 上手成本 | 零。打開網址即用，無註冊流程 |
| 隱私 | 無任何資料離開瀏覽器；統計只寫入 localStorage |
| 離線 | 首次載入後，靜態資源被快取即可離線使用（不額外做 Service Worker） |
| 相容性 | 目標為近兩年的 Chrome / Edge / Safari（桌機與行動）。發音功能在缺少對應語音包的裝置會降級為靜音並顯示提示 |
| 內容更新 | 由專案擁有者改資料檔後 push，Pages 自動更新 |

## 6. 技術方向

（完整決策與取捨見 `design.md`，此處只列結論）

- **純靜態 MPA**：多個 `.html` 檔，不用框架、不用打包器
- **ES Modules**：`<script type="module">`，資料以 `export const` 提供
- **測試**：Node 內建 `node:test`，只測 `core/` 底下的純函式；DOM 層走人工 QA
- **發音**：`window.speechSynthesis`（Web Speech API），偵測不到目標語音時降級
- **統計**：localStorage，單一 key、帶 schema 版本號
- **路徑**：全站使用相對路徑，確保在 `user.github.io/<repo>/` 子路徑下也能運作

## 7. 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| 日文語音包在部分裝置缺失 | 五十音發音功能失效 | TD-4 的三段降級策略 + 明確的 UI 提示 |
| 三種資料 schema 若定不好，日後加題很痛 | 高（本案最大風險） | Phase 2 先把 schema 定死並寫驗證函式與測試 |
| `file://` 直開會因 CORS 擋掉 ES Modules | 本機開發不便 | TD-2 記錄，README 明列 `npx serve` 開發指令 |
| 干擾選項若與正解語意相同會出現無正確答案的題目 | 中 | TD-6 的干擾選項規則 + 資料驗證期檢查 |

## 8. Open Questions

- GitHub repo 名稱與 Pages 的 base path 尚未決定 —— 已用「全站相對路徑」使此問題不影響實作
- 日文單字要不要一律附上假名與羅馬拼音？（本提案假設**要**，見 `specs/content-data.md`）
