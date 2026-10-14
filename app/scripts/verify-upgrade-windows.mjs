/**
 * Windows 覆蓋更新驗證：先安裝舊版（WebView IndexedDB）並作答，再以新版安裝檔覆蓋安裝，
 * 確認新版改用原生 SQLite，且舊版全部學習集合原樣搬入、舊 IndexedDB 保留不刪。
 * 只在本機尚未安裝本 APP、也沒有其資料夾時執行；結束後解除安裝並刪除本次測試資料。
 * 用法：node app/scripts/verify-upgrade-windows.mjs <舊版 setup.exe> <新版 setup.exe>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, closeApp, storageSnapshot, answerOneDaily } from './windows-cdp.mjs';

const [oldSetup, newSetup] = process.argv.slice(2);
if (!oldSetup || !newSetup) { console.error('用法：node app/scripts/verify-upgrade-windows.mjs <舊版 setup.exe> <新版 setup.exe>'); process.exit(1); }
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.app.conf.json', import.meta.url), 'utf8'));
const dataDir = join(process.env.LOCALAPPDATA, config.identifier);
const installDir = join(process.env.LOCALAPPDATA, config.productName);
const exe = join(installDir, `${config.mainBinaryName}.exe`);
if (existsSync(dataDir) || existsSync(exe)) {
  console.error(`拒絕執行：本機已有本 APP 的安裝或資料（${existsSync(exe) ? exe : dataDir}）。請只在乾淨環境測試。`);
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };
const install = (setup) => { execFileSync(setup, ['/S'], { stdio: 'ignore' }); return existsSync(exe); };

try {
  check('安裝舊版（IndexedDB）', install(oldSetup));
  let app = await launchApp(exe);
  const origin = new URL(app.page.url()).origin;
  const oldSummary = await answerOneDaily(app.page, origin);
  const oldData = await storageSnapshot(app.page);
  check('舊版作答並存在 IndexedDB', oldData.kind === 'indexeddb' && /已完成 1/.test(oldSummary), `${oldData.kind} ${oldSummary.replace(/\s+/g, ' ')}`);
  await closeApp(app);

  check('新版安裝檔覆蓋安裝', install(newSetup));
  app = await launchApp(exe);
  const newData = await storageSnapshot(app.page);
  check('新版改用原生 SQLite', newData.kind === 'native-sqlite', newData.kind);
  check('舊版全部學習集合原樣搬入 SQLite', newData.rows === oldData.rows);
  check('舊 IndexedDB 保留未刪（可回復來源）', Array.isArray(newData.indexedDbNames) && newData.indexedDbNames.includes('lang-learn.learning'));
  check('SQLite 檔已建立', existsSync(join(dataDir, 'learning.sqlite3')));
  await app.page.goto(`${origin}/ja/daily.html`);
  await app.page.locator('.daily-summary').waitFor({ timeout: 20000 });
  const summary = await app.page.locator('.daily-summary').innerText();
  check('更新後今日進度仍在', /已完成 1/.test(summary), summary.replace(/\s+/g, ' '));
  const second = await answerOneDaily(app.page, origin);
  check('更新後可繼續作答並保存', /已完成 2/.test(second), second.replace(/\s+/g, ' '));
  await closeApp(app);
} finally {
  if (existsSync(join(installDir, 'uninstall.exe'))) execFileSync(join(installDir, 'uninstall.exe'), ['/S'], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
process.exitCode = failed ? 1 : 0;
