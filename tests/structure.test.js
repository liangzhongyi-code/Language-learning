import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 這一支測的不是行為，而是「架構約定有沒有被違反」。
 * 這些規則靠 code review 守很容易漏，寫成測試就不會。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 遞迴收集副檔名符合的檔案。
 *
 * tests 也要跳過：這一支測的是「原始碼有沒有違反架構約定」，
 * 而測試本身就會出現 speechSynthesis 這種被禁的字串（在 regex 裡），
 * 掃自己會變成自我指涉的誤判。
 */
function collect(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'openspec', 'tests'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, ext, out);
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const htmlFiles = collect(ROOT, '.html');
const jsFiles = collect(ROOT, '.js');
const cssFiles = collect(ROOT, '.css');

/* ── 頁面齊全 ─────────────────────────────────────────────── */

test('13 個頁面都存在', () => {
  const expected = [
    'index.html',
    'help.html',
    'en/index.html', 'en/alphabet.html', 'en/vocabulary.html', 'en/grammar.html', 'en/quiz.html',
    /* guide 只有日文有——英文對中文使用者沒有「三套文字混著寫」這種要先解釋的門檻 */
    'ja/index.html', 'ja/guide.html', 'ja/kana.html', 'ja/vocabulary.html', 'ja/grammar.html', 'ja/quiz.html',
  ];
  for (const page of expected) {
    assert.ok(existsSync(join(ROOT, page)), `缺少頁面：${page}`);
  }
  assert.equal(htmlFiles.length, expected.length, `HTML 檔數應為 ${expected.length}，實際 ${htmlFiles.length}`);
});

/* ── 相對路徑與零外部依賴 ─────────────────────────────────── */

test('沒有任何絕對根路徑引用，才能部署在 Pages 的子路徑底下', () => {
  for (const file of htmlFiles) {
    const src = readFileSync(file, 'utf8');
    const hits = src.match(/(?:href|src)="\//g) || [];
    assert.equal(hits.length, 0, `${rel(file)} 出現 ${hits.length} 個絕對根路徑`);
  }
});

test('沒有任何外部網域的資源引用', () => {
  for (const file of htmlFiles) {
    const src = readFileSync(file, 'utf8');
    const hits = src.match(/(?:href|src)="https?:\/\//g) || [];
    assert.equal(hits.length, 0, `${rel(file)} 引用了外部網域`);
  }
  for (const file of cssFiles) {
    const src = readFileSync(file, 'utf8');
    const hits = src.match(/url\(\s*['"]?https?:\/\//g) || [];
    assert.equal(hits.length, 0, `${rel(file)} 的 CSS 引用了外部網域`);
  }
});

test('package.json 沒有執行期依賴', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  assert.deepEqual(deps, [], `不該有 dependencies，實際：${deps}`);
});

test('存在 .nojekyll，Pages 才不會忽略底線開頭的資源', () => {
  assert.ok(existsSync(join(ROOT, '.nojekyll')));
});

/* ── 樣式集中 ─────────────────────────────────────────────── */

test('HTML 內沒有 <style> 區塊，樣式一律走 theme.css', () => {
  for (const file of htmlFiles) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/<style[\s>]/i.test(src), `${rel(file)} 內嵌了 <style>`);
  }
});

test('色碼只出現在 theme.css，其他檔案一律用 CSS 變數', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;
  const offenders = [];
  for (const file of [...jsFiles, ...cssFiles, ...htmlFiles]) {
    const name = rel(file);
    if (name === 'assets/css/theme.css') continue;
    const hits = readFileSync(file, 'utf8').match(HEX) || [];
    if (hits.length) offenders.push(`${name}：${[...new Set(hits)].join(' ')}`);
  }
  assert.deepEqual(offenders, [], `色碼外洩：\n${offenders.join('\n')}`);
});

/* ── 題庫原始碼 ───────────────────────────────────────────── */

/**
 * 找出物件實字裡重複的鍵。
 *
 * 這是手寫題庫特有的坑：JS 允許 `{ a: 1, a: 2 }`，後者靜靜覆蓋前者，
 * 不報錯、執行期驗證也看不出來，因為它只看得到最終值。
 * 只能掃原始碼文字。
 *
 * 只把「前一個非空白字元是 { 或 ,」的 `名稱:` 當成物件鍵，
 * 避免把三元運算子的 `cond ? a : b` 誤判成鍵。
 */
function findDuplicateKeys(source) {
  const KEY = /([A-Za-z_$][\w$]*)\s*:/y;
  const found = [];
  const stack = [];
  let i = 0;
  let line = 1;
  let quote = null;
  let prev = '';

  while (i < source.length) {
    const c = source[i];
    if (c === '\n') line += 1;

    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '{') { stack.push(new Map()); prev = c; i += 1; continue; }
    if (c === '}') { stack.pop(); prev = c; i += 1; continue; }

    if (stack.length && (prev === '{' || prev === ',')) {
      KEY.lastIndex = i;
      const m = KEY.exec(source);
      if (m) {
        const scope = stack[stack.length - 1];
        if (scope.has(m[1])) found.push(`${m[1]}：第 ${scope.get(m[1])} 行與第 ${line} 行重複`);
        else scope.set(m[1], line);
        i = KEY.lastIndex;
        prev = ':';
        continue;
      }
    }

    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return found;
}

test('題庫檔案沒有重複的物件鍵（重複鍵會被靜靜覆蓋，執行期驗證抓不到）', () => {
  const dataFiles = jsFiles.filter((f) => rel(f).startsWith('assets/js/data/'));
  assert.ok(dataFiles.length >= 8, '找不到題庫檔');

  const offenders = [];
  for (const file of dataFiles) {
    const dups = findDuplicateKeys(readFileSync(file, 'utf8'));
    if (dups.length) offenders.push(`${rel(file)}\n  ${dups.join('\n  ')}`);
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}`);
});

test('重複鍵偵測本身是有效的（自我驗證）', () => {
  const good = 'export const a = [{ id: 1, zh: "x" }, { id: 2, zh: "y" }];';
  const bad = 'export const a = [{ id: 1, zh: "x", id: 3 }];';
  const ternary = 'const x = cond ? alpha : beta; const o = { a: 1 };';
  assert.deepEqual(findDuplicateKeys(good), []);
  assert.equal(findDuplicateKeys(bad).length, 1, '應該抓到重複的 id');
  assert.deepEqual(findDuplicateKeys(ternary), [], '三元運算子不可被誤判為物件鍵');
});

/* ── 文字對比度 ───────────────────────────────────────────── */

/**
 * 從 theme.css 的 :root 取出所有十六進位色彩變數
 */
function themeColors() {
  const css = readFileSync(join(ROOT, 'assets/css/theme.css'), 'utf8');
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const map = {};
  for (const m of root.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) map[m[1]] = m[2];
  return map;
}

/**
 * WCAG 2.1 的相對亮度
 */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 兩色的對比度，1 到 21
 */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('對比度計算本身正確（自我驗證）', () => {
  assert.equal(Math.round(contrast('#ffffff', '#000000')), 21);
  assert.equal(Math.round(contrast('#ffffff', '#ffffff')), 1);
});

test('內文色在所有表面上都達到 WCAG AA 的 4.5:1', () => {
  const c = themeColors();
  const surfaces = ['--bg', '--surface', '--surface-2', '--surface-3'];
  /**
   * 全部用在實際內文上的色，不是純裝飾。
   *
   * 前三個是文字三階（頁面說明、卡片說明、統計引導文案）。
   * 後四個是語意色，它們同樣會直接當文字顏色用——
   * 例如備份面板的警告文字、答對／答錯的回饋、首頁的到期題數。
   * 少了它們，README 承諾的「文字顏色在任何表面上都達到 AA」就是空頭支票：
   * 有人拿 --warn 加一段新文字並把色調暗，測試會全綠而實際跌破 4.5:1。
   */
  const foregrounds = ['--text', '--dim', '--mute', '--accent', '--ok', '--bad', '--warn'];

  const failures = [];
  for (const fg of foregrounds) {
    for (const bg of surfaces) {
      const ratio = contrast(c[fg], c[bg]);
      if (ratio < 4.5) failures.push(`${fg}(${c[fg]}) on ${bg}(${c[bg]}) = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

test('語法角色色在色塊底色上達到 4.5:1', () => {
  const c = themeColors();
  /* 色塊底色是角色色 15% 疊在 --surface 上，取近似的最壞情況直接比 --surface */
  const failures = [];
  for (const [name, hex] of Object.entries(c)) {
    if (!name.startsWith('--r-')) continue;
    const ratio = contrast(hex, c['--surface']);
    if (ratio < 4.5) failures.push(`${name}(${hex}) = ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

/* ── 分層邊界 ─────────────────────────────────────────────── */

test('speechSynthesis 只出現在 ui/speech.js', () => {
  const offenders = jsFiles
    .filter((f) => rel(f) !== 'assets/js/ui/speech.js')
    .filter((f) => /speechSynthesis|SpeechSynthesisUtterance/.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [], 'Web Speech API 必須集中在 speech.js');
});

/**
 * core 層一律不得碰的全域。
 *
 * 用詞界比對而不是 `'document.'` 這種子字串比對——後者擋不住
 * `const d = document;`、`globalThis.document`、`const { document } = globalThis`
 * 這幾種等效寫法，等於留了三個後門。
 */
const BROWSER_GLOBALS = /\b(document|window|globalThis|self|localStorage|sessionStorage|navigator|location|alert|fetch)\b/;

/**
 * 不在上面清單裡、core 可以用的 Web API——它們同時存在於 Node 18+ 與瀏覽器，
 * 純值進純值出、沒有環境狀態，所以 node:test 直接跑得動。目前用到的：
 *   TextEncoder / TextDecoder、btoa / atob、CompressionStream / DecompressionStream（core/backup-code.js）
 * 要加新的請先確認兩件事：Node 也有、以及它不會摸到使用者環境
 * （Blob 的 URL、crypto.subtle 的金鑰、structuredClone 的 transfer 都不算純運算）。
 */

test('core 層不得碰 DOM 或瀏覽器全域', () => {
  const coreFiles = jsFiles.filter((f) => rel(f).startsWith('assets/js/core/'));
  assert.ok(coreFiles.length >= 6, '找不到 core 模組');

  const offenders = [];
  for (const file of coreFiles) {
    const src = readFileSync(file, 'utf8');
    /* 註解裡提到這些字沒關係，只看實際的程式碼 */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const hit = code.match(BROWSER_GLOBALS);
    if (hit) offenders.push(`${rel(file)} 使用了 ${hit[1]}`);
  }
  assert.deepEqual(offenders, [], `core 層必須維持純函式：\n${offenders.join('\n')}`);
});

test('core 層的守門測試本身擋得住等效寫法（自我驗證）', () => {
  const bypasses = [
    'const d = document;',
    'globalThis.document.body',
    'const { document } = globalThis;',
    'sessionStorage.setItem("a", 1)',
    'navigator.language',
  ];
  for (const code of bypasses) {
    assert.match(code, BROWSER_GLOBALS, `這種寫法應該被擋下：${code}`);
  }
  assert.doesNotMatch('const documentation = 1;', BROWSER_GLOBALS, '詞界比對不可誤判相似字');
});

test('core 層不得 import ui 層', () => {
  const offenders = jsFiles
    .filter((f) => rel(f).startsWith('assets/js/core/'))
    .filter((f) => /from\s+['"][^'"]*\/ui\//.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [], '依賴方向必須是 頁面 → UI → Core → 資料');
});

/* ── 頁面樣板一致性 ─────────────────────────────────────────── */

test('每個頁面都有 charset、viewport 與 theme.css', () => {
  for (const file of htmlFiles) {
    const src = readFileSync(file, 'utf8');
    const name = rel(file);
    assert.match(src, /<meta charset="utf-8">/i, `${name} 缺 charset`);
    assert.match(src, /name="viewport"/i, `${name} 缺 viewport`);
    assert.match(src, /assets\/css\/theme\.css/, `${name} 沒有載入 theme.css`);
    assert.match(src, /<html lang="zh-Hant">/, `${name} 缺 lang 屬性`);
  }
});

test('語言子頁都標了 data-lang 與 data-page 供導覽列使用', () => {
  for (const file of htmlFiles.filter((f) => /\/(en|ja)\//.test(rel(f)))) {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /data-lang="(en|ja)"/, `${rel(file)} 缺 data-lang`);
    assert.match(src, /data-page="[a-z]+"/, `${rel(file)} 缺 data-page`);
  }
});

test('沒有巢狀 button，避免瀏覽器重組 DOM 結構', () => {
  for (const file of htmlFiles) {
    const src = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    let depth = 0;
    let maxDepth = 0;
    for (const tag of src.match(/<\/?button[\s>]/gi) || []) {
      depth += tag.startsWith('</') ? -1 : 1;
      maxDepth = Math.max(maxDepth, depth);
    }
    assert.ok(maxDepth <= 1, `${rel(file)} 有巢狀 <button>`);
    assert.equal(depth, 0, `${rel(file)} 的 <button> 開合不平衡`);
  }
});
