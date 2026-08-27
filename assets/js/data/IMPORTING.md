# 題庫分批匯入作業手冊

這份文件記錄「把外部字表匯入本專案題庫」的完整流程與踩過的坑。
英文部分（TSL 1,248 + NGSL 2,779 + 手寫核心 84 = 4,033 筆）就是照這套做完的。

---

## 一、每一批的固定步驟

1. **取字 + 撞號檢查**——列出這一批的原文字，標出與現有題庫 `target` 重複的
2. **寫批次檔**——`assets/js/data/<lang>/words/<來源>-NN.js`
3. **接上匯總入口**——`words.js` 加兩行（import + 展開）
4. **跑測試**——`npm test`，不綠不進下一步
5. **修測試抓到的撞號**——通常是 `zh` 重複
6. **commit + push**——一批一個 commit，訊息寫明排除了哪些字、哪些近義字拉開了中文

一批約 200 字。批次檔獨立、互不相依，任何一批出問題可以單獨 revert。

---

## 二、批次檔的格式

資料寫成「一列一個字」的元組表，不是物件字面值：

```js
const rows = [
  ['會議', 'conference', 'noun', 'business'],
  // [中文, 目標語, 詞性, 主題分類]
];

const LEVEL = 3;
const START = 85;   // 接在上一批最後一筆之後

export const words = rows.map(([zh, target, pos, category], i) => ({
  id: `en-w-${String(START + i).padStart(3, '0')}`,
  zh, target, reading: null, romaji: null, pos, category, level: LEVEL,
}));
```

理由有三：

- **id 由起始號推算**，杜絕手打流水號跳號或重號
- **一批兩百筆的 diff 還看得完**，錯誤不會混進去看不見
- **壓縮率好**：實測 4,033 筆原始 235 KB，gzip 後只有 62 KB，每字 15 bytes。
  當初擔心的「上萬筆會讓頁面爆掉」在這個格式下自己消失了，
  不需要動態載入那一整套複雜度

一批跨兩個等級時，拆成兩個陣列再 concat，用 `stamp(level)` 蓋上等級：

```js
const stamp = (level) => (row) => [...row, level];
const rows = [...TIER_1.map(stamp(1)), ...TIER_2.map(stamp(2))];
```

---

## 三、兩條鐵律

### 1. 同一個中文只能對到一個目標語單字

這是整件事最花工夫的部分，累計拉開超過 200 組近義字。

違反的後果不是「不好看」，是**那一題沒有正確答案**：中翻英題面「垃圾」
會同時對到 garbage 和 trash，作答者選哪個都對，但系統只認一個。

兩種處理方式：

**完全同義的字直接不收。** 英文最後未收 33 個字，全部屬於這一類：

| 未收 | 原因 |
|---|---|
| `automobile` / `auto` | 與 core 的 `car` 同義 |
| `memorandum` | 與 `memo` 同義 |
| `photocopier` | 與 `copier` 同義 |
| `trash` | 與 `garbage` 同義 |
| `jog` / `swim` | 與 core 的 `jogging` / `swimming` 只差詞性 |
| `businessman` / `salesman` / `chairman` | 與 `-person` 版本只差性別詞尾 |
| `graphics` / `salespeople` / `statistic` / `criterion` | 單複數同一個字 |
| `exam` / `pro` / `photo` / `ad` / `lab` | 已收全稱的縮寫 |
| `till` / `whilst` / `adviser` | 已收字的拼法變體 |
| `taxi` / `lawyer` / `bike` / `dad` / `mom` / `wed` / `meanwhile` / `journalist` / `laboratory` / `teenager` / `plane` / `advertisement` / `obligate` | 與已收字完全同義 |

**意思有差但中文會撞的，改中文而不是不收。** 例如：

```
adhere   遵守       comply  遵循       conform 合乎標準   abide 恪守
exact    精確的     accurate 精準的    precise 一絲不苟的
strange  奇怪的     odd     反常的     weird   怪異的
exit     出口       export  外銷        ← 意思完全不同，中文卻同形
```

每一組都要寫進批次檔的檔頭註解，之後看得出當初為什麼這樣選。

### 2. 詞性衍生字要全收，但中文必須分得開

`deduct 扣除` / `deduction 扣除額`、`enthusiastic 熱情的` /
`enthusiastically 熱情地` / `enthusiasm 熱忱` / `enthusiast 愛好者`——
這些**刻意全收**，因為詞性辨析正是多益 Part 5 的題型。
代價是題目會偏難，這是設計上的取捨，不是缺陷。

---

## 四、測試是防線，但它不驗遺漏

`npm test` 會擋下：

- `zh` 或 `target` 全域重複（`dataset.test.js`）
- id 格式錯誤、等級或分類不在允許值內（`schema.test.js`）
- 任何被用到的分類少於 4 筆——低於這個數字，同分類干擾選項會退化成跨類別亂抽

英文匯入過程中，測試實際抓到四次撞號：`automobile`↔`car`、`jog`↔`jogging`、
`swim`↔`swimming`、`effective`↔`valid`、`export`↔`exit`。

**但測試不會告訴你少收了字。** `decision` 在 NGSL 第 3 批規劃時有、寫檔時掉了，
是最後跑「全表 vs 已收」覆蓋率比對才發現的。

> **每個來源收完後，一定要跑一次覆蓋率盤點，並逐字看過未收清單。**
> 未收的每一個字都應該有明確理由；沒有理由的就是漏了。

---

## 五、分類與等級

### 分類（`shared/categories.js`）

43 個，分四組：生活 / 通用 / 語法 / 商務。

商務類直接沿用 **ETS 公布的多益測驗內容領域**（一般商務、人事、財務、
製造、採購、辦公室、旅遊、外食⋯），不是自己發明的。
這樣分出來的干擾選項才會落在同一個真實情境裡：
「發票」的干擾項是「報價單、收據、預算」而不是「香蕉」。

**語法組（介系詞／連接詞／代名詞／助動詞／其他功能詞）是為了干擾選項才拆開的。**
NGSL 最高頻的兩百個字有一半是 of／to／would／because 這類功能詞，
全部混在一個「功能詞」大類的話，「在…上面」的干擾項會抽到「我」「而且」，
等於送分。拆開之後才會變成 in／at／over，真的在考介系詞辨析。

不想練功能詞的人可以在單字頁把「語法」整組取消勾選。

### 等級（`shared/levels.js`）

資料層統一用 1–5 的整數，顯示成什麼由該檔決定。

| level | 英文（多益分數帶） | 日文 |
|---|---|---|
| 1 | ≤400 | N5 |
| 2 | 400–600 | N4 |
| 3 | 600–800 | N3 |
| 4 | 800–990 | N2 |
| 5 | 多益進階 | N1 |

英文的對應是**依詞頻排名推估的參考值**，不是官方對照表——
ETS 從未公布過任何官方單字表。網站上必須把這件事講清楚
（`SCALE_NOTE` 就是幹這個的），不能讓人以為「背完 level 3 就有 800 分」。

實際映射：

```
NGSL   1– 500 → 1      TSL   1– 300 → 3
NGSL 501–1200 → 2      TSL 301– 800 → 4
NGSL 1201–2000 → 3     TSL 801–1259 → 5
NGSL 2001–2801 → 4
```

---

## 六、日文的額外注意事項

英文的 `reading` / `romaji` 一律是 `null`，日文兩者都必須填。

- **`reading`** 填平假名。朗讀一律送 `reading` 而不是 `target`，
  漢字丟給語音引擎會被挑到別的讀法（「雨」會唸成「う」）
- **`romaji`** 不要手打。`scratchpad/kana-romaji.mjs` 有寫好的轉換器，
  促音、長音、拗音、`ん` 隔音符（しんいち → `shin'ichi`）都處理了，
  對照專案現有 85 筆手寫資料驗證過 **85/85 全中**

日文的同義字問題比英文更兇，因為漢字詞和和語詞常常同義
（「明日／あした」「食事／ごはん」），下手前先想清楚要收哪一個。

---

## 七、資料來源

見專案根目錄的 `CREDITS.md`。NGSL 與 TSL 採 CC BY-SA 4.0，
衍生資料同樣以 CC BY-SA 4.0 釋出。
