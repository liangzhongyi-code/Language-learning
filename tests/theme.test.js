import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { normalizeAppearance, PALETTES, BACKGROUNDS } from '../assets/js/core/appearance.js';
import { exportPayload, parseBackup } from '../assets/js/core/backup.js';

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
  return document.documentElement.dataset;
}

test('主題啟動腳本在 CSS 前套用已保存的淺色模式', () => {
  assert.equal(boot(JSON.stringify({ theme: 'light' })).theme, 'light');
});

test('主題啟動腳本對深色、壞資料與停用儲存都安全退回深色', () => {
  assert.equal(boot(JSON.stringify({ theme: 'dark' })).theme, 'dark');
  assert.equal(boot('{broken').theme, 'dark');
  assert.equal(boot(null).theme, 'dark');
  assert.equal(boot(null, true).theme, 'dark');
});

test('外觀啟動腳本與模組正規化在全部 48 種組合一致', () => {
  for (const theme of ['dark', 'light']) for (const { value: palette } of PALETTES) {
    for (const { value: background } of BACKGROUNDS) for (const reducedEffects of [false, true]) {
      const value = { theme, palette, background, reducedEffects };
      assert.deepEqual(boot(JSON.stringify(value)), { ...normalizeAppearance(value), reducedEffects: String(reducedEffects) });
    }
  }
});

test('外觀拒絕未知值與假布林，舊備份缺欄位仍可用', () => {
  for (const value of [null, [], 9, {}, { theme: 'light' }, { palette: 'constructor', background: '__proto__', reducedEffects: 'false' }]) {
    const expected = normalizeAppearance(value);
    assert.deepEqual(boot(JSON.stringify(value)), { ...expected, reducedEffects: String(expected.reducedEffects) });
  }
  assert.deepEqual(normalizeAppearance(null), { theme: 'dark', palette: 'classic', background: 'aurora', reducedEffects: false });
  assert.deepEqual(boot(null, true), { theme: 'dark', palette: 'classic', background: 'aurora', reducedEffects: 'false' });
});

test('外觀偏好隨原有備份往返且不吃掉學習偏好', () => {
  const prefs = { theme: 'light', palette: 'forest', background: 'dust', reducedEffects: true, kanjiMode: 'kana', grammarLines: false };
  const parsed = parseBackup(JSON.stringify(exportPayload({ prefs }, 123)));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.prefs, prefs);
});
