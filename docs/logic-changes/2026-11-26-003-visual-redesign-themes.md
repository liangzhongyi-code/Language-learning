# 2026-11-26-003：全站視覺翻新與 8 款可自選主題

## 基本資訊

- 日期／時區：2026-11-26（Asia/Taipei）
- 類型：畫面／外觀／主題系統
- 狀態：已發布 Workers（2026-11-27，Version `4de6be08-fe12-4e7b-a7f6-89a33363caa2`）；未合併 main。
- 核准狀態與依據：使用者明確要求進行全站視覺大幅翻新、新增多個可自選主題，並於本機預覽後核准部署上線。
- change-id／規格：本次未新增 OpenSpec；沿用既有外觀偏好契約（`assets/js/core/appearance.js`、`assets/js/core/backup.js`），文件規範依 [AGENTS.md](../../AGENTS.md) 與 [範本](TEMPLATE.md)。
- 相關前次紀錄：[2026-10-08-002 背景可見度](2026-10-08-002-appearance-effects.md)。
- 分支／commit：`feature/add-cloud-sync`（詳見本次提交紀錄）。

## 需求與原因

既有站點雖支援深淺模式與 4 組配色，但各配色僅調整底色與強調色，卡片表面、邊框與文字層次幾乎不變，整體視覺偏扁平。使用者希望進行全站視覺大幅翻新，並提供多個可自選主題，涵蓋首頁、英日文所有學習頁、說明頁、隱私權頁與管理後台。

本次範圍包含全站視覺設計系統翻新與可自選主題擴充；不變更測驗判題、FSRS 排程、題庫資料、雲端同步協議或備份檔案版本。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 可選主題數量 | 4 款（classic、midnight、forest、warm），僅覆寫 `--bg` 與 `--accent` | 8 款（保留原 4 款鍵值並新增 `sakura`、`violet`、`sunset`、`mono`），每款在深／淺雙模式皆獨立調校完整表面色階（`--bg`、`--surface`、`--surface-2`、`--surface-3`、`--border`、`--border-strong`、`--text`、`--dim`、`--mute`、`--accent`、`--accent-ink`、`--glow`、`--glow-secondary`），共 16 組達標色票 |
| 外觀設定面板 | 入口標示「外觀」，4 格單純漸層預覽 | 入口改為「主題外觀」並附目前主題強調色圓點；面板提供深淺分段切換、8 款迷你介面色票卡（含標題、氛圍說明與即時深淺預覽）與 3 種背景氛圍 |
| 全站頁面視覺階層 | 單一平面表頭、裸圖示入口卡、基礎按鈕與表格樣式 | 升級全站 21 頁：毛玻璃頂部導覽列與膠囊分頁、帶強調色標記的 `.page-head` 表頭、首頁雙欄語系主打入口卡（`.is-hero` / `.is-portal`）、柔色圓角圖示框、互動箭頭提示、升級版今日學習與統計條、測驗選項鍵盤帽與進度條、漢字／假名／閱讀／文法／歷程／後台表格一致視覺語言 |
| 頁面語意標記 | `index.html` 含行內 `style="cursor:default"` 與 `style="margin-top:28px"`；`admin.html` 僅裸 `<h1>` | `index.html` 改用語意類別 `.is-hero`、`.is-portal`、`.is-static`、`.actions.is-spaced`；`admin.html` 補齊 `.page-head`；`help.html` 同步更新 8 款主題說明 |

## 規則、邊界與取捨

- 正常路徑：使用者於任意頁面點擊導覽列「主題外觀」切換顯示模式、8 款主題、3 種背景或降低特效，頁面立即套用並寫入 `lang-learn.prefs.v1`，同時隨既有備份與雲端快照保存。
- 空資料、失敗、取消、重試與競態：沿用既有 `normalizeAppearance()` 與 `theme-boot.js`；未知主題值或損毀設定安全回退至 `dark` / `classic` / `aurora` / `false`。儲存失敗時仍保留本頁狀態並顯示提示。
- 分級／語言／平台差異：全站 21 頁共用 `assets/css/theme.css` 與 `theme-boot.js`，不引用外部字型或 CDN，所有色碼集中於 `theme.css`。所有 16 組深淺主題皆通過 WCAG AA 4.5:1 內文與主按鈕對比、3:1 控制項邊界對比。測驗卡片維持實心底色；手動「降低特效」與系統 `prefers-reduced-motion` 契約不變。
- 取捨說明：沿用既有 `palette` 鍵值擴充主題而非新增偏好欄位，確保舊版備份、雲端同步快照與 `backup.js` 零遷移成本且 100% 向前相容。

## 影響範圍

- `assets/js/core/appearance.js`：擴充 `PALETTES` 至 8 款並補充 `note` 氛圍說明。
- `assets/js/ui/theme-boot.js`：同步更新首屏啟動白名單為 8 款主題。
- `assets/js/ui/appearance.js`：升級外觀面板為「主題外觀」，呈現 8 款主題卡片與氛圍說明。
- `assets/css/theme.css`：新增 8 款主題深淺雙模式完整表面與預覽色票，全面翻新全站 21 頁版面、導覽列、卡片、表單、測驗、發音、漢字、文法、閱讀、歷程與管理後台樣式。
- `index.html`、`admin.html`、`help.html`：首頁語意類別清理、管理頁補齊 `.page-head`、教學頁更新主題清單說明。
- `tests/structure.test.js`、`tests/theme.test.js`、`tests/browser/suites/appearance-effects.mjs`：將 WCAG 對比度檢查、啟動正規化測試與瀏覽器視覺回歸覆蓋擴展至全部 8 款主題。
- `docs/logic-changes/2026-11-26-003-visual-redesign-themes.md`、`docs/logic-changes/README.md`：記錄本次變更與驗證結果。

## 資料相容、遷移與回復

不變更儲存 key（`lang-learn.prefs.v1`）與備份格式版本。舊備份中的 `classic`、`midnight`、`forest`、`warm` 原樣相容；若將含新主題（如 `sakura`）的備份匯入舊版網站，舊版 `normalizeAppearance()` 會安全回退為 `classic`。回復時只需還原上述檔案變更即可，不需資料遷移。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-11-26 | `node --test tests/structure.test.js tests/theme.test.js tests/appearance-ui.test.js tests/backup.test.js tests/backup-validation-regression.test.js tests/documentation-links.test.js tests/module-preload.test.js tests/build-site.test.js` | PASS 63/63（包含 8 款主題 × 深淺雙模式共 16 組 WCAG AA 4.5:1 與控制項邊界 3:1 對比、96 種啟動正規化組合、備份相容與文件連結） | 未執行全專案 `npm test` 與 Worker 套件 |
| 2026-11-26 | `npm run check:preload` | PASS preload 23 頁 | 不適用 |
| 2026-11-26 | `node tests/browser/run.mjs --suite appearance-effects` | PASS（40 組像素量測＋56 組 computed 驗證，0 失敗，覆蓋全部 8 款主題 × 深淺 × 320／375／1280px） | 真機 Safari／實機 Android 未測 |
| 2026-11-26 | `node tests/browser/run.mjs --suite page-loading`、`study-tools`、`grammar-links` | 三組皆 PASS | 其餘瀏覽器套件未全量重跑 |
| 2026-11-26 | Chromium 多主題截圖目視檢查（首頁經典靛藍深色＋外觀面板、櫻霞暮粉淺色、日文首頁抹茶森綠深色、測驗暮紫星雲深色、漢字溫潤和紙淺色、閱讀琥珀晚霞深色、手機 375px 首頁） | 目視確認無水平溢出（`mobileOverflow=false`），並於檢查中修復切換深淺主題時的過渡殘色與桌面 `.today-card` 雙層內距問題後重測通過 | 未逐頁在真機實測所有 21 頁 |
| 2026-11-27 | `npm test`、`node --test tests/catalog.test.js`、`npm run check:catalog`、`npm run check:preload` | 全量 Node 測試 1507/1508 通過；唯一失敗為 Windows `core.autocrlf` 導致 `assets/js/data/catalog/meta.js` 換行成 CRLF，還原 LF 後 `catalog.test.js` 7/7、`check:catalog`（22 資源）、`check:preload`（23 頁）全數 PASS | 未全量重跑所有瀏覽器套件 |
| 2026-11-27 | `npx wrangler deploy` 與正式站 13 項煙霧檢查（`https://lang-learn.lang-learn.workers.dev`） | 部署成功（Version ID：`4de6be08-fe12-4e7b-a7f6-89a33363caa2`，上傳 48 檔）；`/`、`/ja/`、`/ja/quiz`、`/ja/kanji`、`/ja/reading`、`/help`、`/admin`、`/assets/css/theme.css`、`/assets/js/core/appearance.js`、`/assets/js/ui/appearance.js` 皆回 200 且含新版標記與 8 款主題；`/api/me` 回 401；`/package.json` 與 `/docs/logic-changes/README.md` 回 404 | 真機 Safari／實機 Android 未測 |

## 未完成項目與發布狀態

- 尚待處理：合併 `main` 依既定決議維持暫緩；真機 Safari／Android 視覺與操作待人工抽檢。
- 提交／發布證據：已發布至 Cloudflare Workers（`https://lang-learn.lang-learn.workers.dev`，Version `4de6be08-fe12-4e7b-a7f6-89a33363caa2`），並推送至 `origin/feature/add-cloud-sync`。

## 後續更正／取代

無。
