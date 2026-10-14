/**
 * 僅供 Debug 測試，不能當作正式發布或簽章更新流程。
 * 用法：node app/scripts/package-android.mjs（Windows；JAVA_HOME、ANDROID_HOME、NDK_HOME）
 * 每次以隔離 Cargo 目錄重建兩個 ABI；只對已完成 Rust 的 symlink 權限錯誤補包。
 * receipt 與當次目錄留在已忽略的 src-tauri/target；失敗產物不會被下次採用。
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, lstat, readdir, realpath, rename, unlink, copyFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, sep, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeConfig, expectedIdentity, checkProperties, acceptBuild, assertSame } from './android-package-policy.mjs';

export const LIB = 'liblang_learn_native_prototype_lib.so';
export const TARGETS = [
  { triple: 'aarch64-linux-android', abi: 'arm64-v8a', arch: 'Arm64', target: 'aarch64', machine: 183 },
  { triple: 'x86_64-linux-android', abi: 'x86_64', arch: 'X86_64', target: 'x86_64', machine: 62 },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`拒絕非一般檔案或連結：${path}`);
  return info;
}
async function directory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`拒絕非一般目錄：${path}`);
}
async function within(root, path) {
  const base = await realpath(root), actual = await realpath(path), rel = relative(base, actual);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== actual) throw new Error(`路徑超出工作區：${path}`);
}
async function hashTree(path, root, files) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`拒絕來源連結：${path}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await hashTree(join(path, name), root, files);
  } else {
    await regular(path);
    files[slash(relative(root, path))] = sha(await readFile(path));
  }
}
async function sourceSnapshot(root) {
  const app = join(root, 'app');
  const manifest = await json(join(app, 'assets-manifest.json'));
  const files = {};
  const inputs = ['app/assets-manifest.json', 'app/package.json', 'app/package-lock.json',
    'app/scripts/stage-web.mjs', 'app/scripts/package-android.mjs', 'app/scripts/android-package-policy.mjs',
    'app/src-tauri/Cargo.toml', 'app/src-tauri/Cargo.lock', 'app/src-tauri/build.rs',
    'app/src-tauri/src', 'app/src-tauri/capabilities', 'app/src-tauri/icons',
    'app/src-tauri/tauri.conf.json', 'app/src-tauri/tauri.app.conf.json',
    ...(manifest.pages ?? []), ...(manifest.directories ?? []), ...(manifest.files ?? [])];
  for (const name of inputs) {
    if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.startsWith('/') || name.split('/').includes('..')) throw new Error('非法來源清單');
    await within(root, join(root, name));
    await hashTree(join(root, name), root, files);
  }
  for (const name of ['.cargo', 'app/.cargo', 'app/src-tauri/.cargo', 'app/src-tauri/tauri.android.conf.json']) {
    if (await exists(join(root, name))) await hashTree(join(root, name), root, files);
  }
  const android = join(app, 'src-tauri/gen/android');
  for (const name of ['build.gradle.kts', 'settings.gradle', 'gradle.properties', 'gradle/wrapper',
    'buildSrc/src', 'buildSrc/build.gradle.kts', 'app/build.gradle.kts', 'app/proguard-rules.pro',
    'app/src/main/AndroidManifest.xml', 'app/src/main/res']) await hashTree(join(android, name), root, files);
  return files;
}
async function stagedSnapshot(app) {
  const dist = join(app, 'dist-web'), files = {};
  await hashTree(dist, dist, files);
  const marker = await json(join(dist, 'staged-manifest.json'));
  if (marker.format !== 1 || marker.owner !== 'lang-learn-stage' || !marker.files || Array.isArray(marker.files)) throw new Error('無有效 staged SHA 清單');
  const actual = { ...files };
  delete actual['staged-manifest.json'];
  assertSame(marker.files, actual, 'staged SHA 清單');
  return files;
}
async function generatedSnapshot(android, identity) {
  const files = {};
  for (const name of ['tauri.settings.gradle', 'app/tauri.build.gradle.kts', 'app/tauri.properties', 'app/proguard-tauri.pro',
    `app/src/main/java/${identity.identifier.replaceAll('.', '/')}`]) await hashTree(join(android, name), android, files);
  const assets = join(android, 'app/src/main/assets');
  if (await exists(assets)) await hashTree(assets, android, files);
  return files;
}
async function readIdentity(app) {
  const tauri = join(app, 'src-tauri');
  for (const name of ['Tauri.toml', 'Tauri.android.toml', 'tauri.conf.json5', 'tauri.android.conf.json5']) {
    if (await exists(join(tauri, name))) throw new Error('此 Debug 入口只支援 JSON config，拒絕未核對的額外設定');
  }
  let config = await json(join(tauri, 'tauri.conf.json'));
  if (await exists(join(tauri, 'tauri.android.conf.json'))) config = mergeConfig(config, await json(join(tauri, 'tauri.android.conf.json')));
  config = mergeConfig(config, await json(join(tauri, 'tauri.app.conf.json')));
  if (config.build?.frontendDist !== '../dist-web' || config.build?.beforeBuildCommand !== 'npm run stage') throw new Error('此 Debug 入口只支援既有 stage-web／dist-web 建置流程');
  const identity = expectedIdentity(config);
  const gradle = await readFile(join(tauri, 'gen/android/app/build.gradle.kts'), 'utf8');
  for (const key of ['namespace', 'applicationId']) {
    const matches = [...gradle.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, 'gm'))];
    if (matches.length !== 1 || matches[0][1] !== identity.identifier) throw new Error(`Gradle ${key} 與 config 識別碼不符`);
  }
  return identity;
}
/**
 * Cargo 的最終產物是 deps/ 內同名檔的硬連結（nlink 2）。只在第二個連結正是同一個
 * Cargo 目錄的 deps/ 檔案（同 dev／inode）時接受；其他硬連結或符號連結一律拒絕。
 */
export async function cargoArtifact(path) {
  const info = await lstat(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`拒絕非一般檔案或連結：${path}`);
  if (info.nlink === 1n) return;
  const deps = join(dirname(path), 'deps', basename(path));
  const twin = await lstat(deps, { bigint: true }).catch(() => null);
  if (info.nlink !== 2n || !twin || !twin.isFile() || twin.isSymbolicLink()
      || twin.ino !== info.ino || twin.dev !== info.dev || twin.nlink !== 2n) {
    throw new Error(`拒絕非一般檔案或連結：${path}`);
  }
}

async function library(path, machine, { cargo = false } = {}) {
  if (cargo) await cargoArtifact(path);
  else await regular(path);
  const bytes = await readFile(path);
  if (bytes.length < 64 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes[4] !== 2 || bytes[5] !== 1 ||
      bytes.readUInt16LE(16) !== 3 || bytes.readUInt16LE(18) !== machine) throw new Error('當次原生庫不是預期 ABI 的 ELF shared library');
  return { sha256: sha(bytes), bytes: bytes.length };
}

/**
 * 直接啟動 Node、java.exe、llvm-strip.exe；不經 shell、cmd 或 .bat 拼接參數。
 */
export function runProcess(executable, args, options) {
  return new Promise(resolveResult => {
    const child = spawn(executable, args, { ...options, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '', error;
    const capture = stream => chunk => {
      stream.write(chunk);
      log += chunk.toString();
      if (Buffer.byteLength(log) > 16 * 1024 * 1024) { error = new Error('建置日誌超出 16 MiB，拒絕截斷後判定'); child.kill(); }
    };
    child.stdout.on('data', capture(process.stdout));
    child.stderr.on('data', capture(process.stderr));
    child.on('error', value => { error = value; });
    child.on('close', (status, signal) => resolveResult({ status, signal, error, log }));
  });
}

export async function packageAndroid({ appDir = join(dirname(fileURLToPath(import.meta.url)), '..'),
  env = process.env, platform = process.platform, run = runProcess, report = console.log } = {}) {
  report('僅供 Debug 測試：非正式發布，未提供 release 簽章／更新保證。');
  if (platform !== 'win32') throw new Error('此補包入口目前只支援 Windows');
  if (env.TAURI_CONFIG) throw new Error('請移除 TAURI_CONFIG，避免隱藏設定覆蓋');
  const app = resolve(appDir), root = dirname(app), tauri = join(app, 'src-tauri'), android = join(tauri, 'gen/android');
  for (const name of ['JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME']) {
    if (!env[name]) throw new Error(`缺少 ${name}`);
    await directory(env[name]);
  }
  const cli = join(app, 'node_modules/@tauri-apps/cli/tauri.js');
  const java = join(env.JAVA_HOME, 'bin/java.exe');
  const strip = join(env.NDK_HOME, 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe');
  const wrapper = join(android, 'gradle/wrapper/gradle-wrapper.jar');
  for (const path of [cli, java, strip, wrapper]) await regular(path);
  const targetRoot = join(tauri, 'target');
  await mkdir(targetRoot, { recursive: true });
  await directory(targetRoot);
  await within(root, targetRoot);
  const lockPath = join(targetRoot, 'android-package.lock');
  const lock = await open(lockPath, 'wx').catch(error => { throw new Error(`無法取得打包鎖（若上次中斷，確認無建置後人工移除 ${lockPath}）：${error.code}`); });
  try {
    const runDir = await mkdtemp(join(targetRoot, 'android-debug-'));
    const cargo = join(runDir, 'cargo');
    await mkdir(cargo);
    const buildEnv = { ...env, CARGO_TARGET_DIR: cargo, CARGO_TERM_COLOR: 'never', NO_COLOR: '1', CI: 'true' };
    const checkedRun = async (executable, args, cwd) => {
      const result = await run(executable, args, { cwd, env: buildEnv, shell: false, windowsHide: true });
      if (result.status !== 0 || result.signal || result.error) throw new Error(`命令失敗：${basename(executable)} ${args[0] ?? ''}`);
      return result;
    };
    const identity = await readIdentity(app), inputs = await sourceSnapshot(root);
    await checkedRun(process.execPath, [join(app, 'scripts/stage-web.mjs')], app);
    assertSame(inputs, await sourceSnapshot(root), '來源');
    const staged = await stagedSnapshot(app);
    const unchanged = async () => {
      assertSame(inputs, await sourceSnapshot(root), '來源');
      assertSame(staged, await stagedSnapshot(app), '網站資源');
      assertSame(identity, await readIdentity(app), '設定版本');
    };
    const builds = [];
    let generated;
    for (const t of TARGETS) {
      await unchanged();
      const source = join(cargo, t.triple, 'release', LIB);
      const destination = join(android, 'app/src/main/jniLibs', t.abi, LIB);
      if (await exists(source)) throw new Error('隔離目錄已有原生庫，拒絕冒充當次產出');
      const result = await run(process.execPath, [cli, 'android', 'build', '--apk', '--target', t.target,
        '--config', 'src-tauri/tauri.app.conf.json'], { cwd: app, env: buildEnv, shell: false, windowsHide: true });
      await writeFile(join(runDir, `${t.abi}.log`), result.log ?? '', { flag: 'wx' });
      const fresh = !!await exists(source);
      const outcome = acceptBuild({ result, platform, source, destination, fresh });
      await within(cargo, source);
      const native = await library(source, t.machine, { cargo: true });
      await unchanged();
      checkProperties(await readFile(join(android, 'app/tauri.properties'), 'utf8'), identity);
      const currentGenerated = await generatedSnapshot(android, identity);
      if (generated) assertSame(generated, currentGenerated, 'generated 輸入');
      generated = currentGenerated;
      builds.push({ ...t, source, destination, outcome, native });
    }
    const stripped = join(runDir, 'stripped');
    await mkdir(stripped);
    for (const build of builds) {
      assertSame(build.native, await library(build.source, build.machine, { cargo: true }), '原生庫');
      const outDir = join(stripped, build.abi);
      await mkdir(outDir);
      const output = join(outDir, LIB);
      await checkedRun(strip, ['--strip-unneeded', '-o', output, build.source], app);
      build.packaged = await library(output, build.machine);
      await mkdir(dirname(build.destination), { recursive: true });
      await directory(dirname(build.destination));
      await within(android, dirname(build.destination));
      for (const file of await readdir(dirname(build.destination))) {
        if (file !== LIB) throw new Error(`jniLibs 有未核對檔案，拒絕封入：${build.abi}/${file}`);
      }
      const old = await exists(build.destination);
      if (old) {
        if (!old.isFile() && !old.isSymbolicLink()) throw new Error('jniLibs 目的地不是檔案');
        await unlink(build.destination);
      }
      await copyFile(output, build.destination);
    }
    await unchanged();
    checkProperties(await readFile(join(android, 'app/tauri.properties'), 'utf8'), identity);
    assertSame(generated, await generatedSnapshot(android, identity), 'generated 輸入');
    const outputs = join(android, 'app/build/outputs/apk/universal/debug');
    if (await exists(outputs)) {
      await directory(outputs);
      await within(android, outputs);
      // 保留上一包供人工回復；不列舊 APK 為這次的成功產物。
      await rename(outputs, join(runDir, 'previous-debug'));
    }
    const skip = ['Universal', ...TARGETS.map(t => t.arch)].flatMap(arch => ['-x', `rustBuild${arch}Debug`]);
    await checkedRun(java, ['-classpath', wrapper, 'org.gradle.wrapper.GradleWrapperMain',
      'assembleUniversalDebug', '--no-daemon', '--rerun-tasks', '-PabiList=arm64-v8a,x86_64',
      '-ParchList=arm64,x86_64', '-PtargetList=aarch64,x86_64', ...skip], android);
    await unchanged();
    checkProperties(await readFile(join(android, 'app/tauri.properties'), 'utf8'), identity);
    assertSame(generated, await generatedSnapshot(android, identity), 'generated 輸入');
    for (const build of builds) {
      assertSame(build.native, await library(build.source, build.machine, { cargo: true }), '原生庫');
      assertSame(build.packaged, await library(build.destination, build.machine), '封裝原生庫');
    }
    const metadata = await json(join(outputs, 'output-metadata.json'));
    if (metadata.applicationId !== identity.identifier || metadata.variantName !== 'universalDebug' || metadata.elements?.length !== 1) throw new Error('APK metadata 身分／Debug variant 不符');
    const element = metadata.elements[0];
    if (element.versionCode !== identity.versionCode || element.versionName !== identity.versionName || element.outputFile !== 'app-universal-debug.apk') throw new Error('APK metadata 版本或檔名不符');
    const apk = join(outputs, element.outputFile);
    await regular(apk);
    const apkBytes = await readFile(apk);
    if (!apkBytes.length) throw new Error('APK 是空檔案');
    const receipt = { format: 1, usage: 'DEBUG-TEST-ONLY', runId: basename(runDir), identity, inputs, staged, generated,
      builds: builds.map(({ abi, triple, outcome, native, packaged }) => ({ abi, triple, outcome, native, packaged })),
      apk: { path: slash(relative(root, apk)), sha256: sha(apkBytes), bytes: apkBytes.length } };
    const receiptPath = join(runDir, 'receipt-debug.json');
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    report(`Debug 測試 APK：${apk}\nSHA-256：${receipt.apk.sha256}\n來源 receipt：${receiptPath}`);
    return { apk, receiptPath, receipt };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('僅供 Debug 測試；用法：node app/scripts/package-android.mjs（不接受額外參數）');
    process.exitCode = 1;
  } else {
    packageAndroid().catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
