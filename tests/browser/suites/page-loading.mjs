import assert from 'node:assert/strict';

/**
 * 題庫請求被暫停時，導覽與外觀仍可操作；首頁只抓目前級別，不抓原始全庫批次。
 */
export async function run({ page, context, origin }) {
  const resources = [];
  page.on('request', request => resources.push(new URL(request.url()).pathname));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await context.route('**/assets/js/data/**', async route => {
    if (route.request().url().includes('/catalog/ja-words-')) await held;
    await route.continue();
  });
  try {
    await page.goto(origin + '/ja/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.topbar').waitFor({ timeout: 2000 });
    await page.waitForFunction(() => document.querySelector('[data-count="words"]').textContent === '7608');
    assert.equal(await page.locator('[data-count="words"]').innerText(), '7608');
    await page.locator('.appearance-toggle').click();
    assert.equal(await page.locator('[data-appearance-panel]').evaluate(node => node.open), true);
    assert.equal(resources.filter(path => /\/ja\/words\//.test(path)).length, 0);
    assert.equal(resources.filter(path => /\/catalog\/ja-words-[2-5]\.js/.test(path)).length, 0);
    assert.equal(resources.filter(path => /\/catalog\/ja-sentences/.test(path)).length, 0);
  } finally { release(); }
  await page.locator('.today-card').waitFor();

  /**
   * 索引或單級題庫故障只隔離今日卡，不拖垮導覽與已保存的統計。
   * 每次重新導向都使用新的 document module map；沒有接觸真實瀏覽器紀錄。
   */
  for (const lang of ['ja', 'en']) {
    for (const asset of ['meta.js', `${lang}-words-1.js`]) {
      const pattern = '**/assets/js/data/catalog/' + asset;
      await context.route(pattern, route => route.abort('failed'));
      await page.goto(origin + `/${lang}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('.topbar').waitFor();
      await page.locator('#today [data-load-retry]').waitFor();
      await page.locator('#stats .stats').waitFor();
      assert.match(await page.locator('#stats').innerText(), /開始第一局/);
      await page.locator('.appearance-toggle').click();
      assert.equal(await page.locator('[data-appearance-panel]').evaluate(node => node.open), true);
      await context.unroute(pattern);
      await Promise.all([
        page.waitForEvent('domcontentloaded'),
        page.locator('[data-load-retry]').click(),
      ]);
      await page.locator('.today-card').waitFor();
      assert.equal(await page.locator('[data-count="words"]').innerText(), lang === 'ja' ? '7608' : '4033');
    }
    const before = resources.length;
    await page.goto(origin + `/${lang}/history.html`);
    await page.locator('#app [data-load-retry]').waitFor({ state: 'detached' });
    await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('正在載入'));
    assert.equal(resources.slice(before).filter(path => path.startsWith('/assets/js/data/')).length, 0,
      '歷程不為未使用的題庫或索引發出請求');
    for (const kind of ['quiz', 'daily']) {
      if (kind === 'daily') {
        await page.evaluate(async lang => {
          const { setPref } = await import('/assets/js/ui/prefs.js');
          setPref(`daily.${lang}.level`, 3);
        }, lang);
      }
      const pattern = `**/assets/js/data/catalog/${lang}-words-${kind === 'daily' ? 3 : 1}.js`;
      await context.route(pattern, route => route.abort('failed'));
      await page.goto(origin + `/${lang}/${kind}.html`);
      const retry = kind === 'quiz' ? '[data-source-retry]' : '[data-words-retry]';
      await page.locator(retry).waitFor();
      await context.unroute(pattern);
      await Promise.all([page.waitForEvent('domcontentloaded'), page.locator(retry).click()]);
      const ready = kind === 'quiz' ? '[data-start]:not([disabled])' : '[data-continue]:not([disabled])';
      await page.locator(ready).waitFor();
      if (kind === 'quiz') assert.equal(new URL(page.url()).searchParams.get('source'), 'words');
      else assert.equal(await page.locator('[data-set="level"][data-value="3"]').getAttribute('aria-pressed'), 'true');
    }
  }
  const scene = '**/assets/js/data/catalog/ja-scenes.js';
  await context.route(scene, route => route.abort('failed'));
  await page.goto(origin + '/ja/quiz.html?source=scene');
  await page.locator('[data-source-retry]').waitFor();
  await context.unroute(scene);
  await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('[data-source-retry]').click()]);
  await page.locator('[data-start]:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-set="source"][data-value="scene"]').getAttribute('aria-pressed'), 'true');
}
