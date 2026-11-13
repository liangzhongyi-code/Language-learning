/**
 * 只在隔離 Chromium context 與隨機 loopback port 執行自動化測試。
 * 不連使用者瀏覽器、不重用登入資料；任何 suite 或頁面例外皆回傳非零。
 * --server fixture（預設）直接讀專案檔案；--server wrangler 改用本機 Worker（H01），結束時印出轉址統計。
 */
import { chromium } from 'playwright';
import { readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, startWorkerServer } from './server.mjs';

const SERVERS = { fixture: startFixtureServer, wrangler: startWorkerServer };

/**
 * Worker 模式的轉址與 404 統計：auto-trailing-slash 的 307 次數、網址形式、查詢字串是否保留。
 */
function reportWorker(server, perSuite) {
  const { redirects, notFound } = server;
  const kept = redirects.filter(({ from, location }) => !from.includes('?') || location.includes(from.slice(from.indexOf('?'))));
  const forms = new Map();
  for (const { from, status, location } of redirects) {
    const key = `${status} ${from.split('?')[0]} → ${(location || '').split('?')[0]}`;
    forms.set(key, (forms.get(key) || 0) + 1);
  }
  console.log(`WORKER 轉址 ${redirects.length} 次（帶查詢字串 ${redirects.filter(({ from }) => from.includes('?')).length} 次，保留 ${kept.filter(({ from }) => from.includes('?')).length} 次）`);
  console.log('WORKER 各套件轉址次數：' + perSuite.map(([name, count]) => `${name}=${count}`).join('、'));
  for (const [key, count] of [...forms].sort((a, b) => b[1] - a[1])) console.log(`  ${count}× ${key}`);
  const missing = [...new Set(notFound)];
  console.log(`WORKER 404 共 ${notFound.length} 次（${missing.length} 個網址）` + (missing.length ? '：' + missing.slice(0, 20).join('、') : ''));
}

async function run() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--suite');
  const requested = at === -1 ? 'harness' : args[at + 1];
  if (!requested || !/^[a-z][a-z0-9-]*$/.test(requested)) {
    throw new Error('未知的瀏覽器測試。');
  }
  const serverAt = args.indexOf('--server');
  const serverKind = serverAt === -1 ? 'fixture' : args[serverAt + 1];
  if (!Object.hasOwn(SERVERS, serverKind)) throw new Error('未知的測試伺服器：' + serverKind);
  const suites = new URL('./suites/', import.meta.url);
  const names = requested === 'all'
    ? (await readdir(suites)).filter((name) => name.endsWith('.mjs')).map((name) => name.slice(0, -4)).sort()
    : [requested];
  if (!names.length) throw new Error('沒有任何瀏覽器測試，不能當作通過。');
  for (const name of names) {
    try { await access(new URL(name + '.mjs', suites)); }
    catch { throw new Error('未知的瀏覽器測試：' + name); }
  }
  const server = await SERVERS[serverKind]();
  const perSuite = [];
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
      const redirectsBefore = server.redirects?.length ?? 0;
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.goto(server.origin + '/__harness__');
        const suite = await import(new URL(name + '.mjs', suites));
        await suite.run({
          page, context, origin: server.origin, serverKind,
          intentionalFailure: args.includes('--self-test-failure'),
        });
        if (errors.length) throw new Error('未處理的頁面例外：' + errors.join('; '));
        console.log('PASS ' + name);
      } finally {
        await context.close();
        if (server.redirects) perSuite.push([name, server.redirects.length - redirectsBefore]);
      }
    }
    if (server.redirects) reportWorker(server, perSuite);
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
