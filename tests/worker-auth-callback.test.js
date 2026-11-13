/**
 * T07：登入回呼。
 * A02 登入成功（cookie 屬性、D1 內容、session 只存雜湊）、A03 白名單外或 email 未驗證被拒、
 * A04 取消、state 失效或重放、PKCE 錯誤、授權碼交換失敗；另測 id_token 的 aud／iss／exp 檢查。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestDb, clearTables, workerEnv, signIn, cookiePairFrom, sessionTokenFrom, TEST_SITE } from './helpers/worker-env.mjs';
import { startFakeGoogle } from './helpers/fake-google.mjs';
import worker from '../worker/src/index.js';

let ctx;
let DB;
let google;
let env;

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);
const THIRTY_DAYS = 30 * 24 * 60 * 60;

const OAUTH_COOKIE = '__Host-ll_oauth';
const CLEARED_OAUTH_COOKIE = `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

function callbackRequest(url, start) {
  const cookie = cookiePairFrom(start, OAUTH_COOKIE);
  assert.ok(cookie);
  return new Request(url, { headers: { cookie } });
}

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
  env = workerEnv(DB, { GOOGLE_OAUTH_BASE: google.base, TEST_NOW: () => FIXED_NOW });
  google.setClaimOverrides({ exp: NOW_SEC + 3600 });
});

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

/**
 * 把 email 加入白名單。
 */
async function allow(email, role = 'member') {
  await DB.prepare('INSERT INTO allowed_emails(email, role, created_at) VALUES (?, ?, ?)').bind(email, role, NOW_SEC).run();
}

/**
 * 讀取 users 與 sessions 的列數。
 */
async function counts() {
  const users = await DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const sessions = await DB.prepare('SELECT COUNT(*) AS n FROM sessions').first();
  return { users: users.n, sessions: sessions.n };
}

/**
 * 斷言回呼以指定錯誤碼導回，且沒有設定 session cookie、沒有建立 session。
 */
async function assertRejected(response, location) {
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), location);
  assert.deepEqual(response.headers.getSetCookie(), location === `${TEST_SITE}/#cloud-error=STATE_INVALID`
    ? []
    : [CLEARED_OAUTH_COOKIE]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await counts()).sessions, 0);
}

test('A02 登入成功：302 回原頁，cookie 屬性齊全，D1 建立使用者與只存雜湊的 session', async () => {
  await allow('learner@example.test');
  google.setUser({ sub: 'sub-a02', email: 'Learner@Example.TEST', email_verified: true });
  const { response, token } = await signIn(worker, env, google, { returnTo: '/ja/' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `${TEST_SITE}/ja/`);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.includes(CLEARED_OAUTH_COOKIE));
  const setCookie = cookies.find((cookie) => cookie.startsWith('__Host-ll_session='));
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const parts = setCookie.split(';').map((part) => part.trim());
  assert.equal(parts[0], `__Host-ll_session=${token}`);
  assert.deepEqual(new Set(parts.slice(1)), new Set(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${THIRTY_DAYS}`]));
  assert.equal(/domain=/i.test(setCookie), false);

  const user = await DB.prepare('SELECT * FROM users').first();
  assert.equal(user.email, 'learner@example.test');
  assert.equal(user.google_sub, 'sub-a02');
  assert.notEqual(user.id, 'sub-a02');
  assert.equal(user.created_at, NOW_SEC);
  assert.equal(user.last_login_at, NOW_SEC);

  const { results: sessions } = await DB.prepare('SELECT * FROM sessions').all();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].token_hash, sha256Hex(token));
  assert.equal(sessions[0].user_id, user.id);
  assert.equal(sessions[0].created_at, NOW_SEC);
  assert.equal(sessions[0].expires_at, NOW_SEC + THIRTY_DAYS);
  assert.equal(JSON.stringify(sessions).includes(token), false);

  const states = await DB.prepare('SELECT COUNT(*) AS n FROM login_states').first();
  assert.equal(states.n, 0, 'state 用過即刪');
  const tokenRequest = google.log.tokenRequests[0];
  assert.equal(tokenRequest.redirect_uri, `${TEST_SITE}/api/auth/callback`);
  assert.equal(tokenRequest.grant_type, 'authorization_code');
});

test('A02 同一個 Google 帳號再次登入：沿用同一個使用者列，更新最後登入時間，另發新 session', async () => {
  await allow('learner@example.test');
  google.setUser({ sub: 'sub-again', email: 'learner@example.test', email_verified: true });
  const first = await signIn(worker, env, google);
  const firstUser = await DB.prepare('SELECT id FROM users').first();
  env.TEST_NOW = () => FIXED_NOW + 60_000;
  google.setClaimOverrides({ exp: NOW_SEC + 3600 });
  const second = await signIn(worker, env, google);
  assert.notEqual(first.token, second.token);
  const { results } = await DB.prepare('SELECT id, last_login_at FROM users').all();
  assert.equal(results.length, 1);
  assert.equal(results[0].id, firstUser.id);
  assert.equal(results[0].last_login_at, NOW_SEC + 60);
  assert.equal((await counts()).sessions, 2);
});

test('A02 登入時順便清掉已過期的 session', async () => {
  await allow('learner@example.test');
  await DB.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind('old-hash', 'someone', NOW_SEC - THIRTY_DAYS - 10, NOW_SEC - 10).run();
  await signIn(worker, env, google);
  const old = await DB.prepare("SELECT 1 AS hit FROM sessions WHERE token_hash = 'old-hash'").first();
  assert.equal(old, null);
});

test('A03 白名單外的帳號：導回 #cloud-error=NOT_ALLOWED，不建立使用者與 session', async () => {
  google.setUser({ sub: 'sub-outsider', email: 'outsider@example.test', email_verified: true });
  const { response } = await signIn(worker, env, google, { returnTo: '/ja/' });
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=NOT_ALLOWED`);
  assert.equal((await counts()).users, 0);
});

test('A03 email 未驗證（含字串 "true"）：一律拒絕', async () => {
  await allow('learner@example.test');
  for (const emailVerified of [false, 'true', undefined]) {
    google.setUser({ sub: 'sub-unverified', email: 'learner@example.test', email_verified: emailVerified });
    const { response } = await signIn(worker, env, google, { returnTo: '/en/' });
    await assertRejected(response, `${TEST_SITE}/en/#cloud-error=NOT_ALLOWED`);
    assert.equal((await counts()).users, 0);
  }
});

test('A04 在 Google 按取消：導回 #cloud-error=DENIED，state 作廢', async () => {
  await allow('learner@example.test');
  google.setDeny(true);
  const { start, response, callbackUrl } = await signIn(worker, env, google, { returnTo: '/ja/' });
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=DENIED`);
  const replay = await worker.fetch(callbackRequest(callbackUrl.href, start), env, {});
  await assertRejected(replay, `${TEST_SITE}/#cloud-error=STATE_INVALID`);
});

test('A04 state 不存在或缺少：導回首頁 #cloud-error=STATE_INVALID', async () => {
  await allow('learner@example.test');
  for (const query of ['?code=abc&state=never-issued', '?code=abc', '']) {
    const response = await worker.fetch(new Request(`${TEST_SITE}/api/auth/callback${query}`), env, {});
    await assertRejected(response, `${TEST_SITE}/#cloud-error=STATE_INVALID`);
  }
  assert.equal(google.log.tokenRequests.length, 0, 'state 無效時不換 token');
});

test('A04 state 重放：成功登入後再用同一個回呼網址，不再建立 session', async () => {
  await allow('learner@example.test');
  const { start, response, callbackUrl } = await signIn(worker, env, google);
  assert.equal(response.status, 302);
  assert.equal((await counts()).sessions, 1);
  const replay = await worker.fetch(callbackRequest(callbackUrl.href, start), env, {});
  assert.equal(replay.status, 302);
  assert.equal(replay.headers.get('location'), `${TEST_SITE}/#cloud-error=STATE_INVALID`);
  assert.equal(replay.headers.get('set-cookie'), null);
  assert.equal((await counts()).sessions, 1);
  assert.equal(google.log.tokenRequests.length, 1);
});

test('A04 state 超過 10 分鐘：STATE_INVALID，且該 state 被刪除', async () => {
  await allow('learner@example.test');
  const start = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fja%2F`), env, {});
  const callbackUrl = await google.authorize(start.headers.get('location'));
  const late = { ...env, TEST_NOW: () => FIXED_NOW + 601_000 };
  const response = await worker.fetch(callbackRequest(callbackUrl.href, start), late, {});
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=STATE_INVALID`);
  const states = await DB.prepare('SELECT COUNT(*) AS n FROM login_states').first();
  assert.equal(states.n, 0);
  assert.equal(google.log.tokenRequests.length, 0);
});

test('A04 PKCE 不符（授權碼被接到別的 state）：EXCHANGE_FAILED', async () => {
  await allow('learner@example.test');
  const startA = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fa%2F`), env, {});
  const startB = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fb%2F`), env, {});
  const callbackA = await google.authorize(startA.headers.get('location'));
  const stateB = new URL(startB.headers.get('location')).searchParams.get('state');
  const injected = new URL(callbackA.href);
  injected.searchParams.set('state', stateB);
  const response = await worker.fetch(callbackRequest(injected.href, startB), env, {});
  await assertRejected(response, `${TEST_SITE}/b/#cloud-error=EXCHANGE_FAILED`);
  assert.equal((await counts()).users, 0);
});

test('A04 token 端點失敗、連不上或 secret 錯誤：EXCHANGE_FAILED', async () => {
  await allow('learner@example.test');
  google.setTokenStatus(500);
  let { response } = await signIn(worker, env, google, { returnTo: '/ja/' });
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=EXCHANGE_FAILED`);
  google.setTokenStatus(200);

  ({ response } = await signIn(worker, { ...env, GOOGLE_CLIENT_SECRET: 'wrong-secret' }, google, { returnTo: '/ja/' }));
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=EXCHANGE_FAILED`);

  const start = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fja%2F`), env, {});
  const callbackUrl = await google.authorize(start.headers.get('location'));
  const unreachable = { ...env, GOOGLE_OAUTH_BASE: 'http://127.0.0.1:9' };
  response = await worker.fetch(callbackRequest(callbackUrl.href, start), unreachable, {});
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=EXCHANGE_FAILED`);
  assert.equal((await counts()).users, 0);
});

test('A04 回呼沒有 code：EXCHANGE_FAILED', async () => {
  const start = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fja%2F`), env, {});
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const response = await worker.fetch(callbackRequest(`${TEST_SITE}/api/auth/callback?state=${state}`, start), env, {});
  await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=EXCHANGE_FAILED`);
});

test('id_token 的 aud、iss、exp 不符或格式錯誤：EXCHANGE_FAILED', async () => {
  await allow('learner@example.test');
  const bad = [
    { aud: 'someone-else.apps.example.test', exp: NOW_SEC + 3600 },
    { iss: 'https://evil.example', exp: NOW_SEC + 3600 },
    { iss: 'http://accounts.google.com', exp: NOW_SEC + 3600 },
    { exp: NOW_SEC - 1 },
    { exp: String(NOW_SEC + 3600) },
    { sub: '', exp: NOW_SEC + 3600 },
  ];
  for (const overrides of bad) {
    google.setClaimOverrides(overrides);
    const { response } = await signIn(worker, env, google, { returnTo: '/ja/' });
    await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=EXCHANGE_FAILED`);
  }
  google.setClaimOverrides({ exp: NOW_SEC + 3600 });
  for (const raw of ['not-a-jwt', 'a.b', 'a.!!!.c', '']) {
    google.setRawIdToken(raw);
    const { response } = await signIn(worker, env, google, { returnTo: '/ja/' });
    await assertRejected(response, `${TEST_SITE}/ja/#cloud-error=EXCHANGE_FAILED`);
  }
  assert.equal((await counts()).users, 0);
});

test('id_token 的 iss 為 accounts.google.com（無 https）也接受', async () => {
  await allow('learner@example.test');
  google.setClaimOverrides({ iss: 'accounts.google.com', exp: NOW_SEC + 3600 });
  const { response, token } = await signIn(worker, env, google);
  assert.equal(response.status, 302);
  assert.ok(token);
  assert.equal(sessionTokenFrom(response), token);
});

test('有效的回呼缺少發起瀏覽器的 cookie 時拒絕，且保留未使用的 state', async () => {
  await allow('learner@example.test');
  const start = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fja%2F`), env, {});
  const callbackUrl = await google.authorize(start.headers.get('location'));
  const otherStart = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start`), env, {});
  for (const request of [new Request(callbackUrl.href), callbackRequest(callbackUrl.href, otherStart)]) {
    const response = await worker.fetch(request, env, {});
    await assertRejected(response, `${TEST_SITE}/#cloud-error=STATE_INVALID`);
  }
  assert.equal((await counts()).users, 0);
  assert.equal(google.log.tokenRequests.length, 0);
  const states = await DB.prepare('SELECT COUNT(*) AS n FROM login_states').first();
  assert.equal(states.n, 2);

  const valid = await worker.fetch(callbackRequest(callbackUrl.href, start), env, {});
  assert.equal(valid.headers.get('location'), `${TEST_SITE}/ja/`);
  assert.ok(sessionTokenFrom(valid));
  assert.equal(google.log.tokenRequests.length, 1);
});
