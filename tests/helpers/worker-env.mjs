/**
 * Worker 測試共用工具：讀 wrangler 設定、取得本機 D1（Miniflare）、啟動本機 Worker。
 * 全部在本機執行，資料存在每次測試各自的暫存目錄，不連外、不共用狀態。
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
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
 * 建立暫存的本機 D1，套用全部 migration 後回傳 { env, dispose }。
 * env 只含 DB 綁定，其他變數由測試自行組合。
 */
export async function createTestDb() {
  const { getPlatformProxy } = await import('wrangler');
  const dir = mkdtempSync(join(tmpdir(), 'lang-learn-d1-'));
  const proxy = await getPlatformProxy({ configPath: join(ROOT, 'wrangler.jsonc'), persist: { path: dir } });
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
