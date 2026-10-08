# 整合實作任務清單

> 2026-10-05 · feature/add-offline-study-suite · 基準 fd9b18a
> 設計已核准；2026-10-05 使用者明確回覆「核准任務清單，按順序實作至完成」，第二道核准通過，進入 TDD。
> 本清單統一管理每日學習 D01–D24、單機功能 O01–O20、Google G01–G10、原生 S01–S22，共 76 個情境。未打勾不代表已實作。

## 1. 執行與完成規則

- 順序：F0 資料安全 → F1 每日學習 → F2 個人教材 → F3 新題型 → F4 排程／回饋 → F5 Google／APP → F6 全面驗收。P0 原生可行性在最前段平行查證，不等全部網站寫完才發現平台障礙。
- 下表每列是工作包，包含三個獨立、依序執行的小任務：R 寫測試並實跑失敗（10–25 分）、G 最小實作（20–60 分）、V 整合／重構與驗證（10–30 分）。如 G 實際超過 60 分，先追加更細子項與相依，不把超大工作包冒充一小時任務。
- 每一 R/G/V 都在實作日誌記錄指令、失敗原因／通過數、檔案與未覆蓋項。缺 SDK／下載失敗不是 RED；既有行為補測須做突變檢查。
- 表中檔案為預定新增或修改位置；引用縮寫見第 2 節。各情境測試須有獨立名稱（含 D/O/G/S 編號），不能只靠一個「全部正常」測試涵蓋多項。
- 外部設定、SDK 安裝、Mac 或真機缺席不阻止其他工作；該項保持待驗，不假稱完成／歸檔。未經核准不建立 Google Cloud、登入帳號、上傳私人資料、建立公開 Release 或 CI。
- 學習資料變更先建立一致性還原點；不拿使用者真實紀錄當破壞性測試。測試一律獨立 fixture、DB 名稱與暫存目錄。
- 每批更新 docs/logic-changes，維持網站可用。未完成功能不提供假成功入口；使用能力偵測及明確缺資料提示。
- 活躍 spec-powers 流程不 commit／push／merge。保留所有使用者修改，.idea 不納入功能交付。

## 2. 指令與路徑

路徑縮寫：C = assets/js/core/；P = assets/js/ui/platform/；U = assets/js/ui/；T = tests/；A = app/。套件只用官方來源及鎖定版本，本機 bundle，不新增網站 CDN 依賴。

驗證命令：

- UNIT：node --test tests/<該列測試檔>；每包結尾 npm test。
- WEB：node tests/browser/run.mjs --suite <名稱>。F00 新增可重現的 runner，使用隔離瀏覽器資料與本機靜態站，不以模擬 IndexedDB 代替 Chromium 實際交易。
- RUST：cargo test --manifest-path app/src-tauri/Cargo.toml <名稱>。
- ASSETS：node --test tests/app-assets.test.js，再 node app/scripts/stage-web.mjs。
- WIN：npm --prefix app run build:windows（F50 定義）；須另外實際安裝／更新，不以 build 成功代替。
- ANDROID：npm --prefix app run build:android（F51 定義）；adb 真機安裝測試須先確認裝置與操作。
- IOS：npm --prefix app run build:ios（F52 定義，只在已授權 Mac 執行）；真機續簽另留證據。
- DOC：node openspec/tools/check-task-coverage.mjs；node openspec/tools/build-doc-html.mjs add-offline-study-suite <既有集中資料夾>。前者只檢查映射，不把映射當測試通過。

F00 的瀏覽器 runner 與工具驗證屬測試基礎設施：先用刻意壞頁面／壞斷言證明失敗會令命令非零。不將測試安裝到全球或改系統 PATH。

## 3. F0 儲存及備份（主要關鍵路徑）

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] F00 R/G/V | T/browser/run.mjs、package.json：獨立 Chromium 測試入口、fixture origin 與退出碼；盤點舊測試意圖 | 任務核准 | WEB harness；刻意壞斷言失敗，正常頁通過，不操作使用者既有站台資料 |
| [ ] F01 R/G/V | C/learning-schema.js、C/learning-errors.js、T/learning-schema.test.js：版本、有限數值、集合／關聯、prototype key 深驗證 | F00 | UNIT；合法舊資料保留，畸形／未來版本拒絕；無靜默空值覆寫 |
| [ ] F02 R/G/V | C/learning-operations.js、T/learning-operations.test.js：epoch、revision、operationId＋payload hash、去重收據 | F01 | UNIT；同 ID 同內容取原結果，異內容拒絕；舊 epoch 不可重播 |
| [ ] F03 R/G/V | P/web-repository.js、T/browser/repository.mjs：IndexedDB schema／索引／ready、有限更新交易 | F02 | WEB repository；故障全回滾，兩分頁衝突可察覺，15k states／100k events 不每題全庫解析 |
| [ ] F04 R/G/V | C/learning-migration.js、P/web-repository.js、T/learning-migration.test.js、T/browser/migration.mjs：三把舊 key 匯入與禁止重遷移 | F03 | UNIT＋WEB migration；舊 due/n/w 不變，失敗保留來源，成功／清除後不復活 |
| [ ] F05 R/G/V | C/backup.js、C/backup-code.js、T/backup.test.js、T/backup-code.test.js：v2 學習群組與 v1 明確替換、大小界線 | F01 | UNIT；10MiB raw／decoded、16MiB code 串流止損；prefs 可分開救，v2 群組不可各半 |
| [ ] F06 R/G/V | P/web-repository.js、C/restore-controller.js、T/restore-controller.test.js、T/browser/restore.mjs：三點還原、固定預覽、請求世代 | F03 F05 | UNIT＋WEB restore；restore／clear 交易失敗原資料不變，晚到預覽不覆蓋新選擇 |
| [ ] F07 R/G/V | P/bootstrap.js、P/index.js、U/prefs.js、U/appearance.js、各 HTML 啟動 script | F04 | WEB bootstrap；13 原頁及新增頁全經 ready；延遲不先寫預設值；失敗停寫可重試 |
| [ ] F08 R/G/V | U/quiz-view.js、U/stats-view.js、U/backup-view.js：改 await 共用 repository，移除並行舊儲存寫入 | F06 F07 | WEB legacy-flows＋npm test；自由測驗／清除／備份同一真實來源，原 JLPT／ruby／回報／外觀保留 |

## 4. F1 每日學習與續答

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] F10 R/G/V | C/study-day.js、T/study-day.test.js：固定 IANA 日界與時間政策 | F01 | UNIT；午夜、DST、OS 時區改動與倒退時間均可預測 |
| [ ] F11 R/G/V | C/daily-plan.js、T/daily-plan.test.js：固定清單、due 優先、分段及跨級共用 ledger | F10 F02 | UNIT；預設新字5／複習20，改級不增加額度，1–3題合法且不跨級補題 |
| [ ] F12 R/G/V | C/review-events.js、C/scheduler.js、T/review-events.test.js：實際方向／能力映射、提示／重試／非到期評分 | F02 | UNIT；一事件一次升階，cloze 不把所有候選字當學會 |
| [ ] F13 R/G/V | P/web-repository.js、T/browser/review-submit.mjs：submitReview 與 completeSession 交易 | F11 F12 F03 | WEB review-submit；題次、日誌、清單、統計同時保存，結果頁不重算 |
| [ ] F14 R/G/V | C/study-session.js、T/study-session.test.js：題面快照、prepareEntry、續答、reinforcement／略過 | F11 F12 | UNIT；已提交可續，未提交不冒充已存；每字每段最多一次補強且保留間隔 |
| [ ] F15 R/G/V | en/daily.html、ja/daily.html、U/daily-view.js、U/nav.js、語言首頁、theme.css | F13 F14 F07 | WEB daily；看過不等於作答，保存失敗可重送；今日入口顯示確定工作量 |
| [ ] F16 R/G/V | U/quiz-view.js、U/stats-view.js、C/stats.js、T/browser/progress.mjs | F13 | WEB progress；自由測驗逐題保存，半局不算完成局，完成僅一次；所有模式共用能力紀錄 |

## 5. F2 收藏／單字簿／筆記／意向

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] F20 R/G/V | C/library.js、T/library.test.js：系統收藏、自訂簿、字 id、筆記、刪除與 revision | F01 F02 | UNIT；100簿／60字名稱／每簿15000字／2000字筆記上限；刪簿不刪歷史，晚到筆記不復活簿 |
| [ ] F21 R/G/V | C/library-exchange.js、T/library-exchange.test.js：独立交換格式與衝突預覽 | F20 | UNIT；未知 id 保留但不可出題，合併不覆蓋學習進度與偏好，XSS／原型污染拒絕 |
| [ ] F22 R/G/V | C/learning-intents.js、C/daily-plan.js、T/learning-intents.test.js：想學／自評／今日略過 | F11 F20 | UNIT；只動未開始新字，不擠 due／不退已領額度，已會標未驗證且可撤回 |
| [ ] F23 R/G/V | en/library.html、ja/library.html、U/library-view.js、U/vocab-view.js、P/web-repository.js | F20 F21 F22 F07 | WEB library；CRUD／筆記／匯出入／指定簿練習可鍵盤操作，未知字不偷偷補全庫 |

## 6. F3 新題型（共用事件及分級）

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] F30 R/G/V | C/practice-answers.js、T/practice-answers.test.js：英文／假名政策、白名單答案 | F01 | UNIT；NFKC與空白依政策，重音標點／促音長音濁音不可消失 |
| [ ] F31 R/G/V | assets/js/data/en/practice.js、ja/practice.js、C/schema.js、T/practice-dataset.test.js：人工核對 typing/listening/tiles/reorder/POS metadata | F30 | UNIT；每語言適用模式至少10題，日文先N5，替代語序／詞性依語境，不用中文唯一性冒充翻譯唯一答案 |
| [ ] F32 R/G/V | C/practice-engine.js、T/practice-engine.test.js：新 modes、book／level資格、重複片段instance | F31 F12 | UNIT；空池有中文原因，同片段互換合法、未知語序不判對 |
| [ ] F33 R/G/V | U/practice-view.js、U/quiz-view.js、theme.css、T/browser/practice-input.mjs：文字輸入、IME、點選／拖動、提交 | F32 F13 | WEB practice-input；組字Enter不送出，觸控不依赖drag，明確提交才判定 |
| [ ] F34 R/G/V | P/web-speech.js、U/speech.js、U/voice-check.js、T/browser/listening.mjs：voice 探测、試聽、錯誤／停止／無音退路 | F32 F07 | WEB listening；播放失敗不計錯不消耗計畫；同音題核對／排除；aria/title不洩漏答案 |

## 7. F4 排程、回饋與歷程

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] F40 R/G/V | tools/build-fsrs.mjs、assets/js/vendor/fsrs.js、C/scheduler.js、T/fsrs.test.js：鎖定 ts-fsrs、本機bundle、預設policy | F12 F17 | UNIT golden fixtures；Again／Good 對照固定上游，舊 due 到真實複習才轉換，不做個人參數訓練 |
| [ ] F17 R/G/V | package.json／lockfile、tools/third-party-notices、CREDITS.md：確認相容版本與授權，隔離建置依賴 | F00 | 套件鎖版本與授權可追溯；靜態HTML不新增網路執行期載入 |
| [ ] F41 R/G/V | C/achievements.js、T/achievements.test.js、U/study-history-view.js、歷程頁 | F13 F10 | UNIT＋WEB history；實際事件才計數／固定日界／恢復不重播成就，斷簽不抹累計 |
| [ ] F42 R/G/V | C/feedback-policy.js、U/feedback.js、U/prefs.js、T/feedback.test.js | F07 F33 | UNIT＋WEB feedback；語音／音效／震動各自保存，安靜模式停止非必要輸出，不影響評分 |
| [ ] F43 R/G/V | C/reminders.js、P/web-reminders.js、U/reminder-view.js、T/reminders.test.js | F03 F10 | UNIT＋WEB reminders；web明說關頁不提醒；保存／權限／排程／送達分開，outbox去重與世代取消 |

## 8. F5A Google 多份手動備份

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] F60 R/G/V | assets/js/config/google.js、P/google-web-auth.js、T/browser/google-auth.mjs | F07 | G01/G02/G05/G06；Client IDs 空白時零SDK請求；按連接才授權；scope／帳號／世代核對，token不持久化 |
| [ ] F61 R/G/V | P/google-drive.js、T/google-drive.test.js：固定 endpoints、多頁清單、不可變upload、download串流 | F05 | G03/G04/G08/G09；保留多份、exportId查未知結果、401/429/離線不假成功，拒任意URL |
| [ ] F62 R/G/V | U/google-backup-view.js、U/backup-view.js、C/restore-controller.js | F06 F60 F61 | WEB google-backup；檔案／代碼／Google共用preview；切帳號清preview、晚到請求無效、revision變化重預覽 |
| [ ] F63 R/G/V | docs/google-backup-setup.md、help.html、README.md、T/browser/google-backup.mjs | F62 | mock故障全過；提供空ClientID設定位置、同Cloud專案設定說明，真帳號未測明示 |
| [ ] F64 R/G/V | P/google-native-auth.js、A/src-tauri/src/auth/、mobile bridge、各平台設定 | P00b F61 F50f F51a F52a | G10；各平台受支援外部授權，PKCE/state/callback驗證；沒有真ClientID／Mac保持待驗 |

## 9. F5B APP 原型、交易與能力

| 任務 | 內容與涉及檔案 | 相依 | 驗證／成功條件 |
|---|---|---|---|
| [ ] P00a | 查官方相容版本、安裝缺 Rust／MSVC 所需條件及權限；A/docs/toolchain.md | 任務核准 | 記錄版本／授權與安裝結果；系統安裝需工具核准，無Mac先列阻礙，不擅連遠端 |
| [ ] P00b R/G/V | A/package.json、A/src-tauri/Cargo.toml、tauri.conf.json、src/main.rs／lib.rs：最小 MPA 外殼 | P00a | Windows載入本機两頁、SQLite能編譯；Android/iOS同測；失敗要回報架構風險，不能默換框架 |
| [ ] P00c | A/docs/p0-evidence.md：離線 voice、MPA及Mac IPA產出原型驗證 | P00b | 每平台分開證據；工具缺席不等於通過，7日到期不可用短測取代 |
| [ ] F50a R/G/V | A/scripts/stage-web.mjs、A/assets-manifest.json、T/app-assets.test.js：明確白名單与相對URL | F00 | ASSETS；必要檔缺失失敗，secret/.git/.idea/測試／報告均不進包 |
| [ ] F50b R/G/V | A/src-tauri/src/storage/schema.rs、migrations/、Rust fixture tests | P00b F01 | RUST schema；建表可重跑、固定私有目錄、索引集合非單一歷史JSON |
| [ ] F50c R/G/V | A/src-tauri/src/storage/commit.rs、tests/transactions.rs：revision／epoch／收據／故障回滾 | F50b F02 | RUST transactions；各集合故障注入與子程序強制結束，完整新／舊狀態 |
| [ ] F50d R/G/V | A/src-tauri/src/storage/migration.rs、restore.rs、tests/recovery.rs：一致性備援／三還原點／未來版本 | F50c F06 | RUST recovery；含WAL fixture的完整snapshot，備援失敗停止，舊APP不寫未來DB |
| [ ] F50e R/G/V | A/src-tauri/src/commands/、capabilities/、P/native-repository.js：窄bridge | F50c F07 | RUST＋WEB native-contract；拒任意SQL/路徑/遠端invoke，Web無bare import |
| [ ] F50f R/G/V | A/native-bridge/、P/native-files.js、P/native-speech.js：共用協定與Windows能力 | F50e F34 | S13–S15；success/cancel/unsupported/error分開，離線語音需實際發聲證據 |
| [ ] F50g R/G/V | A/src-tauri/tauri.conf.json、installer設定、A/scripts/build-windows.mjs | F50a F50f F50d | WIN；離線WebView2完整包、固定身份／資料目錄；乾淨VM安裝及舊版覆蓋更新資料比對 |
| [ ] F51a R/G/V | A/src-tauri/gen/android/、Android Kotlin voice/share/reminder bridge | F50e P00b F43 | ANDROID smoke；返回／安全區／TTS／權限/outbox，缺語音明示 |
| [ ] F51b | Android簽署設定範本、A/docs/android-install.md、fixture更新驗收 | F51a F50d | 固定package/key覆蓋安裝保留全部資料；錯簽章拒絕，私鑰不入repo |
| [ ] F52a R/G/V | A/src-tauri/gen/apple/、Swift voice/share/reminder bridge | F50e P00b F43、Mac | IOS smoke；本機資源、語音、權限outbox與前後台，無Mac不假編譯 |
| [ ] F52b | A/docs/ios-install.md、IPA產出與Sideloadly驗收證據 | F52a F50d、iPhone | 固定身份覆蓋／續簽資料保留，真實到期恢復；無設備保持未驗證 |
| [ ] F53 R/G/V | P/index.js、P/bootstrap.js、U/nav.js、A安全配置與T/browser/native-contract.mjs | F50e | 頁面ready、返回取消、保存期間不先換頁，外部網址開系统瀏覽器 |
| [ ] F54 | A/docs/release-checklist.md、build checksum腳本、更新／回滾手冊 | F50g F51b F52b | 安裝包／SHA256／平台已驗清單可交付；不自行發布GitHub Release |

## 10. 情境到獨立測試的追溯

以下每列在所列任務中寫一個具編號的独立案例。執行來源：T/*.test.js 為 UNIT；T/browser/*.mjs 為 WEB；A/src-tauri/tests/*.rs 為 RUST。實機項另保存測試日期、OS、安裝版號與匿名化結果；尚未執行一律標未驗。

| 情境 | 測試檔／驗收項 | 任務 | 可判定成功的關鍵 |
|---|---|---|---|
| D01 | T/daily-plan.test.js | F11 | 首日N5為5新字、0複習 |
| D02 | T/browser/daily.mjs | F15 | 完成2題重開，清單順序及位置保留 |
| D03 | T/daily-plan.test.js | F11 | N5領3轉N4最多剩2；干擾項同級 |
| D04 | T/study-day.test.js | F10 | 固定日界跨日／時區，舊計畫不重排 |
| D05 | T/daily-plan.test.js | F11 | due35分20/15且清完才新字 |
| D06 | T/daily-plan.test.js | F11 | 1–3題可練、0題完成，干擾完整同級池 |
| D07 | T/daily-plan.test.js | F11 | 新到期只追加下一段、不改正在答的題 |
| D08 | T/browser/daily.mjs | F15 | 介紹頁不造review、例句只用既有資料 |
| D09 | T/study-session.test.js | F14 | 錯／提示補強間隔及每段上限 |
| D10 | T/daily-plan.test.js | F11 | 降額度保留started且不再領新字 |
| D11 | T/browser/review-submit.mjs | F13 | 已提交3題、第四未交；重開保留3題及第四題面 |
| D12 | T/browser/review-submit.mjs | F13 | 回應遺失重試只一次、失敗未部分寫 |
| D13 | T/browser/repository.mjs | F03 | 雙分頁revision/epoch與同entry競態 |
| D14 | T/review-events.test.js | F12 | 能力／方向／提示各依政策計數 |
| D15 | T/review-events.test.js | F12 | 非到期答對不推due，答錯只重設一次 |
| D16 | T/fsrs.test.js | F40 | 鎖定參數golden離線輸出 |
| D17 | T/learning-migration.test.js | F04 F40 | 舊due/n/w保留，首次真review才遷排程 |
| D18 | T/browser/migration.mjs | F04 | 標記與資料同交易，无雙寫/靜默fallback |
| D19 | T/browser/migration.mjs | F04 | 壞資料／future／abort不覆蓋成空庫 |
| D20 | T/browser/restore.mjs | F06 | v2完整往返不重播，saved question保留 |
| D21 | T/backup.test.js | F05 | v1損失預告、v2拒不完整群組、prefs獨立 |
| D22 | T/browser/restore.mjs | F06 | stale preview／大小quota拒絕且資料不变 |
| D23 | T/browser/daily.mjs | F15 | 320/375/1280、深淺、鍵盤/觸控44px/aria |
| D24 | T/browser/progress.mjs | F16 | 提交計數即存、完成局一次、半局不算完成 |
| O01 | T/learning-intents.test.js | F22 | 想學只改未開始新字順位 |
| O02 | T/learning-intents.test.js | F22 | 自評未驗證、不清due、可撤回/答錯解除 |
| O03 | T/learning-intents.test.js | F22 | 略過当日不重發、不退已領額度 |
| O04 | T/library.test.js | F20 | 刪一簿保留另一簿／筆記／歷史且抗晚到寫 |
| O05 | T/library-exchange.test.js | F21 | 衝突預覽、未知id禁出題、獨立交換 |
| O06 | T/library-exchange.test.js | F21 | 超量拒絕、原型key拒絕、HTML純文字 |
| O07 | T/practice-answers.test.js | F30 | 大小寫白名單，重音標點不亂刪 |
| O08 | T/browser/practice-input.mjs | F33 | IME不誤送，假名關鍵差異保留 |
| O09 | T/review-events.test.js | F12 | 產出/聽寫等分開，hint/retry不灌分 |
| O10 | T/practice-engine.test.js | F32 | N4無seed／空簿不跨級補题 |
| O11 | T/browser/listening.mjs | F34 | 缺離線voice不可開始無聲題 |
| O12 | T/browser/listening.mjs | F34 | 播放失敗不計錯，同音消歧/無ARIA漏答案 |
| O13 | T/practice-engine.test.js | F32 | 重複片段單次使用、同文字互換有效 |
| O14 | T/practice-engine.test.js | F32 | 多種核對語序均接受，非法語序拒绝 |
| O15 | T/practice-dataset.test.js | F31 | 同字不同詞性以語境判斷 |
| O16 | T/feedback.test.js | F42 | quiet及獨立偏好保留、不改判題 |
| O17 | T/browser/restore.mjs | F06 | 三還原點、不遞迴、整组故障回滾 |
| O18 | T/browser/repository.mjs | F03 F04 | 清除後epoch擋舊寫、還原點清空、不重遷移 |
| O19 | T/achievements.test.js | F41 | 實際事件／固定日界／恢復不重播 |
| O20 | T/reminders.test.js＋native實機 | F43 F51a F52a | 權限及outbox世代去重，OS id不跨裝置 |
| G01 | T/browser/google-auth.mjs | F60 | 空ID不載SDK／發請求 |
| G02 | T/browser/google-auth.mjs | F60 | 同意/拒絕/取消/缺scope全有結果 |
| G03 | T/google-drive.test.js | F61 | 多次upload不覆寫既有檔 |
| G04 | T/browser/google-backup.mjs | F62 | 分頁/固定bytes預覽/取消零寫入 |
| G05 | T/browser/google-auth.mjs | F60 | 401/撤權清狀態、不洩token |
| G06 | T/browser/google-backup.mjs | F62 | 切帳號拒晚到A，不能誤報B成功 |
| G07 | T/restore-controller.test.js | F06 F62 | 同preview revision/epoch與X/Y競態守衛 |
| G08 | T/google-drive.test.js | F61 | timeout先查exportId，unknown不假成功 |
| G09 | T/google-drive.test.js | F61 | 串流上限/429/quota/offline/fixedURL |
| G10 | 三平台真ClientID往返紀錄 | F64 | 真實外部授權与同帳號還原、不匯出認證 |
| S01 | 三平台冷啟動驗收 | P00c F54 | 斷網全部本機頁面及測驗可用 |
| S02 | T/app-assets.test.js | F50a | allowlist無機密／缺資源阻擋 |
| S03 | T/browser/native-contract.mjs＋Android實機 | F53 | 返回／跨語言／保存等待及離開取消 |
| S04 | T/browser/bootstrap.mjs | F07 F53 | 慢ready不先寫預設、不空庫fallback |
| S05 | A/src-tauri/tests/transactions.rs | F50c | 多集合逐題原子提交／結果頁不重算 |
| S06 | A/src-tauri/tests/transactions.rs | F50c | 去重/衝突/不同payload守衛 |
| S07 | A/src-tauri/tests/crash.rs＋強制結束 | F50c | 只完整旧／新狀態，已成功不可丟 |
| S08 | A/src-tauri/tests/recovery.rs | F50d | damaged/future DB保留原檔拒寫 |
| S09 | A/src-tauri/tests/recovery.rs | F50d | 一致性備援、遷移重跑／故障回滾 |
| S10 | T/browser/portable-backup.mjs＋APP往返 | F05 F50e | v1/v2 web↔native保留語意，裝置id不搬 |
| S11 | A/src-tauri/tests/restore.rs | F50d | 學習整組/獨立prefs/3點回復 |
| S12 | T/backup-code.test.js＋Rust輸入測試 | F05 F50e | 10MiB／16MiB及非法數值拒絕 |
| S13 | 三平台檔案/分享/剪貼簿驗收 | F50f F51a F52a | 取消不清preview，寫成功才報儲存 |
| S14 | 三平台飛航voice驗收 | F50f F51a F52a | 日英實際發聲、切頁/背景停止 |
| S15 | 三平台缺voice驗收 | F50f F51a F52a | 缺包指引、非聽力仍可用 |
| S16 | Windows乾淨VM離線EXE | F50g | 無runtime時完整離線安裝可用 |
| S17 | Android同key覆蓋更新 | F51b | 全集合及半局保留，錯key拒絕不卸載 |
| S18 | Mac＋iPhone安裝/續簽/到期恢復 | F52b | 同身份保留全資料，缺真機保持未驗 |
| S19 | Windows前版fixture覆蓋升級 | F50g | 全資料、半局保留，安裝器不清DB |
| S20 | Rust安全測試＋WEB native-contract | F50e F53 | 外連隔離、拒非法scheme/SQL/路徑/invoke |
| S21 | npm test＋WEB legacy-flows | F08 F54 | 原446測試意圖保留、靜態網站回歸 |
| S22 | T/browser/accessibility.mjs＋三平台實機 | F54 | live/focus/44px/safe-area及錯誤可回復 |

## 11. F6 收尾與驗收

- [ ] F70：按工作包同步 docs/logic-changes、help.html、README、CREDITS、安裝／Google設定說明；所有按鈕文案與真實功能一致。
- [ ] F71：npm test、全部 WEB suites、可用平台 RUST/build，记录实际數量、時長、平台及失敗。15k／100k效能fixture不得混入發布資源。
- [ ] F72：使用 branch-review 審 fd9b18a → 工作區最終狀態（包含新增檔），獨立審查儲存競態、Google安全、RWD/a11y、文件同步；完成 review-report.md。critical未清不能交付完成。
- [ ] F73：修復有證據問題並追加回歸；重跑相關及全套測試，更新HTML。
- [ ] F74：逐項勾選76情境並給驗證證據；外部平台未驗留在待辦，不歸檔為全部完成。不發布／推送，交付安裝產物或明確建置阻礙及commit文字。

## 12. 外部限制與授權

2026-10-05 本機唯讀盤點：Node22/npm10可用；Rust/MSVC/Windows SDK未找到；Android Studio2025.1、SDK33/35/36、NDK r27b、JDK17及內附JBR21存在；沒有可用Mac／Xcode的證據。Chromium自動化套件與瀏覽器已有，但執行仍須驗證。

Google Client IDs 依要求留空。mock測試與官方設定手冊可先交付；真授權／跨平台還原待填合法設定。使用者不需在聊天提供密碼、token、keystore密碼或Apple帳密。

需要使用者／設備的地方以選項請示；架構不變的小修不反覆詢問。外部缺項不縮減本清單，也不把「尚未驗證」當成功。

## 2026-10-08 續作驗證追加

以下是本日可追溯的局部進度，既有工作包仍須逐項核對，不以全套綠燈批量勾選原生或外部授權情境。前述 Rust／MSVC 盤點是 10-05 當時狀態，後續盤點見 app/docs/toolchain.md，不改寫成當時已具備。

- F16：自由測驗已接 `quiz-service` 逐題交易、半局固定題序續答、完成局一次入帳。服務與接線測試 9/9；Chromium `quiz-progress`、`quiz-conflict` PASS。跨分頁同題衝突與清除後舊世代提供同步入口，暫時故障維持原提交重試。見 docs/logic-changes/2026-10-07-008-quiz-progress.md。
- F40／F17：ts-fsrs 5.4.2 固定版本、完整 MIT notice、本機 ES2020 vendor 與唯讀可重現建置檢查通過。26 項 FSRS／投影／下游定向驗證通過；不做個人參數訓練，不偽造舊能力，原生 WebView 仍未驗。見 10-07-005 與 009。
- F50a／P00b：資源安全測試與兩頁原型的 JS 契約通過，實際整理 169 個資源到 app/dist-web。安裝包關閉、prototype 身份獨立，只提供記憶體 SQLite 探針；不是原生學習 repository。P00b 的 Rust 編譯與 Windows／Android／iOS 真載入條件仍未滿足，不勾選整項完成。
- F70／F71：邏輯索引、歷史更正與本日結果已留存。Node 1063/1063、10 組隔離 Chromium PASS。15k states／100k events 效能、真機語音、Google 真授權、安裝／更新／續簽仍待驗；F72 全範圍最終審查未完成。
- 本日未執行 commit／push／merge，未歸檔完整規格，也沒有將本機成果標為已發布。詳細證據與限制見 docs/logic-changes/2026-10-08-001-continue-verification.md。
