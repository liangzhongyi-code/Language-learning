import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { enableCloud } from './cloud-auth.mjs';

export async function run({ page, context, origin }) {
  let revision = 0;
  let content = null;
  let uploads = 0;
  const respond = async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/me') return route.fulfill({ json: { accountId: 'acct-1', email: 'learner@example.test', role: 'member' } });
    assert.equal(request.headers()['x-cloud-account'], 'acct-1');
    if (path.endsWith('/meta')) return route.fulfill({ json: { revision } });
    if (request.method() === 'GET') return route.fulfill({
      headers: { 'x-revision': String(revision), 'content-type': 'application/gzip' }, body: content,
    });
    assert.equal(request.method(), 'PUT');
    assert.equal(request.headers()['if-match'], String(revision));
    content = request.postDataBuffer();
    assert.equal(JSON.parse(gunzipSync(content).toString()).version, 2);
    uploads++;
    return route.fulfill({ json: { revision: ++revision } });
  };
  const configure = async (device) => {
    await enableCloud(device, origin);
    await device.route('**/api/**', respond);
  };
  const local = (tab) => tab.evaluate(async () =>
    (await import('/assets/js/ui/platform/learning-store.js')).getLearningStore().ready());
  const seed = (tab, id) => tab.evaluate(async (word) => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    await getLearningStore().recordQuizSession({ lang: 'ja', source: 'words', operationId: 'cloud-test-' + word,
      summary: { total: 1, correct: 1 }, session: { source: 'words',
        questions: [{ kind: 'choice', sourceId: word, options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: 0 }] } });
  }, id);
  const open = async (tab) => {
    await tab.goto(origin + '/');
    await tab.locator('.cloud-menu summary').click();
  };
  const choice = (tab, key) => tab.locator('[data-cloud-action="' + key + '"]');
  const status = (tab, text) => tab.locator('[data-cloud-status]').filter({ hasText: text }).waitFor();
  await seed(page, 'ja-w-001');
  await configure(context);
  await open(page);
  await status(page, '已同步');
  assert.equal(uploads, 1);

  const other = await context.browser().newContext({ serviceWorkers: 'block' });
  try {
    await other.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await configure(other);
    const fresh = await other.newPage();
    await open(fresh);
    await status(fresh, '雲端有學習紀錄');
    const empty = await local(fresh);
    await choice(fresh, 'cloud').click();
    await fresh.locator('#backup [data-cancel]').click();
    await status(fresh, '雲端有學習紀錄');
    assert.deepEqual(await local(fresh), empty);
    assert.equal(uploads, 1);
    await choice(fresh, 'cloud').click();
    await fresh.locator('#backup [data-confirm]').click();
    await status(fresh, '已同步');
    assert.notEqual((await local(fresh)).dataEpoch, empty.dataEpoch);
    assert.equal(uploads, 1);

    await seed(fresh, 'ja-w-002');
    await seed(page, 'ja-w-003');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(() => document.querySelector('[data-cloud-status]').textContent === '已同步');
    await fresh.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await status(fresh, '有衝突待處理');
    await choice(fresh, 'later').click();
    assert.equal(uploads, 2);
    const beforeBad = await local(fresh);
    const previous = content;
    content = gzipSync(Buffer.from('not json'));
    await choice(fresh, 'cloud').click();
    await fresh.locator('#backup .backup-msg').filter({ hasText: /JSON|備份/ }).waitFor();
    await status(fresh, '有衝突待處理');
    assert.deepEqual(await local(fresh), beforeBad);
    content = previous;
    fresh.once('dialog', (dialog) => dialog.accept());
    await choice(fresh, 'local').click();
    await status(fresh, '已同步');
    assert.equal(uploads, 3);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await status(page, '其他裝置有較新的紀錄');
  } finally {
    await other.close();
  }
}
