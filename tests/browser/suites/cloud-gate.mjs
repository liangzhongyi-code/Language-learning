import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * H05–H07：雲端網址閘門與舊站搬家提示。
 * 用路由攔截把 assets/js/config/cloud.js 換成測試設定，讓 fixture（或本機 Worker）的 origin 分別扮演
 * 未設定（off）、舊站（legacy）與新網址（cloud），逐頁檢查 DOM 與全部網路請求。
 */

const PAGES = JSON.parse(readFileSync(new URL('../../../app/assets-manifest.json', import.meta.url), 'utf8')).pages;
const DISMISS_KEY = 'lang-learn.move-notice.v1';
const PREFS_KEY = 'lang-learn.prefs.v1';
const NEW_SITE = 'https://new-site.test/';
const BANNER = '[data-legacy-banner]';

const isApi = (url) => url.pathname === '/api' || url.pathname.startsWith('/api/');
const isGoogle = (url) => /(^|\.)(google|googleapis|googleusercontent|gstatic|googletagmanager)\.com$/.test(url.hostname);

export async function run({ page, context, origin }) {
  let config = null;
  await context.route('**/assets/js/config/cloud.js', (route) => (config
    ? route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
      body: `export const CLOUD_CONFIG = Object.freeze(${JSON.stringify(config)});`,
    })
    : route.fallback()));

  /* 全部網路請求（含被隔離規則擋下的外部請求）都記下來 */
  const requests = [];
  context.on('request', (request) => requests.push(new URL(request.url())));
  const forbidden = () => requests.filter((url) => isApi(url) || isGoogle(url)).map((url) => url.href);

  const open = async (name, target = page) => {
    await target.goto(`${origin}/${name}`);
    await target.locator('.topbar').waitFor();
    await target.waitForLoadState('networkidle');
  };
  const loginEntries = (target = page) => target.locator('a[href*="api/"], [data-cloud-login]').count();

  /* ── H05：未設定（真正的 cloud.js）時零 /api、零 Google、沒有登入入口與搬家提示 ── */
  requests.length = 0;
  for (const name of PAGES) {
    await open(name);
    assert.equal(await page.locator(BANNER).count(), 0, `H05 ${name} 未設定時不得出現搬家提示`);
    assert.equal(await loginEntries(), 0, `H05 ${name} 未設定時不得出現登入入口`);
  }
  await open('ja/quiz.html');
  await page.locator('[data-start]:not([disabled])').click();
  await page.locator('[data-start]').waitFor({ state: 'detached' });
  await page.waitForLoadState('networkidle');
  assert.deepEqual(forbidden(), [], 'H05 未設定時不得發出 /api 或 Google 請求');
  console.log(`  H05 未設定：${PAGES.length} 頁共 ${requests.length} 個請求，/api 與 Google 0 個`);

  /* ── H06：舊站 origin 顯示搬家提示，可關閉、關閉後不再顯示，其他功能照常 ── */
  config = { siteOrigin: 'https://new-site.test', legacyOrigins: [origin], newSiteUrl: NEW_SITE };
  await page.evaluate(([key, prefs]) => { localStorage.removeItem(key); localStorage.removeItem(prefs); }, [DISMISS_KEY, PREFS_KEY]);
  requests.length = 0;
  for (const name of PAGES) {
    await open(name);
    const banner = page.locator(BANNER);
    assert.equal(await banner.count(), 1, `H06 ${name} 舊站應顯示一則搬家提示`);
    assert.ok(await banner.isVisible(), `H06 ${name} 搬家提示應可見`);
    assert.equal(await page.evaluate((selector) => document.querySelector('.topbar').nextElementSibling
      === document.querySelector(selector), BANNER), true, `H06 ${name} 搬家提示應緊接在導覽列下方`);
    const hrefs = await banner.locator('a').evaluateAll((links) => links.map((link) => link.href));
    assert.ok(hrefs.includes(NEW_SITE), `H06 ${name} 應有新網址連結：${hrefs}`);
    assert.ok(hrefs.includes(`${origin}/help.html`), `H06 ${name} 應連到使用教學：${hrefs}`);
    assert.ok(hrefs.includes(`${origin}/index.html#backup`), `H06 ${name} 應連到首頁的備份與還原：${hrefs}`);
    assert.match(await banner.innerText(), /備份代碼/, `H06 ${name} 應說明用備份代碼搬移紀錄`);
    assert.equal(await loginEntries(), 0, `H05 ${name} 舊站不得出現登入入口`);
  }
  assert.deepEqual(forbidden(), [], 'H05 舊站不得發出 /api 或 Google 請求');

  /* 學習與備份照常：測驗能開始，首頁備份面板的匯出與匯入按鈕都在 */
  await open('en/quiz.html');
  await page.locator('[data-start]:not([disabled])').click();
  await page.locator('[data-start]').waitFor({ state: 'detached' });
  await open('index.html');
  await page.locator('#backup button').first().waitFor();
  assert.ok(await page.locator('#backup button').count() >= 2, 'H06 舊站的備份與還原面板應照常可用');

  /* 關閉後同一瀏覽器不再顯示；關閉狀態只存在獨立 key，不進偏好（備份）*/
  const prefsBefore = await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY);
  await page.locator(`${BANNER} [data-legacy-banner-close]`).click();
  assert.equal(await page.locator(BANNER).count(), 0, 'H06 按關閉後提示立即消失');
  assert.ok(await page.evaluate((key) => localStorage.getItem(key), DISMISS_KEY), 'H06 關閉狀態應存在獨立 key');
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY), prefsBefore, 'H06 關閉狀態不得寫進偏好');
  for (const name of ['index.html', 'help.html', 'en/index.html', 'ja/guide.html', 'ja/quiz.html']) {
    await open(name);
    assert.equal(await page.locator(BANNER).count(), 0, `H06 ${name} 關閉後不再顯示`);
  }

  /* 瀏覽器停用 localStorage 時仍顯示、仍可關閉（本頁有效），且不丟出例外 */
  const blocked = await context.newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage denied'); } }));
  await open('en/index.html', blocked);
  assert.equal(await blocked.locator(BANNER).count(), 1, 'H06 停用儲存時仍應顯示搬家提示');
  await blocked.locator(`${BANNER} [data-legacy-banner-close]`).click();
  assert.equal(await blocked.locator(BANNER).count(), 0, 'H06 停用儲存時仍可關閉');
  await blocked.close();
  await page.evaluate((key) => localStorage.removeItem(key), DISMISS_KEY);

  /* 新網址未設定時（newSiteUrl 空或不是 http(s)）不顯示沒有連結的提示 */
  for (const newSiteUrl of ['', 'javascript:alert(1)']) {
    config = { siteOrigin: '', legacyOrigins: [origin], newSiteUrl };
    await open('index.html');
    assert.equal(await page.locator(BANNER).count(), 0, `H06 newSiteUrl=${JSON.stringify(newSiteUrl)} 不應顯示提示`);
  }

  /* ── H07：新網址或其他非舊站 origin 不顯示搬家提示 ── */
  for (const [label, value] of [
    ['新網址', { siteOrigin: origin, legacyOrigins: [], newSiteUrl: NEW_SITE }],
    ['新舊同列', { siteOrigin: origin, legacyOrigins: [origin], newSiteUrl: NEW_SITE }],
    ['其他 origin', { siteOrigin: 'https://new-site.test', legacyOrigins: ['https://old-site.test'], newSiteUrl: NEW_SITE }],
  ]) {
    config = value;
    requests.length = 0;
    for (const name of PAGES) {
      await open(name);
      assert.equal(await page.locator(BANNER).count(), 0, `H07 ${label} ${name} 不得顯示搬家提示`);
    }
    const apiCount = requests.filter(isApi).length;
    if (label === '其他 origin') assert.deepEqual(forbidden(), [], 'H05 其他 origin 不得發出 /api 或 Google 請求');
    console.log(`  H07 ${label}：${PAGES.length} 頁共 ${requests.length} 個請求，/api ${apiCount} 個`);
  }
  config = null;
}
