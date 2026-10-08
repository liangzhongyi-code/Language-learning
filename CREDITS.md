# 資料來源與授權

本站的**單字**題庫有一部分是從公開授權的學術字表匯入的。
中文翻譯、主題分類與等級對照為本專案自行編寫，原始字表的授權條款如下。

單字以外的題庫——句型、情境題、閱讀短文、假名表——全部是本專案自行撰寫，
沒有引用任何外部素材。

---

## 英文

### New General Service List (NGSL) 1.2

- 作者：Browne, C., Culligan, B., & Phillips, J.
- 網站：<https://www.newgeneralservicelist.com/new-general-service-list>
- 授權：[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- 內容：2,801 個通用高頻詞，取自劍橋英語語料庫 2.73 億字的子集

### TOEIC Service List (TSL) 1.1

- 作者：Browne, C., & Culligan, B. (2016)
- 網站：<https://www.newgeneralservicelist.com/toeic-service-list>
- 授權：[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- 內容：1,259 個多益專屬詞，取自 150 萬字的多益備考教材語料庫

**重要：ETS 從未公布過官方的多益單字表。** 本站的「多益分數帶」分級是依
上述兩份字表的詞頻排名推估的參考值，不是官方對照表，也不代表任何分數保證。

## 日文

### JLPT 單字表

- 來源：<https://github.com/jamsinclair/open-anki-jlpt-decks>（MIT License）
- 上游：Jonathan Waller 整理的 <https://www.tanos.co.uk/jlpt/> 系列清單
- 內容：N5–N1 共 7,896 個詞（已跨級去重，重複者歸入較低的級別）

**重要：JLPT 主辦單位自 2010 年改制為 N1–N5 之後即停止公布官方單字表。**
上述清單是社群依據舊版《日本語能力試験出題基準》與教材整理的非官方版本，
與實際考題不保證一致。

---

## ShareAlike 的影響

NGSL 與 TSL 採 CC BY-SA 4.0，衍生作品必須以相同條款釋出並標註原作者。
本專案匯入的英文單字資料（`assets/js/data/en/words/` 底下標明來源為
NGSL 或 TSL 的批次檔）因此同樣以 **CC BY-SA 4.0** 釋出。

以下與 NGSL／TSL 無衍生關係；自行撰寫部分採本專案授權，第三方程式各遵守下方授權：

- 程式碼（第三方排程程式另見下方 ts-fsrs 授權）
- 句型題庫（`{en,ja}/sentences/`）
- 情境題（`ja/scenes.js`）
- 閱讀短文與題目（`{en,ja}/readings.js`，含 16 篇原創短文與中譯）
- 假名表（`ja/kana.js`）與英文字母表
- 手寫的生活單字（`words/core.js`）

---

## 第三方程式：ts-fsrs 5.4.2

- 名稱／版本：`ts-fsrs` **5.4.2**，套件與 lockfile 均鎖定此版本。
- 來源：[open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)；本次授權查證依已安裝 5.4.2 套件的 `package.json`、`dist/index.mjs` 與 `LICENSE`，不是依上游最新分支推定。
- 著作權：`Copyright (c) 2026 Open Spaced Repetition`。
- 授權：**MIT License**，完整原文保留如下，亦包含在 `assets/js/vendor/ts-fsrs.js` 檔頭。
- 本機來源：`node_modules/ts-fsrs/dist/index.mjs`；執行期使用專案內 `assets/js/vendor/ts-fsrs.js`，不透過 CDN 載入。
- 本專案轉換：`tools/build-fsrs.mjs` 對固定來源的 class fields 做 ES2020 DefineProperty 初始化轉換、移除 sourceMappingURL，並加入授權與來源／輸出雜湊。來源版本、授權或 SHA-256 不符即拒絕建置。
- 固定來源 SHA-256：`ad4a4b3b7e259fcbf02764454c8f9db4ea3bf5aae2f473198129ecb7728f1a19`；目前轉換後主體 SHA-256：`8e826625db368a195b8eef907235fdb5063775daf93e81fa7857fd3a177212d2`（不含檔頭）。
- 查證日期：2026-10-08。`node tools/build-fsrs.mjs --check` 本次退出碼 0，確認 vendor 可重現且保留完整 MIT 授權；未重新輸出 vendor。

ts-fsrs 是第三方程式，不能列為本站自行撰寫的程式碼；其 MIT 授權與英文題庫的 CC BY-SA 4.0 分別標示。本批 FSRS 與文件尚未提交／推送／發布；原生平台與完整大資料效能未驗證，不能由授權或 ES2020 檢查推定已完成平台驗收。

### MIT 授權原文（ts-fsrs 5.4.2）

```text
MIT License

Copyright (c) 2026 Open Spaced Repetition

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
