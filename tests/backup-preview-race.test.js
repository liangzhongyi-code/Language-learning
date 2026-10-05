import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initBackupPanel } from '../assets/js/ui/backup-view.js';
import { exportPayload } from '../assets/js/core/backup.js';
import { PROGRESS_KEY } from '../assets/js/core/progress.js';
import { BACKUP_JSON_MAX_BYTES } from '../assets/js/core/backup-limits.js';

const payload = id => JSON.stringify(exportPayload({ progress: {
  schemaVersion: 1, items: { [id]: { n: 2, w: 1 } },
} }, 123));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

/**
 * 假 DOM 只提供面板所用介面；事件 handler 由實際 draw() 綁定，不重寫讀取邏輯。
 */
function fixture() {
  const saved = Object.fromEntries(['document', 'window', 'DecompressionStream'].map(
    key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const writes = [], focused = [], elements = [], handlers = new Map();
  const stored = new Map([[PROGRESS_KEY, JSON.stringify(JSON.parse(payload('ja-w-local')).progress)]]);
  let shell;
  const nodes = new Map();
  const mount = {
    contains: value => [...nodes.values()].includes(value),
    replaceChildren(first) { shell = first; },
    querySelector(selector) { return nodes.get(selector) ?? null; },
  };
  const document = {
    activeElement: null,
    createElement() {
      const element = { setAttribute() {}, click() {} };
      Object.defineProperty(element, 'innerHTML', { get() { return this.html; }, set(html) {
        this.html = html;
        nodes.clear(); handlers.clear();
        for (const match of html.matchAll(/\b(data-[a-z-]+)(?=[\s>])/g)) {
          const selector = `[${match[1]}]`;
          if (nodes.has(selector)) continue;
          const node = {
            value: selector === '[data-code]' ? html.match(/placeholder="langlearn…">([^<]*)<\/textarea>/)?.[1] ?? '' : '',
            addEventListener(event, handler) { handlers.set(`${selector}:${event}`, handler); },
            focus() { focused.push(selector); document.activeElement = node; }, select() {},
          };
          nodes.set(selector, node);
        }
      } });
      elements.push(element);
      return element;
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem(key, text) { writes.push([key, text]); stored.set(key, text); } },
    dispatchEvent() {},
  } });
  initBackupPanel(mount);
  return {
    writes, focused, stored,
    html: () => shell.innerHTML,
    message: () => elements[1].textContent,
    handler: selector => handlers.get(`${selector}:click`),
    file(read, size = 20) {
      const node = nodes.get('[data-file]');
      document.activeElement = node;
      return handlers.get('[data-file]:change')({ currentTarget: { files: [{ size, text: read }], value: 'fixture.json' } });
    },
    code(text) {
      const node = nodes.get('[data-code]'); node.value = text; document.activeElement = node;
      handlers.get('[data-code]:input')({ currentTarget: node });
      return handlers.get('[data-read-code]:click')();
    },
    delayedDecode(job, text) {
      Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: class {
        constructor() { return new TransformStream({ async transform(_, controller) {
          await job.promise; controller.enqueue(new TextEncoder().encode(text));
        } }); }
      } });
    },
    cleanup() {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test('檔案 A 晚成功／晚失敗：都不能覆蓋檔案 B 的預覽、訊息與焦點', async () => {
  for (const fails of [false, true]) {
    const ui = fixture();
    try {
      const a = deferred();
      const readingA = ui.file(() => a.promise);
      await ui.file(async () => payload('ja-w-B'));
      const html = ui.html(), message = ui.message(), focusCount = ui.focused.length;
      if (fails) a.reject(new Error('old read failed')); else a.resolve(payload('ja-w-A'));
      await readingA;
      assert.equal(ui.html(), html); assert.equal(ui.message(), message);
      assert.equal(ui.focused.length, focusCount, '舊工作不得重新搶焦點');
      ui.handler('[data-confirm]')();
      assert.deepEqual(JSON.parse(ui.writes[0][1]).items, { 'ja-w-B': { n: 2, w: 1 } });
    } finally { ui.cleanup(); }
  }
});

test('開始另一份讀取立即撤下舊確認；保留的舊 handler 也不能匯入舊資料', async () => {
  const ui = fixture();
  try {
    await ui.file(async () => payload('ja-w-old'));
    const confirmOld = ui.handler('[data-confirm]');
    const next = deferred(); const read = ui.file(() => next.promise);
    assert.doesNotMatch(ui.html(), /data-confirm/);
    confirmOld(); assert.equal(ui.writes.length, 0);
    next.resolve(payload('ja-w-next')); await read;
    ui.handler('[data-confirm]')();
    assert.deepEqual(JSON.parse(ui.writes[0][1]).items, { 'ja-w-next': { n: 2, w: 1 } });
  } finally { ui.cleanup(); }
});

test('檔案與代碼共用先後識別：舊檔案不能蓋新代碼，舊代碼不能蓋新檔案', async () => {
  const ui = fixture();
  try {
    const oldFile = deferred(); const readFile = ui.file(() => oldFile.promise);
    await ui.code(`langlearn0:${btoa(payload('ja-w-code'))}`);
    oldFile.resolve(payload('ja-w-file')); await readFile;
    ui.handler('[data-confirm]')();
    assert.ok(JSON.parse(ui.writes.at(-1)[1]).items['ja-w-code']);

    for (const fails of [false, true]) {
      const decode = deferred(); ui.delayedDecode(decode, payload('ja-w-old-code'));
      const readCode = ui.code('langlearn1:AAAA');
      await ui.file(async () => payload('ja-w-new-file'));
      const html = ui.html(), message = ui.message(), focuses = ui.focused.length;
      if (fails) decode.reject(new Error('old decode failed')); else decode.resolve();
      await readCode;
      assert.equal(ui.html(), html); assert.equal(ui.message(), message); assert.equal(ui.focused.length, focuses);
      ui.handler('[data-confirm]')();
      assert.ok(JSON.parse(ui.writes.at(-1)[1]).items['ja-w-new-file']);
    }
  } finally { ui.cleanup(); }
});

test('讀取中可取消：延遲成功及失敗不得復活預覽或錯誤訊息', async () => {
  for (const fails of [false, true]) {
    const ui = fixture();
    try {
      const job = deferred(); const read = ui.file(() => job.promise);
      const cancel = ui.handler('[data-cancel]');
      assert.equal(typeof cancel, 'function'); cancel();
      const html = ui.html(), message = ui.message(), focuses = ui.focused.length;
      if (fails) job.reject(new Error('canceled')); else job.resolve(payload('ja-w-canceled'));
      await read;
      assert.equal(ui.html(), html); assert.equal(ui.message(), message); assert.equal(ui.focused.length, focuses);
      assert.equal(ui.writes.length, 0);
    } finally { ui.cleanup(); }
  }
});

test('被重畫移除的確認／取消事件不能操作下一份新預覽，匯入不會雙寫', async () => {
  const ui = fixture();
  try {
    await ui.file(async () => payload('ja-w-old'));
    const confirmOld = ui.handler('[data-confirm]'), cancelOld = ui.handler('[data-cancel]');
    await ui.file(async () => payload('ja-w-new'));
    const html = ui.html(), message = ui.message(), focuses = ui.focused.length;
    confirmOld(); cancelOld();
    assert.equal(ui.writes.length, 0);
    assert.equal(ui.html(), html); assert.equal(ui.message(), message); assert.equal(ui.focused.length, focuses);
    const confirmNew = ui.handler('[data-confirm]'); confirmNew(); confirmNew();
    assert.equal(ui.writes.length, 1);
    assert.ok(JSON.parse(ui.writes[0][1]).items['ja-w-new']);
  } finally { ui.cleanup(); }
});

test('代碼 A 的解壓晚成功／晚失敗不能覆蓋代碼 B；讀取中的代碼也能取消', async () => {
  for (const fails of [false, true]) {
    const ui = fixture();
    try {
      const a = deferred(); ui.delayedDecode(a, payload('ja-w-old-code'));
      const readingA = ui.code('langlearn1:AAAA');
      await ui.code(`langlearn0:${btoa(payload('ja-w-new-code'))}`);
      const html = ui.html(), message = ui.message(), focuses = ui.focused.length;
      if (fails) a.reject(new Error('old code failed')); else a.resolve();
      await readingA;
      assert.equal(ui.html(), html); assert.equal(ui.message(), message); assert.equal(ui.focused.length, focuses);
      ui.handler('[data-confirm]')();
      assert.ok(JSON.parse(ui.writes[0][1]).items['ja-w-new-code']);
      const canceled = deferred(); ui.delayedDecode(canceled, payload('ja-w-canceled'));
      const read = ui.code('langlearn1:AAAA'); ui.handler('[data-cancel]')();
      const canceledHtml = ui.html();
      canceled.resolve(); await read;
      assert.equal(ui.html(), canceledHtml); assert.equal(ui.message(), ''); assert.equal(ui.writes.length, 1);
    } finally { ui.cleanup(); }
  }
});

test('部分救回的預覽只寫合法區塊，不會蓋掉既有壞區塊對應紀錄', async () => {
  const ui = fixture();
  try {
    const before = ui.stored.get(PROGRESS_KEY);
    const mixed = JSON.parse(payload('ja-w-future')); mixed.progress.schemaVersion = 99;
    mixed.prefs = { kanjiMode: 'ruby', hideKanji: false };
    await ui.file(async () => JSON.stringify(mixed));
    assert.match(ui.html(), /progress.*跳過/);
    ui.handler('[data-confirm]')();
    assert.equal(ui.stored.get(PROGRESS_KEY), before);
    assert.deepEqual(ui.writes.map(([key]) => key), ['lang-learn.prefs.v1']);
  } finally { ui.cleanup(); }
});

test('未通過 section 驗證的 future 備份不能覆寫 localStorage，超大檔案不先讀取', async () => {
  const ui = fixture();
  try {
    const before = ui.stored.get(PROGRESS_KEY);
    const bad = JSON.parse(payload('ja-w-bad')); bad.progress.schemaVersion = 99;
    await ui.file(async () => JSON.stringify(bad));
    assert.doesNotMatch(ui.html(), /data-confirm/);
    assert.equal(ui.writes.length, 0); assert.equal(ui.stored.get(PROGRESS_KEY), before);
    let reads = 0;
    await ui.file(async () => { reads++; return payload('ja-w-big'); }, BACKUP_JSON_MAX_BYTES + 1);
    assert.equal(reads, 0); assert.match(ui.message(), /10 MiB/);
  } finally { ui.cleanup(); }
});
