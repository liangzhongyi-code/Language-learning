import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'assets/js/ui/theme-boot.js'), 'utf8');

/**
 * 用最小的瀏覽器替身執行真正的啟動腳本，不只搜尋原始碼字串。
 */
function boot(raw, throws = false) {
  const document = { documentElement: { dataset: {} } };
  const window = {
    localStorage: {
      getItem() {
        if (throws) throw new Error('storage disabled');
        return raw;
      },
    },
  };
  vm.runInNewContext(source, { window, document, JSON });
  return document.documentElement.dataset.theme;
}

test('主題啟動腳本在 CSS 前套用已保存的淺色模式', () => {
  assert.equal(boot(JSON.stringify({ theme: 'light' })), 'light');
});

test('主題啟動腳本對深色、壞資料與停用儲存都安全退回深色', () => {
  assert.equal(boot(JSON.stringify({ theme: 'dark' })), 'dark');
  assert.equal(boot('{broken'), 'dark');
  assert.equal(boot(null), 'dark');
  assert.equal(boot(null, true), 'dark');
});
