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
    ...['sentences', 'cloze', 'mixed', 'scene', 'reading', 'jlpt', 'words', 'toString'].map((source) => ({ name: `${lang}/quiz.html?source=${source}` })),
  ]),
];

/**
 * 先讓瀏覽器走完頁面轉址，取得正式網址與預載清單。再直接開啟正式網址，
 * 移除預載區塊並記下啟動實際載入的模組，核對兩者完全一致。
 */
export async function run({ page, context, origin, serverKind }) {
  let strip = false;
  await context.route((url) => url.origin === origin, async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'document') return route.fallback();
    const response = await route.fetch({ maxRedirects: 0 });
    if (!strip || !response.ok()) return route.fulfill({ response });
    const body = await response.text();
    await route.fulfill({ response, body: body.replace(BLOCK, '') });
  });
  let requested = new Set();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/assets/js/') && path.endsWith('.js') && !path.endsWith('/theme-boot.js')) requested.add(path);
  });
  const load = async (url) => {
    requested = new Set();
    const response = await page.goto(url);
    assert.ok(response?.ok(), url + ' 最終頁應成功載入');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('#app')?.textContent.includes('正在載入'));
    return response;
  };
  const verify = async (name, prefs) => {
    await page.goto(origin + '/index.html');
    await page.evaluate((value) => {
      if (value) localStorage.setItem('lang-learn.prefs.v1', JSON.stringify(value));
      else localStorage.removeItem('lang-learn.prefs.v1');
    }, prefs ?? null);
    const initialUrl = origin + '/' + name;
    const response = await load(initialUrl);
    const finalUrl = page.url();
    if (serverKind === 'wrangler' && name === 'en/index.html') {
      assert.equal(response.request().redirectedFrom()?.url(), initialUrl, 'Worker 的轉址應由瀏覽器跟隨');
    }
    const preloaded = await page.$$eval('link[rel="modulepreload"]', (links) => links.map((link) => new URL(link.href).pathname).sort());
    strip = true;
    try {
      await load(finalUrl);
      assert.equal(page.url(), finalUrl, name + ' 應在同一正式網址比對預載');
      assert.equal(await page.locator('link[rel="modulepreload"]').count(), 0, name + ' 應先移除預載區塊');
    } finally {
      strip = false;
    }
    const needed = [...requested].filter((path) => !onDemand(name.split('?')[0], path)).sort();
    assert.ok(needed.length > 0, `${name} 應至少載入一個模組`);
    assert.deepEqual(preloaded, needed, `${name} ${prefs ? JSON.stringify(prefs) : ''} 的預載與實際載入不一致：程式模組請執行 node tools/build-preload.mjs 並更新 bootModules；題庫請對齊 data-preload.js`);
  };
  for (const name of PAGES) await verify(name);
  for (const { name, prefs } of VARIANTS) await verify(name, prefs);
  await page.evaluate(() => localStorage.removeItem('lang-learn.prefs.v1'));
}
