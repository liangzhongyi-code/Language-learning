import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { packageAndroid, TARGETS, LIB, runProcess } from '../app/scripts/package-android.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = { identifier: 'io.example.learn', versionName: '0.1.0', versionCode: 1000 };
const props = 'tauri.android.versionName=0.1.0\ntauri.android.versionCode=1000';
async function put(path, content = '') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
function elf(machine, content = 'fresh') {
  const bytes = Buffer.alloc(128);
  bytes.write('7f454c460201', 0, 'hex');
  bytes.writeUInt16LE(3, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.write(content, 64);
  return bytes;
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'android-package & space-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'app'), android = join(app, 'src-tauri/gen/android');
  const config = { version: '0.1.0', identifier: identity.identifier,
    build: { frontendDist: '../dist-web', beforeBuildCommand: 'npm run stage' } };
  const files = {
    'index.html': 'current website', 'app/assets-manifest.json': JSON.stringify({ pages: ['index.html'], directories: [], files: [] }),
    'app/package.json': '{}', 'app/package-lock.json': '{}', 'app/scripts/stage-web.mjs': '',
    'app/scripts/package-android.mjs': '', 'app/scripts/android-package-policy.mjs': '',
    'app/src-tauri/tauri.conf.json': JSON.stringify(config), 'app/src-tauri/tauri.app.conf.json': '{}',
    'app/src-tauri/Cargo.toml': '', 'app/src-tauri/Cargo.lock': '', 'app/src-tauri/build.rs': '',
    'app/src-tauri/src/lib.rs': 'current Rust', 'app/src-tauri/capabilities/app.json': '{}',
    'app/src-tauri/icons/icon.png': 'icon', 'app/node_modules/@tauri-apps/cli/tauri.js': 'MOCK-ONLY',
  };
  for (const [name, content] of Object.entries(files)) await put(join(root, name), content);
  for (const name of ['build.gradle.kts', 'settings.gradle', 'gradle.properties', 'gradle/wrapper/gradle-wrapper.jar',
    'buildSrc/src/main/java/RustPlugin.kt', 'buildSrc/build.gradle.kts', 'app/proguard-rules.pro',
    'app/src/main/AndroidManifest.xml', 'app/src/main/res/values/strings.xml', 'tauri.settings.gradle',
    'app/tauri.build.gradle.kts', 'app/proguard-tauri.pro', 'app/src/main/java/io/example/learn/MainActivity.kt',
    'app/src/main/java/io/example/learn/generated/Rust.kt']) await put(join(android, name), 'fixture');
  await put(join(android, 'app/build.gradle.kts'), 'namespace = "io.example.learn"\napplicationId = "io.example.learn"\n');
  await put(join(android, 'app/tauri.properties'), props);
  const env = { JAVA_HOME: join(root, 'java & tool'), ANDROID_HOME: join(root, 'sdk'), NDK_HOME: join(root, 'ndk') };
  await mkdir(env.ANDROID_HOME);
  await put(join(env.JAVA_HOME, 'bin/java.exe'), 'MOCK-ONLY');
  await put(join(env.NDK_HOME, 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'), 'MOCK-ONLY');
  const calls = [];
  const stage = async () => {
    const page = await readFile(join(root, 'index.html'));
    await put(join(app, 'dist-web/index.html'), page);
    await put(join(app, 'dist-web/staged-manifest.json'), JSON.stringify({ format: 1, owner: 'lang-learn-stage', files: { 'index.html': sha(page) } }));
  };
  const outputs = join(android, 'app/build/outputs/apk/universal/debug');
  const run = async (exe, args, opts) => {
    calls.push({ exe, args, opts });
    assert.equal(opts.shell, false);
    assert.equal(opts.windowsHide, true);
    if (basename(args[0]) === 'stage-web.mjs') {
      await stage();
      return { status: 0, log: 'staged' };
    }
    if (args.includes('android')) {
      const target = TARGETS.find(value => value.target === args[args.indexOf('--target') + 1]);
      const source = join(opts.env.CARGO_TARGET_DIR, target.triple, 'release', LIB);
      const destination = join(android, 'app/src/main/jniLibs', target.abi, LIB);
      if (!options.noFresh) await put(source, elf(options.wrongAbi ? 3 : target.machine));
      if (options.restage && target === TARGETS[1]) {
        await put(join(root, 'index.html'), 'changed website');
        await stage();
      }
      if (options.nativeChange && target === TARGETS[1]) await put(join(opts.env.CARGO_TARGET_DIR, TARGETS[0].triple, 'release', LIB), elf(183, 'tampered'));
      if (options.staleVersion) await put(join(android, 'app/tauri.properties'), props.replace('1000', '999'));
      if (options.generatedChange && target === TARGETS[1]) await put(join(android, 'app/tauri.build.gradle.kts'), 'changed dependency');
      if (options.failSecond && target === TARGETS[1]) return { status: 1, log: 'error: could not compile crate' };
      if (options.success) return { status: 0, log: 'success' };
      return { status: 1, log: 'Finished `release` profile [optimized] target(s) in 5s\n' +
        `Error failed to build Android app: Failed to create a symbolic link from ${JSON.stringify(source)} to file ${JSON.stringify(destination)} (file clobbering enabled): Creation symbolic link is not allowed for this system.` };
    }
    if (basename(exe) === 'llvm-strip.exe') {
      await put(args[2], await readFile(args[3]));
      return { status: 0, log: '' };
    }
    assert.equal(basename(exe), 'java.exe');
    assert.equal(args[2], 'org.gradle.wrapper.GradleWrapperMain');
    assert.ok(args.includes('assembleUniversalDebug'));
    if (options.gradleFailure) return { status: 1, log: 'BUILD FAILED' };
    if (!options.noApk) {
      await put(join(outputs, 'app-universal-debug.apk'), 'MOCK APK');
      await put(join(outputs, 'output-metadata.json'), JSON.stringify({ applicationId: identity.identifier,
        variantName: 'universalDebug', elements: [{ versionCode: options.badMetadata ? 1 : 1000,
          versionName: '0.1.0', outputFile: 'app-universal-debug.apk' }] }));
    }
    return { status: 0, log: 'mock Gradle success' };
  };
  return { root, app, android, calls, outputs, stage,
    execute: () => packageAndroid({ appDir: app, env, platform: 'win32', run, report() {} }) };
}

test('完整 fallback 流程：當次兩 ABI、shell-free、版本與 SHA receipt；每次隔離目錄不同', async t => {
  const f = await fixture(t);
  const first = await f.execute();
  assert.equal(first.receipt.usage, 'DEBUG-TEST-ONLY');
  assert.deepEqual(first.receipt.identity, identity);
  assert.deepEqual(first.receipt.builds.map(value => value.abi), ['arm64-v8a', 'x86_64']);
  assert.ok(first.receipt.builds.every(value => value.outcome === 'windows-symlink-fallback'));
  assert.equal(first.receipt.apk.sha256, sha(await readFile(first.apk)));
  assert.equal(first.receipt.inputs['index.html'], sha('current website'));
  const second = await f.execute();
  assert.notEqual(first.receipt.runId, second.receipt.runId);
  assert.equal(await readFile(join(dirname(second.receiptPath), 'previous-debug/app-universal-debug.apk'), 'utf8'), 'MOCK APK');
  assert.deepEqual(f.calls.filter(call => call.args.includes('android')).map(call => call.args[call.args.indexOf('--target') + 1]), ['aarch64', 'x86_64', 'aarch64', 'x86_64']);
});
test('Tauri 正常成功也必須有當次庫才能 Debug 補包', async t => {
  const f = await fixture(t, { success: true });
  const result = await f.execute();
  assert.ok(result.receipt.builds.every(value => value.outcome === 'tauri-success'));
});
for (const [name, options, pattern] of [
  ['舊庫存在但未產生當次庫', { noFresh: true }, /當次/],
  ['第二 ABI Rust 失敗', { failSecond: true }, /建置失敗/],
  ['重 stage 後不得把第一 ABI 舊庫當新庫', { restage: true }, /來源|網站/],
  ['版本 properties 過期', { staleVersion: true }, /properties/],
  ['產物 ABI 錯誤', { wrongAbi: true }, /ABI/],
  ['第一 ABI 產物中途被換掉', { nativeChange: true }, /原生庫/],
  ['generated 輸入跨 ABI 改變', { generatedChange: true }, /generated/],
  ['Gradle 失敗', { gradleFailure: true }, /命令失敗/],
  ['Gradle 成功但只有上一輪 APK', { noApk: true }, /ENOENT/],
  ['APK metadata 版本錯誤', { badMetadata: true }, /metadata/],
]) {
  test(`整合拒絕：${name}，不產生成功 receipt`, async t => {
    const f = await fixture(t, options);
    for (const target of TARGETS) await put(join(f.app, 'src-tauri/target', target.triple, 'release', LIB), elf(target.machine, 'OLD'));
    await put(join(f.outputs, 'app-universal-debug.apk'), 'OLD APK');
    await assert.rejects(f.execute(), pattern);
    const dirs = (await readdir(join(f.app, 'src-tauri/target'))).filter(name => name.startsWith('android-debug-'));
    for (const dir of dirs) assert.ok(!(await readdir(join(f.app, 'src-tauri/target', dir))).includes('receipt-debug.json'));
    if (!options.gradleFailure && !options.noApk && !options.badMetadata) assert.ok(!f.calls.some(call => basename(call.exe) === 'java.exe'));
  });
}
test('鎖阻擋第二個入口，無任何外部命令', async t => {
  const f = await fixture(t);
  await put(join(f.app, 'src-tauri/target/android-package.lock'), 'other invocation');
  await assert.rejects(f.execute(), /打包鎖/);
  assert.equal(f.calls.length, 0);
});
test('無 shell runner 將特殊字元視為普通 argv（只執行 Node）', async () => {
  const value = 'space & echo INJECTED | %TEMP% $(whoami) "quote"';
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv[1]))', value], {});
  assert.equal(result.status, 0);
  assert.equal(result.log, JSON.stringify(value));
});
