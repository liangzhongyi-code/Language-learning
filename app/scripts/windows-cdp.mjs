/**
 * 以 WebView2 遠端除錯啟動 APP exe 並連線。每次選一個目前沒有任何程式在聽的隨機埠，
 * 只有該埠上所有 page 都是 APP 本機頁時才連線，絕不連到使用者自己的瀏覽器。
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const isApp = (url) => /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)\//.test(url);

async function listTargets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    return await response.json();
  } catch { return null; }
}

async function freePort() {
  for (let i = 0; i < 20; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    if (await listTargets(port) === null) return port;
  }
  throw new Error('找不到可用的除錯埠');
}

export async function launchApp(exe) {
  const port = await freePort();
  const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'ignore' });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  for (let i = 0; i < 60 && exited === null; i++) {
    const pages = ((await listTargets(port)) || []).filter((t) => t.type === 'page');
    if (pages.length && pages.every((t) => isApp(t.url))) {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts()[0]?.pages().find((p) => isApp(p.url()));
      if (page) return { child, browser, page };
    }
    await sleep(500);
  }
  child.kill();
  throw new Error(exited !== null ? `APP 已結束（代碼 ${exited}）` : 'APP 啟動後找不到本機頁面');
}

const IDENTIFIER = JSON.parse(readFileSync(new URL('../src-tauri/tauri.app.conf.json', import.meta.url), 'utf8')).identifier;

/**
 * 本 APP 的 WebView2 子程序數量（以命令列中的資料目錄識別碼比對，不碰其他程式）。
 */
function webviewProcesses() {
  const script = `@(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${IDENTIFIER}*' }).Count`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()) || 0;
}

/**
 * 結束 APP 後等它的 WebView2 子程序全部退出；殘留的子程序會讓下一次以不同除錯參數
 * 啟動時建立 WebView2 環境失敗（APP 立即結束），屬測試工具時序而非 APP 行為。
 */
export async function closeApp({ child, browser }) {
  await browser.close().catch(() => {});
  child.kill();
  for (let i = 0; i < 40 && webviewProcesses() > 0; i++) await sleep(500);
  if (webviewProcesses() > 0) throw new Error('APP 的 WebView2 子程序未在 20 秒內結束');
  await sleep(500);
}

/**
 * 從頁面內讀出儲存種類與完整可攜集合（不含 meta），作為重開／升級前後的比對依據。
 */
export function storageSnapshot(page) {
  return page.evaluate(async () => {
    const store = (await import('/assets/js/ui/platform/learning-store.js')).getLearningStore();
    const { PORTABLE_STORES } = await import('/assets/js/core/learning-snapshot.js');
    const { canonicalJson } = await import('/assets/js/core/learning-operations.js');
    const { rows } = await store.read([...PORTABLE_STORES]);
    const names = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name).sort() : null;
    /* 鍵排序固定的 JSON：SQLite 端可能重排物件欄位，比對內容而非欄位順序 */
    return { kind: store.storageKind || 'indexeddb', rows: canonicalJson(rows, { maxBytes: 64 * 1024 * 1024 }), indexedDbNames: names };
  });
}

/**
 * 在每日頁開始並作答一題，回傳保存後的摘要文字。
 */
export async function answerOneDaily(page, origin) {
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
