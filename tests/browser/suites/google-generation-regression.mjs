import assert from 'node:assert/strict';

const payload = id => JSON.stringify({ format: 'lang-learn.backup', version: 1, exportedAt: 123,
  progress: { schemaVersion: 1, items: { [id]: { n: 2, w: 1 } } } });

/**
 * G07 跨來源競態：真正的 Google／本機面板、restore controller 與 IndexedDB。
 * 只在隔離 context 以 route 假造 GIS／Drive，延遲下載成功或失敗；不替換預覽邏輯、不使用真實 OAuth。
 */
export async function run({ page, context, origin }) {
  let nextDownload = null;
  let downloads = 0;
  const unexpectedRequests = [];

  function deferDownload() {
    assert.equal(nextDownload, null, '上一個下載必須已送出');
    let release;
    const response = new Promise(resolve => { release = resolve; });
    nextDownload = { response };
    return { release };
  }

  await context.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.google = { accounts: { oauth2: {
      initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({
        access_token: 'fixture-generation-token', expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.appdata openid email'
      }), 0); } }; },
      revoke(token, done) { done?.(); }
    } } };` }));
  await context.route('https://www.googleapis.com/**', async route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().method() === 'GET' && url.pathname === '/oauth2/v3/userinfo') {
      return json({ email: 'generation@example.com', email_verified: true });
    }
    if (route.request().method() === 'GET' && url.pathname === '/drive/v3/files') {
      return json({ files: [{ id: 'fixture-cloud', name: 'fixture.json',
        appProperties: { exportId: 'fixture-generation', schemaVersion: '1', exportedAt: '123' } }] });
    }
    if (route.request().method() === 'GET' && url.pathname === '/drive/v3/files/fixture-cloud' && url.searchParams.get('alt') === 'media') {
      const job = nextDownload;
      nextDownload = null;
      downloads++;
      if (job) {
        const { fails = false, text = payload('ja-w-cloud') } = await job.response;
        return fails ? json({ error: { code: 500 } }, 500)
          : route.fulfill({ contentType: 'application/json', body: text });
      }
    }
    unexpectedRequests.push(route.request().method() + ' ' + url.pathname);
    return json({ error: { code: 400 } }, 400);
  });

  await page.goto(origin + '/');
  await page.evaluate(async () => {
    const { initLearningBackupPanel } = await import('/assets/js/ui/learning-backup-view.js');
    const { initGoogleBackupPanel } = await import('/assets/js/ui/google-backup-view.js');
    const backup = document.createElement('div');
    const google = document.createElement('div');
    backup.id = 'generation-backup';
    google.id = 'generation-google';
    document.querySelector('main').append(backup, google);
    const panel = initLearningBackupPanel(backup);
    initGoogleBackupPanel(google, panel, { config: { webClientId: 'fixture.apps.googleusercontent.com' } });
    window.generationStoredItems = async () => {
      const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
      return (await getLearningStore().legacyView()).progress.items;
    };
  });
  const backup = page.locator('#generation-backup');
  const google = page.locator('#generation-google');
  await backup.locator('[data-file]').waitFor();
  await google.locator('[data-connect]').click();
  await google.locator('[data-list]:not([disabled])').waitFor();
  await google.locator('[data-list]').click();
  await google.locator('[data-restore]:not([disabled])').waitFor();

  const selectFile = async id => {
    await backup.locator('[data-file]').setInputFiles({ name: id + '.json', mimeType: 'application/json', buffer: Buffer.from(payload(id)) });
    await backup.locator('[data-confirm]').waitFor();
  };
  const snapshot = () => page.evaluate(() => ({ html: document.getElementById('generation-backup').innerHTML,
    focus: document.activeElement === document.body ? 'BODY' : document.activeElement?.outerHTML }));
  const storedItems = () => page.evaluate(() => window.generationStoredItems());
  const startDownload = async () => {
    const job = deferDownload();
    const request = page.waitForRequest(request => request.url() === 'https://www.googleapis.com/drive/v3/files/fixture-cloud?alt=media');
    await google.locator('[data-restore]').click();
    await request;
    return job;
  };
  const finish = async (job, response = {}) => {
    job.release(response);
    await google.locator('[data-list]:not([disabled])').waitFor();
  };
  const confirm = async id => {
    await backup.locator('[data-confirm]').click();
    await page.waitForFunction(() => document.querySelector('#generation-backup .backup-msg').textContent.startsWith('已還原'));
    assert.deepEqual(await storedItems(), { [id]: { n: 2, w: 1 } }, '確認只還原最後選取的固定內容');
  };

  for (const source of ['file', 'code']) {
    for (const fails of [false, true]) {
      const job = await startDownload();
      const id = `ja-w-${source}-${fails}`;
      if (source === 'file') await selectFile(id);
      else {
        await backup.locator('[data-code]').fill('langlearn0:' + Buffer.from(payload(id)).toString('base64'));
        await backup.locator('[data-read-code]').click();
        await backup.locator('[data-confirm]').waitFor();
      }
      await backup.locator('[data-confirm]').focus();
      const shown = await snapshot();
      const saved = await storedItems();
      await finish(job, { fails });
      assert.deepEqual(await snapshot(), shown, `G07 舊 Google ${fails ? '失敗' : '成功'}不得覆蓋較新的 ${source} 預覽或搶焦點`);
      assert.deepEqual(await storedItems(), saved, '預覽與晚到下載都不能自動還原');
      await confirm(id);
    }
  }

  for (const fails of [false, true]) {
    await selectFile('ja-w-retired');
    await page.evaluate(() => { window.generationRetiredConfirm = document.querySelector('#generation-backup [data-confirm]'); });
    const saved = await storedItems();
    const job = await startDownload();
    assert.equal(await backup.locator('[data-confirm]').count(), 0, '點選 Google 時立即取得預覽世代並撤下舊確認');
    await page.evaluate(() => window.generationRetiredConfirm.click());
    await backup.locator('[data-cancel]').click();
    const canceled = await snapshot();
    await finish(job, { fails });
    assert.deepEqual(await snapshot(), canceled, '取消後的下載成功／失敗都不能復活預覽或搶焦點');
    assert.deepEqual(await storedItems(), saved, '已退休的確認按鈕不得還原');
  }

  const saved = await storedItems();
  const latest = await startDownload();
  await finish(latest);
  assert.match(await backup.locator('.backup-preview').innerText(), /來自 Google 雲端快照/, '最新 Google 下載仍可正常預覽');
  assert.match(await google.locator('.backup-msg').innerText(), /已下載/);
  assert.deepEqual(await storedItems(), saved, '最新雲端預覽也不能自動寫入');
  const beforeConfirm = downloads;
  await confirm('ja-w-cloud');
  assert.equal(downloads, beforeConfirm, '確認只能使用已驗證內容，不重新下載');
  assert.deepEqual(unexpectedRequests, [], '測試不允許未預期的 Google 請求');
}
