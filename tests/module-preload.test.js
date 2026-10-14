import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('modulepreload：每頁預載清單與模組靜態相依同步', () => {
  const script = fileURLToPath(new URL('../tools/build-preload.mjs', import.meta.url));
  assert.match(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' }), /PASS preload 21 頁/);
});
