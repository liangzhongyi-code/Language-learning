/**
 * 先驗證白名單候選包，再替換受管理輸出；不遞迴刪除、不跟隨連結。
 */
import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, realpath, rename, unlink, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, basename, relative, resolve, sep, extname, posix, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET = /(^|\/)(?:\.env.*|.*\.(?:key|pem|p12|pfx|jks|keystore|mobileprovision|cer)|id_(?:rsa|ed25519)(?:\.pub)?)$/i;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/;
const EXTENSIONS = new Set(['.html', '.css', '.js', '.md', '.svg', '.png', '.ico', '.woff2']);
const MARKER = 'staged-manifest.json';
const busy = new Set();

function fail(message) {
  const error = new Error(message);
  error.code = 'STAGE_FAILED';
  throw error;
}

function safeName(name) {
  if (typeof name !== 'string' || !name || /[\\:%?#\x00-\x1f]/.test(name) ||
      name.startsWith('/') || name.split('/').some(p => !p || p === '..')) fail('拒絕非法路徑：' + name);
  if (SECRET.test(name) || name.split('/').some(p => p.startsWith('.'))) fail('拒絕隱藏機密、金鑰或憑證：' + name);
  if (/(^|\/)(?:tests?|docs|reports?|openspec|node_modules)(\/|$)|\.(?:test|spec)\./i.test(name)) fail('拒絕測試或報告：' + name);
  if (name.split('/').some(p => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)|[. ]$/i.test(p))) fail('拒絕不安全檔名：' + name);
  return name;
}

/**
 * 檢查完整祖先鏈，避免来源、輸出或父目錄的 junction／symlink 導向包外。
 */
async function noLinks(path, allowMissing = false) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail('拒絕符號連結：' + current);
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function walk(dir) {
  await noLinks(dir);
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) fail('拒絕符號連結：' + full);
    if (info.isDirectory()) files.push(...await walk(full));
    else if (info.isFile() && info.nlink === 1) files.push(full);
    else fail('拒絕非一般檔案或硬連結：' + full);
  }
  return files;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function decodeReference(raw) {
  try {
    return decodeURIComponent(raw.replace(/&amp;/gi, '&').replace(/&#(x[0-9a-f]+|\d+);?/gi,
      (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))));
  } catch { fail('拒絕非法編碼引用：' + raw); }
}

function scriptReferences(text) {
  return [...text.matchAll(/\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
    .map(m => ({ raw: m[1] ?? m[2], resource: true }));
}

/**
 * 檢查靜態 HTML、ES module 與 CSS 引用；動態 DOM／URL 留待原生驗收。
 */
function checkReferences(contents) {
  for (const [file, content] of contents) {
    const ext = extname(file);
    if (!['.html', '.js', '.css', '.svg'].includes(ext)) continue;
    const text = content.toString('utf8');
    const refs = [];
    if (ext === '.html' || ext === '.svg') {
      for (const tag of text.matchAll(/<([a-z][\w:-]*)\b([^>]*?)>/gi)) {
        if (tag[1].toLowerCase() === 'base') fail('拒絕 base 改變引用基準：' + file);
        for (const attr of tag[2].matchAll(/\b(href|src|srcset|poster|action|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          const raw = attr[2] ?? attr[3] ?? attr[4];
          const resource = !(['a', 'area'].includes(tag[1].toLowerCase()) && attr[1].toLowerCase() === 'href');
          if (attr[1].toLowerCase() === 'srcset') {
            for (const candidate of raw.split(',')) refs.push({ raw: candidate.trim().split(/\s+/)[0], resource: true });
          } else refs.push({ raw, resource });
        }
      }
      for (const script of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) refs.push(...scriptReferences(script[1]));
    }
    if (ext === '.js') refs.push(...scriptReferences(text));
    if (ext === '.css') {
      refs.push(...[...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|@import\s+["']([^"']+)["']/gi)]
        .map(m => ({ raw: m[1] ?? m[2] ?? m[3] ?? m[4], resource: true })));
    }
    for (const { raw, resource } of refs) {
      const ref = decodeReference(raw).trim();
      if (!ref || ref.startsWith('#')) continue;
      if (/^(?:https?:|\/\/)/i.test(ref)) {
        if (resource) fail(file + ' 引用遠端資源：' + raw);
        continue;
      }
      if (/^[a-z][\w+.-]*:/i.test(ref)) fail(file + ' 拒絕非法 scheme／包外引用：' + raw);
      if (ref.startsWith('/') || /[\\\x00-\x1f]/.test(ref)) fail(file + ' 指向包外：' + raw);
      if (ext === '.js' && !ref.startsWith('./') && !ref.startsWith('../')) fail(file + ' 拒絕未綁定模組：' + raw);
      const path = ref.split(/[?#]/)[0];
      if (!path) continue;
      let target = posix.normalize(posix.join(posix.dirname(file), path));
      if (target === '..' || target.startsWith('../')) fail(file + ' 指向包外：' + raw);
      if (path.endsWith('/')) target = posix.join(target, 'index.html');
      if (!contents.has(target)) fail(file + ' 引用不存在：' + raw);
    }
  }
}

async function outputInventory(out, root) {
  await noLinks(out, true);
  try { await lstat(out); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!(await lstat(out)).isDirectory()) fail('輸出目錄不是一般目錄。');
  const files = (await walk(out)).map(file => relative(out, file).split(sep).join('/')).sort();
  if (!files.length && !(await readdir(out)).length) return [];
  let previous;
  try { previous = JSON.parse(await readFile(join(out, MARKER), 'utf8')); } catch { fail('輸出含未受管理的資料。'); }
  if (previous.format !== 1 || previous.owner !== 'lang-learn-stage' || previous.sourceRoot !== root ||
      !previous.files || Array.isArray(previous.files) || typeof previous.files !== 'object') fail('輸出含未受管理的資料。');
  const expected = Object.keys(previous.files).sort();
  if (JSON.stringify(files) !== JSON.stringify([...expected, MARKER].sort())) fail('輸出含未受管理的檔案。');
  for (const file of expected) {
    safeName(file);
    if (!/^[a-f0-9]{64}$/.test(previous.files[file]) || digest(await readFile(join(out, file))) !== previous.files[file]) fail('輸出含未受管理或已修改的檔案：' + file);
  }
  const expectedDirs = new Set();
  for (const file of files) {
    let parent = posix.dirname(file);
    while (parent !== '.') { expectedDirs.add(parent); parent = posix.dirname(parent); }
  }
  async function checkDirs(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isDirectory()) {
      const child = join(dir, entry.name);
      if (!expectedDirs.has(relative(out, child).split(sep).join('/'))) fail('輸出含未受管理的空目錄。');
      await checkDirs(child);
    }
  }
  await checkDirs(out);
  return files;
}

/**
 * 只移除盤點過的候選／舊包檔案，以 rmdir 移除空目錄，絕不 recursive delete。
 */
async function removeOwned(dir, files) {
  await noLinks(dir);
  const dirs = new Set([dir]);
  for (const file of files) {
    const full = join(dir, file);
    await noLinks(full);
    if (!(await lstat(full)).isFile()) fail('拒絕清理非一般檔案：' + full);
    await unlink(full);
    let parent = dirname(full);
    while (parent !== dir) { dirs.add(parent); parent = dirname(parent); }
  }
  for (const path of [...dirs].sort((a, b) => b.length - a.length)) await rmdir(path);
}

export async function stageWeb({ root, out, manifest }) {
  const absRoot = resolve(root);
  const absOut = resolve(out);
  const standard = join(absRoot, 'app', 'dist-web');
  const testOutput = dirname(absOut) === resolve(tmpdir()) && /^stage-(?:out|safe-out|real)-[A-Za-z0-9]{6}$/.test(basename(absOut));
  if (absOut !== standard && !testOutput) fail('輸出目錄只允許 app/dist-web 或專用測試暫存目錄。');
  if (absOut === absRoot || absRoot.startsWith(absOut + sep) || (absOut.startsWith(absRoot + sep) && absOut !== standard)) fail('輸出目錄與來源重疊。');
  if (busy.has(absOut)) fail('輸出目錄已有打包工作。');
  busy.add(absOut);
  let candidate;
  const created = [];
  try {
    await noLinks(absRoot);
    if (!(await lstat(absRoot)).isDirectory()) fail('來源不是目錄。');
    const canonicalRoot = await realpath(absRoot);
    await noLinks(absOut, true);
    await outputInventory(absOut, canonicalRoot);
    if (!manifest || !Array.isArray(manifest.pages) || !manifest.pages.length || !Array.isArray(manifest.directories) ||
        !Array.isArray(manifest.files ?? []) || !Array.isArray(manifest.allowedExtensions) ||
        manifest.allowedExtensions.some(ext => !EXTENSIONS.has(ext))) fail('拒絕非法 manifest／副檔名。');
    const allowed = new Set(manifest.allowedExtensions);
    const contents = new Map();
    const add = async (name, explicit = false) => {
      safeName(name);
      if (!allowed.has(extname(name))) { if (explicit) fail('拒絕不允許副檔名：' + name); return; }
      const full = join(absRoot, name);
      await noLinks(full);
      const info = await lstat(full);
      if (!info.isFile() || info.nlink !== 1) fail('拒絕非一般檔案或硬連結：' + name);
      const content = await readFile(full);
      if (PRIVATE_KEY.test(content.toString('utf8'))) fail('拒絕內含機密金鑰：' + name);
      contents.set(name, content);
    };
    for (const page of manifest.pages) {
      safeName(page);
      if (!/^(?:(?:index|help)\.html|(?:en|ja)\/[\w-]+\.html|app\/prototype\/[\w-]+\.html)$/.test(page)) fail('拒絕非白名單頁面：' + page);
      try { await add(page, true); } catch (error) { if (error.code === 'ENOENT') fail('缺少必要頁面：' + page); throw error; }
    }
    for (const file of manifest.files ?? []) {
      safeName(file);
      if (file !== 'CREDITS.md') fail('拒絕非白名單檔案或副檔名：' + file);
      await add(file, true);
    }
    for (const dir of manifest.directories) {
      safeName(dir);
      if (!['assets/js', 'assets/css', 'app/prototype'].includes(dir)) fail('拒絕非白名單目錄：' + dir);
      for (const file of await walk(join(absRoot, dir))) await add(relative(absRoot, file).split(sep).join('/'));
    }
    checkReferences(contents);
    const files = [...contents.keys()].sort();
    const hashes = Object.fromEntries(files.map(file => [file, digest(contents.get(file))]));
    await mkdir(dirname(absOut), { recursive: true });
    await noLinks(dirname(absOut));
    candidate = await mkdtemp(join(dirname(absOut), '.stage-candidate-'));
    for (const file of files) {
      const full = join(candidate, file);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents.get(file), { flag: 'wx' });
      created.push(file);
    }
    await writeFile(join(candidate, MARKER), JSON.stringify({ format: 1, owner: 'lang-learn-stage', sourceRoot: canonicalRoot, files: hashes }, null, 2), { flag: 'wx' });
    created.push(MARKER);
    const previousFiles = await outputInventory(absOut, canonicalRoot);
    let previous;
    try {
      await lstat(absOut);
      previous = await mkdtemp(join(dirname(absOut), '.stage-previous-'));
      await rmdir(previous);
      await rename(absOut, previous);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(candidate, absOut); candidate = undefined; }
    catch (error) { if (previous) await rename(previous, absOut); throw error; }
    if (previous) {
      try { await outputInventory(previous, canonicalRoot); await removeOwned(previous, previousFiles); }
      catch { return { files, retainedPrevious: previous }; }
    }
    return { files };
  } finally {
    busy.delete(absOut);
    if (candidate) await removeOwned(candidate, created);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const manifest = JSON.parse(await readFile(join(appDir, 'assets-manifest.json'), 'utf8'));
    const result = await stageWeb({ root: resolve(appDir, '..'), out: join(appDir, 'dist-web'), manifest });
    console.log('已整理 ' + result.files.length + ' 個檔案到 app/dist-web');
    if (result.retainedPrevious) console.warn('舊輸出保留於 ' + result.retainedPrevious + '，請人工檢查。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
