/**
 * T12：名單查詢與新增成員。
 * M01（API）成員與未登入者被拒、M03 新增成員、M04 不合法或重複的 email、
 * M05 名單欄位與排序、M06 開放模式下不在名單的人。
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
let clock;

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
  clock = FIXED_NOW;
  env = workerEnv(DB, { GOOGLE_OAUTH_BASE: google.base, TEST_NOW: () => clock });
});

/**
 * 以 SQL 加入白名單（模擬部署手冊的設定方式）。
 */
async function allow(email, role = 'member', nickname = null, createdAt = NOW_SEC - 86400) {
  await DB.prepare('INSERT INTO allowed_emails(email, nickname, role, created_at) VALUES (?, ?, ?, ?)')
    .bind(email, nickname, role, createdAt).run();
}

/**
 * 在目前的 clock 登入，回傳 session cookie。
 */
async function login(email, sub = `sub-${email}`, targetEnv = env) {
  google.setClaimOverrides({ exp: Math.floor(clock / 1000) + 3600 });
  const { cookie, response } = await signIn(worker, targetEnv, google, { user: { sub, email, email_verified: true } });
  assert.ok(cookie, `登入失敗：${response.headers.get('location')}`);
  return cookie;
}

const list = (cookie, targetEnv = env) => callApi(worker, targetEnv, 'GET', '/api/admin/members', { cookie });
const add = (cookie, body, targetEnv = env) => callApi(worker, targetEnv, 'POST', '/api/admin/members', { cookie, body });
const userId = async (email) => (await DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first())?.id;
const allowedRow = async (email) => DB.prepare('SELECT * FROM allowed_emails WHERE email = ?').bind(email).first();

test('M01 未登入：名單與新增都回 401', async () => {
  assert.equal((await list(null)).status, 401);
  assert.equal((await add(null, { email: 'x@example.test' })).status, 401);
});

test('M01 成員（含開放模式下不在名單的人）：403 NOT_STAFF，且不寫入', async () => {
  await allow('member@example.test');
  const member = await login('member@example.test');
  for (const response of [await list(member), await add(member, { email: 'x@example.test' })]) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'NOT_STAFF' });
  }
  const open = { ...env, ACCESS_MODE: 'open' };
  const stranger = await login('stranger@example.test', 'sub-stranger', open);
  const response = await list(stranger, open);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'NOT_STAFF' });
  assert.equal(await allowedRow('x@example.test'), null);
});

test('M03 擁有者新增成員：email 轉小寫去空白、角色固定 member、記下新增者，對方可立即登入', async () => {
  await allow('boss@example.test', 'owner');
  const owner = await login('boss@example.test');
  const response = await add(owner, { email: '  New.Person@Example.TEST ', nickname: ' 小新 ', role: 'admin' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { email: 'new.person@example.test', nickname: '小新', role: 'member' });
  const row = await allowedRow('new.person@example.test');
  assert.deepEqual({ ...row }, {
    email: 'new.person@example.test',
    nickname: '小新',
    role: 'member',
    created_at: NOW_SEC,
    added_by: await userId('boss@example.test'),
  });
  const newcomer = await login('new.person@example.test');
  assert.equal((await callApi(worker, env, 'GET', '/api/me', { cookie: newcomer })).status, 200);
});

test('M03 管理員新增成員：夾帶 role owner 也一律存成 member，暱稱可省略', async () => {
  await allow('boss@example.test', 'owner');
  await allow('helper@example.test', 'admin');
  const admin = await login('helper@example.test');
  const response = await add(admin, { email: 'friend@example.test', role: 'owner' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { email: 'friend@example.test', nickname: null, role: 'member' });
  const row = await allowedRow('friend@example.test');
  assert.equal(row.role, 'member');
  assert.equal(row.added_by, await userId('helper@example.test'));
  const owners = await DB.prepare("SELECT email FROM allowed_emails WHERE role = 'owner'").all();
  assert.deepEqual(owners.results.map((r) => r.email), ['boss@example.test']);
});

test('M03 暱稱剛好 40 字（以字元計）可以新增', async () => {
  await allow('boss@example.test', 'owner');
  const owner = await login('boss@example.test');
  const nickname = '名'.repeat(39) + '😀';
  const response = await add(owner, { email: 'forty@example.test', nickname });
  assert.equal(response.status, 201);
  assert.equal((await allowedRow('forty@example.test')).nickname, nickname);
});

test('M04 email 格式錯誤或超過 254 字：400 INVALID_EMAIL，不寫入', async () => {
  await allow('boss@example.test', 'owner');
  const owner = await login('boss@example.test');
  const local = 'a'.repeat(64);
  const tooLong = `${local}@${'b'.repeat(185)}.test`;
  assert.equal(tooLong.length, 255);
  for (const email of ['no-at-sign', 'a@b', '@example.test', 'a@@example.test', 'a b@example.test', 'a@exa mple.test', '', '   ', 'a@exam\nple.test', tooLong, 123, null, undefined, ['a@example.test']]) {
    const response = await add(owner, { email, nickname: 'x' });
    assert.equal(response.status, 400, JSON.stringify(email));
    assert.deepEqual(await response.json(), { error: 'INVALID_EMAIL' }, JSON.stringify(email));
  }
  const count = await DB.prepare('SELECT COUNT(*) AS n FROM allowed_emails').first();
  assert.equal(count.n, 1);
});

test('M04 email 剛好 254 字可以新增', async () => {
  await allow('boss@example.test', 'owner');
  const owner = await login('boss@example.test');
  const email = `${'a'.repeat(64)}@${'b'.repeat(184)}.test`;
  assert.equal(email.length, 254);
  assert.equal((await add(owner, { email })).status, 201);
});

test('M04 暱稱超過 40 字或不是字串：400 INVALID_NICKNAME，不寫入', async () => {
  await allow('boss@example.test', 'owner');
  const owner = await login('boss@example.test');
  for (const nickname of ['名'.repeat(41), 'a'.repeat(41), 42, { text: 'x' }]) {
    const response = await add(owner, { email: 'nick@example.test', nickname });
    assert.equal(response.status, 400, JSON.stringify(nickname));
    assert.deepEqual(await response.json(), { error: 'INVALID_NICKNAME' });
  }
  assert.equal(await allowedRow('nick@example.test'), null);
});

test('M04 已在名單（大小寫不同也算）：409 ALREADY_EXISTS，既有的角色與暱稱不被覆蓋', async () => {
  await allow('boss@example.test', 'owner');
  await allow('helper@example.test', 'admin', '老幫手', 111);
  const owner = await login('boss@example.test');
  const response = await add(owner, { email: 'HELPER@example.test', nickname: '改掉' });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'ALREADY_EXISTS' });
  const row = await allowedRow('helper@example.test');
  assert.deepEqual({ role: row.role, nickname: row.nickname, created_at: row.created_at }, { role: 'admin', nickname: '老幫手', created_at: 111 });
});

test('M04 body 不是 JSON 物件：400 BAD_REQUEST', async () => {
  await allow('boss@example.test', 'owner');
  const owner = await login('boss@example.test');
  for (const body of ['not json', '[]', 'null', '"a@example.test"']) {
    const response = await callApi(worker, env, 'POST', '/api/admin/members', { cookie: owner, body, headers: { 'content-type': 'application/json' } });
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: 'BAD_REQUEST' });
  }
});

test('M05 名單欄位與排序：擁有者第一，其餘依最後登入新到舊，從未登入的排最後', async () => {
  await allow('boss@example.test', 'owner', '站長', NOW_SEC - 10 * 86400);
  await allow('helper@example.test', 'admin', '幫手', NOW_SEC - 9 * 86400);
  await allow('old@example.test', 'member', null, NOW_SEC - 8 * 86400);
  await allow('active@example.test', 'member', '小明', NOW_SEC - 7 * 86400);
  await allow('zeta-never@example.test', 'member', null, NOW_SEC - 6 * 86400);
  await allow('alpha-never@example.test', 'member', null, NOW_SEC - 5 * 86400);

  clock = FIXED_NOW - 40 * DAY_MS;
  await login('old@example.test');
  clock = FIXED_NOW - 3 * DAY_MS;
  const owner = await login('boss@example.test');
  clock = FIXED_NOW - 2 * HOUR_MS;
  const admin = await login('helper@example.test');
  clock = FIXED_NOW - HOUR_MS;
  const active = await login('active@example.test');
  await login('active@example.test');
  clock = FIXED_NOW;
  await callApi(worker, env, 'PUT', '/api/snapshot', {
    cookie: active, body: new Uint8Array([1, 2, 3]),
    headers: { 'if-match': '0', 'x-upload-id': 'up-1', 'x-schema-version': '2' },
  });
  await DB.prepare('UPDATE allowed_emails SET added_by = ? WHERE email = ?').bind(await userId('helper@example.test'), 'active@example.test').run();

  const response = await list(owner);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { members } = await response.json();
  assert.deepEqual(members.map((m) => m.email), [
    'boss@example.test',
    'active@example.test',
    'helper@example.test',
    'old@example.test',
    'alpha-never@example.test',
    'zeta-never@example.test',
  ]);
  for (const member of members) {
    assert.deepEqual(Object.keys(member).sort(), [
      'activeSessions', 'addedBy', 'createdAt', 'email', 'inAllowlist', 'lastLoginAt', 'nickname', 'role', 'snapshotUpdatedAt',
    ]);
  }
  const byEmail = Object.fromEntries(members.map((m) => [m.email, m]));
  assert.deepEqual(byEmail['active@example.test'], {
    email: 'active@example.test',
    nickname: '小明',
    role: 'member',
    inAllowlist: true,
    createdAt: (NOW_SEC - 7 * 86400) * 1000,
    addedBy: 'helper@example.test',
    lastLoginAt: FIXED_NOW - HOUR_MS,
    activeSessions: 2,
    snapshotUpdatedAt: FIXED_NOW,
  });
  assert.deepEqual(byEmail['old@example.test'], {
    email: 'old@example.test',
    nickname: null,
    role: 'member',
    inAllowlist: true,
    createdAt: (NOW_SEC - 8 * 86400) * 1000,
    addedBy: null,
    lastLoginAt: FIXED_NOW - 40 * DAY_MS,
    activeSessions: 0,
    snapshotUpdatedAt: null,
  });
  assert.equal(byEmail['alpha-never@example.test'].lastLoginAt, null);
  assert.equal(byEmail['alpha-never@example.test'].activeSessions, 0);
  assert.equal(byEmail['boss@example.test'].role, 'owner');
  assert.equal(byEmail['helper@example.test'].role, 'admin');

  const text = JSON.stringify(members);
  assert.equal(text.includes('sub-'), false, '不得包含 google_sub');
  assert.equal(text.includes(await userId('boss@example.test')), false, '不得包含使用者 id');

  const adminView = await list(admin);
  assert.equal(adminView.status, 200);
  assert.deepEqual((await adminView.json()).members, members, '管理員看到相同的名單');
});

test('M05 白名單模式下，已被移除但仍有使用者列的人不列出', async () => {
  await allow('boss@example.test', 'owner');
  await allow('gone@example.test');
  const owner = await login('boss@example.test');
  await login('gone@example.test');
  await DB.prepare("DELETE FROM allowed_emails WHERE email = 'gone@example.test'").run();
  const { members } = await (await list(owner)).json();
  assert.deepEqual(members.map((m) => m.email), ['boss@example.test']);
});

test('M06 開放模式：登入過但不在名單的人也列出並標示，工作人員可一鍵加入', async () => {
  const open = { ...env, ACCESS_MODE: 'open' };
  await allow('boss@example.test', 'owner');
  await allow('helper@example.test', 'admin');
  clock = FIXED_NOW - HOUR_MS;
  await login('stranger@example.test', 'sub-stranger', open);
  clock = FIXED_NOW;
  const owner = await login('boss@example.test', 'sub-boss', open);
  const admin = await login('helper@example.test', 'sub-helper', open);

  const { members } = await (await list(owner, open)).json();
  const stranger = members.find((m) => m.email === 'stranger@example.test');
  assert.deepEqual(stranger, {
    email: 'stranger@example.test',
    nickname: null,
    role: 'member',
    inAllowlist: false,
    createdAt: null,
    addedBy: null,
    lastLoginAt: FIXED_NOW - HOUR_MS,
    activeSessions: 1,
    snapshotUpdatedAt: null,
  });
  assert.equal(members.filter((m) => m.inAllowlist).length, 2);

  assert.equal((await add(admin, { email: 'stranger@example.test' }, open)).status, 201);
  const after = (await (await list(owner, open)).json()).members.find((m) => m.email === 'stranger@example.test');
  assert.equal(after.inAllowlist, true);
  assert.equal(after.addedBy, 'helper@example.test');
  assert.equal(after.lastLoginAt, FIXED_NOW - HOUR_MS);
});
