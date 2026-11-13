/**
 * T10：快照上傳與下載。
 * meta、下載、條件式上傳（分塊、db.batch、If-Match）、C07 版本不符與並行上傳、
 * C11 超過 8 MiB 回 413、C12 每小時 60 次回 429 加 Retry-After，以及跨帳號隔離。
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
let clock;
let alice;
let bob;

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);
const MAX_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 1_900_000;

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
  clock = FIXED_NOW;
  env = workerEnv(DB, { GOOGLE_OAUTH_BASE: google.base, TEST_NOW: () => clock });
  await DB.prepare("INSERT INTO allowed_emails(email, role, created_at) VALUES ('alice@example.test', 'member', 1), ('bob@example.test', 'member', 1)").run();
  alice = (await signIn(worker, env, google, { user: { sub: 'sub-alice', email: 'alice@example.test', email_verified: true } })).cookie;
  bob = (await signIn(worker, env, google, { user: { sub: 'sub-bob', email: 'bob@example.test', email_verified: true } })).cookie;
});

/**
 * 產生指定長度、內容可辨識的位元組。
 */
function bytes(length, seed = 7) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + seed) % 256;
  return out;
}

/**
 * 上傳快照。headers 可覆寫或以 null 移除預設標頭。
 */
function put(cookie, body, { ifMatch = '0', uploadId = 'upload-1', schemaVersion = '2', deviceLabel = 'laptop', headers = {} } = {}) {
  const base = { 'if-match': ifMatch, 'x-upload-id': uploadId, 'x-schema-version': schemaVersion, 'x-device-label': deviceLabel, ...headers };
  const clean = Object.fromEntries(Object.entries(base).filter(([, value]) => value !== null && value !== undefined));
  return callApi(worker, env, 'PUT', '/api/snapshot', { cookie, body, headers: clean });
}

const meta = async (cookie) => (await callApi(worker, env, 'GET', '/api/snapshot/meta', { cookie })).json();
const userId = async (email) => (await DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()).id;

/**
 * 某位使用者在 snapshot_chunks 的全部列（不含資料本體）。
 */
async function chunkRows(email) {
  const { results } = await DB.prepare('SELECT revision, idx, length(data) AS size FROM snapshot_chunks WHERE user_id = ? ORDER BY revision, idx')
    .bind(await userId(email)).all();
  return results;
}

test('未登入：meta、下載、上傳都回 401', async () => {
  assert.equal((await callApi(worker, env, 'GET', '/api/snapshot/meta')).status, 401);
  assert.equal((await callApi(worker, env, 'GET', '/api/snapshot')).status, 401);
  assert.equal((await put(null, bytes(10))).status, 401);
});

test('沒有快照：meta 回 {revision:0}，下載回 404', async () => {
  const response = await callApi(worker, env, 'GET', '/api/snapshot/meta', { cookie: alice });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revision: 0 });
  const download = await callApi(worker, env, 'GET', '/api/snapshot', { cookie: alice });
  assert.equal(download.status, 404);
  assert.deepEqual(await download.json(), { error: 'NOT_FOUND' });
});

test('第一次上傳 If-Match: 0，meta 與下載內容一致', async () => {
  const body = bytes(1234);
  const response = await put(alice, body, { uploadId: 'up-first', deviceLabel: encodeURIComponent('筆電 Chrome') });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revision: 1 });

  assert.deepEqual(await meta(alice), {
    revision: 1,
    uploadId: 'up-first',
    schemaVersion: 2,
    byteSize: 1234,
    deviceLabel: '筆電 Chrome',
    updatedAt: FIXED_NOW,
  });

  const download = await callApi(worker, env, 'GET', '/api/snapshot', { cookie: alice });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/gzip');
  assert.equal(download.headers.get('x-revision'), '1');
  assert.equal(download.headers.get('content-encoding'), null);
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), body);
});

test('連續上傳：revision 遞增，只保留目前 revision 的分塊', async () => {
  assert.equal((await put(alice, bytes(100, 1), { ifMatch: '0' })).status, 200);
  clock += 1000;
  const second = await put(alice, bytes(200, 2), { ifMatch: '1', uploadId: 'upload-2' });
  assert.deepEqual(await second.json(), { revision: 2 });
  assert.deepEqual(await chunkRows('alice@example.test'), [{ revision: 2, idx: 0, size: 200 }]);
  const download = await callApi(worker, env, 'GET', '/api/snapshot', { cookie: alice });
  assert.equal(download.headers.get('x-revision'), '2');
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes(200, 2));
});

test('超過 1,900,000 bytes 時分塊保存，下載時依序接回', async () => {
  const body = bytes(4_000_000, 3);
  const response = await put(alice, body);
  assert.equal(response.status, 200);
  assert.deepEqual(await chunkRows('alice@example.test'), [
    { revision: 1, idx: 0, size: CHUNK_BYTES },
    { revision: 1, idx: 1, size: CHUNK_BYTES },
    { revision: 1, idx: 2, size: 4_000_000 - 2 * CHUNK_BYTES },
  ]);
  const row = await DB.prepare('SELECT chunk_count, byte_size FROM snapshots').first();
  assert.deepEqual({ ...row }, { chunk_count: 3, byte_size: 4_000_000 });
  const download = await callApi(worker, env, 'GET', '/api/snapshot', { cookie: alice });
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), body);
});

test('C07 If-Match 落後或超前：409 附目前 meta，快照不變、不留下任何分塊', async () => {
  await put(alice, bytes(50, 1), { ifMatch: '0', uploadId: 'up-a' });
  await put(alice, bytes(60, 2), { ifMatch: '1', uploadId: 'up-b' });
  const before = await meta(alice);
  for (const ifMatch of ['0', '1', '3', '9']) {
    const response = await put(alice, bytes(70, 9), { ifMatch, uploadId: 'up-stale' });
    assert.equal(response.status, 409, `If-Match: ${ifMatch}`);
    assert.deepEqual(await response.json(), { error: 'REVISION_MISMATCH', current: before });
    assert.deepEqual(await meta(alice), before);
    assert.deepEqual(await chunkRows('alice@example.test'), [{ revision: 2, idx: 0, size: 60 }]);
  }
});

test('C07 雲端沒有快照時帶非 0 的 If-Match：409 且不建立快照', async () => {
  const response = await put(alice, bytes(10), { ifMatch: '4' });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'REVISION_MISMATCH', current: { revision: 0 } });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n, 0);
  assert.deepEqual(await chunkRows('alice@example.test'), []);
});

test('C07 兩個請求以同一個基準同時上傳：只成功一個，失敗的不留下分塊', async () => {
  await put(alice, bytes(30, 1), { ifMatch: '0', uploadId: 'up-base' });
  const [first, second] = await Promise.all([
    put(alice, bytes(2_000_000, 4), { ifMatch: '1', uploadId: 'up-left' }),
    put(alice, bytes(2_100_000, 5), { ifMatch: '1', uploadId: 'up-right' }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = first.status === 200 ? 'up-left' : 'up-right';
  const loser = first.status === 200 ? second : first;
  const current = await meta(alice);
  assert.equal(current.revision, 2);
  assert.equal(current.uploadId, winner);
  assert.deepEqual(await loser.json(), { error: 'REVISION_MISMATCH', current });
  const size = winner === 'up-left' ? 2_000_000 : 2_100_000;
  assert.deepEqual(await chunkRows('alice@example.test'), [
    { revision: 2, idx: 0, size: CHUNK_BYTES },
    { revision: 2, idx: 1, size: size - CHUNK_BYTES },
  ]);
});

test('C11 剛好 8 MiB 可以上傳（5 塊）', async () => {
  const response = await put(alice, bytes(MAX_BYTES, 6));
  assert.equal(response.status, 200);
  assert.equal((await chunkRows('alice@example.test')).length, 5);
});

test('C11 超過 8 MiB：413 TOO_LARGE，不寫入任何資料', async () => {
  const declared = await put(alice, bytes(MAX_BYTES + 1));
  assert.equal(declared.status, 413);
  assert.deepEqual(await declared.json(), { error: 'TOO_LARGE' });

  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent > MAX_BYTES) return controller.close();
      const piece = bytes(1024 * 1024);
      sent += piece.byteLength;
      controller.enqueue(piece);
    },
  }, { highWaterMark: 0 });
  const request = new Request(`${TEST_SITE}/api/snapshot`, {
    method: 'PUT',
    body: stream,
    duplex: 'half',
    headers: { cookie: alice, origin: TEST_SITE, 'if-match': '0', 'x-upload-id': 'up-stream', 'x-schema-version': '2', 'x-device-label': 'x' },
  });
  const streamed = await worker.fetch(request, env, {});
  assert.equal(streamed.status, 413);
  assert.deepEqual(await streamed.json(), { error: 'TOO_LARGE' });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM snapshot_chunks').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM upload_log').first()).n, 0);
});

test('C12 一小時內第 61 次上傳：429 RATE_LIMITED 加 Retry-After，到期後恢復', async () => {
  for (let i = 0; i < 60; i += 1) {
    const response = await put(alice, bytes(16, i), { ifMatch: String(i), uploadId: `up-${i}` });
    assert.equal(response.status, 200, `第 ${i + 1} 次`);
    clock += 10_000;
  }
  const blocked = await put(alice, bytes(16, 99), { ifMatch: '60', uploadId: 'up-61' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: 'RATE_LIMITED' });
  assert.equal(blocked.headers.get('retry-after'), String(3600 - 600));
  assert.equal((await meta(alice)).revision, 60, '被擋下的請求不寫入');

  clock = FIXED_NOW + 3600 * 1000 + 1000;
  const allowed = await put(alice, bytes(16, 99), { ifMatch: '60', uploadId: 'up-61' });
  assert.equal(allowed.status, 200);
  const log = await DB.prepare('SELECT COUNT(*) AS n FROM upload_log').first();
  assert.ok(log.n <= 60, '超過一小時的紀錄會被清掉');
});

test('C12 失敗的上傳（409、413）不計入頻率上限', async () => {
  for (let i = 0; i < 70; i += 1) {
    assert.equal((await put(alice, bytes(8), { ifMatch: '5' })).status, 409);
  }
  assert.equal((await put(alice, bytes(8))).status, 200);
});

test('C12 頻率上限依帳號分開計算', async () => {
  const now = Math.floor(clock / 1000);
  const aliceId = await userId('alice@example.test');
  for (let i = 0; i < 60; i += 1) {
    await DB.prepare('INSERT INTO upload_log(user_id, at) VALUES (?, ?)').bind(aliceId, now - 100 + i).run();
  }
  const blocked = await put(alice, bytes(8));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), String(3600 - 100));
  assert.equal((await put(bob, bytes(8))).status, 200);
});

test('跨帳號：讀不到也蓋不到別人的快照', async () => {
  await put(alice, bytes(40, 1), { uploadId: 'alice-up' });
  assert.deepEqual(await meta(bob), { revision: 0 });
  assert.equal((await callApi(worker, env, 'GET', '/api/snapshot', { cookie: bob })).status, 404);
  const bobUpload = await put(bob, bytes(50, 2), { uploadId: 'bob-up' });
  assert.deepEqual(await bobUpload.json(), { revision: 1 });
  assert.equal((await meta(alice)).uploadId, 'alice-up');
  const download = await callApi(worker, env, 'GET', '/api/snapshot', { cookie: alice });
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes(40, 1));
  const spoofed = await callApi(worker, env, 'GET', `/api/snapshot?user=${await userId('bob@example.test')}`, { cookie: alice });
  assert.deepEqual(new Uint8Array(await spoofed.arrayBuffer()), bytes(40, 1));
});

test('標頭或 body 不合法：400 BAD_REQUEST，不寫入', async () => {
  const bad = [
    { ifMatch: null },
    { ifMatch: 'abc' },
    { ifMatch: '-1' },
    { ifMatch: '1.5' },
    { ifMatch: '"0"' },
    { uploadId: null },
    { uploadId: '' },
    { uploadId: 'has space' },
    { uploadId: 'x'.repeat(65) },
    { schemaVersion: null },
    { schemaVersion: 'two' },
    { schemaVersion: '0' },
  ];
  for (const options of bad) {
    const response = await put(alice, bytes(8), options);
    assert.equal(response.status, 400, JSON.stringify(options));
    assert.deepEqual(await response.json(), { error: 'BAD_REQUEST' });
  }
  const empty = await put(alice, new Uint8Array(0));
  assert.equal(empty.status, 400);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n, 0);
});

test('X-Device-Label：前端以 encodeURIComponent 編碼，可省略、解碼後截到 64 字，解碼失敗存空字串但不讓請求失敗', async () => {
  await put(alice, bytes(8), { deviceLabel: null });
  assert.equal((await meta(alice)).deviceLabel, null);
  await put(alice, bytes(8), { ifMatch: '1', deviceLabel: encodeURIComponent('長'.repeat(80)) });
  assert.equal((await meta(alice)).deviceLabel, '長'.repeat(64));
  const broken = await put(alice, bytes(8), { ifMatch: '2', deviceLabel: '%E0%A4%A' });
  assert.equal(broken.status, 200);
  assert.equal((await meta(alice)).deviceLabel, '');
  await put(alice, bytes(8), { ifMatch: '3', deviceLabel: encodeURIComponent('媽媽的 iPad（客廳）') });
  assert.equal((await meta(alice)).deviceLabel, '媽媽的 iPad（客廳）', '中文裝置名稱往返一致');
});
