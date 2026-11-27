# 2026-11-27-002：切頁效能優化（消除 Workers 307 轉址、靜態資源快取、Speculation Rules 與卡片合成層減負）

## 基本資訊

- 日期／時區：2026-11-27（Asia/Taipei）
- 類型：效能／平台／快取／畫面合成
- 狀態：已發布 Workers（2026-11-27，Version `db86e1ca-484b-4269-8e65-fc440d953c81`）；未合併 main。
- 核准狀態與依據：使用者回報正式站切頁略卡，明確同意採用四項效能優化方案並部署驗證。
- change-id／規格：本次未新增 OpenSpec；延續 [2026-10-14-002 模組預載](2026-10-14-002-module-preload.md)、[2026-10-15-001 題庫預載](2026-10-15-001-data-preload.md) 與 [2026-11-13-001 雲端同步與 Workers 託管](2026-11-13-001-cloud-sync.md)。
- 相關前次紀錄：[2026-11-27-001 統一 SVG 圖示、Bento 分區、雙欄工作區、結算圓環與 3 款介面質感](2026-11-27-001-ui-polish-styles-bento.md)。
- 分支／commit：`feature/add-cloud-sync`（詳見本次提交紀錄）。

## 需求與原因

正式站（`https://lang-learn.lang-learn.workers.dev`）實測發現四個造成切頁體感卡頓的瓶頸：

1. 全站導覽列與頁內連結指向 `.html` 相對路徑，而 Cloudflare Workers 的 `html_handling: "auto-trailing-slash"` 會對所有 `.html` 頁面回傳 `307 Temporary Redirect`（例如 `/ja/kanji.html` → `/ja/kanji`），每次點擊切頁都白白多耗一次網路往返（實測 135～515ms）。
2. Workers 預設將所有靜態資產回應為 `Cache-Control: public, max-age=0, must-revalidate`（且未回傳瀏覽器長期快取），導致每次切頁都要把約 40～55 個共用的 CSS、JS 與大型題庫資料檔逐一送往邊緣節點重新驗證（`304` 往返約 150～200ms）。
3. 傳統多頁切換必須等到點擊放開後才開始抓取目標 HTML 與後續模組，缺少瀏覽器原生預抓／預渲染機制。
4. 首頁與語言總覽頁（`root`／`home`）的 `.entry` 卡片全面啟用 `backdrop-filter: blur(12px)`，在首頁 8～12 張卡片捲動、懸停與首次繪製時增加 GPU 合成層開銷。

不在此次範圍：不改動為單頁應用（SPA）、不更動 `wrangler.jsonc` 的 `html_handling: "auto-trailing-slash"`（保留既有外部書籤與 `/en/quiz.html?source=words` 的相容轉址契約），亦不變更 GitHub Pages 與本機預覽伺服器的 `.html` 連結格式。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| Workers 正式站導覽列與頁內連結 | `nav.js` 與頁內靜態／動態連結均輸出 `.html`（如 `./kanji.html`、`../index.html`），點擊後觸發 `307` 轉址再載入目標頁 | 當 `cloudMode(window.location.origin, CLOUD_CONFIG) === 'cloud'` 時，`renderNav()`、`renderRootNav()` 與 `normalizeCloudLinks()` 將站內相對 `.html` 連結正規化為無 `307` 路徑（`./kanji`、`../`、`./quiz?source=kana` 等），GitHub Pages／本機／APP 維持 `.html` 不變 |
| Workers 靜態資產 HTTP 快取標頭 | `dist-site/` 未產生 `_headers`，所有 `/assets/*` 皆回應 `Cache-Control: public, max-age=0, must-revalidate` | `tools/build-site.mjs` 產生 `dist-site/_headers`：`/assets/*` 設為 `Cache-Control: public, max-age=600, stale-while-revalidate=86400`；`/assets/js/data/*` 設為 `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`；HTML 頁面維持預設不設長快取，`/_headers` 本身不對外暴露（404） |
| 瀏覽器切頁前預載 | 僅於目標頁 HTML 內有 `<link rel="modulepreload">`；點擊前未先抓目標頁 | `nav.js` 於支援 Speculation Rules 且未開啟 `navigator.connection.saveData` 的瀏覽器注入 `<script type="speculationrules">`（`eagerness: "moderate"`）：站內非 `/api/*`、`/admin*` 頁面啟用 `prefetch`；僅純閱讀／查詢頁（`kana`、`kanji`、`vocabulary`、`grammar`、`reading`、`guide`、`alphabet`、`help`、`privacy`）啟用 `prerender`，排除會主動寫入 IndexedDB 的頁面（如 `daily`） |
| 首頁與總覽頁卡片毛玻璃特效 | `.topbar` 與 `root`/`home` 的 `.entry` 皆使用 `backdrop-filter: blur(12px)` | 僅保留 `.topbar` 的毛玻璃模糊效果，移除 `.entry` 的 `backdrop-filter`，保留原有的邊框、漸層底色與圓角視覺層次 |

## 規則、邊界與取捨

- 正常路徑：於 Workers 正式站瀏覽時，導覽列連結在注入當下即為正規路徑，既有與動態產生的頁內連結在初始與互動（`pointerover`／`focusin`／`click` 捕獲階段）時轉為正規路徑；第二次切頁起 `/assets/*` 與 `/assets/js/data/*` 直接命中瀏覽器磁碟／記憶體快取（`0ms` 網路等待）；Chromium 桌面與行動版在游標停留或按下瞬間預抓／預渲染目標頁。
- 空資料、失敗、取消、重試與競態：
  - `canonicalCloudHref(href)` 保留 `?query` 與 `#hash`，略過絕對 URL（含 `http:`、`https:`、`mailto:`、`//`）與純 `#anchor`。
  - Speculation Rules 僅於 `HTMLScriptElement.supports?.('speculationrules')` 為真且 `!navigator.connection?.saveData` 時注入，且檢查重複不重覆插入；Firefox／Safari 等未支援瀏覽器無任何錯誤。
  - `prerender` 嚴格限定純閱讀／查詢頁，避免 `daily` 等具儲存初始化或進度寫入行為的頁面在未被點擊時提前寫入本機狀態。
  - `_headers` 僅在 `tools/build-site.mjs` 打包 `dist-site/` 時產生，不影響本機檔案與 GitHub Pages；`/assets/js/data/*` 規則前加入 `! Cache-Control` 解除 `/assets/*` 標頭繼承，避免回應疊加兩組 `Cache-Control`；Workers 平台依規則隱藏 `/_headers` 回應 404，並由 H02 與 H03 測試把關。
- 分級／語言／平台差異：
  - `cloud` 站（`https://lang-learn.lang-learn.workers.dev`）啟用無 `307` 路徑正規化；GitHub Pages、Tauri APP、本機 `serve` 與隔離測試伺服器（`cloudMode !== 'cloud'`）維持 `.html` 路徑，確保離線封裝與現有回歸測試選擇器零破壞。
  - 靜態資產快取在 `max-age` 到期後仍透過 `stale-while-revalidate` 背景更新，兼顧新版發布後 10 分鐘內自動生效與切頁零等待。
- 為什麼採這個方案？放棄什麼？
  - 放棄將專案改寫為 SPA 或引入 Service Worker：前者會破壞多頁直連、瀏覽器原生歷程與大量測試結構；後者會提高離線快取失效與除錯複雜度。改以 Workers 原生 `_headers` + 消除 `307` + 瀏覽器原生 Speculation Rules，改動小、零外部依賴、風險可控且收益直接。

## 影響範圍

- `assets/js/ui/nav.js`：新增 `canonicalCloudHref()`、`pageHref()`、`normalizeCloudLinks()`、`installSpeculationRules()`，並於 `renderNav()` 與 `renderRootNav()` 套用。
- `tools/build-site.mjs`：新增 `SITE_GENERATED = ['_headers']` 與 `HEADERS_CONTENT`，於 `buildSite()` 產出 `dist-site/_headers`。
- `assets/css/theme.css`：移除 `body[data-page='root'] .entry` 與 `body[data-page='home'] .entry` 的 `backdrop-filter: blur(12px)` 區塊，保留 `.topbar` 毛玻璃效果。
- `tests/build-site.test.js`：更新 H02 打包白名單測試，允許 `SITE_GENERATED`（`_headers`）並驗證其內容完全吻合 `HEADERS_CONTENT`。
- `tests/worker-routing.test.js`：擴充 H03 本機 Worker 測試，驗證 `/assets/css/theme.css`、`/assets/js/data/catalog/meta.js` 的 `Cache-Control` 標頭與 `/_headers` 回傳 404。
- `tests/appearance-ui.test.js`：新增 `canonicalCloudHref()` 與 `cloud`/`off` 模式導覽連結正規化單元測試。
- `docs/logic-changes/2026-11-27-002-page-switch-perf.md`、`docs/logic-changes/README.md`：記錄本次變更與實測驗證。

## 資料相容、遷移與回復

不更動 IndexedDB、`localStorage`、備份格式、雲端 API 契約或任何使用者學習資料。回復時還原上述程式碼並重新執行 `npx wrangler deploy` 即可（舊快取最多於 `max-age` 到期後自動更新）。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-11-27 | 正式站優化前基準量測（`https://lang-learn.lang-learn.workers.dev`） | `/ja/index.html` → 307（515ms）、`/ja/quiz.html` → 307（441ms）、`/ja/kanji.html` → 307（135ms）、`/ja/vocabulary.html` → 307（177ms）；`/assets/css/theme.css`（196ms）與 `/assets/js/data/catalog/ja-words-1.js`（195ms）皆為 `public, max-age=0, must-revalidate` | 基準為優化前單次跨區量測 |
| 2026-11-27 | 全量 `npm test`、`npm run check:preload`、`npm run check:catalog`，以及修復 `! Cache-Control` 後複跑 `node --test tests/build-site.test.js tests/worker-routing.test.js` | 全量 Node 測試 `1510/1510 PASS`；`check:preload`（23 頁）與 `check:catalog`（22 資源）全數 PASS；`_headers` 修正後 `build-site.test.js`＋`worker-routing.test.js` 9/9 PASS（精確比對 `Cache-Control` 且 `/_headers` 回 404） | 修正 `! Cache-Control` 後僅複跑受影響的建置與 Worker 測試，未再重跑無關單元測試 |
| 2026-11-27 | Chromium `page-loading`、`appearance-effects`、`cloud-hosting` | 三組套件全數 PASS（`appearance-effects` 40 組像素＋56 組 computed 零失敗；`cloud-hosting` 35 個非網站路徑全數 404） | 其餘瀏覽器套件未全量重跑 |
| 2026-11-27 | `npx wrangler deploy` 與正式站 Playwright 實測（`https://lang-learn.lang-learn.workers.dev`） | 部署成功（Version ID：`db86e1ca-484b-4269-8e65-fc440d953c81`）。標頭實測：`/assets/css/theme.css` 與 `/assets/js/ui/nav.js` 為精確 `public, max-age=600, stale-while-revalidate=86400`；`/assets/js/data/catalog/ja-words-1.js` 與 `/assets/js/data/ja/kanji.js` 為精確 `public, max-age=86400, stale-while-revalidate=604800`；`/_headers`、`/package.json`、`/docs/logic-changes/README.md` 回 404；`/api/me` 回 401。頁內與導覽連結零 `.html`、`<script type="speculationrules">` 已注入、`.entry` `backdrop-filter: none`（`.topbar` 保留 `blur(14px)`）。連續 5 次導覽切頁（漢字→單字→測驗→閱讀→首頁）：**0 次 `307` 轉址**，靜態資源快取命中率 **100%**（41/41、48/48、60/60、46/46、63/63 皆 `transferSize === 0`），點擊到 `load` 耗時為漢字 `122ms`（load `93ms`）、單字 `115ms`（load `96ms`）、測驗 `250ms`（load `126ms`）、閱讀 `113ms`（load `94ms`）、首頁 `110ms`（load `81ms`） | 行動裝置 Safari／Firefox 與真實 4G 網路待人工抽檢 |

## 未完成項目與發布狀態

- 尚待處理：合併 `main` 維持暫緩；行動裝置 Safari／Firefox 實機切頁體感待人工抽檢。
- 提交／發布證據：已發布至 Cloudflare Workers（`https://lang-learn.lang-learn.workers.dev`，Version `db86e1ca-484b-4269-8e65-fc440d953c81`），並推送至 `origin/feature/add-cloud-sync`。

## 後續更正／取代

無。
