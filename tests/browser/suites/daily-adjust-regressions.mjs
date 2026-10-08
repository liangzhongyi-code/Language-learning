import assert from 'node:assert/strict';

/**
 * 只在隔離 context 暫停真 today 的回傳；skip／known 都走真 IndexedDB。
 */
export async function run({ page, origin }) {
  await page.route('**/assets/js/ui/platform/daily-service.js', async route => {
    const response = await route.fetch();
    const original = (await response.text()).replace('export function createDailyService(', 'function baseDailyService(');
    await route.fulfill({ response, body: original + `
      export function createDailyService(options) {
        const service = baseDailyService(options);
        const today = service.today;
        service.today = async (...args) => {
          const view = await today(...args);
          if (!window.adjustFixture?.hold) return view;
          return new Promise(resolve => window.adjustFixture.pending.push({ view, resolve }));
        };
        return service;
      }` });
  });
  for (const kind of ['skip', 'known']) {
    await page.goto(origin + '/__harness__');
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      await getLearningStore().clearAll();
      const { setPref } = await import('/assets/js/ui/prefs.js');
      setPref('daily.ja.level', 1);
      setPref('daily.ja.newLimit', 5);
      const { initDailyPage } = await import('/assets/js/ui/daily-view.js');
      window.adjustFixture = { hold: false, pending: [] };
      const words = [1, 2].flatMap(level => Array.from({ length: 6 }, (_, i) => ({
        id: `ja-w-adjust-${level}-${i}`, target: `假字${level}-${i}`, zh: `假義${level}-${i}`, level,
      })));
      initDailyPage({ lang: 'ja', wordProvider: async level => words.filter(word => word.level === level),
        mount: document.querySelector('#app'), noticeHost: document.createElement('div') });
    });
    await page.locator('[data-continue]').click();
    await page.evaluate(() => { adjustFixture.hold = true; });
    await page.locator(`[data-${kind}]`).click();
    await page.waitForFunction(() => adjustFixture.pending.length === 1);
    await page.locator('[data-back]').click();
    assert.equal(await page.locator('[data-set="level"]').count(), 0, `${kind} 刷新未完成前不能切級別`);
    await page.evaluate(() => { adjustFixture.hold = false; const p = adjustFixture.pending[0]; p.resolve(p.view); });
    await page.waitForFunction(() => document.querySelector('.prompt')?.textContent.includes('假字1-1'));
    await page.locator('[data-back]').click();
    await page.locator('[data-set="level"][data-value="2"]').click();
    await page.locator('[data-continue]').waitFor();
    assert.equal(await page.locator('[data-set="level"][data-value="2"]').getAttribute('aria-pressed'), 'true');
    assert.ok((await page.locator('.daily-word').allTextContents()).every(word => word.startsWith('假字2-')));
  }
}
