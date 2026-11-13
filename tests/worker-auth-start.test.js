/**
 * T06：登入開始。
 * state 與 PKCE（S256）、login_states 只存 state 的雜湊並 10 分鐘有效、轉到 Google 的參數齊全，
 * 以及 A05：returnTo 只接受本站路徑。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestDb, clearTables, workerEnv, TEST_SITE } from './helpers/worker-env.mjs';
import worker from '../worker/src/index.js';

let ctx;
let DB;

before(async () => {
  ctx = await createTestDb();
  DB = ctx.env.DB;
});

after(async () => {
  await ctx?.dispose();
});

beforeEach(async () => {
  await clearTables(DB);
});

const FIXED_NOW = Date.UTC(2026, 10, 13, 8, 0, 0);

/**
 * 發出 GET /api/auth/start，回傳回應與解析後的 Location。
 */
async function start(returnTo, overrides = {}) {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const env = workerEnv(DB, overrides);
  const response = await worker.fetch(new Request(`${TEST_SITE}/api/auth/start${query}`), env, {});
  const location = response.headers.get('location');
  return { response, location: location ? new URL(location) : null };
}

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');
const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url');

test('A05 準備：302 到 Google 授權端點，參數齊全', async () => {
  const { response, location } = await start('/ja/', { ENVIRONMENT: undefined });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const params = location.searchParams;
  assert.equal(params.get('client_id'), 'test-client-id.apps.example.test');
  assert.equal(params.get('redirect_uri'), `${TEST_SITE}/api/auth/callback`);
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('scope'), 'openid email');
  assert.equal(params.get('prompt'), 'select_account');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.match(params.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(params.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(params.has('client_secret'), false);
});

test('login_states 只存 state 的雜湊，verifier 符合 S256，10 分鐘後到期', async () => {
  const { location } = await start('/en/quiz.html', { TEST_NOW: () => FIXED_NOW });
  const state = location.searchParams.get('state');
  const challenge = location.searchParams.get('code_challenge');
  const { results } = await DB.prepare('SELECT * FROM login_states').all();
  assert.equal(results.length, 1);
  const row = results[0];
  assert.equal(row.state_hash, sha256Hex(state));
  assert.notEqual(row.state_hash, state);
  assert.equal(JSON.stringify(row).includes(state), false);
  assert.equal(s256(row.code_verifier), challenge);
  assert.match(row.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(row.return_to, '/en/quiz.html');
  assert.equal(row.expires_at, Math.floor(FIXED_NOW / 1000) + 600);
});

test('每次登入開始都產生不同的 state 與 verifier', async () => {
  const first = await start('/');
  const second = await start('/');
  assert.notEqual(first.location.searchParams.get('state'), second.location.searchParams.get('state'));
  assert.notEqual(first.location.searchParams.get('code_challenge'), second.location.searchParams.get('code_challenge'));
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM login_states').first();
  assert.equal(row.n, 2);
});

test('GOOGLE_OAUTH_BASE 只在 ENVIRONMENT=test 時生效', async () => {
  const fake = 'http://127.0.0.1:9/fake-google';
  const inTest = await start('/', { GOOGLE_OAUTH_BASE: fake });
  assert.equal(inTest.location.href.startsWith(`${fake}/o/oauth2/v2/auth?`), true);
  for (const ENVIRONMENT of ['production', undefined, 'TEST', '']) {
    const prod = await start('/', { GOOGLE_OAUTH_BASE: fake, ENVIRONMENT });
    assert.equal(prod.location.origin, 'https://accounts.google.com', `ENVIRONMENT=${ENVIRONMENT}`);
  }
});

test('注入的時鐘只在測試環境生效', async () => {
  await start('/', { ENVIRONMENT: 'production', TEST_NOW: () => FIXED_NOW });
  const row = await DB.prepare('SELECT expires_at FROM login_states').first();
  const realNow = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(row.expires_at - (realNow + 600)) <= 5, '正式環境要用真實時間');
});

test('A05 returnTo：本站路徑保留，查詢字串保留，hash 去除', async () => {
  const cases = [
    ['/ja/', '/ja/'],
    ['/en/quiz.html?level=N5', '/en/quiz.html?level=N5'],
    ['/help.html#cloud', '/help.html'],
    ['/', '/'],
  ];
  for (const [input, expected] of cases) {
    await clearTables(DB);
    await start(input);
    const row = await DB.prepare('SELECT return_to FROM login_states').first();
    assert.equal(row.return_to, expected, `returnTo=${JSON.stringify(input)}`);
  }
});

test('A05 returnTo：外部網址、//、反斜線、控制字元、非本站路徑一律改成 /', async () => {
  const hostile = [
    undefined,
    '',
    'https://evil.example/',
    `${TEST_SITE}/ja/`,
    '//evil.example/path',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/ja\\..\\..\\x',
    '/a//b',
    '/\t/evil.example',
    '/ja/\nSet-Cookie: x=1',
    '/ja/\r',
    '/ja/\u0000',
    '/ja/\u007f',
    'ja/',
    'javascript:alert(1)',
    ' /ja/',
    `/${'a'.repeat(3000)}`,
  ];
  for (const input of hostile) {
    await clearTables(DB);
    const { response } = await start(input);
    assert.equal(response.status, 302);
    const row = await DB.prepare('SELECT return_to FROM login_states').first();
    assert.equal(row.return_to, '/', `returnTo=${JSON.stringify(input)}`);
  }
});

test('登入開始時順便清掉已過期的 login_states', async () => {
  const nowSec = Math.floor(FIXED_NOW / 1000);
  await DB.prepare('INSERT INTO login_states(state_hash, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?)')
    .bind('expired-hash', 'v', '/', nowSec - 1).run();
  await DB.prepare('INSERT INTO login_states(state_hash, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?)')
    .bind('live-hash', 'v', '/', nowSec + 300).run();
  await start('/', { TEST_NOW: () => FIXED_NOW });
  const { results } = await DB.prepare('SELECT state_hash FROM login_states ORDER BY state_hash').all();
  assert.equal(results.length, 2);
  assert.equal(results.some((row) => row.state_hash === 'expired-hash'), false);
  assert.equal(results.some((row) => row.state_hash === 'live-hash'), true);
});
