/**
 * T09：登出與刪除雲端資料（伺服器端）。
 * A09 登出只刪除這個 session 並清除 cookie；A12 刪除帳號會刪快照、分塊、全部 session 與使用者列，白名單不變。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, clearTables, workerEnv, signIn, callApi } from './helpers/worker-env.mjs';
import { startFakeGoogle } from './helpers/fake-google.mjs';
import worker from '../worker/src/index.js';

let ctx;
let DB;
let google;
let env;

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);
const CLEARED = '__Host-ll_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

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
  await DB.prepare("INSERT INTO allowed_emails(email, nickname, role, created_at) VALUES ('learner@example.test', '小明', 'member', 1)").run();
  await DB.prepare("INSERT INTO allowed_emails(email, role, created_at) VALUES ('other@example.test', 'member', 1)").run();
});

/**
 * 以指定使用者登入，回傳 session cookie。
 */
async function login(sub, email) {
  const { cookie } = await signIn(worker, env, google, { user: { sub, email, email_verified: true } });
  assert.ok(cookie);
  return cookie;
}

/**
 * 直接在 D1 放一份快照、分塊與上傳紀錄（不經 API，T10 才實作上傳）。
 */
async function seedSnapshot(userId) {
  await DB.prepare('INSERT INTO snapshots(user_id, revision, upload_id, schema_version, byte_size, chunk_count, device_label, updated_at) VALUES (?, 3, ?, 2, 3, 1, ?, ?)')
    .bind(userId, 'up-1', 'laptop', NOW_SEC).run();
  await DB.prepare('INSERT INTO snapshot_chunks(user_id, revision, idx, data) VALUES (?, 3, 0, ?)').bind(userId, new Uint8Array([1, 2, 3])).run();
  await DB.prepare('INSERT INTO upload_log(user_id, at) VALUES (?, ?)').bind(userId, NOW_SEC).run();
}

/**
 * 計算某張表中屬於某位使用者的列數。
 */
async function rows(table, column, value) {
  return (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(value).first()).n;
}

const userIdOf = async (email) => (await DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first())?.id;

test('A09 登出：204、清除 cookie，只刪除這個 session，其他裝置不受影響', async () => {
  const laptop = await login('sub-1', 'learner@example.test');
  const phone = await login('sub-1', 'learner@example.test');
  const response = await callApi(worker, env, 'POST', '/api/auth/logout', { cookie: laptop });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('set-cookie'), CLEARED);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: laptop })).status, 401);
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: phone })).status, 200);
  assert.equal(await rows('sessions', 'user_id', await userIdOf('learner@example.test')), 1);
});

test('A09 登出不動使用者列與快照', async () => {
  const cookie = await login('sub-1', 'learner@example.test');
  const userId = await userIdOf('learner@example.test');
  await seedSnapshot(userId);
  assert.equal((await callApi(worker, env, 'POST', '/api/auth/logout', { cookie })).status, 204);
  assert.equal(await rows('users', 'id', userId), 1);
  assert.equal(await rows('snapshots', 'user_id', userId), 1);
  assert.equal(await rows('snapshot_chunks', 'user_id', userId), 1);
});

test('A09 未登入時登出回 401', async () => {
  const response = await callApi(worker, env, 'POST', '/api/auth/logout');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'UNAUTHENTICATED' });
});

test('A12 刪除雲端資料：刪快照、分塊、上傳紀錄、全部 session 與使用者列，白名單不變', async () => {
  const laptop = await login('sub-1', 'learner@example.test');
  const phone = await login('sub-1', 'learner@example.test');
  const bystander = await login('sub-2', 'other@example.test');
  const userId = await userIdOf('learner@example.test');
  const otherId = await userIdOf('other@example.test');
  await seedSnapshot(userId);
  await seedSnapshot(otherId);
  const allowlistBefore = (await DB.prepare('SELECT * FROM allowed_emails ORDER BY email').all()).results;

  const response = await callApi(worker, env, 'DELETE', '/api/account', { cookie: laptop });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('set-cookie'), CLEARED);

  for (const [table, column] of [['snapshots', 'user_id'], ['snapshot_chunks', 'user_id'], ['upload_log', 'user_id'], ['sessions', 'user_id'], ['users', 'id']]) {
    assert.equal(await rows(table, column, userId), 0, `${table} 應已刪除`);
    assert.equal(await rows(table, column, otherId), 1, `${table} 的旁人資料不得受影響`);
  }
  assert.deepEqual((await DB.prepare('SELECT * FROM allowed_emails ORDER BY email').all()).results, allowlistBefore);
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: phone })).status, 401);
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: bystander })).status, 200);
});

test('A12 刪除後再登入視為第一次登入：新的使用者 id、沒有快照', async () => {
  const cookie = await login('sub-1', 'learner@example.test');
  const oldId = await userIdOf('learner@example.test');
  await seedSnapshot(oldId);
  assert.equal((await callApi(worker, env, 'DELETE', '/api/account', { cookie })).status, 204);
  const again = await login('sub-1', 'learner@example.test');
  const me = await (await callApi(worker, env, 'GET', '/api/me', { cookie: again })).json();
  assert.notEqual(me.accountId, oldId);
  assert.equal(await rows('snapshots', 'user_id', me.accountId), 0);
});

test('A12 未登入時刪除帳號回 401，不刪任何資料', async () => {
  await login('sub-1', 'learner@example.test');
  const response = await callApi(worker, env, 'DELETE', '/api/account');
  assert.equal(response.status, 401);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 1);
});
