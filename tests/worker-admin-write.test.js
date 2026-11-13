/**
 * T13：修改暱稱、調整角色、移除與擁有者保護。
 * M07（伺服器端權限）、M08 管理員不能改擁有者或其他管理員的暱稱、M09 擁有者移除人員、
 * M10 管理員不能移除任何人、M11 擁有者升降管理員、M12 管理員不能調整角色、
 * M13 擁有者不能被移除或降級、M14 角色即時生效；另含 M01 的 PATCH／DELETE 部分。
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
let cookies;

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);

/**
 * 每個測試開始時的白名單：一位擁有者、兩位管理員、兩位成員。
 */
const PEOPLE = [
  ['boss@example.test', 'owner', '站長'],
  ['helper@example.test', 'admin', '幫手'],
  ['helper2@example.test', 'admin', '幫手二'],
  ['m1@example.test', 'member', '成員一'],
  ['m2@example.test', 'member', '成員二'],
];

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
  cookies = {};
  for (const [email, role, nickname] of PEOPLE) {
    await DB.prepare('INSERT INTO allowed_emails(email, nickname, role, created_at) VALUES (?, ?, ?, ?)').bind(email, nickname, role, NOW_SEC).run();
    const { cookie } = await signIn(worker, env, google, { user: { sub: `sub-${email}`, email, email_verified: true } });
    cookies[email.split('@')[0]] = cookie;
  }
});

const path = (email) => `/api/admin/members/${encodeURIComponent(email)}`;
const patch = (actor, email, body) => callApi(worker, env, 'PATCH', path(email), { cookie: cookies[actor], body });
const remove = (actor, email) => callApi(worker, env, 'DELETE', path(email), { cookie: cookies[actor] });

/**
 * 目前白名單的完整內容（用來確認「不改任何資料」）。
 */
async function snapshotAllowlist() {
  return (await DB.prepare('SELECT * FROM allowed_emails ORDER BY email').all()).results;
}

/**
 * 斷言回應為指定的錯誤，且白名單完全沒變。
 */
async function assertRefused(responsePromise, status, code, before) {
  const response = await responsePromise;
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code });
  assert.deepEqual(await snapshotAllowlist(), before);
}

const row = async (email) => DB.prepare('SELECT * FROM allowed_emails WHERE email = ?').bind(email).first();
const sessionsOf = async (email) => (await DB.prepare(
  'SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?',
).bind(email).first()).n;

test('M01 PATCH／DELETE：未登入 401，成員 403 NOT_STAFF', async () => {
  const before = await snapshotAllowlist();
  assert.equal((await callApi(worker, env, 'PATCH', path('m2@example.test'), { body: { nickname: 'x' } })).status, 401);
  assert.equal((await callApi(worker, env, 'DELETE', path('m2@example.test'))).status, 401);
  await assertRefused(patch('m1', 'm2@example.test', { nickname: 'x' }), 403, 'NOT_STAFF', before);
  await assertRefused(patch('m1', 'm1@example.test', { nickname: 'x' }), 403, 'NOT_STAFF', before);
  await assertRefused(remove('m1', 'm2@example.test'), 403, 'NOT_STAFF', before);
});

test('M07 擁有者可以改任何人的暱稱（含自己），可清空，內容原樣保存為文字', async () => {
  for (const email of ['boss@example.test', 'helper@example.test', 'm1@example.test']) {
    const response = await patch('boss', email, { nickname: '<script>alert(1)</script>' });
    assert.equal(response.status, 200, email);
    const body = await response.json();
    assert.equal(body.nickname, '<script>alert(1)</script>');
    assert.equal(body.email, email);
    assert.equal((await row(email)).nickname, '<script>alert(1)</script>');
  }
  assert.equal((await patch('boss', 'm1@example.test', { nickname: '' })).status, 200);
  assert.equal((await row('m1@example.test')).nickname, null);
  assert.equal((await patch('boss', 'm2@example.test', { nickname: null })).status, 200);
  assert.equal((await row('m2@example.test')).nickname, null);
});

test('M07 管理員可以改成員與自己的暱稱', async () => {
  const toMember = await patch('helper', 'm1@example.test', { nickname: '新暱稱' });
  assert.equal(toMember.status, 200);
  assert.deepEqual(await toMember.json(), { email: 'm1@example.test', nickname: '新暱稱', role: 'member' });
  const toSelf = await patch('helper', 'helper@example.test', { nickname: '我自己' });
  assert.equal(toSelf.status, 200);
  assert.equal((await row('helper@example.test')).nickname, '我自己');
  assert.equal((await row('helper@example.test')).role, 'admin');
});

test('M07 暱稱超過 40 字：400 INVALID_NICKNAME，不改資料', async () => {
  const before = await snapshotAllowlist();
  await assertRefused(patch('boss', 'm1@example.test', { nickname: '名'.repeat(41) }), 400, 'INVALID_NICKNAME', before);
  await assertRefused(patch('helper', 'm1@example.test', { nickname: 5 }), 400, 'INVALID_NICKNAME', before);
});

test('M08 管理員不能改擁有者或其他管理員的暱稱：403 FORBIDDEN', async () => {
  const before = await snapshotAllowlist();
  await assertRefused(patch('helper', 'boss@example.test', { nickname: 'x' }), 403, 'FORBIDDEN', before);
  await assertRefused(patch('helper', 'helper2@example.test', { nickname: 'x' }), 403, 'FORBIDDEN', before);
});

test('M09 擁有者移除成員與管理員：204，白名單刪除、session 立即失效、雲端紀錄保留', async () => {
  const upload = await callApi(worker, env, 'PUT', '/api/snapshot', {
    cookie: cookies.m1, body: new Uint8Array([9, 9, 9]),
    headers: { 'if-match': '0', 'x-upload-id': 'up-m1', 'x-schema-version': '2' },
  });
  assert.equal(upload.status, 200);

  const response = await remove('boss', 'm1@example.test');
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(await row('m1@example.test'), null);
  assert.equal(await sessionsOf('m1@example.test'), 0);
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: cookies.m1 })).status, 401);
  assert.equal(await sessionsOf('m2@example.test'), 1, '旁人不受影響');

  assert.equal((await remove('boss', 'helper2@example.test')).status, 204);
  assert.equal(await row('helper2@example.test'), null);
  assert.equal(await sessionsOf('helper2@example.test'), 0);

  await DB.prepare("INSERT INTO allowed_emails(email, role, created_at) VALUES ('m1@example.test', 'member', 1)").run();
  const { cookie } = await signIn(worker, env, google, { user: { sub: 'sub-m1@example.test', email: 'm1@example.test', email_verified: true } });
  const meta = await (await callApi(worker, env, 'GET', '/api/snapshot/meta', { cookie })).json();
  assert.equal(meta.revision, 1, '重新加入後仍可取得原本的雲端紀錄');
  assert.equal(meta.uploadId, 'up-m1');
});

test('M10 管理員不能移除任何人：403 OWNER_ONLY，不改資料', async () => {
  const before = await snapshotAllowlist();
  for (const email of ['m1@example.test', 'helper@example.test', 'helper2@example.test']) {
    await assertRefused(remove('helper', email), 403, 'OWNER_ONLY', before);
  }
  assert.equal(await sessionsOf('m1@example.test'), 1);
});

test('M11 擁有者升降管理員：下一次請求即生效', async () => {
  const promote = await patch('boss', 'm1@example.test', { role: 'admin' });
  assert.equal(promote.status, 200);
  assert.deepEqual(await promote.json(), { email: 'm1@example.test', nickname: '成員一', role: 'admin' });
  assert.equal((await callApi(worker, env, 'GET', '/api/admin/members', { cookie: cookies.m1 })).status, 200);

  const demote = await patch('boss', 'helper@example.test', { role: 'member' });
  assert.equal(demote.status, 200);
  const refused = await callApi(worker, env, 'GET', '/api/admin/members', { cookie: cookies.helper });
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: 'NOT_STAFF' });
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: cookies.helper })).status, 200, '降級不影響登入');
});

test('M12 管理員不能調整任何人的角色：403 OWNER_ONLY', async () => {
  const before = await snapshotAllowlist();
  await assertRefused(patch('helper', 'm1@example.test', { role: 'admin' }), 403, 'OWNER_ONLY', before);
  await assertRefused(patch('helper', 'helper2@example.test', { role: 'member' }), 403, 'OWNER_ONLY', before);
  await assertRefused(patch('helper', 'helper@example.test', { role: 'member' }), 403, 'OWNER_ONLY', before);
  await assertRefused(patch('helper', 'helper@example.test', { role: 'admin' }), 403, 'OWNER_ONLY', before);
  await assertRefused(patch('helper', 'm1@example.test', { role: 'admin', nickname: 'x' }), 403, 'OWNER_ONLY', before);
});

test('M13 移除、降級擁有者或設定 owner：409 OWNER_PROTECTED，不改資料', async () => {
  const before = await snapshotAllowlist();
  await assertRefused(remove('boss', 'boss@example.test'), 409, 'OWNER_PROTECTED', before);
  await assertRefused(remove('helper', 'boss@example.test'), 409, 'OWNER_PROTECTED', before);
  await assertRefused(patch('boss', 'boss@example.test', { role: 'member' }), 409, 'OWNER_PROTECTED', before);
  await assertRefused(patch('boss', 'boss@example.test', { role: 'admin' }), 409, 'OWNER_PROTECTED', before);
  await assertRefused(patch('boss', 'm1@example.test', { role: 'owner' }), 409, 'OWNER_PROTECTED', before);
  await assertRefused(patch('helper', 'boss@example.test', { role: 'member' }), 409, 'OWNER_PROTECTED', before);
  await assertRefused(patch('helper', 'helper@example.test', { role: 'owner' }), 409, 'OWNER_PROTECTED', before);
  assert.equal(await sessionsOf('boss@example.test'), 1);
});

test('M14 角色被 SQL 改成成員後，仍持有 session 也立即失去後台權限', async () => {
  await DB.prepare("UPDATE allowed_emails SET role = 'member' WHERE email = 'helper@example.test'").run();
  const before = await snapshotAllowlist();
  await assertRefused(callApi(worker, env, 'GET', '/api/admin/members', { cookie: cookies.helper }), 403, 'NOT_STAFF', before);
  await assertRefused(callApi(worker, env, 'POST', '/api/admin/members', { cookie: cookies.helper, body: { email: 'z@example.test' } }), 403, 'NOT_STAFF', before);
  await assertRefused(patch('helper', 'm1@example.test', { nickname: 'x' }), 403, 'NOT_STAFF', before);
  await assertRefused(remove('helper', 'm1@example.test'), 403, 'NOT_STAFF', before);
});

test('M14 後台寫入請求的 Origin 不符：403 BAD_ORIGIN', async () => {
  const before = await snapshotAllowlist();
  await assertRefused(callApi(worker, env, 'PATCH', path('m1@example.test'), { cookie: cookies.boss, body: { nickname: 'x' }, origin: 'https://evil.example' }), 403, 'BAD_ORIGIN', before);
  await assertRefused(callApi(worker, env, 'DELETE', path('m1@example.test'), { cookie: cookies.boss, origin: null }), 403, 'BAD_ORIGIN', before);
});

test('網址中的 email 會解碼並轉小寫；找不到目標回 404', async () => {
  const response = await callApi(worker, env, 'PATCH', '/api/admin/members/M1%40Example.TEST', { cookie: cookies.boss, body: { nickname: '大寫' } });
  assert.equal(response.status, 200);
  assert.equal((await row('m1@example.test')).nickname, '大寫');
  const raw = await callApi(worker, env, 'PATCH', '/api/admin/members/m2@example.test', { cookie: cookies.boss, body: { nickname: '原樣' } });
  assert.equal(raw.status, 200);

  const before = await snapshotAllowlist();
  await assertRefused(patch('boss', 'nobody@example.test', { nickname: 'x' }), 404, 'NOT_FOUND', before);
  await assertRefused(remove('boss', 'nobody@example.test'), 404, 'NOT_FOUND', before);
  await assertRefused(callApi(worker, env, 'DELETE', '/api/admin/members/%E0%A4%A', { cookie: cookies.boss }), 400, 'INVALID_EMAIL', before);
  await assertRefused(callApi(worker, env, 'DELETE', '/api/admin/members/not-an-email', { cookie: cookies.boss }), 400, 'INVALID_EMAIL', before);
});

test('PATCH body 沒有 nickname 或 role、角色值不合法：400', async () => {
  const before = await snapshotAllowlist();
  await assertRefused(patch('boss', 'm1@example.test', {}), 400, 'BAD_REQUEST', before);
  await assertRefused(patch('boss', 'm1@example.test', { email: 'x@example.test' }), 400, 'BAD_REQUEST', before);
  await assertRefused(patch('boss', 'm1@example.test', { role: 'superuser' }), 400, 'INVALID_ROLE', before);
  await assertRefused(patch('boss', 'm1@example.test', { role: null }), 400, 'INVALID_ROLE', before);
});

test('擁有者可在同一個請求同時改暱稱與角色', async () => {
  const response = await patch('boss', 'm2@example.test', { nickname: '升級了', role: 'admin' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { email: 'm2@example.test', nickname: '升級了', role: 'admin' });
});
