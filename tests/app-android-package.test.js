import test from 'node:test';
import assert from 'node:assert/strict';

import * as helpers from '../app/scripts/android-package-policy.mjs';
const config = { version: '0.1.0', identifier: 'io.example.learn' };
const properties = 'tauri.android.versionName=0.1.0\ntauri.android.versionCode=1000';
const source = 'D:\\work & test\\target\\run-new\\aarch64-linux-android\\release\\libapp.so';
const destination = 'D:\\work & test\\gen\\android\\app\\src\\main\\jniLibs\\arm64-v8a\\libapp.so';
function failure(cause = 'Creation symbolic link is not allowed for this system.') {
  return 'Finished `release` profile [optimized] target(s) in 5s\n' +
    `Error failed to build Android app: Failed to create a symbolic link from ${JSON.stringify(source)} to file ${JSON.stringify(destination)} (file clobbering enabled): ${cause}`;
}
const evidence = { platform: 'win32', source, destination, fresh: true,
  result: { status: 1, log: failure() } };

test('版本採 Tauri semver 公式，支援明確 versionCode', () => {
  assert.deepEqual(helpers.expectedIdentity(config), { identifier: config.identifier, versionName: '0.1.0', versionCode: 1000 });
  assert.equal(helpers.expectedIdentity({ ...config, version: '2.3.4-beta.1' }).versionCode, 2003004);
  assert.equal(helpers.expectedIdentity({ ...config, bundle: { android: { versionCode: 81 } } }).versionCode, 81);
});
test('拒絕未支援或不合法版本策略', () => {
  for (const patch of [{ version: '0.0.0' }, { version: '../package.json' },
    { bundle: { android: { autoIncrementVersionCode: true } } },
    { bundle: { android: { versionCode: 0 } } }, { identifier: 'io.bad-name.app' }]) {
    assert.throws(() => helpers.expectedIdentity({ ...config, ...patch }), /版本|識別|version/);
  }
});
test('properties 必須存在、無重複且版本完全相符', () => {
  const expected = helpers.expectedIdentity(config);
  assert.doesNotThrow(() => helpers.checkProperties(properties, expected));
  for (const value of ['', properties.replace('0.1.0', '0.0.9'), properties.replace('1000', '999'),
    properties + '\ntauri.android.versionCode=1000']) {
    assert.throws(() => helpers.checkProperties(value, expected), /properties|版本/);
  }
});
test('config 依 base → Android → app 順序深度合併，陣列取代', () => {
  const result = helpers.mergeConfig({ app: { windows: [1], security: { csp: 'x' } } },
    { app: { windows: [2], security: { capabilities: [] } } });
  assert.deepEqual(result, { app: { windows: [2], security: { csp: 'x', capabilities: [] } } });
});
test('唯一允許的失敗是當次庫完成後的 Windows symlink 權限錯誤', () => {
  assert.equal(helpers.acceptBuild(evidence), 'windows-symlink-fallback');
  assert.equal(helpers.acceptBuild({ ...evidence, result: { status: 1, log: failure('IO error: required privilege (os error 1314)') } }), 'windows-symlink-fallback');
  assert.equal(helpers.acceptBuild({ ...evidence, result: { status: 0, log: '' } }), 'tauri-success');
});
for (const [name, patch] of [
  ['舊庫／無當次庫', { fresh: false }],
  ['Linux', { platform: 'linux' }],
  ['中斷', { result: { status: 1, signal: 'SIGTERM', log: failure() } }],
  ['啟動失敗', { result: { status: 1, error: new Error('spawn'), log: failure() } }],
  ['沒有 Rust 完成', { result: { status: 1, log: failure().split('\n').slice(1).join('\n') } }],
  ['其他來源', { source: source.replace('run-new', 'run-old') }],
  ['其他 ABI', { destination: destination.replace('arm64-v8a', 'x86_64') }],
  ['一般權限失敗', { result: { status: 1, log: failure('IO error: Access denied (os error 5)') } }],
  ['另外的 Gradle 失敗', { result: { status: 1, log: failure() + '\nFAILURE: Build failed with an exception.' } }],
  ['Rust 編譯失敗', { result: { status: 1, log: 'error[E0308]: mismatch\n' + failure() } }],
  ['成功但無當次產物', { fresh: false, result: { status: 0, log: '' } }],
]) {
  test(`fallback 拒絕：${name}`, () => assert.throws(() => helpers.acceptBuild({ ...evidence, ...patch }), /建置|當次/));
}
test('來源與 staged 清單任何異動都拒絕，不能只相信時間戳', () => {
  assert.doesNotThrow(() => helpers.assertSame({ a: 'hash' }, { a: 'hash' }, '來源'));
  for (const value of [{ a: 'other' }, { a: 'hash', b: 'new' }, {}]) {
    assert.throws(() => helpers.assertSame({ a: 'hash' }, value, '來源'), /來源/);
  }
});

test('Cargo 產物只接受與同目錄 deps/ 同一 inode 的硬連結', async (t) => {
  const { mkdtemp, mkdir, writeFile, link, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { cargoArtifact } = await import('../app/scripts/package-android.mjs');
  const root = await mkdtemp(join(tmpdir(), 'cargo-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'release', 'deps'), { recursive: true });
  const single = join(root, 'release', 'single.so');
  await writeFile(single, 'x');
  await cargoArtifact(single);
  const artifact = join(root, 'release', 'lib.so');
  await writeFile(join(root, 'release', 'deps', 'lib.so'), 'elf');
  await link(join(root, 'release', 'deps', 'lib.so'), artifact);
  await cargoArtifact(artifact);
  const stray = join(root, 'release', 'stray.so');
  await writeFile(join(root, 'elsewhere.so'), 'elf');
  await link(join(root, 'elsewhere.so'), stray);
  await assert.rejects(cargoArtifact(stray), /拒絕非一般檔案或連結/);
  const triple = join(root, 'release', 'triple.so');
  await writeFile(join(root, 'release', 'deps', 'triple.so'), 'elf');
  await link(join(root, 'release', 'deps', 'triple.so'), triple);
  await link(triple, join(root, 'third.so'));
  await assert.rejects(cargoArtifact(triple), /拒絕非一般檔案或連結/);
});
