/**
 * 為每頁產生 <link rel="modulepreload">：把頁面啟動會用到的程式模組全部列在 <head>，
 * 讓瀏覽器讀完 HTML 就一次平行下載，不必等上一層模組下載完才發現下一層（線上每層一次往返）。
 * 只收靜態 import 的封閉集合；分級題庫等依使用者選擇才載入的資料不預載。
 * --check 只核對，不寫入；只改寫自己帶標記的區塊。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'app/assets-manifest.json'), 'utf8'));
const START = '<!-- build-preload：由 tools/build-preload.mjs 產生，勿手改；讓頁面需要的模組平行下載 -->';
const END = '<!-- /build-preload -->';

/**
 * page-boot.js 依 data-page 動態載入的模組（相對 assets/js/）。新增頁面或改動 page-boot 時一併更新，
 * 瀏覽器測試 module-preload 會檢查每頁實際載入的程式模組都已預載。
 */
function bootModules(lang, page) {
  if (!lang) return ['ui/learning-backup-view.js', 'ui/google-backup-view.js'];
  const catalog = ['data/catalog.js'];
  return {
    home: ['ui/stats-view.js', ...catalog, 'ui/today-card.js'],
    quiz: [...catalog, 'ui/quiz-view.js'],
    daily: [...catalog, 'ui/daily-view.js'],
    vocab: [...catalog, 'ui/vocab-view.js'],
    grammar: [...catalog, 'ui/grammar-view.js'],
    library: [...catalog, 'ui/library-view.js'],
    history: ['ui/history-view.js'],
    practice: ['ui/practice-view.js', `data/${lang}/practice.js`],
    pron: ['ui/kana-view.js', lang === 'ja' ? 'data/ja/kana.js' : 'data/en/alphabet.js'],
  }[page] ?? (() => { throw new Error(`build-preload 不認得的頁面：${lang}/${page}`); })();
}

/**
 * 靜態 import／export-from 的相對路徑（不含 import()，那是按需載入）。
 */
const staticImports = (source) => [...source.matchAll(/\b(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);

const sources = new Map();
async function closure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!sources.has(file)) sources.set(file, await readFile(file, 'utf8'));
    for (const spec of staticImports(sources.get(file))) queue.push(resolve(dirname(file), spec));
  }
  return [...seen];
}

const check = process.argv.includes('--check');
const stale = [];
for (const name of manifest.pages) {
  const file = join(root, name);
  const html = await readFile(file, 'utf8');
  const body = html.match(/<body([^>]*)>/)?.[1] ?? '';
  const lang = body.match(/data-lang="([^"]+)"/)?.[1];
  const page = body.match(/data-page="([^"]+)"/)?.[1];
  const entries = [];
  for (const [, attrs, inline] of html.matchAll(/<script\b([^>]*\btype="module"[^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    if (src) entries.push(resolve(dirname(file), src));
    else entries.push(...staticImports(inline).map((spec) => resolve(dirname(file), spec)));
  }
  if (entries.some((entry) => entry.endsWith(`${sep}ui${sep}page-boot.js`))) {
    entries.push(...bootModules(lang, page).map((path) => join(root, 'assets/js', path)));
  }
  const modules = await closure(entries);
  const links = modules.map((path) => `<link rel="modulepreload" href="${relative(dirname(file), path).split(sep).join('/').replace(/^(?!\.)/, './')}">`);
  /* 沿用該頁 theme.css 那行的換行，Windows 簽出（CRLF）與 CI（LF）都核對得過 */
  const eol = /theme\.css">\r\n/.test(html) ? '\r\n' : '\n';
  const block = [START, ...links, END].join(eol);
  const begin = html.indexOf(START);
  let next;
  if (begin >= 0) {
    const stop = html.indexOf(END, begin);
    if (stop < 0) throw new Error(`${name} 的 build-preload 區塊沒有結尾標記`);
    next = html.slice(0, begin) + block + html.slice(stop + END.length);
  } else {
    const anchor = html.match(/<link rel="stylesheet" href="[^"]*theme\.css">\r?\n/);
    if (!anchor) throw new Error(`${name} 找不到 theme.css，無法插入預載區塊`);
    const at = anchor.index + anchor[0].length;
    next = html.slice(0, at) + block + eol + html.slice(at);
  }
  if (next === html) continue;
  if (check) stale.push(name);
  else await writeFile(file, next);
}
if (check && stale.length) throw new Error(`modulepreload 與模組相依不同步，請執行 node tools/build-preload.mjs：${stale.join('、')}`);
console.log(`PASS preload ${manifest.pages.length} 頁${check ? '' : '（已更新）'}`);
