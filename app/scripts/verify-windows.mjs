/**
 * Windows 實機（本機 WebView2）驗證：以遠端除錯埠啟動建置好的 exe，透過 CDP 檢查
 * 21 頁可開、無 CSP／腳本錯誤、每日頁作答落盤，關閉重開後紀錄仍在，且外部網址被擋。
 * 只用 APP 自己的資料目錄（測試前後由呼叫端決定是否清除），不碰瀏覽器或網站資料。
 * 用法：node app/scripts/verify-windows.mjs <exe 路徑>
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const exe = process.argv[2];
if (!exe) { console.error('用法：node app/scripts/verify-windows.mjs <exe 路徑>'); process.exit(1); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listTargets = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    return await response.json();
  } catch { return null; }
};
/**
 * 每次啟動都選一個目前沒有任何程式在聽的隨機埠；已被占用（例如使用者自己的瀏覽器開了
 * 遠端除錯）就換埠，絕不連到不是本腳本啟動的 WebView2。
 */
async function freePort() {
  for (let i = 0; i < 20; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    if (await listTargets(port) === null) return port;
  }
  throw new Error('找不到可用的除錯埠');
}
const PAGES = ['index.html', 'help.html',
  ...['index', 'daily', 'alphabet', 'vocabulary', 'grammar', 'quiz', 'practice', 'library', 'history'].map((p) => `en/${p}.html`),
  ...['index', 'guide', 'daily', 'kana', 'vocabulary', 'grammar', 'quiz', 'practice', 'library', 'history'].map((p) => `ja/${p}.html`)];

const isApp = (url) => /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)\//.test(url);

async function launch() {
  const port = await freePort();
  const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'ignore' });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  for (let i = 0; i < 60 && exited === null; i++) {
    const targets = await listTargets(port);
    /* 只有這個埠上全部 page 都是 APP 本機頁時才連線，確認是本腳本啟動的 WebView2 */
    const pages = (targets || []).filter((t) => t.type === 'page');
    if (pages.length && pages.every((t) => isApp(t.url))) {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts()[0]?.pages().find((p) => isApp(p.url()));
      if (page) return { child, browser, page };
    }
    await sleep(500);
  }
  child.kill();
  throw new Error(exited !== null ? `APP 已結束（代碼 ${exited}）` : 'APP 啟動後找不到本機頁面');
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

let { child, browser, page } = await launch();
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

await page.goto(`${origin}/ja/daily.html`);
await page.locator('[data-continue]').waitFor({ timeout: 15000 });
await page.locator('[data-continue]').click();
await page.locator('[data-start]').click();
await page.locator('[data-opt]').first().waitFor();
await page.keyboard.press('1');
await page.waitForFunction(() => !document.querySelector('[data-next]')?.disabled, null, { timeout: 15000 });
check('每日頁作答一題並保存', true);

const before = await page.evaluate(() => fetch('https://example.invalid/').then(() => 'reachable', () => 'blocked'));
check('CSP 擋下對外連線', before === 'blocked', before);
await page.evaluate(() => { location.href = 'https://example.invalid/'; });
await sleep(1500);
check('導覽白名單擋下外部網址', new URL(page.url()).origin === origin, page.url());

await browser.close().catch(() => {});
child.kill();
await sleep(3000);
({ child, browser, page } = await launch());
await page.goto(`${new URL(page.url()).origin}/ja/daily.html`);
await page.locator('.daily-summary').waitFor({ timeout: 15000 });
const summary = await page.locator('.daily-summary').innerText();
check('關閉重開後紀錄仍在（IndexedDB 持久）', /已完成 1/.test(summary), summary.replace(/\s+/g, ' '));
await browser.close().catch(() => {});
child.kill();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exitCode = failed ? 1 : 0;
