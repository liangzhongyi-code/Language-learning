import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [runner, ...args], {
  encoding: 'utf8', timeout: 30000,
});

test('F00：未知 suite 必須失敗，不可空跑卻報成功', () => {
  const result = run('--suite', 'not-a-real-suite');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /未知的瀏覽器測試/);
});

test('F00：真正 Chromium fixture 可用且不開啟使用者站台', () => {
  const result = run('--suite', 'harness');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS harness/);
});

test('F00：瀏覽器內斷言失敗必須向呼叫端回報非零', () => {
  const result = run('--suite', 'harness', '--self-test-failure');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /F00 intentional failure/);
});
