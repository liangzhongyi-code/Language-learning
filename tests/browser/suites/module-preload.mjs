import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = JSON.parse(readFileSync(new URL('../../../app/assets-manifest.json', import.meta.url), 'utf8')).pages;
const BLOCK = /<!-- build-preload：[\s\S]*?<!-- \/build-preload -->\r?\n?/;
/**
 * 依使用者選擇才載入的資料（分級單字、句型等題庫，以及今日頁按需的練習題）不預載。
 */
const onDemand = (name, path) => /^\/assets\/js\/data\/catalog\/(?:en|ja)-/.test(path)
  || (name.endsWith('/daily.html') && /^\/assets\/js\/data\/(?:en|ja)\/practice\.js$/.test(path));

/**
 * 每頁先拿掉預載區塊，記下頁面啟動實際載入的程式模組；再用原頁核對預載清單與它完全一致：
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
    return [...requested].filter((path) => !onDemand(name, path)).sort();
  };
  for (const name of PAGES) {
    strip = true;
    const needed = await load(name);
    strip = false;
    await load(name);
    const preloaded = await page.$$eval('link[rel="modulepreload"]', (links) => links.map((link) => new URL(link.href).pathname).sort());
    assert.ok(needed.length > 0, `${name} 應至少載入一個模組`);
    assert.deepEqual(preloaded, needed, `${name} 的 modulepreload 與實際載入的模組不一致，請執行 node tools/build-preload.mjs 並更新 bootModules`);
  }
}
