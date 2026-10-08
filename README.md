# 語言學習網站

英文與日文的**發音、單字、文法句型**，加上六種題型的練習：
選擇題（中翻外 / 外翻中）、句子**填空**、日文**情境**（自稱與敬語）、**閱讀**短文。
日文六種題型都能按 JLPT N5～N1 隔離題庫；每題也能產生一串問題回報代碼，
用題目 ID、題面快照與當局設定定位資料問題，不會夾帶整份學習紀錄。

純前端靜態網站——學習免登入、沒有後端，發布資源可直接由 GitHub Pages 提供。
FSRS 排程使用已納入專案的本機 vendor，不依賴 CDN；Google 授權僅於設定後主動連接才載入。
把整個資料夾丟上 GitHub Pages 就能跑。已載入頁面可繼續操作，但目前沒有 Service Worker：關頁後離線重新開啟，不保證可用；完整離線 APP 仍在規劃。
介面支援深色／淺色切換；桌機使用寬版閱讀區，手機維持單欄觸控排版。

---

## 規格與邏輯變更文件

- [每次邏輯變更紀錄](docs/logic-changes/README.md)：查變更原因、前後行為、影響及驗證結果。
- [變更紀錄範本](docs/logic-changes/TEMPLATE.md)：每次實作同步填寫；規劃與已發布必須分開記錄。
- [專案文件規則](AGENTS.md)：後續代理與維護者共同遵循的留存約定。
- 進行中規格放在 `openspec/changes/`，已完成規格放在 `openspec/archive/`；原始 Markdown 留在專案，HTML 只作外部閱讀副本。

## ⚠️ 本機開發：不能雙擊 HTML 直接開

網站用的是 ES Modules（`<script type="module">`），瀏覽器對 `file://` 的模組載入有
CORS 限制，**雙擊 `index.html` 會開出一片空白，Console 一堆 CORS 錯誤**。

一定要跑一個靜態伺服器：

```bash
npx -y serve .
```

然後開 `http://localhost:3000`（或它印出來的網址）。
VS Code 的 Live Server 擴充套件也可以。

> 專案根目錄的 `serve.json` 關掉了 `serve` 的 clean-URL 功能，**不要刪它**。
> 開著的話 `serve` 會把 `/en/index.html` 轉址成 `/en`（沒有結尾斜線），
> 頁面裡的 `./alphabet.html` 就會解析成 `/alphabet.html` 而 404。
> GitHub Pages 沒有這個行為（它直接服務 `.html`，裸目錄會補斜線），
> 所以這純粹是為了讓本機開發與線上一致。

---

## 部署到 GitHub Pages

1. 把整個 repo push 上去
2. **Settings → Pages → Source** 選 `Deploy from a branch`
3. Branch 選預設分支、資料夾選 `/ (root)`，按 Save
4. 等一兩分鐘，網址會是 `https://<你的帳號>.github.io/<repo 名稱>/`

**網站沒有建置步驟、不需自訂 GitHub Actions 或 secrets。** 推送後仍要等待 GitHub Pages 的部署工作成功，再確認線上內容；push 成功不等於部署完成。

repo 叫什麼名字都可以——全站使用相對路徑，放在子路徑底下一樣正常運作。

> 免費方案的 GitHub Pages **只支援公開 repo**。私人 repo 要發布 Pages 需要
> GitHub Pro 以上的方案，或改用 Cloudflare Pages / Netlify（兩者免費方案都吃私人 repo）。

---

## 測試

### 題庫資源維護

編寫來源仍是 `assets/js/data/en/` 與 `assets/js/data/ja/` 的原始批次；網頁按需載入的 `assets/js/data/catalog/` 是已納入專案的生成檔，不要手改。
修改來源後先執行 `npm run build:catalog`，再執行 `npm run check:catalog` 和 `npm test`。發布不需額外建置服務，但生成檔必須與來源一起更新。

導覽先顯示，首頁用小型索引顯示筆數、今日卡只讀目前級別；每日頁切級才抓該級字庫。自由測驗只讀所選題源，但為保留干擾選項與填空候選池，級別只篩問題，不縮減該題源的選項池。單字頁選「全部」仍會載完整字庫；歷程頁不載題庫。題庫失敗不刪除紀錄，頁面提供重新載入。

開發與自動化測試環境使用 **Node.js 20 以上**。網站無須執行期下載套件；FSRS 使用已納入專案的本機 vendor。

完整 Node 驗證先安裝鎖定的開發依賴（不需 Chromium）；未安裝時，上游 FSRS 比對會跳過，不能當作完整驗收：

```bash
npm ci
npm test
```

等同 `node --test`，只跑純 Node 測試，不會自動啟動瀏覽器。
`package.json` 沒有 `dependencies`；開發用的上游比對與瀏覽器測試套件放在 `devDependencies`。

瀏覽器整合測試需另外安裝鎖定的開發依賴及 Chromium；乾淨環境依序執行：

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

`test:browser` 先驗證測試器會正確回報失敗，再跑全部瀏覽器套件（含 IndexedDB 遷移、交易與分頁）。
測試使用隔離 Chromium context 和本機隨機連接埠，不使用個人瀏覽器或真實學習紀錄。
缺少 Chromium 會明確失敗，不會跳過後宣稱成功。Linux CI 若缺少系統函式庫，可在允許安裝的環境使用 `npx playwright install --with-deps chromium`。

測試涵蓋三件事：

| 類型 | 檔案 | 測什麼 |
|---|---|---|
| 邏輯 | `tests/*.test.js` | 抽題、干擾選項、JLPT 難度隔離、計分、統計、搜尋、語序推導、漢字顯示模式、逐題紀錄與間隔重複排程、出題範圍過濾、備份與問題回報代碼 |
| 架構約定 | `tests/structure.test.js` | 相對路徑、無外部資源、色碼集中、分層邊界 |
| 題庫 | `tests/dataset.test.js` | 全部題庫的格式驗證與 18 種出題組合的整合檢查 |

`structure.test.js` 會擋下這些事，所以改動時不用靠記憶：

- HTML 裡出現 `href="/` 或 `src="/`（會讓子路徑部署壞掉）
- 引用任何外部網域（CDN、字型服務）
- 在 `theme.css` 以外的地方寫死色碼
- 內文色（文字三階與 `--accent` / `--ok` / `--bad` / `--warn`）在任何表面上低於 WCAG AA 的 4.5:1
- `core/` 底下出現 `document` / `window` / `localStorage` 等瀏覽器全域
- HTML 裡出現巢狀 `<button>`
- 題庫的物件實字裡有重複的鍵（JS 會靜靜覆蓋，執行期驗證抓不到）

---

## 目錄結構

```
.
├── index.html              語言選擇
├── help.html               使用教學
├── en/                     英文區（index / alphabet / vocabulary / grammar / quiz）
├── ja/                     日文區（index / guide / kana / vocabulary / grammar / quiz）
├── assets/
│   ├── css/
│   │   └── theme.css       尺度與語意 token + 全站元件樣式 ← 改配色只要動這裡
│   └── js/
│       ├── core/           純函式，零 DOM，可被 node:test 直接測
│       ├── ui/             DOM 綁定層
│       └── data/           靜態題庫 ← 新增內容改這裡
├── tests/
├── docs/logic-changes/     每次邏輯變更的索引、範本與紀錄
├── AGENTS.md              專案文件留存規則
└── openspec/               進行中規格、已歸檔歷史與資料處理工具
```

**分層規則**：`頁面 → ui/ → core/ → data/`，方向不可反轉。
`core/` 不得碰 DOM 與帶狀態的瀏覽器全域（`document`、`window`、`localStorage`、`navigator`、
`fetch`…，完整清單在 `tests/structure.test.js` 的 `BROWSER_GLOBALS`，由測試強制執行）。
Node 與瀏覽器共有的純運算 API 可以用——`TextEncoder`、`btoa`、`CompressionStream` 這類
純值進純值出、沒有環境狀態的東西——判準是「`node --test` 直接跑得動」。

### 本機儲存與備份

| 鑰匙 | 內容 | 大小 |
|---|---|---|
| `lang-learn.stats.v1` | 舊版統計遷移來源，新版不雙寫 | 舊格式 |
| `lang-learn.progress.v1` | 舊版進度遷移來源，新版不雙寫 | 舊格式 |
| `lang-learn.prefs.v1` | UI 偏好（顯示主題、漢字模式、假名顯示…） | < 1 KB |

學習資料現在統一存 IndexedDB：統計、逐題摘要、能力排程、事件、固定題面與續答、
每日清單、單字簿、筆記、成就及提醒設定。第一次載入將合法舊紀錄與完成標記同交易遷移，
保留舊 key 供救援，但不再把它當第二份可寫來源；偏好仍独立存 localStorage。

完整 v2 學習群組與可攜偏好能從首頁的「學習紀錄」帶走：下載成 JSON 檔、用系統分享面板送出，
或壓成一串 `langlearn1:…` 的代碼直接貼進訊息（gzip + base64；沒有 CompressionStream 的舊瀏覽器
退回不壓縮的 `langlearn0:`，解碼端兩種都認，見 `core/backup-code.js`）。
三種容器裝的是同一份內容，匯入都走完整群組驗證、預覽與確認；學習整組替換前保存還原點（最多三份）。
Google 是選用的多份手動備份，不自動同步或合併；目前 Client ID 留空，真帳號授權未驗。
設定方法見 [Google 備份設定](docs/google-backup-setup.md)。

題目下方另有 `langissue1:…` 問題回報代碼。它與備份代碼用途不同：只包含當前題目的
`sourceId`、級別、題面／選項快照、顯示設定與使用者說明，不讀取上述三把 localStorage 鑰匙。

---

## 怎麼加內容

修改原始題庫後，先執行 `npm run build:catalog` 更新網頁使用的生成資源，再跑 `npm run check:catalog` 與 `npm test`；來源與生成檔一起提交，重新整理才會看到新內容。

### 加一個單字

`words.js` 只是匯總入口（barrel），真正的資料在 `words/` 底下的批次檔。
在最後一個批次檔的陣列尾端加一筆，或另開一個批次檔再到 `words.js` 匯進去：

```js
{
  id: 'en-w-4034',       // 接續全檔最後一筆的號碼，不補零
  zh: '雨傘',
  target: 'umbrella',
  reading: null,          // 日文填假名讀音，英文固定 null
  romaji: null,           // 日文填羅馬拼音，英文固定 null
  pos: 'noun',            // noun / verb / adjective / adverb / other
  category: 'daily',      // 見 data/shared/categories.js
  level: 1,               // 1–5；日文依序是 N5 / N4 / N3 / N2 / N1
},
```

日文的 `reading` 一定要填，因為**朗讀時送給語音引擎的是假名而不是漢字**
（送漢字會被唸成別的讀法）。

> 每個分類至少要有 4 筆單字，否則測驗的同類別干擾選項會退化成跨類別亂抽，
> 題目會變得太好猜。這條有測試把關。

### 加一個句型

這是比較需要動腦的部分。句型題庫是分批寫的，一批一個檔案放在
`assets/js/data/<lang>/sentences/` 底下，`sentences.js` 只負責串起來。
新增一批就是放新檔再到 barrel 多兩行。

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

寫完會被四條規則檢查（`npm test` 會抓）：

1. 依**陣列順序**串接 `target`，忽略空白後要等於整句 `target`
2. 依 **`zhIndex` 排序**串接 `zh`，要等於整句 `zh`
3. `zhIndex` 必須是 0 起算、不跳號、不重複的連續整數
4. **日文限定**：含漢字的塊要寫 `reading`，依**陣列順序**串接（沒有漢字的塊用 `target`）
   要等於整句 `reading`

#### 日文的助詞怎麼填

助詞（は、を、で⋯）在中文沒有對應詞，所以：

- `role` 用 `'particle'`，`zh` 給**空字串**
- **`zhIndex` 仍然要佔號碼**（否則規則 3 的連續性會壞掉），一律**取尾端號碼**：
  實詞依中文語序拿 `0 … k-1`，助詞接在後面拿 `k … n-1`
- 因為 `zh` 是空字串，排序串接時不貢獻任何字，規則 2 自然成立
- 畫面上**中文排會直接略過助詞**，只在日文排顯示

```js
chunks: [
  { role: 'subject',  zh: '我',     target: '私',           reading: 'わたし', zhIndex: 0 },
  { role: 'particle', zh: '',       target: 'は',                              zhIndex: 4 },  // ← 尾端號碼
  { role: 'time',     zh: '今天',   target: '今日',         reading: 'きょう', zhIndex: 1 },
  { role: 'object',   zh: '羽毛球', target: 'バドミントン',                    zhIndex: 3 },
  { role: 'particle', zh: '',       target: 'を',                              zhIndex: 5 },  // ← 尾端號碼
  { role: 'verb',     zh: '去打',   target: 'します',                          zhIndex: 2 },
],
```

`reading` 只有含漢字的塊要填。`は` 本來就是假名、`バドミントン` 是片假名，
兩者都不必填——片假名硬轉成平假名反而變成沒人這樣寫的日文。
這個欄位餵給測驗的漢字顯示模式：「只顯示假名」時直接拿它代替 target，
「標在假名上」時它是底下讀的那一行、原本的 target 變成標在上面的小字。

日文的**動詞（或否定）一律放在 `chunks` 陣列的最後一個位置**，這是日文的核心特徵，
測試會檢查。

### 加一題情境題（僅日文）

編輯 `assets/js/data/ja/scenes.js`。這一頁考的不是「哪個字對」而是
「這個場合該用哪個字」，所以**選項寫死在資料裡**，不像單字題那樣自動抽干擾選項——
隨機抽出來的名詞構不成干擾，必須是「同樣是自稱、只是敬意等級不對」的字才有意義。

```js
{
  id: 'ja-sc-041',
  axis: 'self',                       // self / address / honorific / inout
  scene: '公司的正式會議上，你要向社長報告。',
  ask: '這時候該怎麼自稱？',
  answer: 'わたくし',
  reading: 'わたくし',                 // 朗讀用
  options: ['わたくし', 'おれ', 'ぼく', 'うち'],   // 恰好四個、含正解、不重複
  note: '為什麼是這個而不是別的',
  category: 'business',
  level: 4,
}
```

四條考點軸定義在 `assets/js/data/shared/scene-axes.js`，測試會檢查每條軸都有題目。

### 加一篇閱讀短文

編輯 `assets/js/data/<lang>/readings.js`。一篇短文帶三題以上，
**問法與選項都要寫中文與目標語言兩版**——測驗頁有開關可以切換，缺一邊那個模式就會出現空白。

```js
{
  id: 'en-r-009',
  title: 'A Rainy Afternoon',
  passage: '目標語言的短文。日文 120 字以上，英文 50 詞以上——低於這個下限 schema 會擋下來',
  translation: '中文翻譯，作答後才顯示',
  category: 'daily',
  level: 3,
  questions: [
    {
      id: 'en-r-009-q1',              // 必須是「短文 id + -qN」
      ask: { zh: '中文問題', target: 'The question in English' },
      options: [
        { zh: '正解', target: 'The right answer', correct: true },
        { zh: '干擾一', target: 'A wrong answer' },
        { zh: '干擾二', target: 'Another wrong answer' },
        { zh: '干擾三', target: 'A third wrong answer' },
      ],
      note: '答案在文中的哪裡（一律中文，這是解說）',
    },
  ],
}
```

> 正解直接標在選項上（`correct: true`），不另外寫一個要去對照的 `answer` 欄位——
> 分成兩欄的話，改了選項卻忘了改 answer 就會產生一題無解的題目。
>
> 短文不提供朗讀。整篇的假名轉寫工程量太大，而日文漢字直接餵給語音引擎會唸錯讀音，
> 寧可不給也不要唸錯。

### 加一個分類或語法角色

- 分類：`assets/js/data/shared/categories.js`
- 語法角色：`assets/js/data/shared/roles.js`（顏色的實際色碼在 `theme.css`，這裡只放變數名）
- 句型：`assets/js/data/shared/patterns.js`
- 情境題考點軸：`assets/js/data/shared/scene-axes.js`

---

## 換配色

全站色碼只有一個來源：`assets/css/theme.css` 的深淺基底與配色 `:root` 色票。
導覽列「外觀」統一提供深色／淺色模式切換、四種配色、三種 CSS 背景及降低特效開關。
`palette`、`background`、`reducedEffects` 與 `theme` 同存在 `lang-learn.prefs.v1`，隨原有備份匯出／匯入。
`theme-boot.js` 在 CSS 前套用設定，`ui/appearance.js` 負責互動與匯入同步，`core/appearance.js` 驗證合法值。
玻璃效果只用於導覽與首頁入口，測驗／閱讀表面維持實心。手動「降低特效」會移除微塵、動態與模糊並降低柔光；系統「減少動態」保留靜態微塵、停止動畫與模糊並降低柔光。手動關閉微塵優先。
新增配色要同時調整深淺兩種版本。`structure.test.js` 驗證各色票對比度，`theme.test.js` 驗證啟動與正規化一致；
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

## 學習統計與逐題紀錄

統計以「語言 × 題源」累計（`ja:words`、`ja:cloze`、`en:reading`、`ja:daily`、`ja:practice` 等）。
真實作答按來源、能力及實際方向分開，選擇題不冒充自由產出，有候選詞填空屬 assembly。

共通行為：

- 自由測驗、每日學習與新練習逐題原子保存；半局答題數照常累計，只有全部完成才加一局。
- 自由測驗重開可從設定畫面接續同一份固定題序；未提交的填空草稿不保存。保存失敗須重試，不能換題。
- 每日單字依到期的能力／方向使用匹配的人工練習題；固定快照用於續答與補強，不以辨認題替代拼寫或聽力。沒有同級對應題庫時保留紀錄並明示，不能假報完成；句型練習不因此自動納入每日單字池。
- 不可用儲存時明示停寫；自由測驗可選不保存練習，此模式不提供續答或保存承諾。
- 「清除紀錄」同交易清掉全部學習集合及還原點，提升 epoch 擋舊頁重送；外觀偏好保留。

排程 B 階段使用鎖定版本 FSRS 的預設參數，Again／Good 評分，不自動訓練個人參數。
舊摘要與 due 保留，第一次合格實際複習才建立該能力的 FSRS 狀態；未到期答對不推遠 due，提示或重試不灌熟練分。
固定學習日界管每日配額，FSRS 的間隔由本機排程器計算，不冒稱兩者是一套午夜排程。

> 損壞或未來版本的資料會明確拒絕並保留原件，不用空預設覆蓋。
> 更新不等於清空資料；卸載、清除網站資料或換裝置仍需外部備份。

---

## 授權

`theme.css` 的間距與字級尺度採用 [Open Props](https://open-props.style)（MIT）的比例值。
本機 FSRS vendor 的鎖定版本與 MIT 授權見 [CREDITS.md](CREDITS.md)；網站不在執行期從 CDN 下載該排程器。
