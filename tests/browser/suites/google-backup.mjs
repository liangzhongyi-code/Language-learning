import assert from 'node:assert/strict';

/**
 * Google 面板：未設定時零請求（G01）；以 route 模擬 GIS 與 Drive，驗證連接、不可變多份備份、
 * 分頁清單、下載後走同一個預覽確認流程（G03/G04），以及中斷後撤下雲端預覽（G06）。
 * 沒有任何真實 Google 請求；token 為假值。
 */
export async function run({ page, context, origin }) {
  const googleRequests = [];
  page.on('request', (request) => {
    if (/google(apis)?\.com/.test(new URL(request.url()).hostname)) googleRequests.push(request.url());
  });
  await page.goto(origin + '/');
  await page.waitForFunction(() => document.getElementById('google-backup').textContent.includes('尚未設定'));
  assert.deepEqual(googleRequests, [], 'G01 Client ID 留空時不載入 SDK、不發請求');

  const files = [];
  await context.route('https://accounts.google.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    window.google = { accounts: { oauth2: {
      initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'fake-token-A', expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.appdata openid email' }), 0); } }; },
      revoke(token, done) { if (done) done(); },
    } } };` }));
  await context.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/oauth2/v3/userinfo') return json({ email: 'learner@example.com', email_verified: true });
    if (url.pathname === '/upload/drive/v3/files' && request.method() === 'POST') {
      const body = request.postData();
      const parts = body.split(/\r?\n--/).map((part) => part.slice(part.search(/\r?\n\r?\n/)).trim());
      const meta = JSON.parse(parts.find((part) => part.includes('appProperties')));
      const content = parts.find((part) => part.includes('"lang-learn.backup"'));
      const file = { id: `file${files.length + 1}`, name: meta.name, createdTime: new Date(1791158400000 + files.length * 1000).toISOString(),
        size: String(content.length), appProperties: meta.appProperties, content };
      files.push(file);
      const { content: _, ...visible } = file;
      return json(visible);
    }
    if (url.pathname === '/drive/v3/files' && request.method() === 'GET') {
      return json({ files: [...files].reverse().map(({ content, ...visible }) => visible) });
    }
    const match = url.pathname.match(/^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/);
    if (match && url.searchParams.get('alt') === 'media') {
      const file = files.find((row) => row.id === match[1]);
      return file ? route.fulfill({ status: 200, contentType: 'application/json', body: file.content }) : json({ error: { code: 404 } }, 404);
    }
    return json({ error: { code: 400 } }, 400);
  });

  await page.evaluate(async () => {
    const { initLearningBackupPanel } = await import('/assets/js/ui/learning-backup-view.js');
    const { initGoogleBackupPanel } = await import('/assets/js/ui/google-backup-view.js');
    const backup = document.createElement('div');
    const google = document.createElement('div');
    backup.id = 'test-backup';
    google.id = 'test-google';
    document.querySelector('main').append(backup, google);
    const panel = initLearningBackupPanel(backup);
    await new Promise((resolve) => { const t = setInterval(() => { if (panel.store) { clearInterval(t); resolve(); } }, 20); });
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    await getLearningStore().recordQuizSession({ lang: 'ja', source: 'words', summary: { total: 1, correct: 1 },
      session: { source: 'words', questions: [{ kind: 'choice', sourceId: 'ja-w-321', options: [{}, {}], correctIndex: 0, answeredIndex: 0 }] },
      operationId: 'google-fixture-quiz' });
    initGoogleBackupPanel(google, panel, { config: { webClientId: 'fixture.apps.googleusercontent.com' } });
  });
  await page.locator('#test-google [data-connect]').click();
  await page.waitForFunction(() => document.getElementById('test-google').textContent.includes('learner@example.com'));
  for (let i = 0; i < 2; i++) {
    await page.locator('#test-google [data-upload]:not([disabled])').click();
    for (let wait = 0; files.length < i + 1 && wait < 100; wait++) await page.waitForTimeout(50);
    await page.waitForFunction(() => document.querySelector('#test-google .backup-msg')?.textContent.includes('已備份到 Google'));
  }
  assert.equal(files.length, 2, 'G03 每次備份新增一份');
  assert.notEqual(files[0].appProperties.exportId, files[1].appProperties.exportId);
  await page.locator('#test-google [data-list]').click();
  await page.waitForFunction(() => document.querySelectorAll('#test-google [data-restore]').length === 2);
  await page.locator('#test-google [data-restore]').first().click();
  await page.locator('#test-backup [data-confirm]').waitFor();
  assert.match(await page.locator('#test-backup .backup-preview').innerText(), /來自 Google 雲端快照/, 'G04 下載後走共用預覽');
  await page.locator('#test-google [data-disconnect]').click();
  await page.waitForFunction(() => !document.querySelector('#test-backup [data-confirm]'));
  assert.equal(await page.locator('#test-google [data-restore]').count(), 0, 'G06 中斷後清除清單與雲端預覽');
  const leaked = await page.evaluate(() => JSON.stringify(localStorage) + document.cookie + location.href);
  assert.equal(leaked.includes('fake-token-A'), false, 'G05 token 不寫入持久儲存或網址');
}
