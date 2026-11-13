/**
 * H02（建置端）：dist-site/ 只含 SITE_ENTRIES 白名單項目，且只放網站會用到的檔案類型。
 * 開發文件、測試、規格、APP、後端原始碼與設定檔一律不得出現在靜態資源目錄。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildSite, SITE_ENTRIES, SITE_EXTENSIONS, ROOT } from '../tools/build-site.mjs';

/**
 * 遞迴列出目錄下全部檔案（相對路徑，斜線分隔）。
 */
function listFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

const extensionOf = (path) => {
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};

/**
 * 以暫存目錄建置一次，不碰工作目錄裡給 wrangler 用的 dist-site/。
 */
function buildInto(root = ROOT) {
  const outDir = mkdtempSync(join(tmpdir(), 'lang-learn-site-'));
  const dispose = () => rmSync(outDir, { recursive: true, force: true });
  try {
    return { outDir, copied: buildSite({ root, outDir }), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

test('H02 建置結果的頂層只含白名單項目，必要項目都在', () => {
  const { outDir, copied, dispose } = buildInto();
  try {
    const allowed = new Set(SITE_ENTRIES.map((entry) => entry.path));
    const top = readdirSync(outDir);
    assert.deepEqual(top.filter((name) => !allowed.has(name)), [], '出現白名單以外的頂層項目');
    for (const { path, required } of SITE_ENTRIES) {
      if (required) assert.ok(top.includes(path), `缺少必要項目：${path}`);
    }
    assert.deepEqual([...copied].sort(), [...top].sort());
  } finally { dispose(); }
});

test('H02 建置結果只含網站檔案類型，沒有開發文件或隱藏檔', () => {
  const { outDir, dispose } = buildInto();
  try {
    const files = listFiles(outDir);
    assert.ok(files.length > 0);
    const offenders = files.filter((path) =>
      !SITE_EXTENSIONS.includes(extensionOf(path)) || path.split('/').some((part) => part.startsWith('.')));
    assert.deepEqual(offenders, [], '靜態資源出現非網站檔案');
  } finally { dispose(); }
});

test('H02 自我驗證：專案根目錄的非網站項目與白名單目錄內的雜項都不會被複製', () => {
  const root = mkdtempSync(join(tmpdir(), 'lang-learn-root-'));
  const write = (path, content = 'x') => {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };
  try {
    for (const path of ['index.html', 'help.html', 'en/index.html', 'ja/index.html', 'assets/js/a.js', 'assets/css/theme.css']) write(path);
    for (const path of ['package.json', 'wrangler.jsonc', 'stray.html', 'tests/a.test.js', 'node_modules/x/index.js',
      'openspec/a.md', 'docs/a.md', 'app/a.js', 'tools/a.mjs', 'worker/src/index.js', '.git/config',
      'assets/js/data/IMPORTING.md', 'assets/.DS_Store', 'en/.secret.js', 'assets/js/notes.txt']) write(path);
    const { outDir, dispose } = buildInto(root);
    try {
      assert.deepEqual(listFiles(outDir).sort(),
        ['assets/css/theme.css', 'assets/js/a.js', 'en/index.html', 'help.html', 'index.html', 'ja/index.html']);
    } finally { dispose(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('H02 缺少必要項目時建置失敗，不產出殘缺網站', () => {
  const root = mkdtempSync(join(tmpdir(), 'lang-learn-root-'));
  try {
    writeFileSync(join(root, 'index.html'), 'x');
    assert.throws(() => buildInto(root), /缺少網站必要項目/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
