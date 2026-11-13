/**
 * T08：每次請求的存取檢查。
 * A06 移除白名單即時生效、A07 新增白名單即時生效、A08 開放模式、
 * A10 session 過期、被刪除或 cookie 被竄改、A11 寫入請求的 Origin 檢查，以及 GET /api/me。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, clearTables, workerEnv, signIn, callApi, TEST_SITE } from './helpers/worker-env.mjs';
import { startFakeGoogle } from './helpers/fake-google.mjs';
import worker from '../worker/src/index.js';

let ctx;
let DB;
let google;
let env;

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);
const DAY_MS = 24 * 60 * 60 * 1000;

before(async () => {
  ctx = await createTestDb();
  DB = ctx.env.DB;
  const base = workerEnv(DB);
  google = await startFakeGoogle({ clientId: base.GOOGLE_CLIENT_ID, clientSecret: base.GOOGLE_CLIENT_SECRET });
});

after(async () => {
  await google?.close();
  await ctx?.dispose();
});

beforeEach(async () => {
  await clearTables(DB);
  google.reset();
  google.setClaimOverrides({ exp: NOW_SEC + 3600 });
  env = workerEnv(DB, { GOOGLE_OAUTH_BASE: google.base, TEST_NOW: () => FIXED_NOW });
});

/**
 * 把 email 加入白名單（模擬管理者以 SQL 新增）。
 */
async function allow(email, role = 'member') {
  await DB.prepare('INSERT INTO allowed_emails(email, role, created_at) VALUES (?, ?, ?)').bind(email, role, NOW_SEC).run();
}

/**
 * 以指定使用者登入，回傳 session cookie。
 */
async function login(user, targetEnv = env) {
  const { cookie, response } = await signIn(worker, targetEnv, google, { user: { email_verified: true, ...user } });
  assert.ok(cookie, `登入失敗：${response.headers.get('location')}`);
  return cookie;
}

/**
 * 讀出回應的狀態碼與 JSON。
 */
async function read(response) {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const sessionCount = async () => (await DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n;

test('GET /api/me：未登入回 401 UNAUTHENTICATED', async () => {
  const result = await read(await callApi(worker, env, 'GET', '/api/me'));
  assert.deepEqual(result, { status: 401, body: { error: 'UNAUTHENTICATED' } });
});

test('GET /api/me：已登入回 accountId、email、role，不含 google_sub', async () => {
  await allow('learner@example.test');
  await allow('boss@example.test', 'owner');
  await allow('helper@example.test', 'admin');
  const member = await login({ sub: 'sub-member', email: 'learner@example.test' });
  const owner = await login({ sub: 'sub-owner', email: 'boss@example.test' });
  const admin = await login({ sub: 'sub-admin', email: 'helper@example.test' });

  const response = await callApi(worker, env, 'GET', '/api/me', { cookie: member });
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const me = await read(response);
  const user = await DB.prepare("SELECT id FROM users WHERE email = 'learner@example.test'").first();
  assert.deepEqual(me, { status: 200, body: { accountId: user.id, email: 'learner@example.test', role: 'member' } });
  assert.equal(JSON.stringify(me.body).includes('sub-member'), false);

  assert.equal((await read(await callApi(worker, env, 'GET', '/api/me', { cookie: owner }))).body.role, 'owner');
  assert.equal((await read(await callApi(worker, env, 'GET', '/api/me', { cookie: admin }))).body.role, 'admin');
});

test('A06 移除白名單即時生效：403 NOT_ALLOWED 並刪除他全部的 session；重新加入後要重新登入', async () => {
  await allow('learner@example.test');
  await allow('other@example.test');
  const first = await login({ sub: 'sub-a06', email: 'learner@example.test' });
  const second = await login({ sub: 'sub-a06', email: 'learner@example.test' });
  const bystander = await login({ sub: 'sub-other', email: 'other@example.test' });
  assert.equal(await sessionCount(), 3);

  await DB.prepare("DELETE FROM allowed_emails WHERE email = 'learner@example.test'").run();
  assert.deepEqual(await read(await callApi(worker, env, 'GET', '/api/me', { cookie: first })), {
    status: 403, body: { error: 'NOT_ALLOWED' },
  });
  assert.equal(await sessionCount(), 1, '只剩旁人的 session');
  assert.equal((await read(await callApi(worker, env, 'GET', '/api/me', { cookie: bystander }))).status, 200);

  await allow('learner@example.test');
  assert.equal((await read(await callApi(worker, env, 'GET', '/api/me', { cookie: second }))).status, 401);
  const again = await login({ sub: 'sub-a06', email: 'learner@example.test' });
  assert.equal((await read(await callApi(worker, env, 'GET', '/api/me', { cookie: again }))).status, 200);
});

test('A07 新增白名單即時生效：以 SQL 加入後，不重新部署即可登入', async () => {
  google.setUser({ sub: 'sub-a07', email: 'newbie@example.test', email_verified: true });
  const before = await signIn(worker, env, google);
  assert.equal(before.response.headers.get('location'), `${TEST_SITE}/#cloud-error=NOT_ALLOWED`);
  await allow('newbie@example.test');
  const cookie = await login({ sub: 'sub-a07', email: 'newbie@example.test' });
  assert.equal((await read(await callApi(worker, env, 'GET', '/api/me', { cookie }))).body.email, 'newbie@example.test');
});

test('A08 開放模式：不在白名單但已驗證的帳號可以登入，role 為 member', async () => {
  const open = { ...env, ACCESS_MODE: 'open' };
  const cookie = await login({ sub: 'sub-a08', email: 'stranger@example.test' }, open);
  const me = await read(await callApi(worker, open, 'GET', '/api/me', { cookie }));
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'member');
  assert.equal(me.body.email, 'stranger@example.test');

  google.setUser({ sub: 'sub-a08b', email: 'unverified@example.test', email_verified: false });
  const unverified = await signIn(worker, open, google);
  assert.equal(unverified.response.headers.get('location'), `${TEST_SITE}/#cloud-error=NOT_ALLOWED`);

  assert.deepEqual(await read(await callApi(worker, env, 'GET', '/api/me', { cookie })), {
    status: 403, body: { error: 'NOT_ALLOWED' },
  }, '切回白名單模式後，不在名單的人下一次請求就被拒');
});

test('A08 ACCESS_MODE 不是 open 的任何值都視為白名單模式', async () => {
  for (const ACCESS_MODE of ['allowlist', 'OPEN', 'Open', ' open', 'true', '', undefined]) {
    google.setUser({ sub: 'sub-mode', email: 'stranger@example.test', email_verified: true });
    const { response, cookie } = await signIn(worker, { ...env, ACCESS_MODE }, google);
    assert.equal(cookie, null, `ACCESS_MODE=${JSON.stringify(ACCESS_MODE)}`);
    assert.equal(response.headers.get('location'), `${TEST_SITE}/#cloud-error=NOT_ALLOWED`);
  }
});

test('A10 session 滿 30 天即失效，期間使用也不延長', async () => {
  await allow('learner@example.test');
  const cookie = await login({ sub: 'sub-a10', email: 'learner@example.test' });
  const at = (ms) => ({ ...env, TEST_NOW: () => FIXED_NOW + ms });
  assert.equal((await callApi(worker, at(29 * DAY_MS), 'GET', '/api/me', { cookie })).status, 200);
  assert.equal((await callApi(worker, at(30 * DAY_MS - 1000), 'GET', '/api/me', { cookie })).status, 200);
  assert.deepEqual(await read(await callApi(worker, at(30 * DAY_MS), 'GET', '/api/me', { cookie })), {
    status: 401, body: { error: 'UNAUTHENTICATED' },
  });
  assert.equal((await callApi(worker, at(31 * DAY_MS), 'GET', '/api/me', { cookie })).status, 401);
});

test('A10 過期的 session 即使已不在白名單也回 401，而不是 403', async () => {
  await allow('learner@example.test');
  const cookie = await login({ sub: 'sub-a10b', email: 'learner@example.test' });
  await DB.prepare('DELETE FROM allowed_emails').run();
  const late = { ...env, TEST_NOW: () => FIXED_NOW + 31 * DAY_MS };
  assert.equal((await callApi(worker, late, 'GET', '/api/me', { cookie })).status, 401);
});

test('A10 被竄改、格式錯誤或已刪除的 cookie 一律回 401', async () => {
  await allow('learner@example.test');
  const cookie = await login({ sub: 'sub-a10c', email: 'learner@example.test' });
  const token = cookie.split('=')[1];
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  const forged = [
    `__Host-ll_session=${flipped}`,
    `__Host-ll_session=${token}x`,
    `__Host-ll_session=${token.slice(1)}`,
    '__Host-ll_session=',
    '__Host-ll_session=%00%00',
    `ll_session=${token}`,
    `other=1; __Host-ll_session_x=${token}`,
  ];
  for (const bad of forged) {
    assert.deepEqual(await read(await callApi(worker, env, 'GET', '/api/me', { cookie: bad })), {
      status: 401, body: { error: 'UNAUTHENTICATED' },
    }, bad);
  }
  assert.equal(await sessionCount(), 1, '無效 cookie 不影響既有 session');
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: `theme=dark; ${cookie}; lang=ja` })).status, 200);

  await DB.prepare('DELETE FROM sessions').run();
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie })).status, 401);
});

/**
 * 全部的寫入端點（A11 要逐一檢查）。
 */
const WRITE_ENDPOINTS = [
  ['POST', '/api/auth/logout'],
  ['PUT', '/api/snapshot'],
  ['DELETE', '/api/account'],
  ['POST', '/api/admin/members'],
  ['PATCH', '/api/admin/members/learner%40example.test'],
  ['DELETE', '/api/admin/members/learner%40example.test'],
];

test('A11 寫入請求的 Origin 缺少或不符：403 BAD_ORIGIN，不讀取 body、不改資料', async () => {
  await allow('learner@example.test', 'owner');
  const cookie = await login({ sub: 'sub-a11', email: 'learner@example.test' });
  const origins = [null, 'https://evil.example', 'null', 'http://site.test', 'https://site.test.evil.example', `${TEST_SITE}/`];
  for (const [method, path] of WRITE_ENDPOINTS) {
    for (const origin of origins) {
      let pulled = false;
      const body = new ReadableStream({
        pull(controller) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode('{"email":"x@example.test"}'));
          controller.close();
        },
      }, { highWaterMark: 0 });
      const headers = { cookie, 'content-type': 'application/json', 'if-match': '0' };
      if (origin !== null) headers.origin = origin;
      const request = new Request(`${TEST_SITE}${path}`, { method, headers, body, duplex: 'half' });
      const result = await read(await worker.fetch(request, env, {}));
      assert.deepEqual(result, { status: 403, body: { error: 'BAD_ORIGIN' } }, `${method} ${path} Origin=${origin}`);
      assert.equal(request.bodyUsed, false, `${method} ${path} 不得讀取 body`);
      assert.equal(pulled, false, `${method} ${path} 不得讀取 body`);
    }
  }
  assert.equal(await sessionCount(), 1, 'logout／刪除帳號沒有被執行');
  const allowed = await DB.prepare('SELECT COUNT(*) AS n FROM allowed_emails').first();
  assert.equal(allowed.n, 1);
  const snapshots = await DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first();
  assert.equal(snapshots.n, 0);
});

test('A11 讀取類請求不檢查 Origin', async () => {
  await allow('learner@example.test');
  const cookie = await login({ sub: 'sub-a11b', email: 'learner@example.test' });
  const response = await worker.fetch(
    new Request(`${TEST_SITE}/api/me`, { headers: { cookie, origin: 'https://evil.example' } }), env, {},
  );
  assert.equal(response.status, 200);
});

test('A11 SITE_ORIGIN 未設定時，所有寫入請求都被拒', async () => {
  const response = await callApi(worker, { ...env, SITE_ORIGIN: '' }, 'POST', '/api/auth/logout', { origin: TEST_SITE });
  assert.deepEqual(await read(response), { status: 403, body: { error: 'BAD_ORIGIN' } });
});
