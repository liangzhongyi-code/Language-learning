/**
 * H01 的基礎：瀏覽器測試可改用本機 Worker 當伺服器（run.mjs --server wrangler）。
 * 這裡只用 Node fetch 檢查伺服器本身，不啟動 Chromium。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startWorkerServer } from './browser/server.mjs';

const runner = fileURLToPath(new URL('./browser/run.mjs', import.meta.url));

test('H01 Worker 模式：隔離頁、靜態資源、轉址與 404 都照本機 Worker 原樣傳回，並記錄轉址', async () => {
  const server = await startWorkerServer();
  try {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const get = (path) => fetch(server.origin + path, { redirect: 'manual' });

    const harness = await get('/__harness__');
    assert.equal(harness.status, 200);
    assert.match(await harness.text(), /<title>測試隔離頁<\/title>/);

    const home = await get('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /page-boot\.js/);

    const quiz = await get('/en/quiz.html?source=words');
    assert.equal(quiz.status, 307);
    assert.equal(quiz.headers.get('location'), '/en/quiz?source=words');

    const css = await get('/assets/css/theme.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    assert.equal((await get('/package.json')).status, 404);
    assert.equal((await fetch(server.origin + '/api/no-such-thing')).status, 404);

    assert.deepEqual(server.redirects.map(({ from, status, location }) => [from, status, location]),
      [['/en/quiz.html?source=words', 307, '/en/quiz?source=words']]);
  } finally {
    await server.close();
  }
});

test('H01 未知的 --server 值必須失敗，不可默默改用其他伺服器', () => {
  const result = spawnSync(process.execPath, [runner, '--suite', 'harness', '--server', 'nginx'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /未知的測試伺服器/);
});
