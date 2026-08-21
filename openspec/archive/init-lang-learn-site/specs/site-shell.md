# Spec Delta: site-shell（站台外殼、主題與部署）

> change-id: `init-lang-learn-site`

## ADDED Requirements

### Requirement: 語言選擇首頁

The system SHALL 在根目錄 `index.html` 提供英文與日文兩個入口，
並簡述本站提供的三種學習內容。

#### Scenario: 首頁入口
- **GIVEN** 開啟站台根路徑
- **WHEN** 頁面載入完成
- **THEN** 可見「英文」與「日文」兩個明顯的入口卡，分別連往 `en/index.html` 與 `ja/index.html`

### Requirement: 語言首頁

The system SHALL 為每個語言提供首頁，含四個功能入口（發音、單字、文法、測驗）
與該語言的累計統計摘要。

#### Scenario: 英文首頁的四個入口
- **GIVEN** 開啟 `en/index.html`
- **WHEN** 頁面載入完成
- **THEN** 可見連往 `alphabet.html`、`vocabulary.html`、`grammar.html`、`quiz.html` 的四張入口卡

#### Scenario: 日文首頁的四個入口
- **GIVEN** 開啟 `ja/index.html`
- **WHEN** 頁面載入完成
- **THEN** 可見連往 `kana.html`、`vocabulary.html`、`grammar.html`、`quiz.html` 的四張入口卡

### Requirement: 使用教學頁

The system SHALL 提供 `help.html`，用一頁說明整個網站怎麼用，
內容涵蓋四個學習模組各自的用途與操作方式、色塊拆解怎麼讀、
以及發音功能在沒有語音包時的狀況。

#### Scenario: 教學頁涵蓋四個模組
- **GIVEN** 開啟 `help.html`
- **WHEN** 檢視頁面
- **THEN** 依序出現「發音」「單字」「文法」「測驗」四個段落，
  每段說明該模組能做什麼、以及一句「什麼時候該用它」

#### Scenario: 用實際範例說明色塊拆解
- **GIVEN** 教學頁的文法段落
- **WHEN** 檢視
- **THEN** 內嵌一張與文法頁樣式相同的雙排色塊範例
  （以 `我今天去打羽毛球` 為例），並標註兩排各代表什麼、
  「語序不同」標記是什麼意思

#### Scenario: 說明發音的降級情況
- **GIVEN** 教學頁的發音段落
- **WHEN** 檢視
- **THEN** 說明發音使用瀏覽器內建語音，
  並指出「聽不到聲音」時最可能的原因是裝置缺少該語言的語音包

#### Scenario: 首次造訪的引導入口
- **GIVEN** 使用者位於根目錄首頁
- **WHEN** 檢視頁面
- **THEN** 可見一個明顯的「第一次來？看使用教學」入口連往 `help.html`

#### Scenario: 每個頁面都能回到教學
- **GIVEN** 位於任一內頁
- **WHEN** 檢視導覽列
- **THEN** 存在連往 `help.html` 的入口

#### Scenario: 教學頁不依賴語言
- **GIVEN** `help.html`
- **WHEN** 檢視其位置與內容
- **THEN** 位於根目錄而非 `en/` 或 `ja/` 底下，且同時說明英文區與日文區

### Requirement: 共用導覽列

The system SHALL 在每個內頁頂端提供共用導覽列，含返回語言首頁、切換語言、
以及目前所在位置的標示。

#### Scenario: 導覽列標示目前位置
- **GIVEN** 位於英文單字頁
- **WHEN** 檢視導覽列
- **THEN** 「單字」項目呈現選取狀態，其餘項目為一般狀態

#### Scenario: 跨語言切換保持相同功能
- **GIVEN** 位於英文單字頁
- **WHEN** 點擊語言切換到日文
- **THEN** 導向日文的單字頁，而非日文首頁

### Requirement: 深色主題

The system SHALL 全站採用深色背景、淺色文字的視覺主題，
所有色彩以 CSS 變數集中定義於 `assets/css/theme.css`。

#### Scenario: 色彩集中定義
- **GIVEN** 專案的 CSS
- **WHEN** 搜尋十六進位色碼
- **THEN** 只出現在 `theme.css` 的 `:root` 變數宣告區塊中

#### Scenario: 文字對比度
- **GIVEN** 任一頁面的主要內文
- **WHEN** 量測前景與背景的對比度
- **THEN** 對比度 ≥ 4.5:1

### Requirement: 行動裝置可用

The system SHALL 在 375px 寬的視窗下維持可操作，不出現水平捲動。

#### Scenario: 手機寬度不橫向溢出
- **GIVEN** 視窗寬度 375px
- **WHEN** 逐一開啟全部 12 個頁面
- **THEN** 每頁的 `document.body.scrollWidth` 不大於視窗寬度

#### Scenario: 測驗選項可單手點擊
- **GIVEN** 視窗寬度 375px 的測驗頁
- **WHEN** 檢視四個選項按鈕
- **THEN** 每個按鈕高度 ≥ 44px 且為單欄排列

### Requirement: 相對路徑以支援任意 base path

The system SHALL 全站的資源引用與頁面連結一律使用相對路徑，
使網站在 `https://<user>.github.io/<repo>/` 這種子路徑下能正常運作。

#### Scenario: 無絕對根路徑引用
- **GIVEN** 全部 HTML 檔
- **WHEN** 搜尋 `href="/` 與 `src="/` 的字串
- **THEN** 沒有任何符合項目

#### Scenario: 子路徑部署可正常載入
- **GIVEN** 將整個站台放在本機伺服器的 `/lang-learn/` 子路徑底下
- **WHEN** 開啟每一個頁面
- **THEN** 所有 CSS、JS 與資料模組皆成功載入，Console 無 404 錯誤

### Requirement: 零執行期依賴

The system SHALL 不在網站執行期引用任何外部 CDN、字型服務或第三方套件。

#### Scenario: 無外部請求
- **GIVEN** 開啟任一頁面
- **WHEN** 檢視 Network 面板
- **THEN** 所有請求的網域皆為站台自身，沒有指向外部網域的請求

#### Scenario: package.json 無執行期依賴
- **GIVEN** 專案的 `package.json`
- **WHEN** 檢視 `dependencies` 欄位
- **THEN** 為空或不存在（僅允許 `devDependencies` 中的測試相關項目）

### Requirement: GitHub Pages 部署設定

The system SHALL 包含 `.nojekyll` 檔並在 README 說明 Pages 的啟用步驟，
使 push 到預設分支後即可直接發布，不需要任何建置流程。

#### Scenario: 存在 .nojekyll
- **GIVEN** 專案根目錄
- **WHEN** 檢查檔案
- **THEN** 存在 `.nojekyll` 檔

#### Scenario: README 含部署與本機開發說明
- **GIVEN** `README.md`
- **WHEN** 閱讀內容
- **THEN** 包含 GitHub Pages 的啟用步驟、本機開發用的靜態伺服器指令，
  以及「如何新增一個單字／一個句型」的操作說明

### Requirement: Console 零錯誤

The system SHALL 在正常操作路徑下不產生任何 Console 錯誤。

#### Scenario: 全站瀏覽無錯誤
- **GIVEN** 依序開啟 12 個頁面並完成一局測驗
- **WHEN** 檢視 Console
- **THEN** 沒有 `error` 層級的訊息
