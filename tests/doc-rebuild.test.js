import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = join(root, 'openspec/tools/build-doc-html.mjs');
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, LANG_LEARN_DOC_OUTPUT: '', ...env },
});

test('document rebuild hint includes the required output path and survives spaces/apostrophes', () => {
  const temp = mkdtempSync(join(tmpdir(), "lang-learn doc's-"));
  try {
    const generated = run(['add-offline-study-suite', temp]);
    assert.equal(generated.status, 0, generated.stderr);
    const html = readFileSync(join(temp, readdirSync(temp).find(name => name.endsWith('.html'))), 'utf8');
    const code = html.match(/<code>(node openspec\/tools\/build-doc-html\.mjs [\s\S]*?)<\/code>/)?.[1];
    assert.ok(code, 'must display a rebuild command');
    const decoded = code.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    const args = [...decoded.matchAll(/'((?:[^']|'')*)'/g)].map(match => match[1].replace(/''/g, "'"));
    assert.deepEqual(args, ['add-offline-study-suite', resolve(temp)]);
    const repeated = run(args);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(run(['add-offline-study-suite']).status, 1, 'missing output must fail clearly');
    assert.equal(run(['add-offline-study-suite'], { LANG_LEARN_DOC_OUTPUT: temp }).status, 0);
  } finally {
    // 只清掉測試自行建立的明確暫存目錄，不觸碰使用者文件。
    rmSync(temp, { recursive: true, force: true });
  }
});
