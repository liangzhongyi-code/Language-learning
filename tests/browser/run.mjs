/**
 * 只在隔離 Chromium context 與隨機 loopback port 執行自動化測試。
 * 不連使用者瀏覽器、不重用登入資料；任何 suite 或頁面例外皆回傳非零。
 */
import { chromium } from 'playwright';
import { readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './server.mjs';

async function run() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--suite');
  const requested = at === -1 ? 'harness' : args[at + 1];
  if (!requested || !/^[a-z][a-z0-9-]*$/.test(requested)) {
    throw new Error('未知的瀏覽器測試。');
  }
  const suites = new URL('./suites/', import.meta.url);
  const names = requested === 'all'
    ? (await readdir(suites)).filter((name) => name.endsWith('.mjs')).map((name) => name.slice(0, -4)).sort()
    : [requested];
  if (!names.length) throw new Error('沒有任何瀏覽器測試，不能當作通過。');
  for (const name of names) {
    try { await access(new URL(name + '.mjs', suites)); }
    catch { throw new Error('未知的瀏覽器測試：' + name); }
  }
  const server = await startFixtureServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const name of names) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const errors = [];
      context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return url.origin === server.origin ? route.continue() : route.abort();
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.goto(server.origin + '/__harness__');
        const suite = await import(new URL(name + '.mjs', suites));
        await suite.run({
          page, context, origin: server.origin,
          intentionalFailure: args.includes('--self-test-failure'),
        });
        if (errors.length) throw new Error('未處理的頁面例外：' + errors.join('; '));
        console.log('PASS ' + name);
      } finally {
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
