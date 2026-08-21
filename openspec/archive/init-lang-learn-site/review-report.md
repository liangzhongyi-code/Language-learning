# 程式碼審查報告

| 項目 | 值 |
|---|---|
| change-id | `init-lang-learn-site` |
| 審查日期 | 2026-08-21 |
| 審查基準 | commit `dc3acb5`（首次建置） |
| 方式 | 三位獨立審查員平行稽核（規格合規 / 正確性 / 品質一致性） |
| 結論 | **所有 critical 與 major 問題已修復**，可進入 Phase 6 |

---

## 1. 審查方式

`spec-powers` 的 Phase 5 原訂執行 `/branch-review <base> <feature>`，
但該工具需要兩個各自有 commit 的分支做比對，而本次是**首次建置、單一 commit**，
沒有可比對的基準線。改以等效方式執行：三位獨立審查員從不同角度平行稽核，
互不知道彼此的發現，最後交叉比對。

| 審查員 | 範圍 | 產出 |
|---|---|---|
| 規格合規 | 逐條核對 7 份 spec 的 136 個 Scenario | 4 個 ❌、2 個附帶發現 |
| 正確性 | 找 bug，重點放在無自動化測試保護的 `ui/` 層 | 8 個缺陷，其中 6 個實際重現過 |
| 品質一致性 | 跨模組一致性、分層邊界、死碼、無障礙 | 15 項，含 6 個 major |

三份報告有 3 項重疊發現（錯題朗讀、日文唸假名的三份實作、`PLACEHOLDER_ROLES` 死碼），
交叉印證後優先處理。

---

## 2. 規格合規

| 標記 | 數量 | 說明 |
|---|---|---|
| ✅ 已實作且有測試 | 77 | 主要是 `core/` 的純函式層 |
| 🟡 已實作但無自動化測試 | 55 | 幾乎全是 DOM 行為，靠人工 QA |
| ❌ 未實作或行為不符 | 4 | **已全部修復** |

分佈：content-data 23（22✅）、quiz-game 25（19✅）、progress 19（15✅）、
grammar 15（10✅）、vocabulary 13（6✅）、site-shell 22（4✅）、pronunciation 19（1✅）。

**🟡 佔 40% 是這個架構的已知代價**，不是疏漏——`design.md` 的 TD-5 明確選擇了
「只對 core 層做自動化測試，UI 層走人工 QA」，理由是為了維持零建置零依賴。
本次審查後追加的 `structure.test.js` 把其中一部分（相對路徑、對比度、分層邊界、
資料重複鍵）從 🟡 轉成了 ✅。

---

## 3. 問題分級與處理

### 3.1 Critical

**無。** 沒有任何導致功能完全不可用或資料損毀的問題。

### 3.2 Major（8 項，全部已修）

| # | 問題 | 根因 | 處理 |
|---|---|---|---|
| M1 | 錯題清單的朗讀：外翻中方向整批沒有喇叭，且日文唸漢字 | `summarize()` 沒把 `speakText` 帶進 `wrongList`，UI 只好拿 `correctText` 頂替；又用 `optionLang !== 'zh'` 當顯示條件 | `stats.js` 補 `speakText` 欄位、`quiz-view` 改用它且不再依方向判斷。補 3 條單元測試 |
| M2 | 內文色對比度未達規格要求的 4.5:1 | `--mute` 在四種表面上分別為 3.99 / 3.65 / 3.20 / **2.82**:1 | `--mute` 提亮至 `#9199a3`、`--dim` 連帶提至 `#b3bcc9` 維持三階層次、`--r-particle` 提至 `#8b95a2`。**並把對比度寫成測試** |
| M3 | 換題源後題數變成看不見的幽靈值 | 只記數字不記「使用者要的是全部」，換源後舊總數不對應任何膠囊 | 改記 `useAll` 旗標，「全部」跟著新題源走 |
| M4 | `document` 上的 keydown 攔截 Enter/Space，結果畫面鍵盤卡死 | 守衛只有 `if (!session)`，結果畫面 session 仍在 | 加 `phase` 狀態機 + 焦點在互動元素時讓路 |
| M5 | 語音清單晚於 1200ms 逾時抵達時，誤導提示無法撤回 | 提示只插入、無撤回路徑 | 提示登記到 `pendingNotices`，`refreshVoices` 抓到語音後移除 |
| M6 | 窄螢幕色塊換行時，連接線端點懸在半空中 | `x` 現算但 `y` 寫死成 `0` 與 `h` | `y` 改用色塊實際 rect；375px 下 103 條線端點全部對齊 |
| M7 | 「日文唸假名」這條規則在三處各寫一份，兩份在 ui 層測不到 | 沒有共用模組 | 抽出 `core/speech-text.js`，三處改 import，補 6 條測試 |
| M8 | `quiz-view` 重寫了 `core` 的 `poolOf`，且形狀與其他四支 view 不一致 | 死參數 `noticeHost`、死回傳值、語音接線寫在 HTML 裡 | `poolOf` / `progressPercent` 改為匯出並由 UI 使用；`quiz-view` 內部自行呼叫 `applySpeechFallback` + `bindSpeakButtons`，兩個 quiz.html 的補救呼叫移除 |

### 3.3 Minor（已修）

| # | 問題 | 處理 |
|---|---|---|
| m1 | `en-s-028` 有重複的物件鍵，實際 `category` 變成 `daily` | 修正資料；**並新增掃描原始碼重複鍵的測試**（JS 會靜靜覆蓋，執行期驗證看不到這類錯誤） |
| m2 | 同一顆朗讀鍵連按兩次，`is-speaking` 被前一段的取消事件抹掉 | `speak()` 比對是否仍是當前 utterance 才清除 |
| m3 | 「成績無法保存」警告在結果畫面重入後消失 | `saved` 提升為 session 層級的 `saveFailed` |
| m4 | 首頁與語言首頁的題庫數字全部少 1 | 語言首頁改為從資料檔即時計數；根首頁改為不寫具體數字 |
| m5 | `help.html` 的色塊範例不是 spec 指定的句子 | 換成 `我今天去打羽毛球`（該句已在題庫中） |
| m6 | `PLACEHOLDER_ROLES` 是死碼，註解還與現行規格相反 | 改名 `TARGET_ONLY_ROLES`、修正註解，`grammar-layout` 改為 import 而非自行重新宣告 |
| m7 | `.wrap.wide` 是無人使用的 CSS | 移除 |
| m8 | `structure.test.js` 的 core 層黑名單用子字串比對，擋不住等效寫法 | 改用詞界正則，並補上 `sessionStorage` / `navigator` 等遺漏項。**加一條自我驗證測試** |
| m9 | `drawLinks` 在迴圈裡交錯讀寫，造成上百次強制版面重算 | 改成「先全讀、再全寫」兩階段 |

### 3.4 已知落差（判定為可接受，未修）

| 項目 | 判斷 |
|---|---|
| 假名卡的例字朗讀鍵無法用鍵盤操作 | `.kana` 本身是 `<button>`，內層不能再放可聚焦元素（巢狀互動元素為無效 HTML）。要修得把 `.kana` 改成 `div` + `role`，動到既有結構與 CSS 約定。**列為後續 TODO** |
| 點單一色塊朗讀日文時唸的是漢字 | chunk 層級沒有假名讀音欄位。整句朗讀已正確使用 `reading`。要修得在資料層為每個 chunk 加讀音，是資料模型的擴充而非缺陷修復。**列為後續 TODO** |
| `ui/` 層有 `esc` × 5、`storage()` × 2、`LANG_LABEL` × 3 等重複 | 真實的重複，但目前行為正確且各檔獨立。抽 `ui/dom.js` 是純重構，風險雖低但收益偏維護性；**列為後續 TODO**，避免在剛通過驗證的程式碼上做大範圍搬動 |
| 五份題庫有兩種排版風格 | 日文那兩份走緊湊風格有其道理（欄位短、筆數多）。純風格議題 |

---

## 4. 一個被推翻的既有決策

審查發現 `assets/css/vendor/open-props.min.css`（29KB）內含 344 個十六進位色碼，
而 `specs/site-shell.md` 明確要求「色碼只出現在 `theme.css` 的 `:root`」。
當時 `structure.test.js` 把 `vendor` 排除在掃描之外，**等於用測試把落差藏起來**。

實測後發現：全站只用到 Open Props 607 個變數中的 **13 個**（9 個間距、3 個字級、1 個曲線）。
29KB 換 13 個值，且同時違反「色碼集中」與「零第三方套件」兩條 Requirement。

**處理**：把那 13 個值直接寫進 `theme.css` 並標明出處，移除整個 vendor 目錄，
同時移除測試裡的 `vendor` 豁免。現在「色碼只出現在 theme.css」這條規則
沒有任何例外，測試也真的在守它。

這推翻了 `design.md` 決策時的假設（以為會用到 Open Props 的多數尺度）。
決策本身沒錯，是實作後的實測資料改變了結論。

---

## 5. OpenSpec 合規檢查

- [x] 所有 Requirement 都已實作（4 個 ❌ 已修復）
- [x] 所有可自動化的 Scenario 都有對應測試（77 → 修復後再增）
- [x] 沒有超出 spec 的夾帶變更
  - 唯一的範圍外新增是 `structure.test.js` 與 `speech-text.js`，兩者都是為了滿足既有 Requirement 而生，不是新功能
- [x] `design.md` 的變更記錄已更新（TD-8 的範例錯誤、Open Props 決策反轉）
- [x] `tasks.md` 的過時敘述已修正（T4.5 的助詞佔位格）

## 6. 品質指標

| 指標 | 結果 |
|---|---|
| TDD 遵守 | T1 的 11 個任務全程 RED-GREEN-REFACTOR，每支都親眼見過失敗 |
| 測試數 | 187 → **208**（審查後新增 21 條） |
| 測試通過率 | 208 / 208 |
| 架構分層 | `core/` 零 DOM，由測試強制；審查後把 3 段條件計算從 `ui/` 撿回 `core/` |
| 註解規範 | 三行式區塊註解全數合規，`grep '/\*\*.*\*/'` 零命中；註解說明「為什麼」而非複述程式碼 |
| Console 錯誤 | 12 頁全數 0 |
| 外部請求 | 0（移除 vendor 後連自架的第三方檔案也沒有了） |
| 水平溢出 | 1280px 與 375px 皆為 0 |
| 對比度 | 全部文字色 ≥ 4.5:1，由測試把關 |

---

## 7. 後續 TODO（不阻擋本次交付）

1. 假名卡例字朗讀鍵的鍵盤可及性——需把 `.kana` 從 `button` 改為 `div` + `role="button"`
2. chunk 層級的假名讀音欄位，讓單塊朗讀也能唸對日文
3. 抽出 `ui/dom.js` 收攏 `esc` / `storage` / `LANG_LABEL` / `debounce`
4. 把假名表的格位計算從 `ui/kana-view.js` 移進 `core/kana-layout.js`，
   並讓 `dataset.test.js` import `SECTIONS` 而不是手抄一份
5. 統一五份題庫的排版風格與分隔線註解
