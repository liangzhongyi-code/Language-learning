import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createCloudApi, CloudApiError, gzipText, gunzipText, parseRetryAfter, SNAPSHOT_MAX_BYTES } from '../assets/js/ui/platform/cloud-api.js';

/**
 * 假 fetch：記下每個請求，依路由表回應；不連任何網路。
 */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, headers: { ...(init.headers || {}) } });
    const route = routes[`${init.method || 'GET'} ${url}`];
    if (!route) throw new TypeError('no route');
    return typeof route === 'function' ? route(init) : route;
  };
  fn.calls = calls;
  return fn;
}

const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json', ...headers } });

/**
 * 可重現的高熵文字：壓縮率低，用來測大小上限。
 */
function noisyText(chars, seed = 7) {
  let x = seed;
  let out = '';
  while (out.length < chars) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += x.toString(36);
  }
  return out.slice(0, chars);
}

test('cloud-api：上限常數為 8 MiB', () => {
  assert.equal(SNAPSHOT_MAX_BYTES, 8388608);
});

test('cloud-api：/api/me 已登入回傳帳號、未登入回傳 null，一律同源帶 cookie', async () => {
  const fetch = fakeFetch({ 'GET /api/me': json(200, { accountId: 'acct-1', email: 'learner@example.test', role: 'member' }) });
  const api = createCloudApi({ fetch });
  assert.deepEqual(await api.me(), { accountId: 'acct-1', email: 'learner@example.test', role: 'member' });
  assert.equal(fetch.calls[0].init.credentials, 'same-origin');
  const signedOut = createCloudApi({ fetch: fakeFetch({ 'GET /api/me': json(401, { error: 'UNAUTHENTICATED' }) }) });
  assert.equal(await signedOut.me(), null);
  const denied = createCloudApi({ fetch: fakeFetch({ 'GET /api/me': json(403, { error: 'NOT_ALLOWED' }) }) });
  await assert.rejects(denied.me(), (error) => error instanceof CloudApiError && error.code === 'FORBIDDEN');
});

test('cloud-api：meta 回傳固定形狀，壞回應轉成 BAD_RESPONSE', async () => {
  const ok = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot/meta': json(200, { revision: 4, uploadId: 'u-1', schemaVersion: 2, byteSize: 10, deviceLabel: '手機', updatedAt: 5 }) }) });
  assert.deepEqual(await ok.meta(), { revision: 4, uploadId: 'u-1', schemaVersion: 2, byteSize: 10, deviceLabel: '手機', updatedAt: 5 });
  const empty = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot/meta': json(200, { revision: 0 }) }) });
  assert.deepEqual(await empty.meta(), { revision: 0, uploadId: null, schemaVersion: null, byteSize: null, deviceLabel: '', updatedAt: null });
  for (const body of [{ revision: -1 }, { revision: '3' }, null, []]) {
    const bad = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot/meta': json(200, body) }) });
    await assert.rejects(bad.meta(), (error) => error.code === 'BAD_RESPONSE', JSON.stringify(body));
  }
  const text = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot/meta': new Response('<html>', { status: 200 }) }) });
  await assert.rejects(text.meta(), (error) => error.code === 'BAD_RESPONSE');
});

test('cloud-api：狀態碼轉成 typed error', async () => {
  const cases = [
    [json(401, { error: 'UNAUTHENTICATED' }), 'UNAUTHENTICATED'],
    [json(403, { error: 'NOT_ALLOWED' }), 'FORBIDDEN'],
    [json(413, { error: 'TOO_LARGE' }), 'TOO_LARGE'],
    [json(429, { error: 'RATE_LIMITED' }, { 'Retry-After': '120' }), 'RATE_LIMITED'],
    [json(500, { error: 'INTERNAL' }), 'SERVER'],
    [json(503, undefined), 'SERVER'],
    [json(418, {}), 'BAD_RESPONSE'],
  ];
  for (const [response, code] of cases) {
    const api = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot/meta': response }) });
    await assert.rejects(api.meta(), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.code, code);
      assert.equal(typeof error.message, 'string');
      assert.equal(error.outcomeUnknown, false, '讀取類請求沒有結果不明的問題');
      return true;
    });
  }
  const limited = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot/meta': json(429, {}, { 'Retry-After': '120' }) }) });
  await assert.rejects(limited.meta(), (error) => error.retryAfterMs === 120000);
});

test('cloud-api：Retry-After 支援秒數與 HTTP 日期，壞值回傳 null', () => {
  const now = Date.parse('2026-11-13T00:00:00Z');
  assert.equal(parseRetryAfter('30', now), 30000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter('Fri, 13 Nov 2026 00:02:00 GMT', now), 120000);
  assert.equal(parseRetryAfter('Fri, 12 Nov 2026 00:02:00 GMT', now), 0, '過去的日期視為立刻');
  assert.equal(parseRetryAfter('soon', now), null);
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter('-5', now), null);
});

test('cloud-api：網路錯誤與逾時；只有 PUT 標記為結果不明', async () => {
  const offline = createCloudApi({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.meta(), (error) => error.code === 'NETWORK' && error.outcomeUnknown === false);
  await assert.rejects(offline.upload(new Uint8Array([1]), { ifMatch: 0, uploadId: 'u-1', schemaVersion: 2, deviceLabel: '' }),
    (error) => error.code === 'NETWORK' && error.outcomeUnknown === true);

  let timer = null;
  const hanging = createCloudApi({
    timeoutMs: 50,
    setTimer: (fn) => { timer = fn; return 1; }, clearTimer: () => {},
    fetch: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  const pending = hanging.upload(new Uint8Array([1]), { ifMatch: 3, uploadId: 'u-2', schemaVersion: 2, deviceLabel: '' });
  await new Promise((resolve) => setImmediate(resolve));
  timer();
  await assert.rejects(pending, (error) => error.code === 'TIMEOUT' && error.outcomeUnknown === true);

  const failing = createCloudApi({ fetch: fakeFetch({ 'PUT /api/snapshot': json(502, {}) }) });
  await assert.rejects(failing.upload(new Uint8Array([1]), { ifMatch: 0, uploadId: 'u-3', schemaVersion: 2, deviceLabel: '' }),
    (error) => error.code === 'SERVER' && error.outcomeUnknown === true);
});

test('cloud-api：PUT 帶齊 If-Match、X-Upload-Id、X-Schema-Version、X-Device-Label 與 gzip body', async () => {
  const fetch = fakeFetch({ 'PUT /api/snapshot': json(200, { revision: 6 }) });
  const api = createCloudApi({ fetch });
  const body = new Uint8Array([31, 139, 8]);
  assert.deepEqual(await api.upload(body, { ifMatch: 5, uploadId: 'u-abc', schemaVersion: 2, deviceLabel: '我的 iPad' }), { revision: 6 });
  const call = fetch.calls[0];
  assert.equal(call.init.method, 'PUT');
  assert.equal(call.init.credentials, 'same-origin');
  assert.equal(call.init.body, body);
  assert.equal(call.headers['If-Match'], '5');
  assert.equal(call.headers['X-Upload-Id'], 'u-abc');
  assert.equal(call.headers['X-Schema-Version'], '2');
  assert.equal(call.headers['Content-Type'], 'application/gzip');
  assert.equal(decodeURIComponent(call.headers['X-Device-Label']), '我的 iPad');
  assert.match(call.headers['X-Device-Label'], /^[\x20-\x7e]*$/, '標頭只能是 ASCII');
  await assert.rejects(api.upload(body, { ifMatch: -1, uploadId: 'u', schemaVersion: 2 }), (error) => error.code === 'INVALID_REQUEST');
  await assert.rejects(api.upload(body, { ifMatch: 1, uploadId: '', schemaVersion: 2 }), (error) => error.code === 'INVALID_REQUEST');
});

test('cloud-api：409 附上目前雲端 meta；413、429 不標結果不明', async () => {
  const conflict = createCloudApi({ fetch: fakeFetch({ 'PUT /api/snapshot': json(409, { error: 'REVISION_MISMATCH', current: { revision: 9, uploadId: 'u-z' } }) }) });
  await assert.rejects(conflict.upload(new Uint8Array([1]), { ifMatch: 5, uploadId: 'u-1', schemaVersion: 2 }), (error) => {
    assert.equal(error.code, 'REVISION_MISMATCH');
    assert.equal(error.current.revision, 9);
    assert.equal(error.outcomeUnknown, false);
    return true;
  });
  const big = createCloudApi({ fetch: fakeFetch({ 'PUT /api/snapshot': json(413, {}) }) });
  await assert.rejects(big.upload(new Uint8Array([1]), { ifMatch: 0, uploadId: 'u-1', schemaVersion: 2 }), (error) => error.code === 'TOO_LARGE' && !error.outcomeUnknown);
  const rate = createCloudApi({ fetch: fakeFetch({ 'PUT /api/snapshot': json(429, {}, { 'Retry-After': '60' }) }) });
  await assert.rejects(rate.upload(new Uint8Array([1]), { ifMatch: 0, uploadId: 'u-1', schemaVersion: 2 }), (error) => error.code === 'RATE_LIMITED' && error.retryAfterMs === 60000 && !error.outcomeUnknown);
});

test('cloud-api：下載後解壓成文字，並回傳 X-Revision', async () => {
  const text = JSON.stringify({ format: 'lang-learn.backup', version: 2, note: '日本語' });
  const api = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot': () => new Response(gzipSync(Buffer.from(text)), { status: 200, headers: { 'X-Revision': '7', 'Content-Type': 'application/gzip' } }) }) });
  assert.deepEqual(await api.download(), { text, revision: 7 });
  const missing = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot': json(404, { error: 'NOT_FOUND' }) }) });
  await assert.rejects(missing.download(), (error) => error.code === 'NOT_FOUND');
  const corrupt = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot': () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'X-Revision': '1' } }) }) });
  await assert.rejects(corrupt.download(), (error) => error.code === 'CORRUPT_SNAPSHOT' && /沒有動任何資料/.test(error.message));
  const noRevision = createCloudApi({ fetch: fakeFetch({ 'GET /api/snapshot': () => new Response(gzipSync(Buffer.from(text)), { status: 200 }) }) });
  await assert.rejects(noRevision.download(), (error) => error.code === 'BAD_RESPONSE');
});

test('cloud-api：gzipText 與 gunzipText 來回一致', async () => {
  const text = '學習紀錄 ' + noisyText(5000);
  const bytes = await gzipText(text);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(gunzipSync(bytes).toString(), text);
  assert.equal(await gunzipText(bytes), text);
});

test('C11 前端：gzip 串流超過上限立刻停止並丟出 TOO_LARGE', async () => {
  const text = noisyText(400000);
  await assert.rejects(gzipText(text, { maxBytes: 4096 }), (error) => {
    assert.ok(error instanceof CloudApiError);
    assert.equal(error.code, 'TOO_LARGE');
    assert.equal(error.limitBytes, 4096);
    return true;
  });
  const exact = await gzipText('a'.repeat(1000));
  await assert.doesNotReject(gzipText('a'.repeat(1000), { maxBytes: exact.byteLength }), '剛好等於上限可以送');
  await assert.rejects(gzipText('a'.repeat(1000), { maxBytes: exact.byteLength - 1 }), (error) => error.code === 'TOO_LARGE');
});

test('cloud-api：登出與刪除雲端資料', async () => {
  const fetch = fakeFetch({ 'POST /api/auth/logout': new Response(null, { status: 204 }), 'DELETE /api/account': new Response(null, { status: 204 }) });
  const api = createCloudApi({ fetch });
  await api.logout();
  await api.deleteAccount();
  assert.deepEqual(fetch.calls.map((call) => [call.init.method, call.url, call.init.credentials]),
    [['POST', '/api/auth/logout', 'same-origin'], ['DELETE', '/api/account', 'same-origin']]);
});
