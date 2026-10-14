import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = JSON.parse(readFileSync(new URL('../../../app/assets-manifest.json', import.meta.url), 'utf8')).pages;
const BLOCK = /<!-- build-preload：[\s\S]*?<!-- \/build-preload -->\r?\n?/;
/**
 * 今日頁的練習題要等使用者做到練習才載入，不預載。
 */
const onDemand = (name, path) => name.endsWith('/daily.html') && /^\/assets\/js\/data\/(?:en|ja)\/practice\.js$/.test(path);
/**
 * 依偏好與網址參數才決定題庫的情境：今日級別、測驗題源（含英文沒有情境題時退回單字、無效題源）。
 */
const VARIANTS = [
  ...['ja', 'en'].flatMap((lang) => [
    { name: `${lang}/index.html`, prefs: { [`daily.${lang}.level`]: 3 } },
    { name: `${lang}/daily.html`, prefs: { [`daily.${lang}.level`]: 5 } },
    ...['sentences', 'cloze', 'mixed', 'scene', 'reading', 'words', 'toString'].map((source) => ({ name: `${lang}/quiz.html?source=${source}` })),
  ]),
];

/**
 * 每頁先拿掉預載區塊，記下頁面啟動實際載入的模組（程式與題庫）；再用原頁核對預載清單與它完全一致：
 * 沒有漏掉（否則線上又會逐層等待），也沒有多抓頁面用不到的模組。
 */
export async function run({ page, context, origin }) {
  let strip = false;
  await context.route(/\.html(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: strip ? body.replace(BLOCK, '') : body });
  });
  let requested = new Set();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/assets/js/') && path.endsWith('.js') && !path.endsWith('/theme-boot.js')) requested.add(path);
  });
  const load = async (name) => {
    requested = new Set();
    await page.goto(`${origin}/${name}`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('#app')?.textContent.includes('正在載入'));
    return [...requested].filter((path) => !onDemand(name.split('?')[0], path)).sort();
  };
  const verify = async (name, prefs) => {
    await page.goto(`${origin}/index.html`);
    await page.evaluate((value) => {
      if (value) localStorage.setItem('lang-learn.prefs.v1', JSON.stringify(value));
      else localStorage.removeItem('lang-learn.prefs.v1');
    }, prefs ?? null);
    strip = true;
    const needed = await load(name);
    strip = false;
    await load(name);
    const preloaded = await page.$$eval('link[rel="modulepreload"]', (links) => links.map((link) => new URL(link.href).pathname).sort());
    assert.ok(needed.length > 0, `${name} 應至少載入一個模組`);
    assert.deepEqual(preloaded, needed, `${name} ${prefs ? JSON.stringify(prefs) : ''} 的預載與實際載入不一致：程式模組請執行 node tools/build-preload.mjs 並更新 bootModules；題庫請對齊 data-preload.js`);
  };
  for (const name of PAGES) await verify(name);
  for (const { name, prefs } of VARIANTS) await verify(name, prefs);
  await page.evaluate(() => localStorage.removeItem('lang-learn.prefs.v1'));
}
