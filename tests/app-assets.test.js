import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageWeb } from '../app/scripts/stage-web.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'app/assets-manifest.json'), 'utf8'));

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'stage-src-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function list(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await list(full, base));
    else out.push(full.slice(base.length + 1).replace(/\\/g, '/'));
  }
  return out.sort();
}

const mini = { pages: ['index.html'], directories: ['assets/js'], files: [], allowedExtensions: ['.html', '.js'] };

test('S02：只打包明列頁面與資源，.git／.idea／測試／報告／金鑰都不進包', async () => {
  const root = await fixture({
    'index.html': '<script type="module" src="./assets/js/app.js"></script>',
    'assets/js/app.js': "import './util.js';",
    'assets/js/util.js': 'export {};',
    '.git/config': 'x', '.idea/misc.xml': 'x', 'tests/a.test.js': 'x', 'docs/report.md': 'x', 'secret.key': 'x',
  });
  const out = await mkdtemp(join(tmpdir(), 'stage-out-'));
  await stageWeb({ root, out, manifest: mini });
  assert.deepEqual(await list(out), ['assets/js/app.js', 'assets/js/util.js', 'index.html', 'staged-manifest.json']);
  await rm(root, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test('S02：缺必要頁面時建置失敗', async () => {
  const root = await fixture({ 'assets/js/app.js': '' });
  const out = await mkdtemp(join(tmpdir(), 'stage-out-'));
  await assert.rejects(stageWeb({ root, out, manifest: mini }), /缺少必要頁面：index\.html/);
  await rm(root, { recursive: true, force: true });
});

test('S02：資源目錄內出現金鑰檔或包外引用時建置失敗', async () => {
  const leaky = await fixture({ 'index.html': '', 'assets/js/app.js': '', 'assets/js/release.keystore': 'x' });
  await assert.rejects(stageWeb({ root: leaky, out: await mkdtemp(join(tmpdir(), 'stage-out-')), manifest: mini }), /金鑰或憑證/);
  const broken = await fixture({ 'index.html': '<link href="../outside.css">', 'assets/js/app.js': '' });
  await assert.rejects(stageWeb({ root: broken, out: await mkdtemp(join(tmpdir(), 'stage-out-')), manifest: mini }), /包外/);
  const missing = await fixture({ 'index.html': '<script src="./assets/js/nope.js"></script>', 'assets/js/app.js': '' });
  await assert.rejects(stageWeb({ root: missing, out: await mkdtemp(join(tmpdir(), 'stage-out-')), manifest: mini }), /不存在/);
});

test('S01/S02：真實專案可整理出全部 21 頁且所有相對引用都在包內', async () => {
  const out = await mkdtemp(join(tmpdir(), 'stage-real-'));
  const { files } = await stageWeb({ root: ROOT, out, manifest });
  for (const page of manifest.pages) assert.ok(files.includes(page), `缺 ${page}`);
  assert.equal(manifest.pages.length, 21);
  assert.ok(!files.some((file) => /^(tests|docs|openspec|node_modules|app)\//.test(file) || file.startsWith('.')));
  await rm(out, { recursive: true, force: true });
});

async function sandbox(t, files) {
  const root = await fixture(files);
  const out = await mkdtemp(join(tmpdir(), 'stage-safe-out-'));
  t.after(() => Promise.all([root, out].map((path) => rm(path, { recursive: true, force: true }))));
  return { root, out };
}

test('S02：拒絕來源目錄 junction，不讀取連結中的檔案', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '' });
  const external = await fixture({ 'private.js': 'export const privateKey = "fixture-only";' });
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, 'assets/js/linked'), 'junction');
  await assert.rejects(stageWeb({ root, out, manifest: mini }), /符號連結/);
});

test('S02：輸出不可覆蓋來源子目錄，也不可抹除未受管理的檔案', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '' });
  await assert.rejects(stageWeb({ root, out: join(root, 'assets'), manifest: mini }), /輸出目錄/);
  await writeFile(join(out, 'keep.txt'), 'user-owned');
  await assert.rejects(stageWeb({ root, out, manifest: mini }), /未受管理/);
  assert.equal(await readFile(join(out, 'keep.txt'), 'utf8'), 'user-owned');
});

test('S02：失敗引用檢查保留上一批有效輸出，成功重跑移除舊資源並校驗雜湊', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': 'export {};' });
  await stageWeb({ root, out, manifest: mini });
  const before = await readFile(join(out, 'staged-manifest.json'), 'utf8');
  await writeFile(join(root, 'index.html'), '<script src="./missing.js"></script>');
  await assert.rejects(stageWeb({ root, out, manifest: mini }), /不存在/);
  assert.equal(await readFile(join(out, 'staged-manifest.json'), 'utf8'), before);
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), '');
  await writeFile(join(root, 'index.html'), 'changed');
  await rm(join(root, 'assets/js/app.js'));
  await stageWeb({ root, out, manifest: mini });
  assert.deepEqual(await list(out), ['index.html', 'staged-manifest.json']);
  const hashes = JSON.parse(await readFile(join(out, 'staged-manifest.json'), 'utf8')).files;
  assert.equal(hashes['index.html'], createHash('sha256').update('changed').digest('hex'));
});

for (const [name, files] of [
  ['單引號 HTML', { 'index.html': "<script src='./missing.js'></script>" }],
  ['無引號 HTML', { 'index.html': '<img src=./missing.png>' }],
  ['雙引號 import', { 'assets/js/app.js': 'import "./missing.js";' }],
  ['export from', { 'assets/js/app.js': 'export { x } from "./missing.js";' }],
  ['動態 import', { 'assets/js/app.js': 'import("./missing.js");' }],
  ['CSS url', { 'assets/css/app.css': 'body { background: url("./missing.png"); }' }],
  ['CSS import', { 'assets/css/app.css': '@import "./missing.css";' }],
  ['srcset', { 'index.html': '<img srcset="./missing.png 1x, ./missing2.png 2x">' }],
  ['目錄連結', { 'index.html': '<a href="./en/">page</a>' }],
  ['編碼包外', { 'index.html': '<a href="%2e%2e/outside.html">page</a>' }],
  ['遠端執行資源', { 'index.html': '<script src="https://example.invalid/app.js"></script>' }],
]) {
  test(`S02：${name} 的不完整或不合法資源拒絕打包`, async (t) => {
    const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '', ...files });
    const options = { ...mini, directories: ['assets/js', ...(files['assets/css/app.css'] ? ['assets/css'] : [])], allowedExtensions: ['.html', '.js', '.css'] };
    await assert.rejects(stageWeb({ root, out, manifest: options }), /不存在|包外|遠端/);
  });
}

test('S02：manifest 不接受穿越路徑、測試檔、報告與不允許的副檔名', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '', 'docs/report.md': '', 'assets/js/a.test.js': '', 'assets/js/ignored.txt': '' });
  for (const files of [['docs/report.md'], ['assets/js/a.test.js'], ['assets/js/ignored.txt'], ['assets/js/../js/app.js']]) {
    await assert.rejects(stageWeb({ root, out, manifest: { ...mini, files } }), /拒絕|副檔名/);
  }
});

test('S02：資源內的隱藏機密與偽裝成 JS 的 private key 必須拒絕', async (t) => {
  for (const [path, content] of [['assets/js/.env.local', 'TOKEN=fixture'], ['assets/js/key.js', 'const key = "-----BEGIN PRIVATE KEY-----\\nfixture";']]) {
    const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '', [path]: content });
    await assert.rejects(stageWeb({ root, out, manifest: mini }), /機密|金鑰|憑證/);
  }
});

test('S02：拒絕 repo、磁碟根、祖先、任意外部與 app 內非 staging 輸出', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '' });
  const external = await fixture({ 'keep.txt': 'user-owned' });
  t.after(() => rm(external, { recursive: true, force: true }));
  for (const target of [root, parse(root).root, dirname(root), external, join(root, 'app'), join(root, 'app/other')]) {
    await assert.rejects(stageWeb({ root, out: target, manifest: mini }), /輸出目錄/);
  }
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), '');
  assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'user-owned');
  assert.deepEqual(await list(out), []);
});

test('S02：輸出父目錄 junction 拒絕，外部資料保留', async (t) => {
  const { root } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '' });
  const external = await fixture({ 'dist-web/keep.txt': 'user-owned' });
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, 'app'), 'junction');
  await assert.rejects(stageWeb({ root, out: join(root, 'app/dist-web'), manifest: mini }), /符號連結/);
  assert.equal(await readFile(join(external, 'dist-web/keep.txt'), 'utf8'), 'user-owned');
});

test('S02：来源祖先 junction 與明列頁面 junction 拒絕', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '' });
  const external = await fixture({ 'js/private.js': 'fixture' });
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, 'linked'), 'junction');
  await assert.rejects(stageWeb({ root: join(root, 'linked'), out, manifest: mini }), /符號連結/);
  await mkdir(join(root, 'en'));
  await symlink(external, join(root, 'en/index.html'), 'junction');
  await assert.rejects(stageWeb({ root, out, manifest: { ...mini, pages: ['en/index.html'] } }), /符號連結/);
});

test('S02：受管理輸出被改寫、加檔或加空目錄時拒絕覆蓋', async (t) => {
  for (const mode of ['changed', 'extra-file', 'extra-dir', 'forged-owner']) {
    const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '' });
    await stageWeb({ root, out, manifest: mini });
    if (mode === 'changed') await writeFile(join(out, 'index.html'), 'user-owned');
    if (mode === 'extra-file') await writeFile(join(out, 'keep.txt'), 'user-owned');
    if (mode === 'extra-dir') await mkdir(join(out, 'keep-empty'));
    if (mode === 'forged-owner') await writeFile(join(out, 'staged-manifest.json'), '{"files":{}}');
    const before = await readFile(join(out, 'staged-manifest.json'), 'utf8');
    await assert.rejects(stageWeb({ root, out, manifest: mini }), /未受管理/);
    assert.equal(await readFile(join(out, 'staged-manifest.json'), 'utf8'), before);
    if (mode === 'changed') assert.equal(await readFile(join(out, 'index.html'), 'utf8'), 'user-owned');
  }
});

test('S02：白名單不允許擴張到其他目錄或敏感副檔名', async (t) => {
  const { root, out } = await sandbox(t, { 'index.html': '', 'assets/js/app.js': '', 'private/page.html': '' });
  for (const options of [
    { ...mini, directories: ['private'] },
    { ...mini, pages: ['private/page.html'] },
    { ...mini, allowedExtensions: ['.html', '.js', '.key'] },
    { ...mini, files: ['C:/outside.js'] },
  ]) await assert.rejects(stageWeb({ root, out, manifest: options }), /拒絕/);
});

test('S02：query、hash、目錄 index 與有效 CSS／JS 引用可重複打包', async (t) => {
  const { root, out } = await sandbox(t, {
    'index.html': '<link href="./assets/css/app.css"><a href="./en/?q=ja#card">go</a><script type="module">import "./assets/js/app.js";</script>',
    'en/index.html': '<a href="../index.html">back</a>',
    'assets/js/app.js': 'export { x } from "./util.js"; import("./util.js");',
    'assets/js/util.js': 'export const x = 1;',
    'assets/css/app.css': '@import "./other.css"; body {background:url("./icon.svg");}',
    'assets/css/other.css': '', 'assets/css/icon.svg': '<svg></svg>',
  });
  const options = { ...mini, pages: ['index.html', 'en/index.html'], directories: ['assets/js', 'assets/css'], allowedExtensions: ['.html', '.js', '.css', '.svg'] };
  const first = await stageWeb({ root, out, manifest: options });
  const second = await stageWeb({ root, out, manifest: options });
  assert.deepEqual(first, second);
  assert.equal(first.retainedPrevious, undefined);
});

for (const source of [
  '<base href="https://example.invalid/">',
  '<script src="//example.invalid/app.js"></script>',
  '<a href="&#46;&#46;/outside.html">bad</a>',
  '<a href="javascript:alert(1)">bad</a>',
  '<img src="/outside.png">',
]) {
  test(`S02：拒絕其他不安全引用 ${source}`, async (t) => {
    const { root, out } = await sandbox(t, { 'index.html': source, 'assets/js/app.js': '' });
    await assert.rejects(stageWeb({ root, out, manifest: mini }), /拒絕|遠端|包外/);
    assert.deepEqual(await list(out), []);
  });
}

test('S02：打包器不含 recursive rm，候選驗證在輸出替換前完成', async () => {
  const script = await readFile(join(ROOT, 'app/scripts/stage-web.mjs'), 'utf8');
  assert.doesNotMatch(script, /\brm\s*\(|recursive\s*:\s*true[^}]*force/);
  assert.ok(script.indexOf('checkReferences(contents);') < script.indexOf('await rename(absOut, previous)'));
});

test('P00b：scaffold 僅提供本機 prototype 與窄 SQLite 探針，關閉安裝包', async () => {
  const config = JSON.parse(await readFile(join(ROOT, 'app/src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(config.build.frontendDist, '../dist-web');
  assert.equal(config.build.devUrl, undefined);
  assert.equal(config.bundle.active, false);
  assert.equal(config.app.withGlobalTauri, true);
  assert.match(config.identifier, /prototype$/);
  assert.equal(config.app.windows[0].url, 'app/prototype/index.html');
  assert.equal(config.app.windows[0].create, false);
  assert.ok(config.app.security.csp && !/unsafe-inline|unsafe-eval|https:\/\/\*/.test(config.app.security.csp));
  const capability = JSON.parse(await readFile(join(ROOT, 'app/src-tauri/capabilities/prototype.json'), 'utf8'));
  assert.deepEqual(capability.permissions, ['allow-prototype-probe']);
  assert.equal(capability.remote, undefined);
  const cargo = await readFile(join(ROOT, 'app/src-tauri/Cargo.toml'), 'utf8');
  assert.match(cargo, /sqlx/);
  assert.ok(!cargo.includes('tauri-plugin-sql'));
});

test('P00b：探針未在原生 runtime 或 invoke 拒絕時，不回報成功', async () => {
  const { runProbe } = await import('../app/prototype/probe.js');
  await assert.rejects(runProbe(), /原生/);
  await assert.rejects(runProbe(async () => { throw new Error('fixture failure'); }), /fixture failure/);
  await assert.rejects(runProbe(async () => ({ sqliteVersion: 'fixture' })), /格式/);
  const proof = { sqliteVersion: 'fixture', rollbackVerified: true, learningRepository: 'not-implemented' };
  assert.deepEqual(await runProbe(async (command) => { assert.equal(command, 'prototype_probe'); return proof; }), proof);
});

test('P00b：rollback false、假儲存能力、空版本及未等待的結果均拒絕', async () => {
  const { runProbe } = await import('../app/prototype/probe.js');
  const valid = { sqliteVersion: '3.46.0', rollbackVerified: true, learningRepository: 'not-implemented' };
  for (const response of [null, {}, { ...valid, rollbackVerified: false }, { ...valid, learningRepository: 'ready' },
    { ...valid, sqliteVersion: '' }, { ...valid, sqliteVersion: ' '.repeat(4) }, { ...valid, sqliteVersion: 'x'.repeat(129) }]) {
    await assert.rejects(runProbe(async () => response), /格式/);
  }
  let resolve;
  const pending = runProbe(() => new Promise(done => { resolve = done; }));
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise(done => setImmediate(done));
  assert.equal(settled, false);
  resolve(valid);
  assert.deepEqual(await pending, valid);
});

test('P00b：prototype staging 保留網站 21 頁，兩頁與外部模組可載入且機密不進包', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'stage-real-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const prototype = JSON.parse(await readFile(join(ROOT, 'app/prototype-manifest.json'), 'utf8'));
  assert.deepEqual(prototype.pages.slice(0, manifest.pages.length), manifest.pages);
  const { files } = await stageWeb({ root: ROOT, out, manifest: prototype });
  for (const path of ['app/prototype/index.html', 'app/prototype/second.html', 'app/prototype/probe.js', 'app/prototype/ui.js']) {
    assert.ok(files.includes(path), path);
    assert.ok((await readFile(join(out, path), 'utf8')).length > 0);
  }
  assert.ok(!files.some(file => /(?:src-tauri|docs|tests|package\.json|Cargo\.toml)/.test(file)));
});
