import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, workerEnv, signIn, callApi } from './helpers/worker-env.mjs';
import { startFakeGoogle } from './helpers/fake-google.mjs';
import worker from '../worker/src/index.js';

const NOW = Date.UTC(2026, 10, 13, 8);
const SNAPSHOT = '/api/snapshot';
const aliceBytes = Uint8Array.of(1, 2, 3);
const bobBytes = Uint8Array.of(4, 5, 6);

let ctx;
let google;
let env;
let alice;
let bob;

function request(method, path, options, requestEnv = env) {
  return callApi(worker, requestEnv, method, path, options);
}

async function login(name) {
  const email = `${name}@example.test`;
  const { cookie } = await signIn(worker, env, google, {
    user: { sub: `sub-${name}`, email, email_verified: true },
  });
  assert.ok(cookie);
  const me = await request('GET', '/api/me', { cookie });
  assert.equal(me.status, 200);
  const { accountId } = await me.json();
  assert.ok(accountId);
  return { cookie, accountId };
}

function uploadHeaders(revision, uploadId, accountId) {
  return {
    'if-match': String(revision),
    'x-upload-id': uploadId,
    'x-schema-version': '2',
    ...(accountId === undefined ? {} : { 'X-Cloud-Account': accountId }),
  };
}

before(async () => {
  ctx = await createTestDb();
  const { DB } = ctx.env;
  const base = workerEnv(DB);
  google = await startFakeGoogle({ clientId: base.GOOGLE_CLIENT_ID, clientSecret: base.GOOGLE_CLIENT_SECRET });
  google.setClaimOverrides({ exp: NOW / 1000 + 3600 });
  env = workerEnv(DB, { ACCESS_MODE: 'open', GOOGLE_OAUTH_BASE: google.base, TEST_NOW: () => NOW });

  alice = await login('alice');
  const first = await request('PUT', SNAPSHOT, {
    cookie: alice.cookie, body: aliceBytes, headers: uploadHeaders(0, 'alice-first'),
  });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { revision: 1 });

  const logout = await request('POST', '/api/auth/logout', { cookie: alice.cookie });
  assert.equal(logout.status, 204);
  bob = await login('bob');
  assert.notEqual(bob.accountId, alice.accountId);
  const second = await request('PUT', SNAPSHOT, {
    cookie: bob.cookie, body: bobBytes, headers: uploadHeaders(0, 'bob-first', bob.accountId),
  });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { revision: 1 });
});

after(async () => {
  await google?.close();
  await ctx?.dispose();
});

/**
 * 舊分頁仍帶 Alice 的帳號 ID，但瀏覽器已改送 Bob 的 session cookie。
 */
async function assertAccountChanged(method, path, { body, headers = {} } = {}) {
  const snapshotQueries = [];
  const DB = {
    prepare(sql) {
      if (/\b(snapshots|snapshot_chunks|upload_log)\b/.test(sql)) snapshotQueries.push(sql);
      return env.DB.prepare(sql);
    },
    batch: env.DB.batch.bind(env.DB),
  };
  const response = await request(method, path, {
    cookie: bob.cookie,
    body,
    headers: { ...headers, 'X-Cloud-Account': alice.accountId },
  }, { ...env, DB });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'ACCOUNT_CHANGED' });
  assert.deepEqual(snapshotQueries, []);
}

test('切換到同版號的帳號後，舊分頁無法讀取快照 meta', async () => {
  await assertAccountChanged('GET', `${SNAPSHOT}/meta`);
});

test('切換到同版號的帳號後，舊分頁無法下載快照', async () => {
  await assertAccountChanged('GET', SNAPSHOT);
});

test('未帶帳號標頭仍可用現有 session 讀取，空標頭視為不符', async () => {
  const meta = await request('GET', `${SNAPSHOT}/meta`, { cookie: bob.cookie });
  assert.equal(meta.status, 200);
  assert.equal((await meta.json()).revision, 1);
  const download = await request('GET', SNAPSHOT, { cookie: bob.cookie });
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bobBytes);
  const empty = await request('GET', `${SNAPSHOT}/meta`, {
    cookie: bob.cookie, headers: { 'X-Cloud-Account': '' },
  });
  assert.equal(empty.status, 403);
  assert.deepEqual(await empty.json(), { error: 'ACCOUNT_CHANGED' });
});

test('If-Match 符合新帳號的版號時，舊分頁仍無法覆寫快照', async () => {
  await assertAccountChanged('PUT', SNAPSHOT, {
    body: aliceBytes,
    headers: uploadHeaders(1, 'alice-stale'),
  });

  const headers = { 'X-Cloud-Account': bob.accountId };
  const meta = await request('GET', `${SNAPSHOT}/meta`, { cookie: bob.cookie, headers });
  assert.equal(meta.status, 200);
  const { revision, uploadId } = await meta.json();
  assert.deepEqual({ revision, uploadId }, { revision: 1, uploadId: 'bob-first' });
  const download = await request('GET', SNAPSHOT, { cookie: bob.cookie, headers });
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bobBytes);
});

test('舊分頁不能登出新帳號，拒絕時保留 cookie 與 session', async () => {
  const client = await login('logout-target');
  const stale = await request('POST', '/api/auth/logout', {
    cookie: client.cookie, headers: { 'X-Cloud-Account': alice.accountId },
  });
  assert.equal(stale.status, 403);
  assert.deepEqual(await stale.json(), { error: 'ACCOUNT_CHANGED' });
  assert.equal(stale.headers.has('set-cookie'), false);
  assert.equal((await request('GET', '/api/me', { cookie: client.cookie })).status, 200);

  const current = await request('POST', '/api/auth/logout', {
    cookie: client.cookie, headers: { 'X-Cloud-Account': client.accountId },
  });
  assert.equal(current.status, 204);
  assert.match(current.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await request('GET', '/api/me', { cookie: client.cookie })).status, 401);
});

test('舊分頁不能刪除新帳號，拒絕時保留 cookie、session 與快照', async () => {
  const client = await login('delete-target');
  const upload = await request('PUT', SNAPSHOT, {
    cookie: client.cookie, body: bobBytes, headers: uploadHeaders(0, 'delete-target-first', client.accountId),
  });
  assert.equal(upload.status, 200);
  const stale = await request('DELETE', '/api/account', {
    cookie: client.cookie, headers: { 'X-Cloud-Account': alice.accountId },
  });
  assert.equal(stale.status, 403);
  assert.deepEqual(await stale.json(), { error: 'ACCOUNT_CHANGED' });
  assert.equal(stale.headers.has('set-cookie'), false);
  const download = await request('GET', SNAPSHOT, {
    cookie: client.cookie, headers: { 'X-Cloud-Account': client.accountId },
  });
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bobBytes);

  const current = await request('DELETE', '/api/account', {
    cookie: client.cookie, headers: { 'X-Cloud-Account': client.accountId },
  });
  assert.equal(current.status, 204);
  assert.match(current.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await request('GET', '/api/me', { cookie: client.cookie })).status, 401);
  const snapshot = await env.DB.prepare('SELECT revision FROM snapshots WHERE user_id = ?').bind(client.accountId).first();
  assert.equal(snapshot, null);
});

test('帳號刪除或 session 撤銷發生在讀取上傳 body 時，舊請求不能寫入', async (t) => {
  for (const endpoint of ['/api/auth/logout', '/api/account']) {
    await t.test(endpoint, async () => {
      const client = await login(endpoint.endsWith('logout') ? 'upload-logout' : 'upload-delete');
      const headers = uploadHeaders(0, 'stale-upload', client.accountId);
      let onBodyRead;
      const reading = new Promise((resolve) => { onBodyRead = resolve; });
      let bodyStream;
      const body = new ReadableStream({
        pull(controller) {
          bodyStream = controller;
          onBodyRead();
        },
      }, { highWaterMark: 0 });
      const upload = worker.fetch(new Request(`https://site.test${SNAPSHOT}`, {
        method: 'PUT',
        headers: { ...headers, origin: 'https://site.test', cookie: client.cookie },
        body,
        duplex: 'half',
      }), env, {});
      await Promise.race([reading, upload]);
      try {
        const response = await request(endpoint.endsWith('logout') ? 'POST' : 'DELETE', endpoint, {
          cookie: client.cookie, headers,
        });
        assert.equal(response.status, 204);
      } finally {
        bodyStream?.enqueue(aliceBytes);
        bodyStream?.close();
      }

      const response = await upload;
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'UNAUTHENTICATED' });
      for (const table of ['snapshots', 'snapshot_chunks', 'upload_log']) {
        const { count } = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`)
          .bind(client.accountId).first();
        assert.equal(count, 0, table);
      }
    });
  }
});

test('帳號在快照寫入後立即刪除，不會留下補寫的 upload_log', async () => {
  const client = await login('delete-after-upload');
  const DB = env.DB;
  const headers = uploadHeaders(0, 'delete-after-upload', client.accountId);
  let deleted = false;
  const response = await request('PUT', SNAPSHOT, {
    cookie: client.cookie, body: bobBytes, headers,
  }, {
    ...env,
    DB: {
      prepare: DB.prepare.bind(DB),
      async batch(statements) {
        const result = await DB.batch(statements);
        if (!deleted) {
          deleted = true;
          const removal = await request('DELETE', '/api/account', { cookie: client.cookie, headers });
          assert.equal(removal.status, 204);
        }
        return result;
      },
    },
  });
  assert.equal(response.status, 200);
  assert.ok(deleted);
  const { count } = await DB.prepare('SELECT COUNT(*) AS count FROM upload_log WHERE user_id = ?')
    .bind(client.accountId).first();
  assert.equal(count, 0);
});
