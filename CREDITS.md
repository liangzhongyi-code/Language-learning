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

**不受此條款約束的部分**（全部是本專案自行撰寫，與 NGSL／TSL 無衍生關係）：

- 程式碼
- 句型題庫（`{en,ja}/sentences/`）
- 情境題（`ja/scenes.js`）
- 閱讀短文與題目（`{en,ja}/readings.js`，含 16 篇原創短文與中譯）
- 假名表（`ja/kana.js`）與英文字母表
- 手寫的生活單字（`words/core.js`）
