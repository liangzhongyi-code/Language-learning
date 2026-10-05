import assert from 'node:assert/strict';

const payload = id => JSON.stringify({ format: 'lang-learn.backup', version: 1, exportedAt: 123,
  progress: { schemaVersion: 1, items: { [id]: { n: 2, w: 1 } } } });

/**
 * 真正首頁、DOM、file change 與 localStorage；只延遲 File.text 的 I/O，不替換面板邏輯。
 * 所有資料與 API patch 都限於 runner 新建的隔離 context，無登入或使用者紀錄。
 */
export async function run({ page, origin }) {
  await page.goto(origin + '/');
  await page.locator('#backup [data-file]').waitFor();
  await page.evaluate(() => {
    const original = File.prototype.text;
    window.fixtureReads = {};
    File.prototype.text = function () {
      return window.fixtureReads[this.name]?.promise ?? original.call(this);
    };
    window.fixtureDefer = name => {
      const job = {};
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      window.fixtureReads[name] = job;
    };
  });
  const selectFile = async (name, data) => {
    await page.locator('#backup [data-file]').focus();
    await page.locator('#backup [data-file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(data) });
  };
  const settle = async (name, data, fails = false) => page.evaluate(async ({ name, data, fails }) => {
    const job = window.fixtureReads[name];
    if (fails) job.reject(new Error('fixture delayed failure')); else job.resolve(data);
    await new Promise(resolve => setTimeout(resolve, 0));
  }, { name, data, fails });
  const snapshot = () => page.evaluate(() => ({ html: document.getElementById('backup').innerHTML,
    focus: document.activeElement?.outerHTML }));

  for (const fails of [false, true]) {
    const name = `late-${fails}.json`;
    await page.evaluate(name => window.fixtureDefer(name), name);
    await selectFile(name, payload('ja-w-old'));
    assert.equal(await page.locator('#backup [data-confirm]').count(), 0);
    await selectFile('new.json', payload('ja-w-new'));
    await page.locator('#backup [data-confirm]').waitFor();
    const before = await snapshot();
    await settle(name, payload('ja-w-old'), fails);
    assert.deepEqual(await snapshot(), before, 'late I/O cannot redraw or steal focus');
    await page.locator('#backup [data-confirm]').click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('lang-learn.progress.v1')).items),
      { 'ja-w-new': { n: 2, w: 1 } });
  }

  await selectFile('preview.json', payload('ja-w-preview'));
  await page.locator('#backup [data-confirm]').waitFor();
  await page.evaluate(() => { window.retiredConfirm = document.querySelector('#backup [data-confirm]'); });
  await page.evaluate(() => window.fixtureDefer('cancel.json'));
  await selectFile('cancel.json', payload('ja-w-canceled'));
  assert.equal(await page.locator('#backup [data-confirm]').count(), 0);
  await page.evaluate(() => window.retiredConfirm.click());
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('lang-learn.progress.v1')).items['ja-w-new']),
    'retired confirmation cannot import yesterday preview');
  await page.locator('#backup [data-cancel]').click();
  const canceled = await snapshot();
  await settle('cancel.json', payload('ja-w-canceled'));
  assert.deepEqual(await snapshot(), canceled, 'cancel invalidates pending success');

  await page.evaluate(() => window.fixtureDefer('before-code.json'));
  await selectFile('before-code.json', payload('ja-w-file'));
  await page.locator('#backup [data-code]').fill('langlearn0:' + Buffer.from(payload('ja-w-code')).toString('base64'));
  await page.locator('#backup [data-read-code]').click();
  await page.locator('#backup [data-confirm]').waitFor();
  const codePreview = await snapshot();
  await settle('before-code.json', payload('ja-w-file'));
  assert.deepEqual(await snapshot(), codePreview, 'file and code share request identity');
  await page.locator('#backup [data-confirm]').click();
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('lang-learn.progress.v1')).items['ja-w-code']));

  const invalid = JSON.parse(payload('ja-w-future')); invalid.progress.schemaVersion = 99;
  await selectFile('future.json', JSON.stringify(invalid));
  await page.waitForFunction(() => document.querySelector('#backup [role="status"]').textContent.includes('跳過'));
  assert.equal(await page.locator('#backup [data-confirm]').count(), 0);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('lang-learn.progress.v1')).items['ja-w-code']));
  const malformed = JSON.parse(payload('ja-w-malformed')); malformed.version = { toString: null };
  await selectFile('malformed.json', JSON.stringify(malformed));
  await page.waitForFunction(() => document.querySelector('#backup [role="status"]').textContent.includes('格式版本不合法'));
  assert.equal(await page.locator('#backup [data-confirm]').count(), 0);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
      `backup panel must not create horizontal overflow at ${width}`);
  }
}
