import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_CONFIG } from '../assets/js/config/google.js';
import {
  createGoogleWebAuth, GOOGLE_GSI_URL, GOOGLE_SCOPES, DRIVE_APPDATA_SCOPE, GOOGLE_USERINFO_URL, isAllowedGoogleUrl,
} from '../assets/js/ui/platform/google-web-auth.js';

/**
 * 測試用的假 token；真實程式不得把它寫進狀態快照、錯誤訊息或任何持久儲存。
 */
const TOKEN_A = 'ya29.SECRET-TOKEN-AAAA';
const TOKEN_B = 'ya29.SECRET-TOKEN-BBBB';
const FULL_SCOPE = `${DRIVE_APPDATA_SCOPE} openid https://www.googleapis.com/auth/userinfo.email`;
const EMAILS = { [TOKEN_A]: 'alice@example.com', [TOKEN_B]: 'bob@example.com' };
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

/**
 * 假的 Google Identity Services：只記錄呼叫，callback 由測試手動觸發。
 */
function fakeGoogle({ revokeThrows = false } = {}) {
  const calls = { init: [], request: [], revoke: [] };
  let client = null;
  const google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      calls.init.push(cfg);
      client = { requestAccessToken(options) { calls.request.push(options); } };
      return client;
    },
    revoke(token, done) {
      calls.revoke.push(token);
      if (revokeThrows) throw new Error('revoke failed');
      done?.({ successful: true });
    },
  } } };
  return {
    google,
    calls,
    respond: (response) => calls.init.at(-1).callback(response),
    fail: (error) => calls.init.at(-1).error_callback(error),
  };
}

function userinfoResponse(init) {
  const auth = init?.headers?.Authorization ?? '';
  const token = auth.replace(/^Bearer /, '');
  return new Response(JSON.stringify({ sub: token, email: EMAILS[token] ?? 'x@example.com' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function harness(options = {}) {
  const { fetchImpl, revokeThrows, loadImpl, now } = options;
  const webClientId = 'webClientId' in options ? options.webClientId : 'web-client.apps.googleusercontent.com';
  const g = fakeGoogle({ revokeThrows });
  const loads = [];
  const fetches = [];
  const changes = [];
  let loaded = false;
  const auth = createGoogleWebAuth({
    config: { webClientId, windowsClientId: '', androidClientId: '', iosClientId: '' },
    loadScript: async (url) => {
      loads.push(url);
      if (loadImpl) await loadImpl(url);
      loaded = true;
    },
    getGoogle: () => (loaded ? g.google : undefined),
    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (String(url) === GOOGLE_USERINFO_URL) return userinfoResponse(init);
      return (fetchImpl ?? (async () => new Response('{}', { status: 200 })))(url, init);
    },
    onChange: (status) => changes.push(status),
    now,
  });
  return { auth, g, loads, fetches, changes };
}

async function connectWith(h, response) {
  const pending = h.auth.connect();
  await flush();
  h.g.respond(response);
  return pending;
}

const connectOk = (h, token = TOKEN_A) =>
  connectWith(h, { access_token: token, expires_in: 3599, scope: FULL_SCOPE, token_type: 'Bearer' });

function assertNoToken(error, ...tokens) {
  const text = [error?.message, JSON.stringify(error?.details ?? {}), String(error?.stack ?? ''), String(error)].join('\n');
  for (const token of tokens) assert.equal(text.includes(token), false, `錯誤內容洩漏 token：${error?.code}`);
}

/* ── G01 空設定 ─────────────────────────────────────────── */

test('G01 預設 GOOGLE_CONFIG 四個 Client ID 全部留空、已凍結，且沒有 secret／API key 欄位', () => {
  assert.deepEqual({ ...GOOGLE_CONFIG }, { webClientId: '', windowsClientId: '', androidClientId: '', iosClientId: '' });
  assert.equal(Object.isFrozen(GOOGLE_CONFIG), true);
  assert.equal(Object.keys(GOOGLE_CONFIG).some(key => /secret|apikey|api_key/i.test(key)), false);
});

test('G01 Client ID 留空（含只有空白）時顯示未設定、connect 拋 GOOGLE_NOT_CONFIGURED，且不載入 SDK、不發任何請求', async () => {
  for (const webClientId of ['', '   ', undefined]) {
    const h = harness({ webClientId });
    assert.deepEqual(h.auth.status(), { configured: false, connected: false, email: '', generation: 0 });
    await assert.rejects(h.auth.connect(), (error) => error.code === 'GOOGLE_NOT_CONFIGURED' && /尚未設定/.test(error.message));
    await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), { code: 'GOOGLE_NOT_CONNECTED' });
    h.auth.disconnect();
    assert.equal(h.loads.length, 0, '未設定時不得載入 Google SDK');
    assert.equal(h.fetches.length, 0, '未設定時不得發任何請求');
    assert.equal(h.g.calls.init.length, 0);
  }
});

test('G01 即使已設定 Client ID，建立 adapter 與查狀態也不載入 SDK，只有按連接才載入', async () => {
  const h = harness();
  assert.equal(h.auth.status().configured, true);
  assert.equal(h.auth.status().connected, false);
  await flush();
  assert.equal(h.loads.length, 0);
  assert.equal(h.fetches.length, 0);
});

/* ── G02 主動授權與帳號 ─────────────────────────────────── */

test('G02 接受授權：固定網址載入 SDK 一次、只要求 drive.appdata 與 openid email，並以 userinfo 顯示確認帳號', async () => {
  const h = harness();
  const status = await connectOk(h);
  assert.deepEqual(h.loads, [GOOGLE_GSI_URL]);
  assert.equal(GOOGLE_GSI_URL, 'https://accounts.google.com/gsi/client');
  assert.equal(h.g.calls.init.length, 1);
  const cfg = h.g.calls.init[0];
  assert.equal(cfg.client_id, 'web-client.apps.googleusercontent.com');
  assert.equal(cfg.scope, GOOGLE_SCOPES);
  assert.deepEqual(GOOGLE_SCOPES.split(' ').sort(), ['email', 'https://www.googleapis.com/auth/drive.appdata', 'openid']);
  assert.equal(/auth\/drive(\s|$)|drive\.file|drive\.readonly/.test(cfg.scope), false, '不得要求完整 Drive 權限');
  assert.equal('client_secret' in cfg, false);
  assert.equal(h.g.calls.request.length, 1);
  assert.equal(status.connected, true);
  assert.equal(status.email, 'alice@example.com');
  assert.deepEqual(h.fetches.map(item => item.url), [GOOGLE_USERINFO_URL]);
  assert.equal(h.fetches[0].init.headers.Authorization, `Bearer ${TOKEN_A}`);
  assert.equal(h.changes.at(-1).email, 'alice@example.com');

  await h.auth.disconnect();
  await connectOk(h, TOKEN_B);
  assert.equal(h.loads.length, 1, 'SDK 只載入一次');
  assert.equal(h.auth.status().email, 'bob@example.com');
});

test('G02 使用者拒絕（access_denied）回 GOOGLE_DENIED，不連線也不打 userinfo', async () => {
  const h = harness();
  await assert.rejects(connectWith(h, { error: 'access_denied' }), (error) =>
    error.code === 'GOOGLE_DENIED' && /拒絕/.test(error.message));
  assert.equal(h.auth.status().connected, false);
  assert.equal(h.fetches.length, 0);
});

test('G02 使用者關閉授權視窗（popup_closed）回 GOOGLE_CANCELLED，可再重試', async () => {
  const h = harness();
  const pending = h.auth.connect();
  await flush();
  h.g.fail({ type: 'popup_closed', message: 'Popup window closed' });
  await assert.rejects(pending, (error) => error.code === 'GOOGLE_CANCELLED' && /取消/.test(error.message));
  assert.equal(h.auth.status().connected, false);
  assert.equal(h.fetches.length, 0);
  const status = await connectOk(h);
  assert.equal(status.connected, true);
});

test('G02 未授予 drive.appdata 時回 GOOGLE_SCOPE_MISSING，撤銷並丟棄 token', async () => {
  const h = harness();
  await assert.rejects(connectWith(h, { access_token: TOKEN_A, expires_in: 3599, scope: 'openid email' }), (error) => {
    assertNoToken(error, TOKEN_A);
    return error.code === 'GOOGLE_SCOPE_MISSING';
  });
  assert.deepEqual(h.g.calls.revoke, [TOKEN_A]);
  assert.equal(h.auth.status().connected, false);
  assert.equal(h.fetches.length, 0, '缺 scope 不得拿 token 打任何 API');
  await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), { code: 'GOOGLE_NOT_CONNECTED' });
});

test('G02 userinfo 沒有 email 時視為帳號未確認，不進入已連接', async () => {
  const g = fakeGoogle();
  let loaded = false;
  const auth = createGoogleWebAuth({
    config: { webClientId: 'id' },
    loadScript: async () => { loaded = true; },
    getGoogle: () => (loaded ? g.google : undefined),
    fetch: async () => new Response(JSON.stringify({ sub: '1' }), { status: 200 }),
  });
  const second = auth.connect();
  await flush();
  g.respond({ access_token: TOKEN_A, expires_in: 3599, scope: FULL_SCOPE });
  await assert.rejects(second, { code: 'GOOGLE_SCOPE_MISSING' });
  assert.equal(auth.status().connected, false);
  assert.deepEqual(g.calls.revoke, [TOKEN_A]);
});

test('G02 SDK 載入失敗回 GOOGLE_OFFLINE，之後可重新載入', async () => {
  let fail = true;
  const h = harness({ loadImpl: async () => { if (fail) throw new Error('script error'); } });
  await assert.rejects(h.auth.connect(), { code: 'GOOGLE_OFFLINE' });
  fail = false;
  const status = await connectOk(h);
  assert.equal(status.connected, true);
  assert.equal(h.loads.length, 2);
});

/* ── G05 token 及授權失效 ──────────────────────────────── */

test('G05 token 只在記憶體：不碰 localStorage／sessionStorage／indexedDB，狀態快照與事件不含 token', async () => {
  const touched = [];
  const names = ['localStorage', 'sessionStorage', 'indexedDB'];
  const saved = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const name of names) {
    Object.defineProperty(globalThis, name, { configurable: true, get() { touched.push(name); return undefined; } });
  }
  try {
    const h = harness();
    await connectOk(h);
    await h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder');
    await h.auth.disconnect();
    assert.deepEqual(touched, [], '不得存取持久儲存');
    const snapshot = JSON.stringify([h.auth.status(), h.changes]);
    assert.equal(snapshot.includes(TOKEN_A), false);
    for (const item of h.fetches) assert.equal(String(item.url).includes(TOKEN_A), false, 'token 不得出現在 URL');
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('G05 API 回 401 時清除狀態、世代 +1、拋 GOOGLE_AUTH_EXPIRED，不自動重試且錯誤不含 token', async () => {
  const h = harness({ fetchImpl: async () => new Response('{"error":{"code":401}}', { status: 401 }) });
  await connectOk(h);
  const before = h.auth.status().generation;
  const count = h.fetches.length;
  await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), (error) => {
    assertNoToken(error, TOKEN_A);
    return error.code === 'GOOGLE_AUTH_EXPIRED' && /重新連接/.test(error.message);
  });
  assert.equal(h.fetches.length, count + 1, '401 不得自動重試');
  assert.deepEqual(h.auth.status(), { configured: true, connected: false, email: '', generation: before + 1 });
  await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), { code: 'GOOGLE_NOT_CONNECTED' });
  assert.equal(h.fetches.length, count + 1);
});

test('G05 token 到期後不再送出請求，直接要求重新連接', async () => {
  let clock = 1_000_000;
  const h = harness({ now: () => clock });
  await connectOk(h);
  const count = h.fetches.length;
  clock += 3600 * 1000;
  await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), { code: 'GOOGLE_AUTH_EXPIRED' });
  assert.equal(h.fetches.length, count);
  assert.equal(h.auth.status().connected, false);
});

test('G05 斷線時撤銷 token 並清本地；revoke 拋錯也照樣清除', async () => {
  for (const revokeThrows of [false, true]) {
    const h = harness({ revokeThrows });
    await connectOk(h);
    const generation = h.auth.status().generation;
    await h.auth.disconnect();
    assert.deepEqual(h.g.calls.revoke, [TOKEN_A]);
    assert.deepEqual(h.auth.status(), { configured: true, connected: false, email: '', generation: generation + 1 });
    assert.equal(h.auth.currentGeneration(), generation + 1);
    await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), { code: 'GOOGLE_NOT_CONNECTED' });
  }
});

test('G05 authorizedFetch 只對固定 Google 網域附 Bearer，其餘 URL 不呼叫 fetch 直接拒絕', async () => {
  const h = harness();
  await connectOk(h);
  const count = h.fetches.length;
  const rejected = [
    'https://evil.example.com/drive/v3/files',
    'http://www.googleapis.com/drive/v3/files',
    'https://www.googleapis.com.evil.com/drive/v3/files',
    'https://user@www.googleapis.com/drive/v3/files',
    'https://www.googleapis.com:8443/drive/v3/files',
    'https://www.googleapis.com/oauth2/v4/token',
    'https://www.googleapis.com/drive/v3/files/../../oauth2/v4/token',
    'https://www.googleapis.com/drive/v3/about',
    'https://accounts.google.com/gsi/client',
    '/drive/v3/files',
    'javascript:alert(1)',
    42,
  ];
  for (const url of rejected) {
    assert.equal(isAllowedGoogleUrl(url), false, String(url));
    await assert.rejects(h.auth.authorizedFetch(url), (error) => {
      assertNoToken(error, TOKEN_A);
      return error.code === 'GOOGLE_URL_REJECTED';
    });
  }
  assert.equal(h.fetches.length, count, '被拒的 URL 不得發出請求');
  for (const url of [
    'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder',
    'https://www.googleapis.com/drive/v3/files/abc_DEF-123?alt=media',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    GOOGLE_USERINFO_URL,
  ]) {
    assert.equal(isAllowedGoogleUrl(url), true, url);
    await h.auth.authorizedFetch(url, { headers: { Accept: 'application/json' } });
    const sent = h.fetches.at(-1);
    assert.equal(sent.init.headers.Authorization, `Bearer ${TOKEN_A}`);
    assert.equal(sent.init.headers.Accept, 'application/json');
    assert.equal(sent.init.credentials, 'omit');
  }
});

test('G05 網路中斷（fetch 拋 TypeError）回 GOOGLE_OFFLINE，且錯誤不含 token', async () => {
  const h = harness({ fetchImpl: async () => { throw new TypeError(`Failed to fetch with Bearer ${TOKEN_A}`); } });
  await connectOk(h);
  await assert.rejects(h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files'), (error) => {
    assertNoToken(error, TOKEN_A);
    return error.code === 'GOOGLE_OFFLINE';
  });
  assert.equal(h.auth.status().connected, true, '離線不清授權，可稍後重試');
});

/* ── G06 切帳號與晚到結果 ──────────────────────────────── */

test('G06 授權視窗未完成就斷線：connect 回 GOOGLE_STALE_SESSION，晚到的 token 被撤銷且不採用', async () => {
  const h = harness();
  const pending = h.auth.connect();
  await flush();
  await h.auth.disconnect();
  h.g.respond({ access_token: TOKEN_A, expires_in: 3599, scope: FULL_SCOPE });
  await assert.rejects(pending, { code: 'GOOGLE_STALE_SESSION' });
  assert.equal(h.auth.status().connected, false);
  assert.ok(h.g.calls.revoke.includes(TOKEN_A));
  assert.equal(h.fetches.length, 0, '晚到 token 不得拿去打 userinfo');
});

test('G06 userinfo 尚未回來就斷線：不把晚到帳號設為已連接', async () => {
  const gate = deferred();
  const g = fakeGoogle();
  let loaded = false;
  const auth = createGoogleWebAuth({
    config: { webClientId: 'id' },
    loadScript: async () => { loaded = true; },
    getGoogle: () => (loaded ? g.google : undefined),
    fetch: async () => { await gate.promise; return new Response(JSON.stringify({ email: 'alice@example.com' }), { status: 200 }); },
  });
  const pending = auth.connect();
  await flush();
  g.respond({ access_token: TOKEN_A, expires_in: 3599, scope: FULL_SCOPE });
  await flush();
  await auth.disconnect();
  gate.resolve();
  await assert.rejects(pending, { code: 'GOOGLE_STALE_SESSION' });
  assert.equal(auth.status().connected, false);
  assert.equal(auth.status().email, '');
});

test('G06 請求進行中斷線：晚到的回應被丟棄並回 GOOGLE_STALE_SESSION', async () => {
  const gate = deferred();
  const h = harness({ fetchImpl: async () => { await gate.promise; return new Response('{"files":[]}', { status: 200 }); } });
  await connectOk(h);
  const pending = h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files');
  await flush();
  await h.auth.disconnect();
  gate.resolve();
  await assert.rejects(pending, { code: 'GOOGLE_STALE_SESSION' });
});

test('G06 A 帳號請求未完成時切到 B：A 的結果不能被當成 B 的，世代遞增且顯示 B 帳號', async () => {
  const gate = deferred();
  const h = harness({ fetchImpl: async () => { await gate.promise; return new Response('{"files":[]}', { status: 200 }); } });
  await connectOk(h, TOKEN_A);
  const generationA = h.auth.currentGeneration();
  const pendingA = h.auth.authorizedFetch('https://www.googleapis.com/drive/v3/files');
  await flush();
  const statusB = await connectOk(h, TOKEN_B);
  assert.equal(statusB.email, 'bob@example.com');
  assert.ok(statusB.generation > generationA);
  gate.resolve();
  await assert.rejects(pendingA, { code: 'GOOGLE_STALE_SESSION' });
  assert.equal(h.auth.status().email, 'bob@example.com');
});

test('G06 連續按兩次連接：前一次授權被作廢回 GOOGLE_STALE_SESSION', async () => {
  const h = harness();
  const first = assert.rejects(h.auth.connect(), { code: 'GOOGLE_STALE_SESSION' });
  await flush();
  const second = h.auth.connect();
  await flush();
  await first;
  h.g.respond({ access_token: TOKEN_B, expires_in: 3599, scope: FULL_SCOPE });
  const status = await second;
  assert.equal(status.email, 'bob@example.com');
});
