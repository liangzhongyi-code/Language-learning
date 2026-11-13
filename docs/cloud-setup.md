# 雲端同步部署手冊（Cloudflare Workers＋Google 登入）

本手冊給網站管理者，說明怎麼把網站部署到 Cloudflare Workers，並開啟 Google 登入與學習紀錄同步。

設計與規格見 [add-cloud-sync](../openspec/changes/add-cloud-sync/design.md)。以下所有 email、網址與 ID 都是範例，請換成你自己的值。
**不要把真實的 email、Client Secret 或 session cookie 貼進 issue、聊天或版控。**

## 0. 需要什麼

- Cloudflare 帳號（免費方案即可）。
- Google Cloud 專案（可以沿用 [Google 備份設定](google-backup-setup.md) 的同一個專案）。
- 本機已執行過 `npm ci`；wrangler 已鎖定在 `package.json` 的 devDependencies，用 `npx wrangler …` 執行。

標「（本人）」的步驟要由管理者本人在瀏覽器或終端機完成，代理不會替你登入或貼上密鑰。

## 1. 登入 Cloudflare（本人）

```bash
npx wrangler login
```

瀏覽器會開啟 Cloudflare 的授權頁，同意後回到終端機。

## 2. 建立 D1 資料庫並套用 schema

```bash
npx wrangler d1 create lang-learn
```

把輸出中的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，取代 `00000000-…` 的佔位值。這個 ID 不是機密，可以進版控。接著套用 migration：

```bash
npx wrangler d1 migrations apply lang-learn --remote
```

migration 全部用 `IF NOT EXISTS`，重複執行不會出錯。

## 3. 決定網址

第一次執行 `npx wrangler deploy`（第 7 步）後，網址會是 `https://<name>.<sub>.workers.dev`：

- `<name>` 是 `wrangler.jsonc` 的 `name`（預設 `lang-learn`）。
- `<sub>` 是你帳號的 workers.dev 子網域。

可以先部署一次取得網址，再回來完成第 4～6 步。

## 4. Google OAuth 用戶端（本人）

在 Google Cloud Console：

1. 「OAuth 同意畫面」：
   - 填寫應用程式名稱、首頁（網站網址）、隱私權政策（`https://<name>.<sub>.workers.dev/privacy`）。
   - 範圍只加入 `openid` 與 `email`，兩者都是非敏感範圍，不需要 Google 審查。
   - 發布狀態改為「正式版」，存取權由本站的白名單控制。
2. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 類型「網頁應用程式」：
   - 已授權的重新導向 URI：`https://<name>.<sub>.workers.dev/api/auth/callback`。
   - 本機開發另加 `http://localhost:8787/api/auth/callback`。
   - 「已授權的 JavaScript 來源」不需要填，因為登入是伺服器端轉址流程。
3. 記下用戶端 ID 與用戶端密鑰（Client Secret）。

## 5. 設定 Worker 變數與密鑰

`wrangler.jsonc` 的 `vars`（公開值，可進版控）：

| 變數 | 值 |
|---|---|
| `GOOGLE_CLIENT_ID` | 第 4 步的用戶端 ID |
| `SITE_ORIGIN` | `https://<name>.<sub>.workers.dev`（不含路徑與結尾斜線） |
| `ACCESS_MODE` | `allowlist`（預設，只有名單內的人能登入）；改成 `open` 就開放所有 email 已驗證的 Google 帳號 |

Client Secret 一定要用 secret 保存，不能寫進任何檔案（本人）：

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

執行後貼上密鑰。**不要**設定 `ENVIRONMENT` 或 `GOOGLE_OAUTH_BASE`，這兩個只給自動化測試使用，正式設定檔由測試檢查不得出現。

## 6. 設定擁有者

擁有者是最高權限，全站只有一位，只能用 SQL 設定，後台無法移除或降級。（本人提供 email）

```bash
npx wrangler d1 execute lang-learn --remote --command "INSERT INTO allowed_emails(email, nickname, role, created_at) VALUES ('owner@example.com', '站長', 'owner', unixepoch()) ON CONFLICT(email) DO UPDATE SET role = 'owner'"
```

email 請寫小寫。之後的成員與管理員都在網站的「管理後台」處理：

- 擁有者：可以新增、移除成員，也能升降管理員。
- 管理員：只能新增成員、修改成員與自己的暱稱。
- 新增的人一律是成員。

## 7. 前端設定與部署

把 `assets/js/config/cloud.js` 填好：

- `siteOrigin`：新網址，例如 `https://<name>.<sub>.workers.dev`。
- `legacyOrigins`：舊站 origin，例如 `https://<帳號>.github.io`。
- `newSiteUrl`：舊站搬家提示要連去的網址。

接著部署：

```bash
npm test
```

```bash
npx wrangler deploy
```

`wrangler deploy` 會先執行 `tools/build-site.mjs`，以白名單把網站檔案複製到 `dist-site/` 再上傳。開發文件、測試、規格、APP 與後端原始碼都不會被公開。

## 8. 驗收

1. 用擁有者帳號登入，導覽列顯示 email 與「已同步」，並出現「管理後台」。
2. 用不在名單的帳號登入，應看到「此帳號尚未開放雲端同步」。
3. 在後台新增一位成員，他不用等你重新部署就能登入。
4. 兩台裝置分別練習，確認衝突時會出現「用雲端的／用這台的／稍後再說」。
5. 用 `npx wrangler tail` 觀察快照下載的 CPU 時間：免費方案每次請求的 CPU 上限是 10ms，紀錄很大時要特別確認。

## 9. 舊站搬家提示

GitHub Pages 舊站使用同一份前端。`cloud.js` 填好 `legacyOrigins` 與 `newSiteUrl` 並推送到 GitHub 後，舊站各頁會顯示搬家提示。這一步會影響公開的舊網站，推送前請再確認一次。

## 常用維護指令

暫時用 SQL 直接加人或移除（平常用後台即可）：

```bash
npx wrangler d1 execute lang-learn --remote --command "INSERT OR IGNORE INTO allowed_emails(email, nickname, role, created_at) VALUES ('member@example.com', '範例成員', 'member', unixepoch())"
```

```bash
npx wrangler d1 execute lang-learn --remote --command "DELETE FROM allowed_emails WHERE email = 'member@example.com' AND role <> 'owner'"
```

擁有者帳號疑似被盜用時，強制登出擁有者的所有裝置：

```bash
npx wrangler d1 execute lang-learn --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT u.id FROM users u JOIN allowed_emails a ON a.email = u.email WHERE a.role = 'owner')"
```

回到上一個部署版本：

```bash
npx wrangler rollback
```

D1 的 schema 只新增、不刪改，回滾程式不需要回滾資料。

## 本機開發

```bash
npx wrangler d1 migrations apply lang-learn --local
```

```bash
npm run dev:worker
```

本機網址是 `http://localhost:8787`。要在本機測登入，Google 用戶端要加上本機的重新導向 URI，`SITE_ORIGIN` 與 `cloud.js` 的 `siteOrigin` 也要改成本機網址（不要提交）。自動化測試使用本機的假 Google，不需要真實帳號：

```bash
node tests/browser/run.mjs --suite all --server wrangler
```
