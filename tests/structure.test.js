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
    if (['node_modules', '.git', 'openspec', 'vendor', 'tests'].includes(name)) continue;
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

test('12 個頁面都存在', () => {
  const expected = [
    'index.html',
    'help.html',
    'en/index.html', 'en/alphabet.html', 'en/vocabulary.html', 'en/grammar.html', 'en/quiz.html',
    'ja/index.html', 'ja/kana.html', 'ja/vocabulary.html', 'ja/grammar.html', 'ja/quiz.html',
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

/* ── 分層邊界 ─────────────────────────────────────────────── */

test('speechSynthesis 只出現在 ui/speech.js', () => {
  const offenders = jsFiles
    .filter((f) => rel(f) !== 'assets/js/ui/speech.js')
    .filter((f) => /speechSynthesis|SpeechSynthesisUtterance/.test(readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [], 'Web Speech API 必須集中在 speech.js');
});

test('core 層不得碰 DOM 或 localStorage', () => {
  const coreFiles = jsFiles.filter((f) => rel(f).startsWith('assets/js/core/'));
  assert.ok(coreFiles.length >= 6, '找不到 core 模組');

  const offenders = [];
  for (const file of coreFiles) {
    const src = readFileSync(file, 'utf8');
    /* 註解裡提到這些字沒關係，只看實際的程式碼 */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of ['document.', 'window.', 'localStorage']) {
      if (code.includes(forbidden)) offenders.push(`${rel(file)} 使用了 ${forbidden}`);
    }
  }
  assert.deepEqual(offenders, [], `core 層必須維持純函式：\n${offenders.join('\n')}`);
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
