# 2026-10-05-006：隔離瀏覽器整合測試

## 基本資訊

- 日期／時區：2026-10-05（Asia/Taipei）
- 類型：測試基礎設施；不改網站行為。
- 狀態：F00 已驗證，尚未發布。
- 核准：詳細任務已核准；[整合 tasks](../../openspec/changes/add-offline-study-suite/tasks.md) F00。
- 分支：feature/add-offline-study-suite；未提交。

## 需求與前後差異

原先只有 Node 純函式／DOM 替身測試；新增可重現的隔離 Chromium runner，以真 IndexedDB 驗證交易。禁止空跑或吞頁面例外卻回傳成功。

## 規則與取捨

只綁127.0.0.1隨機port，每suite建立獨立context，不接使用者的浏览器或cookies；封鎖外部網路請求。fixture伺服器只提供網站路徑，拒.git／node_modules／未知副檔名及離開repo的真實路徑。依賴playwright精確1.62.1並有package-lock，只用於開發，不新增網站執行期依賴。每suite顯示PASS不代表未執行suite已通過。

## 影響檔案

package.json、package-lock.json、tests/browser/run.mjs、server.mjs、suites/harness.mjs、tests/browser-runner.test.js。

## 資料相容與回復

全部fixture資料在測試context，關閉即釋放；沒有修改真實localStorage／IndexedDB，沒有資料遷移。

## 實際驗證

| 命令 | 結果 |
|---|---|
| node --test tests/browser-runner.test.js（stub） | RED：3項因錯誤退出碼／缺正確結果失敗，不是缺依賴 |
| node --test tests/browser-runner.test.js（實作） | GREEN：3/3，含真正Chromium IndexedDB讀寫及刻意頁面例外 |
| npm install --save-dev --save-exact playwright@1.62.1 | 安裝2個套件，audit 0漏洞（當次結果） |

## 未完成／發布

其他瀏覽器suite及Firefox/WebKit尚未驗證。未提交／未推送；本機基礎工具可用不等於APP完成。

## 後續更正

無。
