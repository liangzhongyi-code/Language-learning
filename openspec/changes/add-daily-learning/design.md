# 每日學習設計審核

> 2026-10-05 · add-daily-learning · 完整模式
> 2026-10-05 使用者已核准設計；詳細任務待第二道核准。分支 feature/add-offline-study-suite，基準 fd9b18a。

## 1. Overview

### 1.1 Purpose
每天提供確定、可完成、可恢復的學習工作量。新字、複習和配額分開管理；看過不等於學會，選擇答對不等於能主動產出。

### 1.2 Scope
先網站每日單字與日誌（A），再 FSRS（B），由 APP 封裝沿用。免登入、不新增遠端依賴。自動訓練個人參數、每日閱讀／情境課表和新字頻資料集不在此版。保留原自由測驗。

### 1.3 Related Documents
- [proposal.md](proposal.md)
- [specs/daily-learning.md](specs/daily-learning.md)：D01–D24。
- [APP 設計](../add-native-app-packaging/design.md)：已同步逐題續答、v2 備份與 IndexedDB 契約，與整合設計一併核准。

## 2. Architecture

### 2.1 System Context
```text
首頁今日卡／每日學習／自由測驗／備份
                  ↓ await
          非同步 learning repository
         ↙                         ↘
網站 IndexedDB 交易             APP SQLite 交易
         ↖                         ↗
    純核心：清單 + 事件 reducer + 排程 adapter
                                 ├─ A: Leitner
                                 └─ B: FSRS 本機 bundle
```

### 2.2 Components
- daily-plan：依 now／timeZone／範圍／額度／歷史產生有序 entries，注入 rng，不碰 DOM。
- review-events：驗證與派生狀態，事件只生效一次，結果頁不重計。
- scheduler：初始化／review 共用接口，維度 key 不用 UI 文案，不讓兩演算法同時寫一張卡。
- repository：ready、交易、revision、epoch、遷移及去重；所有學習寫入只走此入口。
- daily-view：教學卡、題面、保存、續答、餘量，重用原判分及回報，不複製另一套。
- backup：學習組整體驗證、預覽、替換與還原點；偏好獨立。

### 2.3 Interactions
1. ready／遷移完成才讀取今日清單，不存在才原子建立。
2. 新字介紹時原子 claim 額度及保存題面；不虛構答對。
3. 提交產生固定 reviewId／answeredAt，一次交易保存日誌、排程、清單、統計及收據。
4. 落盤後才可下一題；失敗保留同操作供重試。重啟只恢復已落盤狀態。
5. 自由測驗接同一事件入口；結果頁不再 recordSession 整局重計。

## 3. Technical Decisions

### TD1：分期交付
- Context：只換算法仍解決不了每日清單，現有 Leitner 可先沿用。
- Options：只改權重（無續答）；一次全换（風險大）；分期共用事件契約（可驗收）。
- Decision：A 做每日體驗與真實歷史，B 接 FSRS 預設排程；B 是本需求後續交付。
- Rationale：先有可靠事件，再談個人化，不偽造歷史。
- Consequences：兩期分別驗收；個人參數自動訓練另立需求，B 未完成不宣稱 FSRS 已上線。

### TD2：交易式儲存
- Context：逐題日誌會成長，多把 localStorage 不具跨 key 交易。
- Options：多 key（部分成功）；單一巨大 JSON（重寫成本）；IndexedDB／SQLite（交易、需 async）。
- Decision：網站學習 IndexedDB、APP SQLite；web 偏好仍 localStorage，APP 偏好原生。學習狀態單一真實來源。
- Rationale：事件、清單、排程須一起落盤，不能拿記憶體更新冒充成功。
- Consequences：改所有學習讀寫入口與啟動屏障；舊 key 留復原、不雙寫；舊網站不能讀新庫，須文件明示。

### TD3：固定計畫與日帳本
- Context：洗牌、換級別、跨時區容易多發新字。
- Options：每開動態算（漂移）；鎖所有設定（不便）；固定清單＋日帳本（可控）。
- Decision：首用固定 IANA 學習時區，planKey＝學習日＋語言＋級別；每日新字額度按語言共享。系統時區改變不自動套用，手動修改從下一未建立日生效，日期倒退不再發額度。
- Rationale：scope 保存續答、日帳本防換級別刷額度。
- Consequences：只替換未開始項目；新到期另列下一段，不推翻已完成目標。新字首版按級別內穩定順序，非字頻排名。

2026-10-05 實作守衛補充：跨日 carry 保留同一 entryId，不替舊摘要重造題次。新字首次 prepare 要依當下已解析學習日拒絕過期 plan；有 pending 改區政策時注入 studyDayState，沿用 resolveStudyDay 的單調日界，不能只比系統日期。已保存的題面可跨日續答且不再 claim，見 [013 修復紀錄](../../../docs/logic-changes/2026-10-05-013-review-regressions.md)。固定學習日不等於所有排程都使用該時區：A adapter 暫保留既有 srs.dueAfter 裝置當地時間政策，B／APP 接線須另驗，不重算舊 due。

### TD4：能力與排程資格
- Context：看漢字猜對、同日多點幾次不代表長期熟練。
- Options：只有 sourceId（混算）；每 UI 選項一張卡（過度碎裂）；能力 key＋上下文（較明確）。
- Decision：sourceId＋能力＋實際方向；依 add-offline-study-suite 擴為 recognition／production／listening-recognition／listening-production／assembly／grammar。中翻外四選一仍屬 recognition，有候選詞的句子填空使用句子 assembly key，不冒充自由產出。漢字、提示留事件上下文。錯誤或提示為 Again，無提示答對為 Good，不臆測 Hard／Easy。
- Rationale：不把選擇辨認當作主動產出，不把句內所有詞當學會。
- Consequences：首頁按 sourceId 去重；未到期／同日補強答對不推遠 due，錯誤可重設一次；保留真實事件及 scheduleEligible，B 沿用同一資格政策。

### TD5：新版備份與舊歷史
- Context：v1 無日誌，新欄位被舊客戶端忽略會假還原。
- Options：v1 加欄位（靜默遺失）；外殼 v2（明確拒絕不相容版本）。
- Decision：v2 學習組 stats／progress／learning 全有全無，prefs 可獨立；langlearn0／1 只是傳輸編碼。匯入採替換不合併。
- Rationale：不能拼接兩台装置的狀態／歷史，也不能從累計反推作答時間。
- Consequences：v1 缺資料須明示替換影響；保留還原點，更新 epoch；初次遷移保留舊 due，實際作答時才建 FSRS 狀態。

## 4. Data Design
- meta：schemaVersion、revision、dataEpoch、migrationStatus、historyStartedAt、schedulerPolicyVersion。
- itemStates：skillKey、sourceId、legacySummary、schedulerName／version、schedulerState、due、lastEligibleReviewAt、learningStatus；FSRS 欄位由鎖定版本 adapter 定義。
- reviewEvents：reviewId、sessionId、planId／entryId、sourceId、skillKey、answeredAt、correct、assistance、responseMs（可空）、questionMode、scheduleEligible、schedulerVersion、before／after。耗時排除背景時間，不作唯一評分。
- dailyPlans：planId、localDate、timeZone、lang、level、policyVersion、orderedEntries、quotaSnapshot、generatedAt、status；保存當前題面、選項／候選詞和回報上下文，不存整份題庫。
- dailyLedger：學習日＋語言、已開始 sourceId 集合、排除名單與額度；claim 與 plan 同交易。
- sessions：固定題序、已提交題、完成標記，完整局數去重；不承諾未提交輸入。
- operations：operationId、內容摘要、epoch、結果 revision；同 ID 不同內容拒絕，成功重送先查收據再判 revision。

日誌逐筆追加並索引，首頁只查摘要。首版不靜默截斷歷史，容量不足提示備份。超過解碼上限不得產出無法重匯入的成功備份；長期封存另行設計後才可刪日誌。

## 5. API Design
- ready／readSummary／getOrCreatePlan：就緒失敗不回空狀態繼續。
- prepareEntry：保存固定題面與額度 claim。
- submitReview(event, operationId, expectedRevision, epoch)：交易更新；重試 ID 與時間不變，衝突重讀重算。
- completeSession：只加首次完成局數，不再加已答計數。
- previewImport／restoreBackup：預覽綁 revision；學習組完整替換，偏好獨立回報。
- clearLearning：先以 IndexedDB 交易清除學習資料、還原點並寫入禁止再次遷入標記及新 epoch，再移除舊 localStorage 復原 key。後一步失敗／中斷也不能再次遷回；保留偏好並明示殘留來源待清理。裝置提醒排程需同步撤銷。

## 6. Implementation Approach

### 6.1 Technology Stack
維持 ES2020、原生 ES Modules、node:test、GitHub Pages。IndexedDB 在 ui/platform，不混入 core。FSRS 採 ts-fsrs 本機 bundle；B 先驗相容性、精確版本、授權及無網路需求再鎖版，不走 CDN。不符合現有瀏覽器基線就回設計審核，不默默降級。

### 6.2 Code Organization
- core/daily-plan.js、review-events.js、scheduler.js、fsrs-adapter.js。
- ui/platform/learning-repository.js、web-learning-repository.js，APP 實作相同接口。
- ui/daily-view.js、英日文每日入口；抽取 quiz-view 可共用控制器，重用判分及回報。
- tests/daily-plan、review-events、learning-repository、daily-ui、fsrs-adapter。
- 同步 backup／progress／stats／prefs／help／README、首頁及 structure 頁面清單；不可縮小既有測試來放行。

## 7. Security
備份深驗證、ID／數字／版本與關聯檢查，文字先跳脫。原檔與解壓各 10 MiB、代碼 16 MiB，逐塊解壓限額。原生命令不接任意 SQL／路徑。沒有雲端追蹤，本機與備份皆不宣稱加密。

## 8. Performance
以 15,000 itemStates／100,000 reviewEvents 驗證索引與有限更新；不每答一題全庫解析。記錄手機／桌面實測耗時，不把 Node 測試當裝置保證。大資料測儲存能力，不承諾均可放進聊天代碼或大小有限的備份。

## 9. Testing Strategy
每個 D01–D24 至少一個獨立案例，tasks 核准後 TDD。D01–10 測清單／日界／額度；D11–13 實際 IndexedDB 交易、故障及跨頁；D14–17 能力／排程與 FSRS golden fixtures；D18–22 遷移／備份／epoch；D23–24 UI／舊功能回歸。
另測 DST、時鐘倒退、調低額度、題庫項目移除、同 entry 競態、同 ID 異內容、回應遺失、匯入後舊頁重送。IndexedDB 不用 mock 冒充真實交易；APP SQLite 與三平台安裝另有真機驗收。

## 10. Deployment
A 先交付獨立今日入口，所有學習讀寫切新 repository 後啟用。B 漸進按項目遷移，不全庫重排。網站發佈不代表 APP 已可安裝；保留舊資料復原來源及升級前備份。

## 11. Migration／APP 銜接
使用者明確要求 APP 更新包保留資料：每日清單、已提交的未完成局、日誌、維度狀態與 FSRS 排程皆納入 add-native-app-packaging 的 S17／S18／S19 更新驗收。一般覆蓋更新不需手動搬移；schema 遷移前一致性備份，失敗回滾而非初始化空資料。刪除 APP／清除資料／換機另走備份還原，不混同正常更新。

APP S03 保存已提交題、S05 逐題交易、S10／S11 採 v2 學習群組與 v1 替換提示；learning 納入備份，網站使用 IndexedDB。2026-10-05 使用者已核准整合契約；O01–O20、G01–G10、D01–D24 與 S01–S22 一起驗收，核准不等於已實作。

## 12. Open Questions 與 Gate
- 建議網站 A→B，APP 使用穩定接口；新字 5／複習段 20 可在設定調整。
- 真機與 Mac 工具鏈未確認；任務核准後可實作原生程式與準備工具鏈，平台未實測部分保持未驗證。
- 第一道設計核准已通過；詳細 [tasks](../add-offline-study-suite/tasks.md) 待第二道核准，通過後進入生產程式 TDD。

## 13. Sources／Change Log
- [Anki FSRS](https://docs.ankiweb.net/deck-options.html)
- [WaniKani SRS](https://knowledge.wanikani.com/wanikani/srs-stages/)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- 2026-10-05：使用者採用研究方向，新增本設計；尚未實作。
