# JLPT N1 讀解設計

> 2026-10-23 · add-jlpt-n1-reading · 完整模式
> 設計待核准；分支 feature/add-offline-study-suite，基準 8f2ea72。尚未修改生產程式或題庫。

## 1. Overview

### 1.1 Purpose
在「JLPT 模擬」題源加入 N1 讀解：題面是一篇（統合理解是兩篇）日文短文帶多題，作答後逐選項顯示繁中解說。第一批 350 題，來源 Yomitaku 固定 commit。

### 1.2 Scope
- 新增「短文組」資料格式與 schema，以及上游對照工具。
- JLPT 題源按篇抽題，選項打亂規則依題型而定。
- 畫面呈現短文、A／B 雙篇、劃線句、逐選項解說。
- 目錄改為按級別拆檔，選題型時預設級別。
- 作答事件、續答、問題回報、備份沿用既有機制。

N5 的一題一筆格式與行為不變（R18）。

### 1.3 Related Documents
- [proposal.md](proposal.md)：來源、授權、官方編號、已決定事項。
- [specs/jlpt-reading.md](specs/jlpt-reading.md)：R01–R18。
- [tasks.md](tasks.md)
- 前一個變更：[add-jlpt-mock-source 設計](../add-jlpt-mock-source/design.md)（JLPT 題源、`core/jlpt-mondai.js`、`validateJlpt`、`tools/import-jlptsuccess.mjs`）。

## 2. Architecture

### 2.1 System Context
```text
Yomitaku 固定 commit 的 js/bank/*.js（本機下載，不進版控）
        ↓ tools/import-yomitaku.mjs
          ・驗 SHA-256
          ・去掉 window.BANK.push(…) 外框後 JSON.parse（只當資料，不執行）
          ・--select 依固定種子選組；--draft 產生草稿；--check 對照
assets/js/data/ja/jlpt-reading/n1-<題型>.js（人工逐題審查、寫逐選項繁中解說，進版控）
        ↓ npm test（validateJlptReading）
        ↓ tools/build-catalog.mjs：JLPT 目錄改為 ja-jlpt-1.js ～ ja-jlpt-5.js
loadDataset('ja', 'jlpt', { level })
        ↓
quiz-view（題型膠囊依級別、預設級別）→ quiz-engine（按篇抽題、buildJlptQuestion）→ 呈現
        ↓ 作答
既有逐題事件（choice → recognition）、續答、問題回報
```

### 2.2 Components
- **題型定義** `core/jlpt-mondai.js`：新增讀解六種題型。鍵值用題型名稱（`dokkai-tanbun`、`dokkai-chubun`、`dokkai-chobun`、`dokkai-togo`、`dokkai-shucho`、`dokkai-joho`），附 `mondaiByLevel`（N1 為問題 8～13）、官方字數、選項是否打亂、自寫的日文問法與中文對照。N5 既有的 `moji-1` 等鍵值不變。
- **資料檔** `assets/js/data/ja/jlpt-reading/n1-{tanbun,chubun,chobun,togo,shucho,joho}.js`，加上 barrel `ja/jlpt-reading.js`。每檔匯出 `passages` 與 `excluded`。
- **schema** `validateJlptReading`：R01–R05 的規則。
- **匯入對照工具** `tools/import-yomitaku.mjs`：固定 commit 與 6 個題庫檔的 SHA-256，提供 `--select`、`--draft`、`--check`。
- **目錄** `tools/build-catalog.mjs`：輸出 `ja-jlpt-1.js` ～ `ja-jlpt-5.js`，每檔匯出 `jlpt`（一題一筆）與 `jlptReading`（短文組），取代單一的 `ja-jlpt.js`。`meta.js` 的 JLPT 題數改為「題目數」，含讀解題，並依級別與題型分布。
- **出題** `quiz-engine.js`：`poolOf('jlpt')` 把短文組攤平成一題一筆並帶 `passageId`；抽題按篇；`buildJlptQuestion` 支援讀解。
- **畫面** `quiz-view.js`：題型膠囊依目前級別顯示；選 JLPT 題源時預設級別；短文、雙篇、劃線句、逐選項解說。

## 3. Technical Decisions

### TD1：放在 JLPT 題源，不收進閱讀題源（使用者 2026-10-23 決定）
- Context：既有閱讀題要求全文中譯、題目與選項中日兩版。照搬的話光短文就約 60 萬字要翻譯。
- Decision：JLPT 題源新增讀解區段，全日文作答，只寫繁中解說。
- Consequences：JLPT 題源要從「只有一題一筆」擴充到「也有短文組」。閱讀題的抽題與呈現能重用的部分抽成共用函式，不複製一份。

### TD2：題型鍵值用名稱，問題號依級別對照
- Context：官方各級的讀解問題號不同。N1 是 8～13，N2 從 10 起，N3 從 4 起；用號碼當鍵值，之後收 N2 就會撞號。
- Decision：讀解題型鍵值為 `dokkai-<題型>`，畫面上的「問題 N」由 `mondaiByLevel[level]` 決定。這一批只填 N1，`level` 5 → 8～13。
- N5 既有鍵值（`moji-1` 等）是一題一筆的題型，維持原樣，不在本變更改名。

### TD3：短文組資料格式
```js
{
  id: 'ja-jr-0001',            // 短文組流水號，整份從 0001 連號
  level: 5,                    // N1
  type: 'tanbun',              // tanbun | chubun | chobun | togo | shucho | joho
  passage: '…',                // 統合理解改用 passageA／passageB，passage 為 null
  passageA: null,
  passageB: null,
  underline: null,             // 劃線句：原文中剛好出現一次的句子；沒有劃線題時為 null
  questions: [
    {
      id: 'ja-jr-0001-q1',     // 組 id 加 -qN，從 1 連號
      focus: 'main',           // 考點，見下方對照
      ask: '筆者が最も言いたいことはどれか。',
      options: ['…', '…', '…', '…'],
      answer: '…',             // 必須是選項之一
      explain: ['…', '…', '…', '…'],  // 與 options 同順序的繁中解說，四段都必填
    },
  ],
  sourceRef: 'sim-tan164',     // 上游組 id，供 --check 對照
  edited: null,                // 與上游不同時寫原因（繁中）
}
```
- 考點 `focus` 對照上游的簡體中文標籤：主旨把握 → `main`、内容一致 → `detail`、理由说明 → `reason`、划线句含义 → `underline`、指示语 → `reference`、共通点 → `common`、相違点 → `difference`、条件筛选 → `condition`、注意事项 → `notice`。畫面顯示繁中名稱。
- 劃線句：上游以 `⟪…⟫` 標在原文中，每篇最多一處（2026-10-22 全檢，0 篇多處）。匯入時拿掉標記，句子另存 `underline`，畫面用 DOM 節點包 `<u>`，與 N5 的做法一致。
- 不帶上游的標題（「模拟⑦ …」）、`minutes`、`source` 欄位：考試題面沒有標題，作答時間另外處理（不在本批）。
- 短文保留上游原文，只修錯字與資料錯誤，並寫 `edited`。

### TD4：品質關卡與選題規則（第一批 25 組／題型）
1. **字數下限**：低於官方字數七成的短文不收。下限為短文 140、中文 350、長文 700、統合（兩篇合計）420、主張 700、情報 490。
2. **避開早期批次**：上游組 id 依數字排序後的前 15% 不收（2026-10-22 評估：早期批次偏短、陷阱設計較少）。
3. **選組方式**：符合 1、2 的組，依工具內的固定種子打亂，取前 25 組；審查後排除的組，依同一順序往下遞補。種子與順序可以重現。
4. **逐題審查**：比照 N5 的 TD6，另外檢查：
   - 劃線句題引用的句子確實在原文中。
   - 情報檢索的條件逐項對得上。
   - 統合理解的「只有一方」選項，確實只出現在單篇。
   - 短文的錯字（例如「伸べ放題」）。
5. **已知要處理的**：`sim-cho17` 不收（引用句不在原文）；`sim-togo110` 若入選，要修正「伸べ放題」。

### TD5：逐選項繁中解說（使用者 2026-10-23 決定）
- `explain` 四段都必填、都是繁中，順序與 `options` 相同，打亂選項時跟著選項一起移動。
- 正解的解說要寫出原文依據；錯誤選項的解說要指出錯在哪裡，並用繁中標出陷阱類型（例如【部分曲解】【範圍擴大】【只有一方】）。上游陷阱名稱的日文寫法統一轉成繁中。
- 撰寫方式：由 Claude 參考上游的日文解說撰寫，不是逐字翻譯；交付時誠實標示 AI 撰寫、未經母語者審查。

### TD6：抽題與選項順序
- 按篇抽：同一組的題目一起出、依原順序排列，篇與篇之間打亂。題數以題目計，最後一篇不截斷。這點與閱讀題現行的 `sampleReadingQuestions` 不同：閱讀題會把最後一篇截斷，讀解題截斷會讓一篇短文只答一半。
- N5 的一題一筆題目視為一題一組，行為不變。
- 選項：情報檢索照原順序，不打亂（上游慣例：選項依原文出現順序排列）；其他題型照常打亂。題型定義的 `shuffle` 欄位決定，不寫死在引擎。

### TD7：目錄按級別拆檔、預設級別
- Context：第一批 N1 讀解估算約 50 萬位元組（短文約 9 萬字，加上選項與逐選項解說，UTF-8 每字約 3 位元組；實作時以實際檔案大小為準）。
  - 2026-10-23 實測更正：`ja-jlpt-5.js` 為 819,881 位元組，比估算大，主要是逐選項解說比預期長。拆檔的必要性因此更明確：N5 的 `ja-jlpt-1.js` 只有 116,808 位元組。維持單一 `ja-jlpt.js` 的話，只練 N5 的人也要下載 N1 短文。
- Decision：JLPT 目錄拆成 `ja-jlpt-1.js` ～ `ja-jlpt-5.js`；`loadDataset('ja', 'jlpt', { level })` 只載入指定級別，`level` 為 `all` 時載入全部。
- 測驗頁選 JLPT 題源時，級別原本是「全部」的話，改為今日學習的級別偏好（`daily.ja.level`，沒有就 N5）；使用者手動選「全部」才載入全部級別。預載表（`data-preload.js`）依同一規則判斷。
- 其他題源的級別行為不變。

### TD8：能力、方向與紀錄
- 作答型態 `choice` → 能力 `recognition`，方向 `target2zh`，與 N5 相同；不新增能力或方向，學習紀錄與備份格式不變。
- sourceId 用題目 id（`ja-jr-NNNN-qN`），符合 `skillKeyFor` 的字元規則。每題各自排程，同一篇的不同題不互相影響。
- 問題回報多帶 `passageId`、劃線句與題型鍵值；短文全文不放進回報代碼，以 `passageId` 定位，避免代碼過長。

### TD9：不接每日學習
- 與 N5 相同（add-jlpt-mock-source TD8），每日清單不會抽到 `ja-jr-` 題目。

## 4. 資料相容、遷移與回復
- **目錄改名**：`ja-jlpt.js` 換成 `ja-jlpt-1.js` ～ `-5.js`，屬於生成檔。
  - 已開著的舊頁面重新整理就會用新檔名。
  - 舊的進行中測驗存的是題面快照，續答不依賴目錄檔名（R16 驗證）。
- **N5 資料不動**：學習紀錄與備份格式不變。
- **回復**：revert 本變更的 commit 並重建目錄即可。已產生的 `ja-jr-` 學習紀錄保留在使用者瀏覽器，不刪資料。

## 5. Testing
- **schema**：R01–R05 的合法與違規案例。
- **匯入工具**：SHA 不符時拒絕；解析時不執行上游程式碼（以會在執行時留下痕跡的假檔驗證）；選組可重現；修改、排除與遞補的對照。
- **quiz-engine**：按篇抽題、最後一篇不截斷、情報檢索不打亂、解說跟著選項移動、N5 行為不變。
- **目錄與預載**：按級別拆檔、N5 頁面不載入 N1 檔、預載與實際載入一致。
- **瀏覽器隔離測試**：題型膠囊、預設級別、短文與雙篇呈現、劃線、逐選項解說、續答、手機寬度下長文排版。
- **覆蓋檢查**：`openspec/tools/check-task-coverage.mjs` 加入本變更（R 開頭）。
