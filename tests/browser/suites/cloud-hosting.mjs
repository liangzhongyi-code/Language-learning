import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, startLocalWorker } from '../../helpers/worker-env.mjs';

/**
 * H02：在本機 Worker（wrangler 設定加白名單靜態資源）逐一請求非網站檔案，最終一律 404 且不回傳內容。
 * 自己啟動一個本機 Worker，不依賴 run.mjs 目前用哪一種伺服器。
 * auto-trailing-slash 可能先回 307，所以跟著同源轉址走到最終結果再判斷。
 */

/**
 * 每個非網站資料夾挑一個實際存在的檔案（排序後第一個），確保請求的是真的檔案而不是本來就不存在的路徑。
 */
function firstFile(dir) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return null;
  for (const name of readdirSync(full).sort()) {
    const path = join(full, name);
    if (statSync(path).isDirectory()) {
      const nested = firstFile(dir + '/' + name);
      if (nested) return nested;
    } else return dir + '/' + name;
  }
  return null;
}

const PRIVATE_DIRS = ['node_modules', 'tests', 'openspec', 'docs', 'app', 'tools', 'worker'];
const PRIVATE_FILES = ['.git/config', 'package.json', 'package-lock.json', 'wrangler.jsonc', 'README.md', 'AGENTS.md',
  'serve.json', '.gitignore', 'assets/js/data/IMPORTING.md'];

/**
 * 跟著同源 3xx 轉址走，回傳最終狀態、內容與經過的轉址。
 */
async function finalResponse(local, path) {
  const hops = [];
  let target = new URL(path, local.url);
  for (let i = 0; i < 5; i++) {
    const response = await local.fetch(target.pathname + target.search);
    const body = Buffer.from(await response.arrayBuffer());
    if (response.status < 300 || response.status >= 400) return { status: response.status, body, hops };
    const next = new URL(response.headers.get('location'), target);
    assert.equal(next.origin, target.origin, `${path} 轉址到其他網域：${next.href}`);
    hops.push(`${response.status} ${target.pathname} → ${next.pathname}`);
    target = next;
  }
  throw new Error(`${path} 轉址超過 5 次`);
}

export async function run() {
  const paths = [];
  for (const dir of PRIVATE_DIRS) {
    const file = firstFile(dir);
    assert.ok(file, `找不到 ${dir}/ 底下的實際檔案，H02 檢查會失去意義`);
    paths.push('/' + file, '/' + dir + '/', '/' + dir);
  }
  for (const file of PRIVATE_FILES) paths.push('/' + file);
  paths.push('/en/%2e%2e/package.json', '/assets/..%2fpackage.json', '/.git', '/.wrangler/', '/dist-site/index.html');

  const local = await startLocalWorker();
  try {
    const leaks = [];
    for (const path of paths) {
      const { status, body, hops } = await finalResponse(local, path);
      const disk = join(ROOT, decodeURIComponent(path.split('?')[0]));
      const content = existsSync(disk) && statSync(disk).isFile() ? readFileSync(disk) : null;
      const leaked = content && content.length && body.includes(content.subarray(0, Math.min(64, content.length)));
      if (status !== 404 || leaked) leaks.push(`${path} → ${status}${hops.length ? '（' + hops.join('；') + '）' : ''}${leaked ? ' 且回傳檔案內容' : ''}`);
    }
    assert.deepEqual(leaks, [], 'H02 非網站路徑必須 404 且不回傳內容');
    console.log(`  H02 已檢查 ${paths.length} 個非網站路徑，全部 404`);

    /* 對照組：網站本身仍可取得，避免「全部 404」是因為 Worker 根本沒提供靜態資源 */
    for (const path of ['/', '/en/', '/assets/css/theme.css']) {
      assert.equal((await finalResponse(local, path)).status, 200, `${path} 應為 200`);
    }
  } finally {
    await local.dispose();
  }
}
