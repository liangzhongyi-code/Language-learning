/**
 * Android 覆蓋更新驗證：在空白 LangLearn_QA_ 模擬器先裝舊版（WebView IndexedDB）並作答，
 * 再以新版 APK 覆蓋安裝（同 Debug 簽章），確認新版改用原生 SQLite、全部學習集合原樣搬入、
 * 舊 IndexedDB 保留，且更新後可繼續作答。不解除安裝、不清除既有資料。
 * 用法：node app/scripts/verify-upgrade-android.mjs <舊版 apk> <新版 apk> <模擬器序號>
 */
import { execFileSync } from 'node:child_process';
import { _android } from 'playwright';
import { assertVerificationTarget, isPackagedAppUrl } from './android-verification.mjs';

const [oldApk, newApk, serial] = process.argv.slice(2);
if (!oldApk || !newApk || !serial) { console.error('用法：node app/scripts/verify-upgrade-android.mjs <舊版 apk> <新版 apk> <serial>'); process.exit(1); }
const PKG = 'io.github.liangzhongyicode.langlearn';
const adbPath = `${process.env.ANDROID_HOME || `${process.env.LOCALAPPDATA}\\Android\\Sdk`}\\platform-tools\\adb.exe`;
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 120000 }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const t0 = Date.now();
const step = (text) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${text}`);
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

let device = null;
/**
 * 只接受目前 PID 的 WebView：強制結束或更新後，Playwright 可能仍快取舊程序。
 */
async function launch() {
  if (!device) device = (await _android.devices()).find((d) => d.serial() === serial);
  if (!device) throw new Error('找不到指定的 Android 裝置');
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  step('已啟動 Activity');
  let pid = 0;
  for (let i = 0; i < 40 && !pid; i++) { try { pid = Number(adb('shell', 'pidof', PKG)); } catch { await sleep(250); } }
  let webview = null;
  for (let i = 0; i < 120 && !webview; i++) {
    webview = device.webViews().find((w) => w.pkg() === PKG && w.pid() === pid) || null;
    if (!webview) await sleep(250);
  }
  if (!webview) throw new Error(`找不到 PID ${pid} 的 WebView`);
  step(`連線 PID ${pid} 的 WebView`);
  const page = await webview.page();
  step(`頁面 ${page.url()}`);
  for (let i = 0; i < 40 && !isPackagedAppUrl(page.url()); i++) await sleep(250);
  return page;
}
const stop = async () => { adb('shell', 'am', 'force-stop', PKG); await sleep(1500); };
const snapshot = (page) => page.evaluate(async () => {
  const store = (await import('/assets/js/ui/platform/learning-store.js')).getLearningStore();
  const { PORTABLE_STORES } = await import('/assets/js/core/learning-snapshot.js');
  const { canonicalJson } = await import('/assets/js/core/learning-operations.js');
  const { rows } = await store.read([...PORTABLE_STORES]);
  const names = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name).sort() : null;
  return { kind: store.storageKind || 'indexeddb', indexedDbNames: names, rows: canonicalJson(rows, { maxBytes: 64 * 1024 * 1024 }) };
});
async function answerOneDaily(page) {
  const origin = new URL(page.url()).origin;
  step('開始每日作答');
  await page.goto(`${origin}/ja/daily.html`);
  await page.locator('[data-continue]').waitFor({ timeout: 20000 });
  await page.locator('[data-continue]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  await page.locator('[data-opt]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-next]')?.disabled === false, null, { timeout: 20000 });
  await page.goto(`${origin}/ja/daily.html`);
  await page.locator('.daily-summary').waitFor({ timeout: 20000 });
  return page.locator('.daily-summary').innerText();
}

assertVerificationTarget({ serial, emulator: adb('shell', 'getprop', 'ro.kernel.qemu'),
  avdName: adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim(), installedPath: adb('shell', 'pm', 'list', 'packages', PKG) });
try {
  check('安裝舊版 APK（IndexedDB）', /Success/.test(adb('install', oldApk)));
  let page = await launch();
  const oldSummary = await answerOneDaily(page);
  const oldData = await snapshot(page);
  check('舊版作答並存在 IndexedDB', oldData.kind === 'indexeddb' && /已完成 1/.test(oldSummary), `${oldData.kind} ${oldSummary.replace(/\s+/g, ' ')}`);
  await stop();
  check('新版 APK 覆蓋安裝（同簽章更新）', /Success/.test(adb('install', '-r', newApk)));
  page = await launch();
  const newData = await snapshot(page);
  check('新版改用原生 SQLite', newData.kind === 'native-sqlite', newData.kind);
  check('舊版全部學習集合原樣搬入 SQLite', newData.rows === oldData.rows);
  check('舊 IndexedDB 保留未刪（可回復來源）', Array.isArray(newData.indexedDbNames) && newData.indexedDbNames.includes('lang-learn.learning'));
  const second = await answerOneDaily(page);
  check('更新後可繼續作答並保存', /已完成 2/.test(second), second.replace(/\s+/g, ' '));
  const afterSecond = await snapshot(page);
  await stop();
  page = await launch();
  const reopened = await snapshot(page);
  check('更新後強制結束重開，SQLite 全部集合完全相同', reopened.kind === 'native-sqlite' && reopened.rows === afterSecond.rows);
  await stop();
} finally {
  if (device) await device.close().catch(() => {});
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exitCode = failed ? 1 : 0;
