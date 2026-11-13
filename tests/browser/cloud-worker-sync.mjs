/**
 * H01／T19：以兩個 Chromium context 驗證本機 Worker、D1 與假 Google 的完整同步。
 * 執行方式：node tests/browser/cloud-worker-sync.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { buildSite } from '../../tools/build-site.mjs';
import { applySql, readWranglerConfig, ROOT } from '../helpers/worker-env.mjs';
import { startFakeGoogle } from '../helpers/fake-google.mjs';
import { startWorkerServer } from './server.mjs';

const email = 'learner@example.test';
const clientId = 'browser-sync.apps.example.test';
const clientSecret = 'fake-browser-sync-secret';
const sessionCookie = '__Host-ll_session';
const snapshotPath = '/api/snapshot';
const original = 'ja-w-001';
const fromA = 'ja-w-002';
const fromB = 'ja-w-003';

async function startSyncWorker({ vars }) {
  const { unstable_startWorker, getPlatformProxy } = await import('wrangler');
  const scratch = await mkdtemp(join(tmpdir(), 'lang-learn-cloud-browser-'));
  let worker;
  try {
    const config = readWranglerConfig();
    const workerSource = join(scratch, 'worker');
    const site = join(scratch, 'site');
    const configPath = join(scratch, 'wrangler.json');
    const persist = join(scratch, 'state');
    await cp(join(ROOT, 'worker'), workerSource, { recursive: true });
    buildSite({ outDir: site });
    await writeFile(join(site, 'assets/js/config/cloud.js'), 'export const CLOUD_CONFIG = ' + JSON.stringify({
      siteOrigin: vars.SITE_ORIGIN, legacyOrigins: [], newSiteUrl: '',
    }) + ';\n');
    await writeFile(configPath, JSON.stringify({
      name: config.name + '-browser-sync',
      main: config.main,
      compatibility_date: config.compatibility_date,
      assets: { ...config.assets, directory: './site' },
      d1_databases: config.d1_databases,
      vars,
      send_metrics: false,
    }));

    // 關閉初始化 runtime 後，以同一份暫存 D1 啟動 Worker。
    const setup = await getPlatformProxy({ configPath, persist: { path: join(persist, 'v3') }, remoteBindings: false });
    try {
      const migrations = join(workerSource, 'migrations');
      const names = (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort();
      assert.ok(names.length > 0, '本機 D1 必須套用專案 migration');
      for (const name of names) await applySql(setup.env.DB, await readFile(join(migrations, name), 'utf8'));
      await setup.env.DB.prepare('INSERT INTO allowed_emails (email) VALUES (?)').bind(email).run();
    } finally {
      await setup.dispose();
    }

    worker = await unstable_startWorker({
      config: configPath,
      dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist, logLevel: 'error' },
    });
    await worker.ready;
    const url = await worker.url;
    return {
      fetch: (path, init) => fetch(new URL(path, url), { redirect: 'manual', ...init }),
      async dispose() {
        try { await worker.dispose(); } finally { await rm(scratch, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    try { await worker?.dispose(); } finally { await rm(scratch, { recursive: true, force: true }); }
    throw error;
  }
}

const choice = (page, action) => page.locator('[data-cloud-action="' + action + '"]');
const preview = (page) => page.locator('#backup [data-confirm]');
async function status(page, label) {
  const sync = page.locator('[data-cloud-status]');
  try {
    await sync.filter({ hasText: label }).waitFor({ state: 'attached' });
  } catch (error) {
    const backup = await page.locator('#backup .backup-msg').allTextContents();
    throw new Error('等待同步狀態「' + label + '」失敗。實際狀態 ' +
      JSON.stringify({ sync: await sync.allTextContents(), backup }), { cause: error });
  }
}

async function seed(page, word) {
  await page.evaluate(async (id) => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    await getLearningStore().recordQuizSession({
      lang: 'ja', source: 'words', operationId: 'worker-sync-' + id,
      summary: { total: 1, correct: 1 },
      session: { source: 'words', questions: [
        { kind: 'choice', sourceId: id, options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: 0 },
      ] },
    });
  }, word);
}

async function localState(page) {
  return page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const store = getLearningStore();
    const { meta, rows } = await store.read(['progress']);
    return { meta, progress: rows.progress, points: await store.restorePoints(), storage: { ...localStorage } };
  });
}

async function snapshot(device, revision, words) {
  const response = await device.page.evaluate(async (path) => {
    const result = await fetch(path);
    const bytes = new Uint8Array(await result.arrayBuffer());
    return { status: result.status, revision: result.headers.get('x-revision'), bytes: [...bytes] };
  }, snapshotPath);
  assert.equal(response.status, 200, '已登入的 context 應可讀取 Worker 快照');
  assert.equal(Number(response.revision), revision);
  const content = gunzipSync(Buffer.from(response.bytes)).toString('utf8');
  if (words) {
    const payload = JSON.parse(content);
    assert.equal(payload.version, 2);
    assert.deepEqual(Object.keys(payload.progress.items).sort(), [...words].sort());
  }
  return content;
}

async function createDevice(browser, origin, google, errors) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error));
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const isGoogleAuth = url.origin === google && url.pathname === '/o/oauth2/v2/auth';
    return url.origin === origin || isGoogleAuth ? route.continue() : route.abort();
  });
  await page.goto(origin + '/#cloud-sync');
  await page.locator('[data-cloud-login]').waitFor();
  const anonymous = await page.evaluate(async () => (await fetch('/api/me')).status);
  assert.equal(anonymous, 401, '每台裝置登入前必須獨立且未授權');
  return { context, page, origin };
}

async function signIn(device) {
  const { context, origin, page } = device;
  const callback = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === '/api/auth/callback';
  });
  await page.locator('[data-cloud-login]').click();
  assert.equal((await callback).status(), 302);
  await page.locator('.cloud-menu').waitFor();
  if (await page.locator('.cloud-menu:not([open]) summary').count()) {
    await page.locator('.cloud-menu summary').click();
  }
  const account = await page.evaluate(async () => {
    const response = await fetch('/api/me');
    return { status: response.status, ...await response.json() };
  });
  assert.equal(account.status, 200, 'Worker 必須認得瀏覽器的 session cookie');
  assert.equal(account.email, email);
  assert.equal(account.role, 'member');
  const cookie = (await context.cookies()).find(({ name }) => name === sessionCookie);
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax', 'OAuth callback 應設定 Secure、HttpOnly、SameSite=Lax session');
  return { id: account.accountId, cookie: cookie.value };
}

async function restore(page) {
  await choice(page, 'cloud').click();
  await preview(page).click();
  await page.locator('#backup .backup-msg').filter({ hasText: '已還原：學習紀錄' }).waitFor();
  // 還原完成會通知同源分頁；立即觸發隱藏頁面的正常檢查，不等防抖計時器。
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await status(page, '已同步');
}

async function run() {
  const google = await startFakeGoogle({ clientId, clientSecret });
  let server;
  let browser;
  try {
    server = await startWorkerServer({
      startWorker: startSyncWorker,
      vars: { ENVIRONMENT: 'test', ACCESS_MODE: 'allowlist', GOOGLE_OAUTH_BASE: google.base,
        GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret },
    });
    browser = await chromium.launch();
    const errors = [];
    const a = await createDevice(browser, server.origin, google.base, errors);
    await seed(a.page, original);
    const accountA = await signIn(a);
    await status(a.page, '已同步');
    await snapshot(a, 1, [original]);

    const b = await createDevice(browser, server.origin, google.base, errors);
    const accountB = await signIn(b);
    assert.equal(accountB.id, accountA.id, '兩次 OAuth 登入應對應同一個 D1 帳號');
    assert.ok(accountB.cookie !== accountA.cookie, '兩個 context 應各自獲得 session');
    assert.equal(google.log.issued.length, 2, '兩次登入皆經過假 Google 的一次性授權碼與 PKCE');

    // C02：取消保持本機紀錄、還原點、同步基準與雲端快照原狀。
    await status(b.page, '雲端有學習紀錄');
    const empty = await localState(b.page);
    assert.deepEqual(empty.progress, {});
    await choice(b.page, 'cloud').click();
    await preview(b.page).waitFor();
    await b.page.locator('#backup [data-cancel]').click();
    await status(b.page, '雲端有學習紀錄');
    assert.deepEqual(await localState(b.page), empty);
    await snapshot(b, 1, [original]);
    await restore(b.page);
    const restored = await localState(b.page);
    assert.notEqual(restored.meta.dataEpoch, empty.meta.dataEpoch);
    assert.deepEqual(Object.keys(restored.progress), [original]);
    assert.equal(restored.points.length, empty.points.length + 1);
    await snapshot(b, 1, [original]);

    // 先讓 A 上傳，再讓 B 在舊同步基準上作答。B 的任何檢查都會遇到 revision 2。
    await seed(a.page, fromA);
    await a.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await status(a.page, '已同步');
    await snapshot(a, 2, [original, fromA]);
    await seed(b.page, fromB);
    await b.page.goto(server.origin + '/?device=b#cloud-sync');
    await status(b.page, '有衝突待處理');
    await choice(b.page, 'later').click();
    assert.equal(await choice(b.page, 'later').count(), 0);
    await status(b.page, '有衝突待處理');
    assert.deepEqual(Object.keys((await localState(b.page)).progress).sort(), [original, fromB]);
    await snapshot(a, 2, [original, fromA]);

    // C06：用這台的覆蓋雲端。Worker 必須接受以 revision 2 為基準的寫入。
    b.page.once('dialog', (dialog) => dialog.accept());
    await choice(b.page, 'local').click();
    await status(b.page, '已同步');
    const valid = await snapshot(b, 3, [original, fromB]);

    // C05：A 本機未變，提示雲端較新。選擇套用，透過本機交易替換內容並建立還原點。
    await a.page.goto(server.origin + '/?device=a#cloud-sync');
    await status(a.page, '其他裝置有較新的紀錄');
    assert.deepEqual(Object.keys((await localState(a.page)).progress).sort(), [original, fromA]);
    await restore(a.page);
    assert.deepEqual(Object.keys((await localState(a.page)).progress).sort(), [original, fromB]);
    await snapshot(a, 3, [original, fromB]);

    // C13：使用真 PUT 將有效 gzip、無效 JSON 寫入同一份 D1；下載與預覽仍走正式路徑。
    async function putFixture(base, content) {
      const result = await b.page.evaluate(async ({ path, base, id, bytes }) => {
        const response = await fetch(path, {
          method: 'PUT',
          headers: { 'content-type': 'application/gzip', 'if-match': String(base),
            'x-upload-id': 'browser-fixture-' + base, 'x-schema-version': '2', 'x-cloud-account': id },
          body: Uint8Array.from(bytes),
        });
        return { status: response.status, ...await response.json() };
      }, { path: snapshotPath, base, id: accountB.id, bytes: [...gzipSync(content)] });
      assert.equal(result.status, 200, '測試快照須經 Worker 接受');
      assert.equal(result.revision, base + 1);
    }

    await putFixture(3, 'not json');
    assert.equal(await snapshot(a, 4), 'not json');
    await a.page.goto(server.origin + '/?device=a&bad=1#cloud-sync');
    await status(a.page, '其他裝置有較新的紀錄');
    const beforeInvalid = await localState(a.page);
    await choice(a.page, 'cloud').click();
    await a.page.locator('#backup .backup-msg').filter({ hasText: /JSON/ }).waitFor();
    await status(a.page, '其他裝置有較新的紀錄');
    assert.equal(await preview(a.page).count(), 0);
    assert.deepEqual(await localState(a.page), beforeInvalid);
    assert.equal(await snapshot(a, 4), 'not json');

    // C06 的第三個選項：兩邊都變後選「用雲端的」，放棄本機新增的紀錄。
    await putFixture(4, valid);
    await seed(a.page, fromA);
    await a.page.goto(server.origin + '/?device=a&conflict=cloud#cloud-sync');
    await status(a.page, '有衝突待處理');
    await restore(a.page);
    assert.deepEqual(Object.keys((await localState(a.page)).progress).sort(), [original, fromB]);
    await snapshot(a, 5, [original, fromB]);

    if (errors.length) throw new AggregateError(errors, '瀏覽器發生未處理的例外');
    console.log('PASS cloud-worker-sync (H01, OAuth + D1, C02, C05, C06, C13)');
  } finally {
    try { await browser?.close(); } finally {
      try { await server?.close(); } finally { await google.close(); }
    }
  }
}

await run();
