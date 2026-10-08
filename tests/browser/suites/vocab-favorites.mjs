import assert from 'node:assert/strict';

/**
 * F23：隔離 Chromium context、隨機 loopback origin 與真 IndexedDB。
 * 實際英日頁面測鍵盤／重載／單字簿互通；故障案例使用專用 fixture DB。
 */
export async function run({ page, context, origin }) {
  const waitMember = async (id, member) => page.waitForFunction(({ id, member }) => {
    const button = [...document.querySelectorAll('[data-favorite]')].find(b => b.dataset.favorite === id);
    return button && !button.disabled && button.getAttribute('aria-pressed') === String(member);
  }, { id, member });
  const waitMessage = async text => page.waitForFunction(text =>
    document.querySelector('[data-favorites-status]').textContent.includes(text), text);

  for (const lang of ['en', 'ja']) {
    await page.goto(`${origin}/${lang}/vocabulary.html`);
    const first = page.locator('[data-favorite]').first();
    await page.locator('[data-favorite]:not([disabled])').first().waitFor();
    const id = await first.getAttribute('data-favorite');
    const target = await first.locator('xpath=../..').locator('.word-target').innerText();
    assert.match(await first.getAttribute('aria-label'), new RegExp('收藏'));
    assert.ok((await first.getAttribute('aria-label')).includes(target), 'F23 具體標示單字');
    assert.equal(await first.locator('svg').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('[data-favorites-status]').getAttribute('role'), 'status');

    await page.locator('[type="search"]').focus();
    await page.keyboard.press('Tab');
    for (let n = 0; n < 6 && !(await first.evaluate(b => b === document.activeElement)); n++) {
      await page.keyboard.press('Tab');
    }
    assert.equal(await first.evaluate(b => b === document.activeElement), true, 'F23 Tab 可到收藏');
    const focusStyle = await first.evaluate(b => {
      const css = getComputedStyle(b);
      return { style: css.outlineStyle, width: css.outlineWidth };
    });
    assert.notEqual(focusStyle.style, 'none', 'F23 焦點有可見外框');
    assert.notEqual(focusStyle.width, '0px');
    await page.keyboard.press('Enter');
    await waitMember(id, true);
    assert.equal(await first.evaluate(b => b === document.activeElement), true, 'F23 保存後保留焦點');
    assert.match(await first.getAttribute('aria-label'), /取消收藏/);
    await page.keyboard.press('Space');
    await waitMember(id, false);
    await page.keyboard.press('Enter');
    await waitMember(id, true);

    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const box = await first.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `F23 ${lang} ${width}px 點擊範圍至少 44×44`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `F23 ${lang} ${width}px 無整頁水平捲動`);
    }
    await page.reload();
    await waitMember(id, true);
    const other = await context.newPage();
    try {
      await other.goto(`${origin}/${lang}/library.html`);
      const remove = other.locator(`[data-remove="${id}"][data-book="favorites"]`);
      await remove.waitFor();
      await remove.click();
      await other.waitForFunction(() => document.querySelector('.backup-msg').textContent === '已移出。');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await waitMember(id, false);
    } finally {
      await other.close();
    }
  }

  /**
   * 保持真實 store／service／交易，只在 store 邊界加入可控等待與讀取故障。
   * beforeCommit 的 QuotaExceededError 驗證交易中止後原資料不變。
   */
  const fixture = async ({ holdReady = false, failRead = false, count = 2, lang = 'en' } = {}) => {
    await page.goto(origin + '/__harness__');
    await page.addStyleTag({ url: origin + '/assets/css/theme.css' });
    await page.evaluate(async options => {
      const { initVocabPage } = await import('/assets/js/ui/vocab-view.js');
      const { createLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
      const { createLibraryService } = await import('/assets/js/ui/platform/library-service.js');
      const state = { failRead: options.failRead, failWrite: false, calls: 0, holdCommit: false };
      const name = 'fixture-vocab-favorites-' + crypto.randomUUID();
      const repository = createWebRepository({ name, beforeCommit() {
        if (state.failWrite) throw new DOMException('fixture quota', 'QuotaExceededError');
      } });
      const base = createLearningStore({ repository, legacyStorage: { getItem: () => null } });
      await base.ready();
      let releaseReady;
      const readyWait = new Promise(resolve => { releaseReady = resolve; });
      const store = {
        async ready() { if (options.holdReady) await readyWait; return base.ready(); },
        async read(stores) {
          if (state.failRead) throw { code: 'STORAGE_UNAVAILABLE' };
          return base.read(stores);
        },
        async commit(operation) {
          state.calls++;
          if (state.holdCommit) await new Promise(resolve => { state.releaseCommit = resolve; });
          return base.commit(operation);
        },
      };
      const words = Array.from({ length: options.count }, (_, i) => ({ id: `${options.lang}-fixture-${i + 1}`,
        target: options.lang === 'ja' ? `雨${i + 1}` : `word${i + 1}`, zh: '假資料',
        reading: options.lang === 'ja' ? 'あめ' : null, romaji: options.lang === 'ja' ? 'ame' : null,
        pos: 'noun', category: 'food', level: 1 }));
      document.querySelector('#app').className = 'wrap';
      const ready = initVocabPage({ lang: options.lang, words, mount: document.querySelector('#app'), store });
      window.favoritesFixture = { state, ready, releaseReady, base, service: createLibraryService({ store: base }) };
    }, { holdReady, failRead, count, lang });
  };
  const ids = () => page.evaluate(async () => (await window.favoritesFixture.base.read(['books'])).rows.books.favorites.wordIds);
  const calls = () => page.evaluate(() => window.favoritesFixture.state.calls);
  const star = () => page.locator('[data-favorite]').first();

  await fixture({ holdReady: true });
  assert.equal(await star().isDisabled(), true, 'F23 等待就緒時停寫');
  assert.equal(await star().locator('xpath=../..').locator('[data-speak]').getAttribute('data-speak'), 'word1');
  await page.locator('[type="search"]').fill('word1');
  await page.waitForFunction(() => document.querySelector('.count-line').textContent === '目前 1 筆');
  await page.evaluate(() => window.favoritesFixture.releaseReady());
  await waitMember('en-fixture-1', false);
  await page.evaluate(() => { window.favoritesFixture.state.holdCommit = true; });
  await star().click();
  assert.equal(await star().isDisabled(), true);
  assert.equal(await star().getAttribute('aria-pressed'), 'false', 'F23 未保存前不先亮星號');
  await star().dispatchEvent('click');
  await page.locator('[type="search"]').fill('word');
  await page.waitForFunction(() => document.querySelector('.count-line').textContent === '目前 2 筆');
  await star().dispatchEvent('click');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await calls(), 1, 'F23 保存中重繪與重複點擊只送一次');
  await page.evaluate(() => { window.favoritesFixture.state.holdCommit = false; window.favoritesFixture.state.releaseCommit(); });
  await waitMember('en-fixture-1', true);
  assert.deepEqual(await ids(), ['en-fixture-1']);

  await page.evaluate(() => { window.favoritesFixture.state.failWrite = true; });
  await star().click();
  await waitMessage('未保存');
  assert.equal(await star().getAttribute('aria-pressed'), 'true', 'F23 取消失敗保留已收藏');
  assert.equal(await star().isDisabled(), false);
  assert.deepEqual(await ids(), ['en-fixture-1'], 'F23 quota 中止不改真 IndexedDB');
  await page.evaluate(() => { window.favoritesFixture.state.failWrite = false; });
  await star().click();
  await waitMember('en-fixture-1', false);
  assert.deepEqual(await ids(), []);

  await page.evaluate(() => { window.favoritesFixture.state.failRead = true; });
  await star().click();
  await waitMessage('已保存，但收藏讀取失敗');
  assert.deepEqual(await ids(), ['en-fixture-1']);
  assert.equal(await star().isDisabled(), true);
  const savedCalls = await calls();
  await page.evaluate(() => { window.favoritesFixture.state.failRead = false; });
  await page.locator('[data-favorites-retry]').click();
  await waitMember('en-fixture-1', true);
  assert.equal(await calls(), savedCalls, 'F23 已保存後只重試讀取');

  await fixture({ failRead: true });
  await waitMessage('收藏讀取失敗');
  assert.equal(await star().isDisabled(), true);
  await page.locator('[type="search"]').fill('word2');
  await page.waitForFunction(() => document.querySelectorAll('[data-favorite]').length === 1);
  await page.evaluate(() => { window.favoritesFixture.state.failRead = false; });
  await page.locator('[data-favorites-retry]').click();
  await waitMember('en-fixture-2', false);
  assert.equal(await calls(), 0, 'F23 初次讀取重試不寫入');

  await fixture({ count: 301, lang: 'ja' });
  await waitMember('ja-fixture-1', false);
  assert.equal(await page.locator('[data-favorite]').count(), 300);
  await page.locator('[data-more]').click();
  assert.equal(await page.locator('[data-favorite]').count(), 301, 'F23 展開更多保留控制');
  await page.evaluate(async () => window.favoritesFixture.service.setMember('favorites', 'ja-fixture-1', true));
  await star().click();
  await waitMember('ja-fixture-1', true);
  assert.deepEqual(await ids(), ['ja-fixture-1'], 'F23 落後畫面提交加入意向不反向取消');
  await page.evaluate(async () => {
    await window.favoritesFixture.service.setMember('favorites', 'ja-fixture-1', false);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitMember('ja-fixture-1', false);
  await page.locator('[type="search"]').fill('雨301');
  await page.waitForFunction(() => document.querySelectorAll('[data-favorite]').length === 1);
  assert.equal(await star().getAttribute('data-favorite'), 'ja-fixture-301');
  assert.equal(await page.locator('[data-speak]').getAttribute('data-speak'), 'あめ', 'F23 日文仍朗讀假名');
}
