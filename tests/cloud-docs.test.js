/**
 * T21：雲端同步的使用者說明、隱私頁、部署手冊與任務對照。
 * 只檢查文件是否據實描述行為與限制；不代表功能已部署。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('help.html 不再宣稱沒有雲端同步，並說明同步規則與衝突限制', () => {
  const help = read('help.html');
  assert.equal(help.includes('沒有做自動雲端同步'), false);
  assert.equal(help.includes('沒有帳號、沒有後端'), false);
  assert.match(help, /id="cloud-sync"/);
  assert.match(help, /只能保留其中一邊/);
  assert.match(help, /白名單/);
  assert.match(help, /隱私權說明/);
  /**
   * APP 版不打包 privacy.html，help.html 不能放靜態連結；連結由網站版的雲端畫面動態加上。
   */
  assert.equal(help.includes('privacy.html'), false);
});

test('help.html 的「紀錄會存多久」有錨點，搬家提示可以直接連過去', () => {
  assert.match(read('help.html'), /id="storage"/);
});

test('privacy.html 說明保存內容、用途、刪除方式與沒有端到端加密', () => {
  assert.equal(existsSync(join(root, 'privacy.html')), true);
  const page = read('privacy.html');
  for (const phrase of ['email', '刪除我的雲端資料', '端到端加密', '學習紀錄', 'Cloudflare', '本機']) {
    assert.ok(page.includes(phrase), '隱私頁缺少：' + phrase);
  }
  assert.match(page, /renderRootNav\('privacy'\)/);
});

test('部署手冊列出擁有者設定、secret 與白名單指令，且只用假資料', () => {
  const doc = read('docs/cloud-setup.md');
  for (const phrase of ['wrangler secret put GOOGLE_CLIENT_SECRET', "role = 'owner'", 'd1 migrations apply', '/api/auth/callback', 'ACCESS_MODE']) {
    assert.ok(doc.includes(phrase), '手冊缺少：' + phrase);
  }
  const emails = doc.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const email of emails) assert.match(email, /@example\.(com|org)$/, '手冊只能使用範例 email：' + email);
  assert.equal(/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i.test(doc), false, '手冊不得寫入實際的 workers.dev 網址');
});

test('任務對照工具涵蓋 add-cloud-sync 的全部情境', () => {
  const output = execFileSync(process.execPath, [join(root, 'openspec/tools/check-task-coverage.mjs')], { encoding: 'utf8' });
  const total = Number(/規格情境 (\d+)/.exec(output)?.[1]);
  assert.ok(total >= 110 + 50, '應在既有 110 個情境外再包含 add-cloud-sync 的 50 個，實際總數 ' + total);
  assert.match(read('openspec/tools/check-task-coverage.mjs'), /add-cloud-sync\/tasks\.md/);
});
