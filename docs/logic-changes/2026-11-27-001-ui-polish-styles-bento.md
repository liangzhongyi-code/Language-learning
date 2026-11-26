# 2026-11-27-001：統一 SVG 圖示、Bento 分區、雙欄工作區、結算圓環與 3 款介面質感

## 基本資訊

- 日期／時區：2026-11-27（Asia/Taipei）
- 類型：畫面／外觀／介面質感／互動體驗
- 狀態：已發布 Workers（2026-11-27，Version `5e519153-18bb-4005-b1ef-35d81da39f97`）；未合併 main。
- 核准狀態與依據：使用者明確核准全數採用四項第二波視覺升級方向並於驗證後直接部署上線。
- change-id／規格：本次未新增 OpenSpec；延續既有外觀偏好與備份白名單契約，文件規範依 [AGENTS.md](../../AGENTS.md) 與 [範本](TEMPLATE.md)。
- 相關前次紀錄：[2026-11-26-003 全站視覺翻新與 8 款可自選主題](2026-11-26-003-visual-redesign-themes.md)。
- 分支／commit：`feature/add-cloud-sync`（詳見本次提交紀錄）。

## 需求與原因

第一波翻新完成 8 款深淺主題色票後，使用者希望進一步提升整體美觀度與產品精緻感：消除系統 Emoji 造成的跨平台風格破碎、打破全等寬方格的平面排列、改善桌面版漢字表與閱讀頁反覆捲動體驗、增強測驗結算視覺回饋，並提供可自選的介面版面質感風格。

## 變更前與變更後

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 圖示系統 | 入口卡與全站朗讀／跟讀按鈕使用系統 Emoji（`🔊`、`🎤`、`📅`、`🧩` 等） | 改用統一筆畫（`1.85px` 圓角線條、`currentColor`）的純離線內聯 SVG 圖示（`SPEAK_ICON` 集中於 `speech.js`，`shadow.js` 具統一麥克風／播放／停止圖示，首頁與英日文入口卡僅保留 `Aa`/`あ`/`ア`/`漢` 文字徽章） |
| 首頁與語言總覽版面 | `ja/index.html` 12 張卡與 `en/index.html` 8 張卡全等寬平鋪 | 改為三區階層（每日主線／基礎打底／沉浸或管理與紀錄），「每日主線」採不對稱 Bento 網格並凸顯「今日學習」寬卡；首頁表頭新增網站特色標籤，雙語主打卡附能力摘要 |
| 漢字表與閱讀查詞 | 單欄垂直堆疊，桌面版點選漢字或查詞需上下捲動 | 桌面版（漢字 ≥960px、閱讀 ≥1024px）啟用左右雙欄 `.split-workspace`，右側為常駐黏滯詳情／查詞面板；手機版自動折回單欄並隱藏閒置空框 |
| 測驗結算與微回饋 | 結算僅顯示純文字分數；作答對錯無輕量微動效 | 結算畫面新增純 SVG 圓環正確率圖（依分數區間套用 `--ok`/`--accent`/`--warn`）；答對輕彈、答錯微震與回饋淡入均遵守「降低特效」與系統減少動態設定 |
| 介面質感自選 | 僅能切換深淺、色票與背景 | 新增 `style` 外觀偏好，提供「現代俐落（`modern`）」「溫潤圓角（`soft`）」「極簡紙本（`editorial`）」3 款可自選介面質感，同步納入 `theme-boot.js`、備份白名單與雲端快照 |

## 規則、邊界與取捨

- 正常路徑：使用者可在「主題外觀」面板自由組合 2 種深淺 × 8 款色票 × 3 款介面質感 × 3 種背景，偏好即時套用並隨備份／雲端同步保存。
- 空資料、失敗、取消、重試與競態：舊備份不含 `style` 欄位時，`normalizeAppearance()` 與 `theme-boot.js` 安全預設為 `modern`；未知 `style` 值於備份驗證或載入時拒絕／回退。
- 分級／語言／平台差異：所有 SVG 為純離線內聯向量，無外部資源或新增執行期依賴；所有色碼集中於 `theme.css`；`SPEAK_ICON` 置於既有 `speech.js`，不更動各頁模組預載圖或 Tauri 資源清單。
- 取捨說明：閱讀頁於 ≥1024px 將 `.rd-lookup` 置於右側黏滯面板，於 <1024px 維持就地展開於該句工具列下方，兼顧桌機免捲動與手機就近閱讀。

## 影響範圍

- `assets/js/core/appearance.js`、`assets/js/ui/theme-boot.js`、`assets/js/ui/appearance.js`、`assets/js/ui/prefs.js`：新增 `STYLES` 與 `style` 偏好。
- `assets/js/core/backup.js`、`assets/js/core/learning-backup.js`、`assets/js/ui/learning-backup-view.js`、`assets/js/ui/google-backup-view.js`：將 `style` 納入可攜偏好與備份白名單。
- `assets/js/ui/speech.js`、`assets/js/ui/shadow.js`、`assets/js/ui/vocab-view.js`、`assets/js/ui/grammar-view.js`、`assets/js/ui/grammar-points-view.js`、`assets/js/ui/kana-view.js`、`assets/js/ui/daily-view.js`、`assets/js/ui/library-view.js`：統一朗讀／跟讀 SVG 圖示。
- `assets/js/ui/kanji-view.js`、`assets/js/ui/reading-view.js`、`assets/js/ui/quiz-view.js`：雙欄工作區、結算 SVG 圓環與統一朗讀 SVG。
- `index.html`、`en/index.html`、`ja/index.html`、`help.html`：Bento 分區版面、入口 SVG 圖示與說明更新。
- `assets/css/theme.css`：3 款介面質感 token 與預覽、SVG 圖示、Bento 網格、雙欄工作區、結算圓環與微動效樣式。
- `tests/theme.test.js`、`tests/appearance-ui.test.js`、`tests/backup-validation-regression.test.js`、`tests/browser/suites/backup-content-regressions.mjs`：補齊 `style` 偏好（288 種組合）與備份回歸測試。
- `docs/logic-changes/2026-11-27-001-ui-polish-styles-bento.md`、`docs/logic-changes/README.md`：記錄本次變更與驗證結果。

## 資料相容、遷移與回復

於 `lang-learn.prefs.v1` 與備份白名單新增可選字串欄位 `style`（合法值 `modern`、`soft`、`editorial`），舊備份與舊本機偏好缺此欄時自動套用 `modern`，不需資料遷移。回復時還原上述變更即可。

## 驗證紀錄

| 日期 | 指令／人工操作 | 實際結果 | 未覆蓋部分 |
|---|---|---|---|
| 2026-11-27 | 全量 `npm test`、`node --test tests/vocab-favorites.test.js`、`npm run check:preload`、`npm run check:catalog` | 首輪 `npm test` 1494/1508 通過（僅 `vocab-favorites.test.js` 14 項缺 `SPEAK_ICON` 沙盒注入），補齊後 `vocab-favorites.test.js` 14/14 PASS；定向外觀／結構／主題（288 種組合）／備份／學習工具 70/70 PASS；`check:preload`（23 頁）與 `check:catalog`（22 資源）全數 PASS | 未於修復 `vocab-favorites.test.js` 後再重跑整批 `npm test` |
| 2026-11-27 | Chromium `study-tools`、`backup-content-regressions`、`page-loading` 與 5 張第二波截圖目視檢查 | 三組套件全數 PASS（含 `style` 偏好漂移護欄與漢字／閱讀雙欄無水平溢出）；目視檢查首頁外觀面板、日文溫潤圓角櫻霞 Bento、漢字極簡紙本雙欄、閱讀深海雙欄查詞、測驗結算 SVG 圓環，並修正淡入起點（`0.6 → 1`）後重拍確認 | 真機 Safari／實機 Android 與其餘瀏覽器套件未全量重跑 |
| 2026-11-27 | `npx wrangler deploy` 與正式站 13 項煙霧檢查（`https://lang-learn.lang-learn.workers.dev`） | 部署成功（Version ID：`5e519153-18bb-4005-b1ef-35d81da39f97`，上傳 24 檔）；`/`、`/ja/`、`/en/`、`/help`、`/assets/css/theme.css`、`/assets/js/core/appearance.js`、`/assets/js/ui/speech.js`、`/assets/js/ui/kanji-view.js`、`/assets/js/ui/reading-view.js`、`/assets/js/ui/quiz-view.js` 皆回 200 且含新版標記；`/api/me` 回 401；`/package.json` 與 `/docs/logic-changes/README.md` 回 404 | 真機實測待人工抽檢 |

## 未完成項目與發布狀態

- 尚待處理：合併 `main` 維持暫緩；真機 Safari／Android 視覺與操作待人工抽檢。
- 提交／發布證據：已發布至 Cloudflare Workers（`https://lang-learn.lang-learn.workers.dev`，Version `5e519153-18bb-4005-b1ef-35d81da39f97`），並推送至 `origin/feature/add-cloud-sync`。

## 後續更正／取代

無。
