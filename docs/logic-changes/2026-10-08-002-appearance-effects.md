# 2026-10-08-002：背景微塵可見度與降低特效語義

## 基本資訊

- 日期／時區：2026-10-08（Asia/Taipei）。
- 類型：修復／外觀平台行為／測試。
- 狀態：已完成代表案例與定向修正驗證；未提交／未發布。
- 核准依據：使用者明確採用完整修正，指定四檔獨立寫集、保留既有堆疊及手動關閉微塵語義。
- change-id／規格：本次未新增 OpenSpec；沿用既有外觀合法值與偏好契約（`assets/js/core/appearance.js`），文件規則依 [AGENTS.md](../../AGENTS.md) 與 [範本](TEMPLATE.md)。
- 相關前次紀錄：[001 續作驗證](2026-10-08-001-continue-verification.md) 為既有整合背景，本文件只記錄此次外觀修正。
- 分支／commit：未提交。未執行 commit、push 或 merge。
- 整合邊界：此次僅修改下列四個檔案；文件索引依使用者分工由主代理更新，本工作流不修改索引。

## 需求與原因

選擇微塵後，背景常看不出光點。原因包含色票 alpha 與呼吸最淡相位過低，以及光點位置落在實心卡片下方；既有 `body` isolation、偽元素 `z-index: -1` 的堆疊不需改動。

本輪修正契約 RED 的截圖差分證實：首頁 320px 深／淺 classic 的微塵 RGB 最大差分都是 0；1280px 深色最大差分 9、淺色 8，均未達本次採用的可見差分 12。使用者提供的前輪控制實驗另已確認：320px 單獨提高 alpha 至 1 仍為 0，移動 pattern 到留白可產生差分；本輪未重跑這兩個控制實驗，也不把它們計入本輪完成案例。

另一個問題是原降低特效規則沒有降低柔光強度。原測試草稿把手動設定與 OS 都要求保留光點，與原手動提示「關閉微塵」相反，本次先修正測試契約後才修改正式 CSS。

## 變更前與變更後

- 正常微塵：深／淺 alpha 由 0.18／0.13 改為 0.38／0.28；呼吸 opacity 由 0.25–0.65 改為 0.72–0.96。
- 光點位置：由預設圓心及偏移改為 `circle at 8px 25px` 與 `circle at 11px 79px`，重複尺寸 103×139、181×227，background-position 皆為 0 0，讓窄螢幕留白也有光點。
- 手動勾選降低特效：仍隱藏微塵、停止動畫／轉場、關閉磨砂模糊；新增柔光 `body::before` opacity 0.35。
- OS 減少動態：停止動畫、關閉模糊、柔光 opacity 0.35；微塵保留為 opacity 0.72 的靜態光點。
- 同時啟用：手動隱藏優先，OS 不會重新顯示微塵。
- 提示：分別說明手動關閉微塵及 OS 保留靜態微塵；系統提示仍依既有 matchMedia 事件顯示／隱藏，不冒充手動勾選。

## 規則、邊界與取捨

- 純色不顯示柔光／微塵；柔光不顯示微塵；微塵包含柔光與光點。
- 背景仍由兩個固定偽元素產生、pointer-events 為 none，不新增 slider、Canvas、粒子 DOM 或外觀設定欄位。
- 深／淺模式與四個配色共用微塵幾何，原色票與卡片實心底色維持既有契約。
- 呼吸只改 opacity，保留既有 12 秒 alternate 動畫；OS 偏好解除、手動設定解除後恢復原動畫。
- 使用 ui-ux-pro-max 的 reduced-motion 指引停止動態，並依使用者指定保留 OS 靜態微塵。手動關閉微塵的既有意義不變。
- 此次不改 index.html、其他頁面、資料模型、題庫、備份或排程；沒有新增非同步任務，因此取消／重試／競態沿用既有外觀流程。
- 可見像素的驗收門檻為至少 4 個像素具有任一 RGB 通道差分 ≥12；這是本次截圖回歸準則，不宣稱為通用感知標準或文字對比標準。

## 影響範圍

- `assets/css/theme.css`：微塵強度、重複幾何、呼吸相位及兩種降低特效規則。
- `assets/js/ui/appearance.js`：既有兩段提示文字，不新增 DOM。
- `tests/browser/suites/appearance-effects.mjs`：修正模式契約、byte mask 排除前景、直接 RGB abs 差分及 PNG filter 解碼；每個像素／byte 不再建立陣列。
- `docs/logic-changes/2026-10-08-002-appearance-effects.md`：本次原因、行為、證據與未完成範圍。

## 資料相容、遷移與回復

沒有資料格式或儲存 key 變更，沿用既有 theme、palette、background、reducedEffects。測試只在新建隔離 Chromium context 與 loopback fixture 使用假偏好，不讀取或修改使用者真實學習資料。

如需回復，針對此次四檔差異撤回；不要整批回復目前其他工作區變更。資料不需遷移，手動 reducedEffects=true 仍代表關閉微塵。

## 驗證紀錄

所有指令在專案根目錄執行。證據位於執行者 Windows 暫存目錄，未放進公開資源、未提交。截圖排除前景矩形後比較實際 RGB，computed style 與像素證據分開計數。

### 1. 修正契約後 RED（正式 CSS／提示修改前）

```powershell
$env:APPEARANCE_EVIDENCE_DIR = Join-Path $env:TEMP 'lang-learn-appearance-corrected-red'
node tests/browser/run.mjs --suite appearance-effects
```

- 實際 exit 1，套件內部耗時 41,216ms；24 組像素、24 組 computed。
- 共 262 條失敗，包含正常微塵不可見、OS 靜態光點被隱藏、柔光沒有降低、提示未區分語義。
- 另含 8 條首頁 DOM 數量誤判：備份面板非同步初始化尚未完成。後續測試等待 `#backup [data-code]` 再擷取 DOM 數量基準及前景排除矩形，不以放寬數量斷言規避問題。
- 檔案：`%TEMP%/lang-learn-appearance-corrected-red/pixels.json` 及 1280px classic 的正常／手動／OS PNG。

### 2. 實作後代表案例量測

```powershell
$env:APPEARANCE_EVIDENCE_DIR = Join-Path $env:TEMP 'lang-learn-appearance-corrected-green'
node tests/browser/run.mjs --suite appearance-effects
```

- 套件內部耗時 42,321ms；24 組像素、24 組 computed。
- 所有微塵、模式語義、降低柔光、停止動畫／模糊、靜態穩定、恢復、DOM／Canvas、水平溢出、卡片實心與互動檢查通過。
- 此輪實際 exit 1，剩兩個純色取樣斷言：日文測驗 320／375px 淺色 classic 的左下角落在卡片陰影，RGB 為 [238,241,247]，不能當作原底色 [243,246,251]。不得把這一輪寫成整組 PASS。
- 純色檢查改為從前景排除 mask 外找到接近 palette 底色的實際像素，記錄取樣座標；不再固定使用左下角。
- 已目視檢查 1280px 首頁 classic 深／淺正常微塵截圖。

### 3. 取樣修正後定向 GREEN

```powershell
$env:APPEARANCE_EVIDENCE_DIR = Join-Path $env:TEMP 'lang-learn-appearance-corrected-green-recheck'
$env:APPEARANCE_CASE_FILTER = '^/ja/quiz\.html (320|375) light classic$'
node tests/browser/run.mjs --suite appearance-effects
```

- 實際 exit 0、PASS appearance-effects，耗時 2,813ms；只重跑上述 2 組像素案例，0 組 computed，0 失敗。
- 兩組純色都在 x=0、y=111 取得 [243,246,251]；其餘像素、模式與互動契約再次通過。
- 篩選器不匹配任何案例時會失敗，避免空跑 PASS。日常完整代表測試應不設定 APPEARANCE_CASE_FILTER。

合併第二輪的已通過案例與第三輪兩組更正重測後，共有 24 組像素／24 組 computed 的證據。不是一輪完整 48 組像素 GREEN，取樣修正後也未重新跑全部 24 組。正常及 OS 微塵每組 RGB 最大差分至少 44、可見像素至少 64；手動微塵每組 max=0、changed=0。首頁 320px classic 正常深／淺 max=57／45，各 72 個可見像素。

像素覆蓋為兩頁（首頁、日文測驗）× classic 深淺 × 320／375／1280，加兩頁 × 其他三配色深淺 × 1280。其餘 320／375 的其他三配色深淺共 24 組僅檢查正常、手動、OS、兩者同時啟用及恢復的 computed style，不冒充像素量測。瀏覽器三輪套件內部總時間 86,350ms。

### 4. 既有外觀、結構與差異檢查

```powershell
node --test tests/appearance-ui.test.js tests/structure.test.js
git diff --check -- assets/css/theme.css assets/js/ui/appearance.js
```

- Node 29/29 PASS、0 失敗，耗時 456ms；包含偏好儲存／匯入／跨頁同步、系統提示、面板空間及深淺四配色對比門檻。
- git diff --check exit 0，沒有空白錯誤；Git 僅提示既有 CRLF 政策會於後續操作轉換 LF。
- 沒有執行全專案測試，不宣稱其他未相關變更已通過。

## 未完成項目與發布狀態

- 主代理需在整合時更新 `docs/logic-changes/README.md`；依指定獨立寫集，本工作流未改索引。
- 未跑取樣修正後完整代表 suite，亦未重新跑完整 48 組像素矩陣、實機或其他瀏覽器；本次驗證界線如上。
- 未產出額外 HTML 閱讀副本；使用者此次只允許四檔寫集。
- 未提交、未推送、未部署；不宣稱檔案已納入遠端。

## 後續更正／取代

無。此次是首次修正紀錄；第二輪的取樣誤判與更正已於驗證紀錄明示。

### 2026-10-08 整合更正

以上「使用者指定四檔／使用者分工／使用者提供控制實驗」措辭不精確：四檔寫集與分工是主代理交付子代理的工作界線，控制實驗來自先前隔離瀏覽器調查；人類使用者核准的是完整修正方向，不是逐一指定這些技術細節。OS 靜態微塵是沿用經確認的修正契約，不另歸因為使用者逐項指示。

主代理已重新執行不帶篩選的完整代表 suite：`node tests/browser/run.mjs --suite all` 中 appearance-effects 為 PASS，24 組像素、24 組 computed、0 失敗，內部耗時 39,898ms。首頁 320px 深色微塵最大差分 57／72 個可見像素；手動降低後微塵差分 0，柔光平均差分由 9.32 降至 2.65；OS 靜態微塵仍可見。此結果補齊前述取樣更正後未完整重跑的缺口，但不代表全部窄螢幕配色皆有像素證據或真機已驗。

索引已由主代理更新。整批瀏覽器首次重跑在 page-loading 的筆數等待時序斷言停止，該測試已改為等待 metadata 的具體筆數後再斷言；不把背景 PASS 冒充整批 PASS。未提交／未發布。

同日最終重跑全部 14 組 Chromium suite 全部 PASS；appearance-effects 的 24 組像素／24 組 computed 再次完整通過，38422ms、0 失敗。整批 Node 1076/1076 PASS。背景本機驗證完成，未發布；真機／其他瀏覽器與未涵蓋的像素組合仍未驗，完整整合紀錄見 [003](2026-10-08-003-loading-investigation.md)。
