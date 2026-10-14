/**
 * Windows 實機（本機 WebView2）驗證：以遠端除錯埠啟動建置好的 exe，透過 CDP 檢查
 * 21 頁可開、無 CSP／腳本錯誤、學習資料存在原生 SQLite、每日作答落盤、關閉重開後全部集合一致，
 * 且外部網址被擋。只用 APP 自己的資料目錄（測試前後由呼叫端決定是否清除）。
 * 用法：node app/scripts/verify-windows.mjs <exe 路徑>
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, closeApp, storageSnapshot, answerOneDaily, sleep } from './windows-cdp.mjs';

const exe = process.argv[2];
if (!exe) { console.error('用法：node app/scripts/verify-windows.mjs <exe 路徑>'); process.exit(1); }
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.app.conf.json', import.meta.url), 'utf8'));
const database = join(process.env.LOCALAPPDATA, config.identifier, 'learning.sqlite3');
const PAGES = JSON.parse(readFileSync(new URL('../assets-manifest.json', import.meta.url), 'utf8')).pages;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

let app = await launchApp(exe);
let { page } = app;
const origin = new URL(page.url()).origin;
check('APP 啟動並載入本機首頁', /index\.html$|\/$/.test(new URL(page.url()).pathname), page.url());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

for (const path of PAGES) {
  errors.length = 0;
  await page.goto(`${origin}/${path}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(400);
  const ready = await page.evaluate(() => document.querySelector('.topbar') !== null && document.querySelector('main')?.innerText.length > 20);
  check(`頁面 ${path}`, ready && errors.length === 0, errors.join(' | ').slice(0, 200));
}

if (process.env.SCREENSHOT_DIR) {
  for (const [path, name] of [['index.html', 'app-home.png'], ['ja/index.html', 'app-ja.png']]) {
    await page.goto(`${origin}/${path}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(800);
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}` });
  }
}

const summary = await answerOneDaily(page, origin);
check('每日頁作答一題並保存', /已完成 1/.test(summary), summary.replace(/\s+/g, ' '));
const before = await storageSnapshot(page);
check('學習資料使用原生 SQLite', before.kind === 'native-sqlite', before.kind);
check('SQLite 檔位於 APP 私有資料目錄', existsSync(database), database);
check('沒有建立 WebView IndexedDB 學習資料庫', Array.isArray(before.indexedDbNames) && !before.indexedDbNames.includes('lang-learn.learning'),
  JSON.stringify(before.indexedDbNames));

const outbound = await page.evaluate(() => fetch('https://example.invalid/').then(() => 'reachable', () => 'blocked'));
check('CSP 擋下對外連線', outbound === 'blocked', outbound);
await page.evaluate(() => { location.href = 'https://example.invalid/'; });
await sleep(1500);
check('導覽白名單擋下外部網址', new URL(page.url()).origin === origin, page.url());

await closeApp(app);
app = await launchApp(exe);
page = app.page;
const after = await storageSnapshot(page);
check('關閉重開後全部學習集合完全相同', after.rows === before.rows);
await page.goto(`${new URL(page.url()).origin}/ja/daily.html`);
await page.locator('.daily-summary').waitFor({ timeout: 15000 });
const reopened = await page.locator('.daily-summary').innerText();
check('關閉重開後畫面紀錄仍在', /已完成 1/.test(reopened), reopened.replace(/\s+/g, ' '));
await closeApp(app);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exitCode = failed ? 1 : 0;
