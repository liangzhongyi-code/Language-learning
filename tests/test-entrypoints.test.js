import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);

test('一般 Node 測試不自動載入需要 Chromium 的 runner 檢查', () => {
  assert.equal(existsSync(new URL('tests/browser-runner.test.js', root)), false);
  assert.ok(existsSync(new URL('tests/browser/runner-checks.mjs', root)));
});

test('瀏覽器測試須有明示入口並保留 runner 失敗傳遞檢查', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts['test:browser'], 'node --test tests/browser/runner-checks.mjs && node tests/browser/run.mjs --suite all');
  assert.equal(pkg.engines.node, '>=20');
});
