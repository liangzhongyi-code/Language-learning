/**
 * Worker 測試共用工具：讀 wrangler 設定、取得本機 D1（Miniflare）、啟動本機 Worker。
 * 全部在本機執行，資料存在每次測試各自的暫存目錄，不連外、不共用狀態。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 讀 wrangler.jsonc。設定檔刻意不寫註解，可直接以 JSON 解析。
 */
export function readWranglerConfig() {
  return JSON.parse(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8'));
}

/**
 * 在暫存目錄寫一份只含 D1 綁定的 wrangler 設定，回傳其路徑。
 * 正式設定含靜態資源與 build 指令，多個測試檔平行取用時會同時重建 dist-site/ 而互相干擾；
 * D1 測試只需要資料庫，因此只沿用正式設定的 D1 綁定與 compatibility_date。
 */
function writeD1OnlyConfig(dir) {
  const config = readWranglerConfig();
  const path = join(dir, 'wrangler.d1-only.json');
  writeFileSync(path, JSON.stringify({
    name: `${config.name}-d1-test`,
    compatibility_date: config.compatibility_date,
    d1_databases: config.d1_databases.map(({ binding, database_name, database_id }) => ({ binding, database_name, database_id })),
  }));
  return path;
}

/**
 * 建立暫存的本機 D1，套用全部 migration 後回傳 { env, dispose }。
 * env 只含 DB 綁定，其他變數由測試自行組合。
 */
export async function createTestDb() {
  const { getPlatformProxy } = await import('wrangler');
  const dir = mkdtempSync(join(tmpdir(), 'lang-learn-d1-'));
  const proxy = await getPlatformProxy({ configPath: writeD1OnlyConfig(dir), persist: { path: dir } });
  const { readdirSync } = await import('node:fs');
  const migrations = join(ROOT, 'worker', 'migrations');
  let files = [];
  try { files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort(); } catch { files = []; }
  for (const name of files) await applySql(proxy.env.DB, readFileSync(join(migrations, name), 'utf8'));
  return {
    env: { DB: proxy.env.DB },
    async dispose() {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 逐句執行 SQL 檔（以分號切句，migration 內不使用含分號的字串）。
 */
export async function applySql(db, sql) {
  const statements = sql
    .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    .split(';').map((part) => part.trim()).filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
}

/**
 * 以 wrangler.jsonc 啟動本機 Worker（含靜態資源），回傳 { url, fetch(path, init), dispose }。
 */
export async function startLocalWorker({ vars = {} } = {}) {
  const { unstable_startWorker } = await import('wrangler');
  const dir = mkdtempSync(join(tmpdir(), 'lang-learn-dev-'));
  const worker = await unstable_startWorker({
    config: join(ROOT, 'wrangler.jsonc'),
    bindings: Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, { type: 'plain_text', value }])),
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: dir, logLevel: 'error' },
  });
  await worker.ready;
  const url = await worker.url;
  return {
    url,
    fetch: (path, init) => fetch(new URL(path, url), { redirect: 'manual', ...init }),
    async dispose() {
      await worker.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Worker 測試用的本站 origin（不是真實網域）。
 */
export const TEST_SITE = 'https://site.test';

/**
 * 組出直接呼叫 worker.fetch 用的 env：DB 加上固定的假設定值。
 * 預設是白名單模式、測試環境；需要時以 overrides 覆寫（例如 GOOGLE_OAUTH_BASE、TEST_NOW）。
 */
export function workerEnv(DB, overrides = {}) {
  return {
    DB,
    GOOGLE_CLIENT_ID: 'test-client-id.apps.example.test',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    ACCESS_MODE: 'allowlist',
    SITE_ORIGIN: TEST_SITE,
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

/**
 * 清空全部資料表，讓同一個測試檔內的案例互不影響。
 */
export async function clearTables(DB) {
  for (const table of ['allowed_emails', 'users', 'sessions', 'login_states', 'snapshots', 'snapshot_chunks', 'upload_log']) {
    await DB.prepare(`DELETE FROM ${table}`).run();
  }
}

/**
 * 取出單一 cookie 的 name=value，供測試模擬瀏覽器送出 Cookie。
 */
export function cookiePairFrom(response, name) {
  const cookies = response.headers.getSetCookie();
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(';', 1)[0] ?? null;
}

/**
 * 從 Set-Cookie 取出 __Host-ll_session 的值；沒有時回 null。
 */
export function sessionTokenFrom(response) {
  const pair = cookiePairFrom(response, '__Host-ll_session');
  return pair?.slice('__Host-ll_session='.length) || null;
}

/**
 * 走完整個登入流程：/api/auth/start → 假 Google 授權 → /api/auth/callback。
 * 回傳 { start, callbackUrl, response, token, cookie }；token 為 null 表示沒有發 session。
 */
export async function signIn(worker, env, google, { returnTo = '/', user } = {}) {
  if (user) google.setUser(user);
  const start = await worker.fetch(
    new Request(`${TEST_SITE}/api/auth/start?returnTo=${encodeURIComponent(returnTo)}`), env, {},
  );
  const callbackUrl = await google.authorize(start.headers.get('location'));
  const loginCookie = cookiePairFrom(start, '__Host-ll_oauth');
  const headers = loginCookie ? { cookie: loginCookie } : {};
  const response = await worker.fetch(new Request(callbackUrl.href, { headers }), env, {});
  const token = sessionTokenFrom(response);
  return { start, callbackUrl, response, token, cookie: token ? `__Host-ll_session=${token}` : null };
}

/**
 * 對 Worker 發 API 請求。寫入類請求預設帶本站 Origin；cookie 為 session cookie 字串。
 * body 若是物件會轉成 JSON。
 */
export async function callApi(worker, env, method, path, { cookie, body, headers = {}, origin = TEST_SITE } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (origin !== null && !['GET', 'HEAD'].includes(method)) init.headers.origin = origin;
  if (body !== undefined) {
    if (body instanceof Uint8Array || body instanceof ArrayBuffer || typeof body === 'string') {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
  }
  return worker.fetch(new Request(`${TEST_SITE}${path}`, init), env, {});
}
