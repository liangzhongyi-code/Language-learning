# 語言學習網站

英文與日文的**發音、單字、文法句型**，加上中翻外 / 外翻中的**選題練習**。

純前端靜態網站——沒有後端、沒有帳號、沒有建置步驟、執行期零依賴。
把整個資料夾丟上 GitHub Pages 就能跑，載入後也能離線使用。

---

## ⚠️ 本機開發：不能雙擊 HTML 直接開

網站用的是 ES Modules（`<script type="module">`），瀏覽器對 `file://` 的模組載入有
CORS 限制，**雙擊 `index.html` 會開出一片空白，Console 一堆 CORS 錯誤**。

一定要跑一個靜態伺服器：

```bash
npx -y serve .
```

然後開 `http://localhost:3000`（或它印出來的網址）。
VS Code 的 Live Server 擴充套件也可以。

---

## 部署到 GitHub Pages

1. 把整個 repo push 上去
2. **Settings → Pages → Source** 選 `Deploy from a branch`
3. Branch 選預設分支、資料夾選 `/ (root)`，按 Save
4. 等一兩分鐘，網址會是 `https://<你的帳號>.github.io/<repo 名稱>/`

**沒有建置步驟、沒有 GitHub Actions、沒有 secrets。** push 完就是部署完。

repo 叫什麼名字都可以——全站使用相對路徑，放在子路徑底下一樣正常運作。

> 免費方案的 GitHub Pages **只支援公開 repo**。私人 repo 要發布 Pages 需要
> GitHub Pro 以上的方案，或改用 Cloudflare Pages / Netlify（兩者免費方案都吃私人 repo）。

---

## 測試

```bash
npm test
```

等同 `node --test`，用 Node 內建的測試執行器，**零安裝**（需要 Node 18 以上）。
`package.json` 的 `dependencies` 永遠是空的——網站本體不依賴任何套件。

測試涵蓋兩件事：

| 類型 | 檔案 | 測什麼 |
|---|---|---|
| 邏輯 | `tests/*.test.js` | 抽題、干擾選項、計分、統計、搜尋、語序推導 |
| 架構約定 | `tests/structure.test.js` | 相對路徑、無外部資源、色碼集中、分層邊界 |
| 題庫 | `tests/dataset.test.js` | 全部題庫的格式驗證與 18 種出題組合的整合檢查 |

`structure.test.js` 會擋下這些事，所以改動時不用靠記憶：

- HTML 裡出現 `href="/` 或 `src="/`（會讓子路徑部署壞掉）
- 引用任何外部網域（CDN、字型服務）
- 在 `theme.css` 以外的地方寫死色碼
- `core/` 底下出現 `document` / `window` / `localStorage`
- HTML 裡出現巢狀 `<button>`

---

## 目錄結構

```
.
├── index.html              語言選擇
├── help.html               使用教學
├── en/                     英文區（index / alphabet / vocabulary / grammar / quiz）
├── ja/                     日文區（index / kana / vocabulary / grammar / quiz）
├── assets/
│   ├── css/
│   │   ├── theme.css       語意 token 與全站元件樣式 ← 改配色只要動這裡
│   │   └── vendor/         Open Props（MIT，提供間距與字級尺度）
│   └── js/
│       ├── core/           純函式，零 DOM，可被 node:test 直接測
│       ├── ui/             DOM 綁定層
│       └── data/           靜態題庫 ← 新增內容改這裡
├── tests/
└── openspec/               規格文件（提案、設計、7 份 spec、任務清單）
```

**分層規則**：`頁面 → ui/ → core/ → data/`，方向不可反轉。
`core/` 不得碰任何瀏覽器 API——這條由測試強制執行。

---

## 怎麼加內容

改完存檔重新整理就看得到，記得跑一次 `npm test` 確認格式沒寫錯。

### 加一個單字

編輯 `assets/js/data/en/words.js` 或 `ja/words.js`，在陣列尾端加一筆：

```js
{
  id: 'en-w-085',        // 接續前一筆的號碼，三位數
  zh: '雨傘',
  target: 'umbrella',
  reading: null,          // 日文填假名讀音，英文固定 null
  romaji: null,           // 日文填羅馬拼音，英文固定 null
  pos: 'noun',            // noun / verb / adjective / adverb / other
  category: 'daily',      // 見 data/shared/categories.js
  level: 1,               // 1 / 2 / 3
},
```

日文的 `reading` 一定要填，因為**朗讀時送給語音引擎的是假名而不是漢字**
（送漢字會被唸成別的讀法）。

> 每個分類至少要有 4 筆單字，否則測驗的同類別干擾選項會退化成跨類別亂抽，
> 題目會變得太好猜。這條有測試把關。

### 加一個句型

這是比較需要動腦的部分。編輯 `assets/js/data/en/sentences.js` 或 `ja/sentences.js`：

```js
{
  id: 'en-s-029',
  zh: '我今天去打羽毛球',
  target: 'I play badminton today',
  reading: null,                      // 日文填整句假名
  patternId: 'en-p-svo-time',         // 見 data/shared/patterns.js
  chunks: [
    { role: 'subject', zh: '我',     target: 'I',         zhIndex: 0 },
    { role: 'verb',    zh: '去打',   target: 'play',      zhIndex: 2 },
    { role: 'object',  zh: '羽毛球', target: 'badminton', zhIndex: 3 },
    { role: 'time',    zh: '今天',   target: 'today',     zhIndex: 1 },
  ],
  note: '中文把「今天」放在主詞後面，英文的時間副詞習慣擺句尾。',
  category: 'sport',
  level: 1,
},
```

**`chunks` 陣列的順序 = 目標語言語序；每塊的 `zhIndex` = 它在中文句裡的位置。**

上面那句英文的語序是「我 → 去打 → 羽毛球 → 今天」，所以陣列就照這個順序排；
而中文是「我 → 今天 → 去打 → 羽毛球」，所以 `zhIndex` 依序是 0、2、3、1。

寫完會被三條規則檢查（`npm test` 會抓）：

1. 依**陣列順序**串接 `target`，忽略空白後要等於整句 `target`
2. 依 **`zhIndex` 排序**串接 `zh`，要等於整句 `zh`
3. `zhIndex` 必須是 0 起算、不跳號、不重複的連續整數

#### 日文的助詞怎麼填

助詞（は、を、で⋯）在中文沒有對應詞，所以：

- `role` 用 `'particle'`，`zh` 給**空字串**
- **`zhIndex` 仍然要佔號碼**（否則規則 3 的連續性會壞掉），一律**取尾端號碼**：
  實詞依中文語序拿 `0 … k-1`，助詞接在後面拿 `k … n-1`
- 因為 `zh` 是空字串，排序串接時不貢獻任何字，規則 2 自然成立
- 畫面上**中文排會直接略過助詞**，只在日文排顯示

```js
chunks: [
  { role: 'subject',  zh: '我',     target: '私',           zhIndex: 0 },
  { role: 'particle', zh: '',       target: 'は',           zhIndex: 4 },  // ← 尾端號碼
  { role: 'time',     zh: '今天',   target: '今日',         zhIndex: 1 },
  { role: 'object',   zh: '羽毛球', target: 'バドミントン', zhIndex: 3 },
  { role: 'particle', zh: '',       target: 'を',           zhIndex: 5 },  // ← 尾端號碼
  { role: 'verb',     zh: '去打',   target: 'します',       zhIndex: 2 },
],
```

日文的**動詞（或否定）一律放在 `chunks` 陣列的最後一個位置**，這是日文的核心特徵，
測試會檢查。

### 加一個分類或語法角色

- 分類：`assets/js/data/shared/categories.js`
- 語法角色：`assets/js/data/shared/roles.js`（顏色的實際色碼在 `theme.css`，這裡只放變數名）
- 句型：`assets/js/data/shared/patterns.js`

---

## 換配色

全站色碼只有一個來源：`assets/css/theme.css` 最上面的 `:root` 區塊。
改那幾行就會全站生效，包括文法頁的色塊。這條由 `structure.test.js` 強制執行——
在別的地方寫死色碼會讓測試失敗。

---

## 發音

用瀏覽器內建的 Web Speech API，**沒有夾帶任何音檔**。
所有相關程式集中在 `assets/js/ui/speech.js`，其他模組一律透過
`speak` / `isSupported` / `hasVoiceFor` 三個介面。

三段降級：

| 情況 | 行為 |
|---|---|
| API 與目標語言語音都在 | 正常朗讀 |
| API 在但找不到該語言的語音 | 仍嘗試朗讀，並在頁面上方顯示提示 |
| 完全不支援 | 隱藏所有朗讀按鈕，其餘內容照常可讀 |

日文語音在 Windows 上需要另外安裝語言包（設定 → 時間與語言 → 語言），
部分 Android 裝置也沒有。這種情況下網站不會壞，只是沒有聲音。

---

## 學習統計

存在 localStorage 的單一 key `lang-learn.stats.v1`，以「語言 × 題源」為粒度累計。

- **未完成的局完全不計入**——作答到一半離開或重新整理就不算
- localStorage 被停用或已滿時會降級，測驗本身不受影響
- 語言首頁有「清除統計」，需二次確認

> 統計結構帶版本號。日後若改格式，舊資料會被安全丟棄而不是造成錯誤——
> 也就是說**升級版本會清空既有統計**。這是刻意的取捨：統計不是不可再生的重要資產。

---

## 授權

`assets/css/vendor/open-props.min.css` 為 [Open Props](https://open-props.style)，MIT 授權。
其餘為本專案內容。
