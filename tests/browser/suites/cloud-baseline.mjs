import assert from 'node:assert/strict';

/**
 * T15／C16：真 localStorage 的同步基準、真 BroadcastChannel 的跨分頁通知，
 * 以及首頁實際下載的備份檔與「複製代碼」產生的代碼都不含同步資訊。
 * 帳號 ID 與 email 都是假值，只在隔離的 Chromium context 中使用。
 */
const ACCOUNT = 'acct-browser-5c2e';
const EMAIL = 'learner@example.test';
const KEY = 'lang-learn.cloud.v1';

export async function run({ page, context, origin }) {
  const fresh = async () => {
    await page.goto(origin + '/__harness__');
    await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      await getLearningStore().clearAll();
      localStorage.clear();
    });
  };

  await fresh();
  const stored = await page.evaluate(async ({ account, key }) => {
    const { createCloudBaseline } = await import('/assets/js/ui/platform/cloud-baseline.js');
    const baseline = createCloudBaseline();
    baseline.set(account, { cloudRevision: 2, localRevision: 5, localEpoch: 'epoch-x', origin: 'upload' });
    baseline.set('acct-other', { cloudRevision: 1, localRevision: 1, localEpoch: 'epoch-y', origin: 'cloud' });
    const mine = baseline.get(account);
    const raw = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, '{broken');
    const broken = createCloudBaseline().get(account);
    return { mine, accounts: Object.keys(raw).sort(), broken };
  }, { account: ACCOUNT, key: KEY });
  assert.equal(stored.mine.cloudRevision, 2);
  assert.equal(stored.mine.origin, 'upload');
  assert.deepEqual(stored.accounts, ['acct-browser-5c2e', 'acct-other'].sort(), '依帳號分開存放');
  assert.equal(stored.broken, null, '壞資料當作沒有基準');

  const other = await context.newPage();
  try {
    await other.goto(origin + '/__harness__');
    await other.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      window.__changes = [];
      getLearningStore().onChange((change) => window.__changes.push(change));
    });
    const written = await page.evaluate(async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      const store = getLearningStore();
      const local = [];
      const off = store.onChange((change) => local.push(change));
      await store.recordQuizSession({ lang: 'ja', source: 'words', summary: { total: 1, correct: 1 }, operationId: 'cloud-tab-1',
        session: { source: 'words', questions: [{ kind: 'choice', sourceId: 'ja-w-001', options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: 0 }] } });
      off();
      const meta = await store.ready();
      return { local, meta: { revision: meta.revision, dataEpoch: meta.dataEpoch } };
    });
    assert.deepEqual(written.local, [{ ...written.meta, source: 'local' }], '本頁收到 {revision, dataEpoch}');
    await other.waitForFunction(() => window.__changes.length > 0);
    assert.deepEqual(await other.evaluate(() => window.__changes), [{ ...written.meta, source: 'remote' }], '其他分頁經 BroadcastChannel 收到通知');
  } finally {
    await other.close();
  }

  await page.evaluate(async ({ account }) => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { createCloudBaseline } = await import('/assets/js/ui/platform/cloud-baseline.js');
    const meta = await getLearningStore().ready();
    localStorage.removeItem('lang-learn.cloud.v1');
    createCloudBaseline().set(account, { cloudRevision: 3, localRevision: meta.revision, localEpoch: meta.dataEpoch, origin: 'upload' });
  }, { account: ACCOUNT });
  await page.goto(origin + '/');
  await page.locator('#backup [data-export]:not([disabled])').waitFor();
  assert.notEqual(await page.evaluate((key) => localStorage.getItem(key), KEY), null, '前提：同步基準存在');

  const pending = page.waitForEvent('download');
  await page.locator('#backup [data-export]').click();
  const file = await pending;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  const json = Buffer.concat(chunks).toString();
  assert.equal(JSON.parse(json).version, 2);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text) => { window.__copied = text; } } });
  });
  await page.locator('#backup [data-copy-code]').click();
  await page.waitForFunction(() => typeof window.__copied === 'string');
  const decoded = await page.evaluate(async () => {
    const { decodeBackupCode } = await import('/assets/js/core/backup-code.js');
    return decodeBackupCode(window.__copied);
  });

  for (const [label, text] of [['備份檔', json], ['備份代碼解碼後', decoded]]) {
    for (const secret of [KEY, 'cloudRevision', 'localEpoch', ACCOUNT, EMAIL, 'accountId', '__Host-ll_session']) {
      assert.equal(text.includes(secret), false, `C16 ${label}不可含有 ${secret}`);
    }
  }

  await fresh();
  await page.goto(origin + '/');
  await page.locator('#backup [data-file]').setInputFiles({ name: 'cloud-c16.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.locator('#backup [data-confirm]').click();
  await page.waitForFunction(() => document.querySelector('#backup .backup-msg').textContent.startsWith('已還原'));
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), KEY), null, 'C16 從備份還原不會帶入同步狀態');

  /**
   * T16 的模組在真 Chromium 可以載入；gzip 串流來回一致，超過上限時丟出 TOO_LARGE。
   */
  const gzip = await page.evaluate(async () => {
    const { gzipText, gunzipText, SNAPSHOT_MAX_BYTES } = await import('/assets/js/ui/platform/cloud-api.js');
    const { SYNC_STATUSES } = await import('/assets/js/ui/platform/cloud-sync-runner.js');
    const text = '學習紀錄 ' + 'abc'.repeat(2000);
    const round = await gunzipText(await gzipText(text));
    const tooLarge = await gzipText(Array.from({ length: 20000 }, (_, i) => (i * 2654435761 >>> 0).toString(36)).join(''), { maxBytes: 256 })
      .then(() => 'sent', (error) => error.code);
    return { same: round === text, tooLarge, limit: SNAPSHOT_MAX_BYTES, statuses: SYNC_STATUSES.length };
  });
  assert.deepEqual(gzip, { same: true, tooLarge: 'TOO_LARGE', limit: 8388608, statuses: 15 });
}
