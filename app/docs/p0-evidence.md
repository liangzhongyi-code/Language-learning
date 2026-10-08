# P0 原型驗證證據

2026-10-08（Asia/Taipei）續做 P00b。Node 契約／資源 staging 通過；P00b 原生與 P00c 三平台能力仍待驗，不勾整體完成。

## 本輪實際 R／G／V

1. 改 scaffold 前執行 `node --test tests/app-assets.test.js`：exit 1，36 項、32 pass／4 fail。P00b 四項因缺 `tauri.conf.json`、`probe.js`、`prototype-manifest.json` 失敗；這是缺實作的 RED，不是缺 SDK 假充 RED。
2. 必要的專用安全測試先新增，尚未實作時執行 `node --test tests/app-prototype-security.test.js`：exit 1，3 項、0 pass／3 fail。兩項因缺 probe 模組、一項因缺 native config 失敗。
3. 實作後執行 `node --test tests/app-assets.test.js`：exit 0，36 pass／0 fail／0 skipped，包含原本 32 項與四個 P00b 契約，耗時約 1.76 秒。
4. 實作後執行 `node --test tests/app-prototype-security.test.js`：exit 0，3 pass／0 fail／0 skipped，耗時約 0.11 秒。
5. `node --check app/scripts/stage-prototype.mjs`、`node --check app/prototype/probe.js`、`node --check app/prototype/ui.js`：皆 exit 0。
6. `node app/scripts/stage-prototype.mjs`：exit 0，實際整理 169 個檔案到受管理 `app/dist-web`。包含原網站 21 頁與原型兩頁；僅 staging，沒有原生 build。

本範圍定向 Node 測試合計 39 項。全套測試數量與瀏覽器結果另見 [續作驗證](../../docs/logic-changes/2026-10-08-001-continue-verification.md)；本文件不以局部結果推定全部已驗收。

## 契約已覆蓋的界線

- bundle 關閉、frontendDist 本機、沒有 devUrl、main create:false，原型 identifier 與單一 capability。
- 原生／invoke 缺席、拒絕、錯誤回應、rollback false、空／過長 SQLite 版本、假 repository 能力及未 resolve 的 Promise 都不回報成功。
- 模擬的遠端、一般 localhost、網站頁面、非預設 port、憑證 URL、file scheme、iframe 在 JS invoke 前拒絕；合法兩頁只能呼叫無 payload 的 prototype_probe。
- capability 沒有 wildcard／remote／core:default；CSP 拒 frame、外部程式及廣域授權。
- staging 保留原網站全部 21 頁，原型兩頁及外部 JS 可被收集、相對引用存在、原生來源／docs／tests／package／Cargo 設定不進包。

這些 Node 案例使用 fixture 或靜態設定；無法代替 Rust ACL、SQLx、WebView 真正的 runtime 驗證。Rust 另有來源篩選與回滾的兩個單元案例，其來源已寫入，但尚未執行，也沒有宣稱 Rust RED／GREEN。

## 原生探針的待驗路徑

Rust command 不接受 SQL、DB 路徑或 learning payload，只允許 main 原型兩頁。build.rs 將 command 納入 ACL，setup 在自動建立視窗之前掛上導覽限制；同包網站頁面不能靠共用 origin 取得此 command。

每次建立 `sqlite::memory:` 的單一連線，建兩張 fixture 表，先確認交易內 state=1／events=1，再注入 CHECK constraint 失敗，明確等待 rollback，確認 state=0／events=0 並關閉連線。全部成立才回傳：

```json
{
  "sqliteVersion": "由實際 SELECT sqlite_version() 取得",
  "rollbackVerified": true,
  "learningRepository": "not-implemented"
}
```

上面是協定示意，並非已取得的原生回應。沒有持久 DB、learning repository、遷移、WAL、revision／epoch／operationId、崩潰復原、語音或檔案能力證據。

## 工具限制與平台狀態

- Windows：Node 與 staging 已驗；本輪找不到 cargo／rustc，因此 Rust dependency resolution、cargo check／test、WebView2 兩頁離線實載、原生 invoke／拒絕及 SQLite 故障回滾全部未驗。
- Android：本輪未 init／build／真機測試，MPA、返回、語音及 bridge 未驗。
- iOS：沒有本輪 Mac／Xcode 可用證據；未 build IPA、側載、續簽或進行七天到期觀察。
- P00a 仍缺工具鏈驗證；P00b 保持「來源已實作、原生待驗」；P00c 保持未驗。工具缺席不代表架構已證實可行，也不默換框架。
- 精確直接版本及 primary docs 見 [toolchain.md](toolchain.md)。沒有 SDK 安裝、native build、Cargo.lock 假檔、commit／push／merge，也沒有使用真學習資料。

## 工具齊備後要補的實測

1. 正常解析依賴／產生真實 lockfile，執行 cargo check／test；保存命令與實際結果。
2. Windows 原生斷網啟動，兩頁往返、每頁重新執行探針；保存真實 SQLite version／rollback 回應與錯誤路徑。
3. 實際嘗試網站頁、遠端 URL、其他視窗／frame、非法 command 呼叫，確認 Rust／ACL 的拒絕；Node fixture 不代替這一步。
4. Android／iOS 分開驗證同一原型；離線日英發聲、安裝與更新／續簽依 P00c 和 S01–S22 另留真機證據。

原型來源與本文件已落盤。正式學習功能與完整驗收證據由各自變更紀錄留存，本文件不能作為安裝包交付證明。
