/**
 * T11（A13）：機密只留在伺服器。
 * 用固定的假 secret 跑完整的登入、同步、登出與刪除流程，攔截 console 輸出，
 * 掃描每個回應的 body 與標頭（含導回網址）：不得出現 Client Secret、授權碼、Google access token／id_token，
 * session token 只能出現在 Set-Cookie。另掃描 assets/ 前端原始碼不得出現 client_secret 或 token 端點網址。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createTestDb, workerEnv, sessionTokenFrom, ROOT, TEST_SITE } from './helpers/worker-env.mjs';
import { startFakeGoogle } from './helpers/fake-google.mjs';
import worker from '../worker/src/index.js';

const FAKE_SECRET = 'A13-fixed-fake-client-secret-0123456789';
const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);
const NOW_SEC = Math.floor(FIXED_NOW / 1000);

let ctx;
let DB;
let google;

before(async () => {
  ctx = await createTestDb();
  DB = ctx.env.DB;
  google = await startFakeGoogle({ clientId: workerEnv(DB).GOOGLE_CLIENT_ID, clientSecret: FAKE_SECRET });
  google.setClaimOverrides({ exp: NOW_SEC + 3600 });
});

after(async () => {
  await google?.close();
  await ctx?.dispose();
});

/**
 * 在 fn 執行期間攔截全部 console 輸出，回傳 { result, lines }。
 */
async function captureConsole(fn) {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const original = Object.fromEntries(methods.map((name) => [name, console[name]]));
  const lines = [];
  for (const name of methods) {
    console[name] = (...args) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : (() => {
        try { return JSON.stringify(arg) ?? String(arg); } catch { return String(arg); }
      })())).join(' '));
    };
  }
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, original);
  }
}

/**
 * 在 text 中找出 needles 中出現的機密，回傳命中的名稱。
 */
function findLeaks(text, needles) {
  return Object.entries(needles).filter(([, value]) => value && text.includes(value)).map(([name]) => name);
}

test('A13 完整流程：回應 body、導回網址與 console 都不含機密原文', async () => {
  const env = workerEnv(DB, { GOOGLE_CLIENT_SECRET: FAKE_SECRET, GOOGLE_OAUTH_BASE: google.base, TEST_NOW: () => FIXED_NOW });
  await DB.prepare("INSERT INTO allowed_emails(email, role, created_at) VALUES ('learner@example.test', 'owner', 1)").run();
  google.setUser({ sub: 'sub-a13', email: 'learner@example.test', email_verified: true });

  const recorded = [];
  const authCodes = [];
  /**
   * 呼叫 Worker 並記錄回應（body 以文字保存，二進位快照不在掃描範圍外另行比對）。
   */
  const send = async (request) => {
    const response = await worker.fetch(request, env, {});
    const body = await response.clone().text();
    recorded.push({ label: `${request.method} ${new URL(request.url).pathname}`, response, body });
    return response;
  };
  const jsonInit = (method, cookie, body, extra = {}) => ({
    method,
    headers: { cookie, origin: TEST_SITE, ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });

  const { lines } = await captureConsole(async () => {
    /**
     * 走一次登入，回傳 session cookie（失敗時為 null）。
     */
    const login = async () => {
      const start = await send(new Request(`${TEST_SITE}/api/auth/start?returnTo=%2Fja%2F`));
      const callbackUrl = await google.authorize(start.headers.get('location'));
      if (callbackUrl.searchParams.get('code')) authCodes.push(callbackUrl.searchParams.get('code'));
      const callback = await send(new Request(callbackUrl.href));
      const token = sessionTokenFrom(callback);
      return token ? `__Host-ll_session=${token}` : null;
    };

    google.setTokenStatus(500);
    await login();
    google.setTokenStatus(200);
    await send(new Request(`${TEST_SITE}/api/auth/callback?code=forged-code&state=forged-state`));

    const cookie = await login();
    assert.ok(cookie);
    await send(new Request(`${TEST_SITE}/api/me`, { headers: { cookie } }));
    await send(new Request(`${TEST_SITE}/api/snapshot/meta`, { headers: { cookie } }));
    await send(new Request(`${TEST_SITE}/api/snapshot`, {
      method: 'PUT',
      headers: { cookie, origin: TEST_SITE, 'if-match': '0', 'x-upload-id': 'up-a13', 'x-schema-version': '2', 'x-device-label': 'laptop' },
      body: new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
    }));
    await send(new Request(`${TEST_SITE}/api/snapshot`, {
      method: 'PUT',
      headers: { cookie, origin: TEST_SITE, 'if-match': '0', 'x-upload-id': 'up-a13b', 'x-schema-version': '2' },
      body: new Uint8Array([1]),
    }));
    await send(new Request(`${TEST_SITE}/api/admin/members`, { headers: { cookie } }));
    await send(new Request(`${TEST_SITE}/api/admin/members`, jsonInit('POST', cookie, { email: 'friend@example.test', nickname: '朋友' })));
    await send(new Request(`${TEST_SITE}/api/auth/logout`, jsonInit('POST', cookie)));
    await send(new Request(`${TEST_SITE}/api/me`, { headers: { cookie } }));

    const second = await login();
    await send(new Request(`${TEST_SITE}/api/snapshot`, { headers: { cookie: second } }));
    await send(new Request(`${TEST_SITE}/api/account`, jsonInit('DELETE', second)));
    await send(new Request(`${TEST_SITE}/api/auth/logout`, jsonInit('POST', second, undefined, { origin: 'https://evil.example' })));
  });

  const sessionTokens = recorded.map(({ response }) => sessionTokenFrom(response)).filter(Boolean);
  assert.ok(sessionTokens.length >= 2, '流程中應發出至少兩個 session token');
  assert.ok(authCodes.length >= 3, '流程中應產生授權碼');
  assert.ok(google.log.issued.length >= 2, '流程中應簽發 id_token');

  const serverOnly = { clientSecret: FAKE_SECRET };
  authCodes.forEach((code, i) => { serverOnly[`authCode${i}`] = code; });
  google.log.issued.forEach(({ idToken, accessToken }, i) => {
    serverOnly[`idToken${i}`] = idToken;
    serverOnly[`idTokenPayload${i}`] = idToken.split('.')[1];
    serverOnly[`accessToken${i}`] = accessToken;
  });
  const cookieOnly = Object.fromEntries(sessionTokens.map((token, i) => [`sessionToken${i}`, token]));

  for (const { label, response, body } of recorded) {
    assert.deepEqual(findLeaks(body, { ...serverOnly, ...cookieOnly }), [], `${label} 回應 body`);
    for (const [name, value] of response.headers) {
      const needles = name === 'set-cookie' ? serverOnly : { ...serverOnly, ...cookieOnly };
      assert.deepEqual(findLeaks(value, needles), [], `${label} 標頭 ${name}`);
    }
  }
  const output = lines.join('\n');
  assert.deepEqual(findLeaks(output, { ...serverOnly, ...cookieOnly }), [], 'console 輸出');
});

test('A13 掃描工具本身會抓到機密（避免測試空轉）', () => {
  assert.deepEqual(findLeaks(`token=${FAKE_SECRET}`, { clientSecret: FAKE_SECRET }), ['clientSecret']);
  assert.deepEqual(findLeaks('nothing here', { clientSecret: FAKE_SECRET }), []);
});

/**
 * 遞迴收集 assets/ 底下的前端原始碼（js、mjs、html、css、json）。
 */
function collectFrontend(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectFrontend(full, out);
    else if (/\.(m?js|html|css|json)$/.test(name)) out.push(full);
  }
  return out;
}

test('A13 前端原始碼不得出現 client_secret 或 Google token 端點', () => {
  const files = [...collectFrontend(join(ROOT, 'assets'))];
  for (const name of readdirSync(ROOT)) {
    if (name.endsWith('.html')) files.push(join(ROOT, name));
  }
  assert.ok(files.length > 10, '應掃描到前端檔案');
  const forbidden = [/client_secret/i, /oauth2\.googleapis\.com\/token/i];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) hits.push(`${relative(ROOT, file)}: ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});
