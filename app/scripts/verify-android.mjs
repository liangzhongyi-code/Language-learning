/**
 * Android（模擬器或 USB 真機）驗證：adb 安裝 debug APK、啟動、經 WebView DevTools socket 以 CDP 檢查
 * 21 頁、每日作答落盤、CSP／導覽阻擋；強制結束重開與覆蓋安裝（同簽章更新）後紀錄仍在。
 * 只操作空白 LangLearn_QA_ 測試模擬器；不解除安裝或清除既有資料。
 * 用法：node app/scripts/verify-android.mjs <apk 路徑> <模擬器序號>
 */
import { execFileSync } from 'node:child_process';
import { _android } from 'playwright';
import { readFileSync } from 'node:fs';
import { assertVerificationTarget, isPackagedAppUrl } from './android-verification.mjs';

const [apk, serial] = process.argv.slice(2);
if (!apk || !serial) { console.error('用法：node app/scripts/verify-android.mjs <apk> <serial>'); process.exit(1); }
const PKG = 'io.github.liangzhongyicode.langlearn';
const adbPath = `${process.env.ANDROID_HOME || `${process.env.LOCALAPPDATA}\\Android\\Sdk`}\\platform-tools\\adb.exe`;
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', timeout: 60000 }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGES = JSON.parse(readFileSync(new URL('../assets-manifest.json', import.meta.url), 'utf8')).pages;
const isApp = isPackagedAppUrl;

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

/**
 * 透過 Playwright 的 Android 支援連到「本套件」的 WebView；只接受 APP 本機頁面。
 */
let device = null;
async function launch() {
  if (!device) {
    const devices = await _android.devices();
    device = devices.find((d) => !serial || d.serial() === serial);
    if (!device) throw new Error('找不到指定的 Android 裝置');
  }
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  /**
   * 強制結束後 Playwright 可能仍快取舊程序的 WebView；只接受目前 PID 的 WebView，
   * 否則 page() 會連到已關閉的 socket 而無限等待。
   */
  let pid = 0;
  for (let i = 0; i < 40 && !pid; i++) {
    try { pid = Number(adb('shell', 'pidof', PKG)); } catch { await sleep(250); }
  }
  if (!pid) throw new Error('APP 沒有啟動');
  let webview = null;
  for (let i = 0; i < 120 && !webview; i++) {
    webview = device.webViews().find((w) => w.pkg() === PKG && w.pid() === pid) ?? null;
    if (!webview) await sleep(250);
  }
  if (!webview) throw new Error(`找不到 PID ${pid} 的 WebView`);
  const page = await webview.page();
  for (let i = 0; i < 40 && !isApp(page.url()); i++) await sleep(250);
  if (!isApp(page.url())) throw new Error(`WebView 不是 APP 本機頁：${page.url()}`);
  return { browser: null, page };
}

const stop = async () => { adb('shell', 'am', 'force-stop', PKG); await sleep(1500); };

/**
 * 比對測試 APP 的全部 IndexedDB 集合與偏好；不只比較畫面上的完成題數。
 */
const snapshot = (page) => page.evaluate(async () => {
  const records = {};
  for (const info of (await indexedDB.databases()).sort((a, b) => a.name.localeCompare(b.name))) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(info.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = [...db.objectStoreNames].sort();
      records[info.name] = await new Promise((resolve, reject) => {
        const transaction = db.transaction(names, 'readonly');
        const rows = {};
        for (const name of names) {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => { rows[name] = request.result; };
        }
        transaction.oncomplete = () => resolve(Object.fromEntries(names.map((name) => [name, rows[name]])));
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }
  return JSON.stringify({ records, prefs: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])) });
});

assertVerificationTarget({ serial, emulator: adb('shell', 'getprop', 'ro.kernel.qemu'),
  avdName: adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim(), installedPath: adb('shell', 'pm', 'list', 'packages', PKG) });
console.log(`裝置：${adb('shell', 'getprop', 'ro.product.model')}／Android ${adb('shell', 'getprop', 'ro.build.version.release')}／${adb('shell', 'getprop', 'ro.product.cpu.abi')}`);
try {
check('安裝 APK', /Success/.test(adb('install', apk)));
adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
adb('shell', 'svc', 'wifi', 'disable');
adb('shell', 'svc', 'data', 'disable');
check('離線驗證：飛航模式且 Wi-Fi 關閉', adb('shell', 'settings', 'get', 'global', 'airplane_mode_on') === '1'
  && adb('shell', 'settings', 'get', 'global', 'wifi_on') === '0');

let { browser, page } = await launch();
const origin = new URL(page.url()).origin;
check('APP 啟動並載入本機首頁', isApp(page.url()), page.url());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const path of PAGES) {
  errors.length = 0;
  await page.goto(`${origin}/${path}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(400);
  const ready = await page.evaluate(() => document.querySelector('.topbar') !== null && document.querySelector('main')?.innerText.length > 20);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(`頁面 ${path}`, ready && errors.length === 0 && !overflow, [errors.join(' | ').slice(0, 160), overflow ? '水平溢出' : ''].filter(Boolean).join(' '));
}
if (process.env.SCREENSHOT_DIR) {
  await page.goto(`${origin}/ja/index.html`);
  await sleep(1200);
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/android-ja.png` });
}
await page.goto(`${origin}/ja/daily.html`);
await page.locator('[data-continue]').waitFor({ timeout: 20000 });
await page.locator('[data-continue]').click();
await page.locator('[data-start]').click();
await page.locator('[data-opt]').first().waitFor();
await page.locator('[data-opt]').first().click();
await page.waitForFunction(() => document.querySelector('[data-next]')?.disabled === false, null, { timeout: 20000 });
check('每日頁作答一題並保存', await page.locator('main').innerText().then((text) => text.includes('已保存')));
const saved = await snapshot(page);
const outbound = await page.evaluate(() => fetch('https://example.invalid/').then(() => 'reachable', () => 'blocked'));
check('CSP 擋下對外連線', outbound === 'blocked', outbound);
await page.evaluate(() => { location.href = 'https://example.invalid/'; });
await sleep(1500);
check('導覽白名單擋下外部網址', isApp(page.url()), page.url());

await stop(browser);
({ browser, page } = await launch());
check('強制結束重開後全部集合與偏好一致', await snapshot(page) === saved);
await page.goto(`${origin}/ja/daily.html`);
await page.locator('.daily-summary').waitFor({ timeout: 20000 });
let summary = await page.locator('.daily-summary').innerText();
check('強制結束重開後紀錄仍在', /已完成 1/.test(summary), summary.replace(/\s+/g, ' '));

const beforeUpdate = await snapshot(page);
await stop();
check('同簽章覆蓋安裝（更新）', /Success/.test(adb('install', '-r', apk)));
({ browser, page } = await launch());
check('同版本覆蓋安裝後全部集合與偏好一致', await snapshot(page) === beforeUpdate);
await page.goto(`${origin}/ja/daily.html`);
await page.locator('.daily-summary').waitFor({ timeout: 20000 });
summary = await page.locator('.daily-summary').innerText();
check('覆蓋安裝後紀錄仍在', /已完成 1/.test(summary), summary.replace(/\s+/g, ' '));
await stop(browser);
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exitCode = failed ? 1 : 0;
} finally {
  if (device) {
    await stop().catch(() => {});
    await device.close().catch(() => {});
  }
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable');
}
