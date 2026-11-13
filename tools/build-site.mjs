/**
 * 把網站需要的檔案以白名單複製到 dist-site/，作為 Cloudflare Workers 的靜態資源目錄。
 * 只複製 SITE_ENTRIES 列出的項目；新增的資料夾預設不公開，必須明確加入清單。
 * 用法：node tools/build-site.mjs（wrangler dev／deploy 會自動先執行）。
 */
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'dist-site');

/**
 * 公開的網站項目；可選項目不存在時略過（例如尚未建立的頁面）。
 */
export const SITE_ENTRIES = [
  { path: 'index.html', required: true },
  { path: 'help.html', required: true },
  { path: 'privacy.html', required: false },
  { path: 'admin.html', required: false },
  { path: 'en', required: true },
  { path: 'ja', required: true },
  { path: 'assets', required: true },
];

/**
 * 清空並重建輸出目錄，回傳實際複製的項目路徑。
 */
export function buildSite({ root = ROOT, outDir = OUT_DIR } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const copied = [];
  for (const { path, required } of SITE_ENTRIES) {
    const source = join(root, path);
    if (!existsSync(source)) {
      if (required) throw new Error('缺少網站必要項目：' + path);
      continue;
    }
    cpSync(source, join(outDir, path), { recursive: true });
    copied.push(path);
  }
  return copied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const copied = buildSite();
  console.log('dist-site：' + copied.join('、'));
}
