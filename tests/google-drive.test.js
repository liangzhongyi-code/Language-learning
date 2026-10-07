import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleWebAuth, DRIVE_APPDATA_SCOPE, GOOGLE_USERINFO_URL } from '../assets/js/ui/platform/google-web-auth.js';
import {
  createGoogleDrive, newExportId, sanitizeDeviceLabel, DRIVE_FILES_URL, DRIVE_UPLOAD_URL,
} from '../assets/js/ui/platform/google-drive.js';
import { BACKUP_JSON_MAX_BYTES } from '../assets/js/core/backup-limits.js';

/**
 * 假 token：任何錯誤的 message／details／stack 都不得出現這段字串。
 */
const TOKEN = 'ya29.DRIVE-SECRET-TOKEN-ZZZ';
const TOKEN_B = 'ya29.DRIVE-SECRET-TOKEN-BBB';
const FULL_SCOPE = `${DRIVE_APPDATA_SCOPE} openid email`;
const NOW = 1791172800000;
const BACKUP_TEXT = JSON.stringify({ format: 'lang-learn.backup', version: 2, exportedAt: NOW, prefs: { theme: 'light' } });
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(ok => { resolve = ok; });
  return { promise, resolve };
}

function fakeGoogle() {
  const init = [];
  const google = { accounts: { oauth2: {
    initTokenClient(cfg) { init.push(cfg); return { requestAccessToken() {} }; },
    revoke(token, done) { done?.({ successful: true }); },
  } } };
  return { google, respond: (response) => init.at(-1).callback(response) };
}

/**
 * 用真的 auth adapter（假 GIS + 假 fetch）組出已連接的 Drive adapter，
 * 讓 Bearer 附加、網域白名單與 401 清狀態都走正式路徑。
 */
async function driveHarness(handler, options = {}) {
  const g = fakeGoogle();
  let loaded = false;
  const requests = [];
  const auth = createGoogleWebAuth({
    config: { webClientId: 'web-client-id' },
    loadScript: async () => { loaded = true; },
    getGoogle: () => (loaded ? g.google : undefined),
    fetch: async (url, init = {}) => {
      if (String(url) === GOOGLE_USERINFO_URL) {
        const token = init.headers.Authorization.replace('Bearer ', '');
        return new Response(JSON.stringify({ email: token === TOKEN ? 'alice@example.com' : 'bob@example.com' }), { status: 200 });
      }
      const request = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body, signal: init.signal };
      requests.push(request);
      return handler(request, requests.length);
    },
  });
  const connect = async (token = TOKEN) => {
    const pending = auth.connect();
    await flush();
    g.respond({ access_token: token, expires_in: 3599, scope: FULL_SCOPE });
    return pending;
  };
  await connect();
  const drive = createGoogleDrive({ auth, ...options });
  return { drive, auth, requests, connect };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function errorResponse(status, reason, headers = {}) {
  return json({ error: { code: status, message: `server said ${TOKEN}`, errors: [{ reason, message: `echo ${TOKEN}` }] } }, status, headers);
}

function parseMultipart(request) {
  const boundary = /boundary=([^;\s]+)/.exec(request.headers['Content-Type'])[1];
  assert.equal(request.body.endsWith(`\r\n--${boundary}--`), true, 'multipart 結尾邊界');
  const parts = request.body.split(`--${boundary}`).slice(1, -1).map((part) => {
    const index = part.indexOf('\r\n\r\n');
    return { head: part.slice(0, index), body: part.slice(index + 4, -2) };
  });
  return { boundary, parts, metadata: JSON.parse(parts[0].body), media: parts[1].body };
}

let fileSeq = 0;
function createdResponse(request) {
  const { metadata, media } = parseMultipart(request);
  fileSeq += 1;
  return json({ id: `file_${fileSeq}`, name: metadata.name, createdTime: '2026-10-07T00:00:00.000Z',
    size: String(new TextEncoder().encode(media).byteLength), appProperties: metadata.appProperties });
}

function uploadArgs(exportId, extra = {}) {
  return { text: BACKUP_TEXT, exportId, schemaVersion: 2, exportedAt: NOW, deviceLabel: '我的筆電', ...extra };
}

function assertNoToken(error) {
  const text = [error?.message, JSON.stringify(error?.details ?? {}), String(error?.stack ?? ''), String(error)].join('\n');
  assert.equal(text.includes(TOKEN), false, `錯誤內容洩漏 token：${error?.code}`);
}

function abortableNever(request) {
  return new Promise((_, reject) => {
    request.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

/* ── G03 新增多份快照 ─────────────────────────────────── */

test('G03 多次備份各自建立新檔：不同 exportId、POST multipart 到固定上傳端點，從不 PATCH／DELETE', async () => {
  const h = await driveHarness(createdResponse);
  const first = newExportId();
  const second = newExportId();
  assert.notEqual(first, second);
  const a = await h.drive.uploadSnapshot(uploadArgs(first));
  const b = await h.drive.uploadSnapshot(uploadArgs(second));
  assert.equal(a.status, 'created');
  assert.equal(b.status, 'created');
  assert.equal(a.exportId, first);
  assert.equal(b.exportId, second);
  assert.notEqual(a.snapshot.id, b.snapshot.id);
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'POST']);
  for (const request of h.requests) {
    assert.equal(request.url.startsWith(DRIVE_UPLOAD_URL), true, request.url);
    assert.equal(/[?&]fileId=|\/files\/[^?]/.test(request.url), false, '不得指定既有檔案 id');
    const { metadata, media, parts } = parseMultipart(request);
    assert.match(request.headers['Content-Type'], /^multipart\/related; boundary=/);
    assert.match(parts[0].head, /Content-Type: application\/json/);
    assert.deepEqual(metadata.parents, ['appDataFolder']);
    assert.equal(media, BACKUP_TEXT);
    assert.deepEqual(Object.keys(metadata.appProperties).sort(), ['deviceLabel', 'exportId', 'exportedAt', 'schemaVersion']);
    assert.equal(metadata.appProperties.schemaVersion, '2');
    assert.equal(metadata.appProperties.exportedAt, String(NOW));
    assert.equal(metadata.appProperties.deviceLabel, '我的筆電');
  }
  assert.notEqual(parseMultipart(h.requests[0]).metadata.name, parseMultipart(h.requests[1]).metadata.name);
  assert.equal(h.requests.some(r => ['PATCH', 'PUT', 'DELETE'].includes(r.method)), false);
});

test('G03 newExportId 每次不同且只含查詢安全字元', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newExportId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{16,64}$/);
});

test('G03 上傳前檢查：超過 10 MiB bytes 拋 BACKUP_SIZE_LIMIT、非備份 JSON 拋 INVALID_BACKUP，皆不發請求', async () => {
  const h = await driveHarness(createdResponse);
  const multibyte = '中'.repeat(Math.ceil((BACKUP_JSON_MAX_BYTES + 1) / 3));
  assert.ok(multibyte.length < BACKUP_JSON_MAX_BYTES, '以 bytes 計算而非字元數');
  await assert.rejects(h.drive.uploadSnapshot(uploadArgs(newExportId(), { text: multibyte })), { code: 'BACKUP_SIZE_LIMIT' });
  for (const text of ['', 'not json', '[]', JSON.stringify({ format: 'other' }), null]) {
    await assert.rejects(h.drive.uploadSnapshot(uploadArgs(newExportId(), { text })), { code: 'INVALID_BACKUP' });
  }
  for (const exportId of ['', "x' or name contains 'a", 'a b', 'x'.repeat(200), undefined]) {
    await assert.rejects(h.drive.uploadSnapshot(uploadArgs(exportId)), { code: 'INVALID_BACKUP' });
  }
  await assert.rejects(h.drive.uploadSnapshot(uploadArgs(newExportId(), { schemaVersion: 'x' })), { code: 'INVALID_BACKUP' });
  await assert.rejects(h.drive.uploadSnapshot(uploadArgs(newExportId(), { exportedAt: -1 })), { code: 'INVALID_BACKUP' });
  assert.equal(h.requests.length, 0);
});

test('G03 deviceLabel 去除控制字元、最長 40 字且 appProperties 不超過 Drive 位元組上限', async () => {
  assert.equal(sanitizeDeviceLabel('  客廳\u0000平板\n\u007f‎  '), '客廳平板');
  assert.equal(Array.from(sanitizeDeviceLabel('a'.repeat(80))).length, 40);
  const wide = sanitizeDeviceLabel('漢'.repeat(80));
  assert.ok(Array.from(wide).length <= 40);
  assert.ok(new TextEncoder().encode(`deviceLabel${wide}`).byteLength <= 124);
  assert.equal(sanitizeDeviceLabel(undefined), '');
  const h = await driveHarness(createdResponse);
  await h.drive.uploadSnapshot(uploadArgs(newExportId(), { deviceLabel: `手機\r\n${'x'.repeat(100)}` }));
  const label = parseMultipart(h.requests[0]).metadata.appProperties.deviceLabel;
  assert.equal(/[\u0000-\u001f]/.test(label), false);
  assert.ok(Array.from(label).length <= 40);
});

test('G03 上傳 403 配額不足時拋 GOOGLE_QUOTA，不視為未知、下次也不先查詢', async () => {
  let quota = true;
  const h = await driveHarness((request) => (quota ? errorResponse(403, 'storageQuotaExceeded') : createdResponse(request)));
  const exportId = newExportId();
  await assert.rejects(h.drive.uploadSnapshot(uploadArgs(exportId)), (error) => {
    assertNoToken(error);
    return error.code === 'GOOGLE_QUOTA';
  });
  quota = false;
  const result = await h.drive.uploadSnapshot(uploadArgs(exportId));
  assert.equal(result.status, 'created');
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'POST']);
});

/* ── G04 清單分頁 ─────────────────────────────────────── */

test('G04 清單按需分頁：固定端點、appDataFolder、createdTime desc、pageSize ≤ 100、只取必要欄位', async () => {
  const pages = {
    '': { nextPageToken: 'page-2', files: [
      { id: 'f1', name: 'a.json', createdTime: '2026-10-07T01:00:00Z', size: '120',
        appProperties: { exportId: 'exp-1', schemaVersion: '2', exportedAt: String(NOW), deviceLabel: '筆電' } },
      { id: '../evil', name: 'bad.json', createdTime: '2026-10-07T00:00:00Z' },
    ] },
    'page-2': { files: [{ id: 'f2', name: 'b.json', createdTime: '2026-10-06T01:00:00Z', size: '80', appProperties: {} }] },
  };
  const h = await driveHarness((request) => {
    const url = new URL(request.url);
    return json(pages[url.searchParams.get('pageToken') ?? '']);
  });
  const first = await h.drive.listSnapshots();
  assert.equal(first.nextPageToken, 'page-2');
  assert.deepEqual(first.snapshots.map(s => s.id), ['f1'], '非法 id 不進入清單');
  assert.deepEqual(first.snapshots[0], {
    id: 'f1', name: 'a.json', createdTime: '2026-10-07T01:00:00Z', size: 120,
    exportId: 'exp-1', schemaVersion: 2, exportedAt: NOW, deviceLabel: '筆電',
  });
  const second = await h.drive.listSnapshots({ pageToken: first.nextPageToken });
  assert.equal(second.nextPageToken, null);
  assert.deepEqual(second.snapshots.map(s => s.id), ['f2']);
  assert.equal(second.snapshots[0].exportId, null);
  await h.drive.listSnapshots({ pageSize: 500 });
  assert.equal(h.requests.length, 3, '只在呼叫時取下一頁，不一次全抓');
  for (const request of h.requests) {
    const url = new URL(request.url);
    assert.equal(`${url.origin}${url.pathname}`, DRIVE_FILES_URL);
    assert.equal(request.method, 'GET');
    assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
    assert.equal(url.searchParams.get('orderBy'), 'createdTime desc');
    assert.ok(Number(url.searchParams.get('pageSize')) <= 100);
    assert.equal(url.searchParams.get('fields'), 'nextPageToken,files(id,name,createdTime,size,appProperties)');
  }
  assert.equal(new URL(h.requests[1].url).searchParams.get('pageToken'), 'page-2');
  assert.equal(new URL(h.requests[2].url).searchParams.get('pageSize'), '100');
});

test('G04 清單請求中切換帳號：晚到的 A 清單回 GOOGLE_STALE_SESSION，不顯示給 B', async () => {
  const gate = deferred();
  const h = await driveHarness(async () => { await gate.promise; return json({ files: [{ id: 'fromA', name: 'a' }] }); });
  const pending = h.drive.listSnapshots();
  await flush();
  await h.connect(TOKEN_B);
  gate.resolve();
  await assert.rejects(pending, { code: 'GOOGLE_STALE_SESSION' });
});

/* ── G08 上傳結果未知 ─────────────────────────────────── */

test('G08 上傳逾時回傳 { status: "unknown" }，不宣稱成功', async () => {
  const h = await driveHarness(abortableNever, { timeoutMs: 20 });
  const exportId = newExportId();
  const result = await h.drive.uploadSnapshot(uploadArgs(exportId));
  assert.deepEqual(result, { status: 'unknown', exportId });
  assert.equal(h.requests.length, 1);
});

test('G08 未知結果再次備份：先以 exportId 查詢 appDataFolder，找到就回報已存在且不重送', async () => {
  let mode = 'timeout';
  const exportId = newExportId();
  const h = await driveHarness((request) => {
    if (request.method === 'POST') return mode === 'timeout' ? abortableNever(request) : createdResponse(request);
    return json({ files: [{ id: 'existing_1', name: 'x.json', createdTime: '2026-10-07T00:00:00Z', size: '10',
      appProperties: { exportId, schemaVersion: '2', exportedAt: String(NOW), deviceLabel: '筆電' } }] });
  }, { timeoutMs: 20 });
  assert.equal((await h.drive.uploadSnapshot(uploadArgs(exportId))).status, 'unknown');
  mode = 'ok';
  const retry = await h.drive.uploadSnapshot(uploadArgs(exportId));
  assert.equal(retry.status, 'exists');
  assert.equal(retry.snapshot.id, 'existing_1');
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'GET']);
  const url = new URL(h.requests[1].url);
  assert.equal(`${url.origin}${url.pathname}`, DRIVE_FILES_URL);
  assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
  assert.equal(url.searchParams.get('q'), `appProperties has { key='exportId' and value='${exportId}' }`);
});

test('G08 未知結果再次備份但查無檔案：查詢後才重送，成功後回 created', async () => {
  let mode = 'offline';
  const h = await driveHarness((request) => {
    if (request.method === 'POST') {
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      return createdResponse(request);
    }
    return json({ files: [] });
  });
  const exportId = newExportId();
  assert.deepEqual(await h.drive.uploadSnapshot(uploadArgs(exportId)), { status: 'unknown', exportId });
  mode = 'ok';
  const retry = await h.drive.uploadSnapshot(uploadArgs(exportId));
  assert.equal(retry.status, 'created');
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'GET', 'POST']);
  await h.drive.uploadSnapshot(uploadArgs(exportId));
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'GET', 'POST', 'POST'], '已確認成功後不再列為未知');
});

test('G08 伺服器 5xx 也視為結果未知；findByExportId 可列出重複的同一次匯出', async () => {
  const exportId = newExportId();
  const h = await driveHarness((request) => {
    if (request.method === 'POST') return errorResponse(503, 'backendError');
    return json({ files: [
      { id: 'dup_1', name: 'a', appProperties: { exportId } },
      { id: 'dup_2', name: 'a', appProperties: { exportId } },
    ] });
  });
  assert.deepEqual(await h.drive.uploadSnapshot(uploadArgs(exportId)), { status: 'unknown', exportId });
  const found = await h.drive.findByExportId(exportId);
  assert.deepEqual(found.map(s => s.id), ['dup_1', 'dup_2']);
  assert.equal(found.every(s => s.exportId === exportId), true);
  await assert.rejects(h.drive.findByExportId("x' or trashed = true or 'a"), { code: 'INVALID_BACKUP' });
});

test('G08 上傳途中切換帳號：回 GOOGLE_STALE_SESSION 並標明結果未知，再試同 exportId 會先查詢', async () => {
  const gate = deferred();
  let first = true;
  const h = await driveHarness(async (request) => {
    if (request.method === 'POST' && first) { first = false; await gate.promise; return createdResponse(request); }
    if (request.method === 'GET') return json({ files: [] });
    return createdResponse(request);
  });
  const exportId = newExportId();
  const pending = h.drive.uploadSnapshot(uploadArgs(exportId));
  await flush();
  await h.connect(TOKEN_B);
  gate.resolve();
  await assert.rejects(pending, (error) => error.code === 'GOOGLE_STALE_SESSION' &&
    error.details.outcome === 'unknown' && error.details.exportId === exportId);
  await h.drive.uploadSnapshot(uploadArgs(exportId));
  assert.deepEqual(h.requests.map(r => r.method), ['POST', 'GET', 'POST']);
});

/* ── G09 資料與網路邊界 ───────────────────────────────── */

test('G09 下載用串流累計 bytes，超過 10 MiB 立即 cancel 並回 BACKUP_SIZE_LIMIT', async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  const h = await driveHarness(() => new Response(new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls > 40) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { status: 200 }));
  await assert.rejects(h.drive.downloadSnapshot('file_1'), (error) => {
    assertNoToken(error);
    return error.code === 'BACKUP_SIZE_LIMIT';
  });
  assert.equal(cancelled, true, '超限必須取消串流');
  assert.ok(pulls <= 13, `不得讀完整內容才檢查，實際讀了 ${pulls} 塊`);
});

test('G09 Content-Length 已超限時不讀內容；沒有 body 時先看 Content-Length 再 text()', async () => {
  let textCalls = 0;
  let cancelled = false;
  let length = BACKUP_JSON_MAX_BYTES + 1;
  const h = await driveHarness(() => ({
    ok: true, status: 200, headers: new Headers({ 'Content-Length': String(length) }), body: null,
    text: async () => { textCalls += 1; return BACKUP_TEXT; },
  }));
  await assert.rejects(h.drive.downloadSnapshot('file_1'), { code: 'BACKUP_SIZE_LIMIT' });
  assert.equal(textCalls, 0);
  length = BACKUP_TEXT.length;
  const result = await h.drive.downloadSnapshot('file_1');
  assert.equal(result.text, BACKUP_TEXT);
  assert.equal(textCalls, 1);

  const streamed = await driveHarness(() => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(10)); },
    cancel() { cancelled = true; },
  }), { status: 200, headers: { 'Content-Length': String(BACKUP_JSON_MAX_BYTES + 5) } }));
  await assert.rejects(streamed.drive.downloadSnapshot('file_1'), { code: 'BACKUP_SIZE_LIMIT' });
  assert.equal(cancelled, true);
});

test('G09 正常下載只回傳固定 bytes 文字，URL 固定為 files/{id}?alt=media', async () => {
  const text = JSON.stringify({ format: 'lang-learn.backup', version: 2, exportedAt: NOW, note: '日本語' });
  const h = await driveHarness(() => new Response(text, { status: 200 }));
  const result = await h.drive.downloadSnapshot('abc_DEF-123');
  assert.equal(result.text, text);
  assert.equal(result.fileId, 'abc_DEF-123');
  assert.equal(result.byteLength, new TextEncoder().encode(text).byteLength);
  assert.deepEqual(Object.keys(result).sort(), ['byteLength', 'fileId', 'text']);
  assert.deepEqual(h.requests.map(r => [r.method, r.url]), [['GET', `${DRIVE_FILES_URL}/abc_DEF-123?alt=media`]]);
});

test('G09 下載內容不是合法 UTF-8 時回 INVALID_BACKUP', async () => {
  const h = await driveHarness(() => new Response(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), { status: 200 }));
  await assert.rejects(h.drive.downloadSnapshot('file_1'), { code: 'INVALID_BACKUP' });
});

test('G09 fileId 注入 ../、完整 URL、斜線或查詢字串一律拒絕且不發請求', async () => {
  const h = await driveHarness(() => new Response(BACKUP_TEXT, { status: 200 }));
  const bad = ['../x', '..', 'https://evil.example.com/x', 'a/b', '', 'a'.repeat(257), 'abc?alt=json', '%2e%2e', 'abc#x', 'a b', null, 42];
  for (const fileId of bad) {
    await assert.rejects(h.drive.downloadSnapshot(fileId), { code: 'GOOGLE_INVALID_FILE_ID' }, String(fileId));
  }
  assert.equal(h.requests.length, 0);
});

test('G09 HTTP 錯誤對應：429／403 限流、403 配額、403 缺 scope、離線，各自 code 且不自動重試、不洩 token', async () => {
  const cases = [
    [() => errorResponse(429, 'rateLimitExceeded', { 'Retry-After': '30' }), 'GOOGLE_RATE_LIMITED'],
    [() => errorResponse(403, 'rateLimitExceeded'), 'GOOGLE_RATE_LIMITED'],
    [() => errorResponse(403, 'userRateLimitExceeded'), 'GOOGLE_RATE_LIMITED'],
    [() => errorResponse(403, 'storageQuotaExceeded'), 'GOOGLE_QUOTA'],
    [() => errorResponse(403, 'insufficientPermissions'), 'GOOGLE_SCOPE_MISSING'],
    [() => json({ error: { code: 403, status: 'PERMISSION_DENIED',
      details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 403), 'GOOGLE_SCOPE_MISSING'],
    [() => { throw new TypeError(`Failed to fetch ${TOKEN}`); }, 'GOOGLE_OFFLINE'],
  ];
  for (const [respond, code] of cases) {
    for (const action of ['list', 'download']) {
      const h = await driveHarness(respond);
      const run = action === 'list' ? h.drive.listSnapshots() : h.drive.downloadSnapshot('file_1');
      await assert.rejects(run, (error) => {
        assertNoToken(error);
        return error.code === code;
      }, `${action} ${code}`);
      assert.equal(h.requests.length, 1, '不得自動重試');
      assert.equal(h.auth.status().connected, true, '非 401 錯誤不清授權');
    }
  }
  const limited = await driveHarness(() => errorResponse(429, 'rateLimitExceeded', { 'Retry-After': '30' }));
  await assert.rejects(limited.drive.listSnapshots(), (error) => error.details.retryAfterSeconds === 30);
});

test('G09 API 回 401：拋 GOOGLE_AUTH_EXPIRED、清除授權，要求重新連接', async () => {
  for (const action of ['list', 'upload', 'download']) {
    const h = await driveHarness(() => errorResponse(401, 'authError'));
    const run = action === 'list' ? h.drive.listSnapshots()
      : action === 'upload' ? h.drive.uploadSnapshot(uploadArgs(newExportId()))
        : h.drive.downloadSnapshot('file_1');
    await assert.rejects(run, (error) => {
      assertNoToken(error);
      return error.code === 'GOOGLE_AUTH_EXPIRED';
    });
    assert.equal(h.auth.status().connected, false);
    assert.equal(h.requests.length, 1);
  }
});

test('G09 token 只送往固定 Google 端點；所有請求都是 https://www.googleapis.com 且附 Bearer', async () => {
  const exportId = newExportId();
  const h = await driveHarness((request) => {
    if (request.method === 'POST') return createdResponse(request);
    if (request.url.includes('alt=media')) return new Response(BACKUP_TEXT, { status: 200 });
    return json({ files: [] });
  });
  await h.drive.listSnapshots();
  await h.drive.findByExportId(exportId);
  await h.drive.uploadSnapshot(uploadArgs(exportId));
  await h.drive.downloadSnapshot('file_9');
  assert.equal(h.requests.length, 4);
  for (const request of h.requests) {
    assert.equal(new URL(request.url).origin, 'https://www.googleapis.com');
    assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(request.url.includes(TOKEN), false);
  }
  assert.equal(DRIVE_FILES_URL, 'https://www.googleapis.com/drive/v3/files');
  assert.equal(DRIVE_UPLOAD_URL, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
});

test('G09 下載進行中切換帳號：晚到內容被丟棄並回 GOOGLE_STALE_SESSION', async () => {
  const gate = deferred();
  const h = await driveHarness(async () => { await gate.promise; return new Response(BACKUP_TEXT, { status: 200 }); });
  const pending = h.drive.downloadSnapshot('file_1');
  await flush();
  await h.auth.disconnect();
  gate.resolve();
  await assert.rejects(pending, { code: 'GOOGLE_STALE_SESSION' });
});
