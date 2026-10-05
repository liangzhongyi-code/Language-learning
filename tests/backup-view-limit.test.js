import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initBackupPanel } from '../assets/js/ui/backup-view.js';
import { PREFS_KEY } from '../assets/js/ui/prefs.js';
import { BACKUP_JSON_MAX_BYTES } from '../assets/js/core/backup-limits.js';

test('複製代碼超限：真實事件路徑顯示限制、檔案保留退路與還原限制', async (t) => {
  const previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const handlers = new Map();
  const elements = [];
  const mount = {
    contains: () => false,
    replaceChildren: () => {},
    querySelector: selector => ({ addEventListener: (event, handler) => handlers.set(`${selector}:${event}`, handler) }),
  };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      activeElement: null,
      createElement: () => {
        const element = { setAttribute() {}, click() {} };
        elements.push(element);
        return element;
      },
    } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
      getItem: key => key === PREFS_KEY ? JSON.stringify({ note: '字'.repeat(Math.ceil(BACKUP_JSON_MAX_BYTES / 3)) }) : null,
    } } });
    initBackupPanel(mount);
    await handlers.get('[data-copy-code]:click')();
    const status = elements[1];
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /10 MiB/);
    assert.match(status.textContent, /下載檔案/);
    assert.match(status.textContent, /保留/);
    assert.match(status.textContent, /不保證.*匯入|仍.*匯入.*限制/);
    assert.doesNotMatch(status.textContent, /已複製|任何裝置.*匯入/);
    t.mock.method(URL, 'createObjectURL', () => 'blob:backup-fixture');
    t.mock.method(URL, 'revokeObjectURL', () => {});
    handlers.get('[data-export]:click')();
    assert.match(status.textContent, /還原.*格式.*大小/);
    assert.doesNotMatch(status.textContent, /任何裝置.*匯入/);
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
