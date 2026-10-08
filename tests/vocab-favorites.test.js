import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as filters from '../assets/js/core/filter.js';
import { CATEGORY_GROUPS } from '../assets/js/data/shared/categories.js';
import { levelLabel, SCALE_NAME, SCALE_NOTE } from '../assets/js/data/shared/levels.js';
import { speakTextOf } from '../assets/js/core/speech-text.js';
import { createLibraryService } from '../assets/js/ui/platform/library-service.js';
import { FAVORITES_BOOK_ID } from '../assets/js/core/library.js';
import { emptyLearning } from '../assets/js/core/learning-schema.js';
import { storageMessage } from '../assets/js/ui/platform/learning-store.js';

const now = Date.parse('2026-10-07T00:00:00Z');
const word = (lang = 'en', n = 1) => ({ id: `${lang}-w-${n}`, target: lang === 'ja' ? '雨' : `word${n}`,
  reading: lang === 'ja' ? 'あめ' : null, romaji: lang === 'ja' ? 'ame' : null,
  zh: '測試', pos: 'noun', category: 'food', level: 1 });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(done => setImmediate(done));

/**
 * 執行真實 vocab-view 與 library service；DOM 僅模擬事件及屬性，
 * 真實鍵盤、版面與 IndexedDB 另由 vocab-favorites browser suite 驗證。
 */
function harness({ lang = 'en', words = [word(lang)], favoriteIds = [], readyWait, commitWait } = {}) {
  const listeners = new Map();
  const pageListeners = new Map();
  const visibilityListeners = new Map();
  const input = { value: '', addEventListener(type, handler) { listeners.set(`input:${type}`, handler); } };
  const count = { textContent: '' };
  const status = { textContent: '', hidden: false };
  const retry = { hidden: true, disabled: false, addEventListener(type, handler) { listeners.set(`retry:${type}`, handler); } };
  let buttons = [];
  let html = '';
  const document = { activeElement: null, visibilityState: 'visible',
    addEventListener(type, handler) { visibilityListeners.set(type, handler); } };
  const list = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      buttons = [...value.matchAll(/<button\b([^>]*data-favorite="([^"]+)"[^>]*)>/g)].map(([, attrs, id]) => {
        const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
        return { dataset: { favorite: id }, attributes, disabled: /\bdisabled\b/.test(attrs), innerHTML: '',
          setAttribute(k, v) { attributes[k] = String(v); }, getAttribute(k) { return attributes[k] ?? null; },
          closest(selector) { return selector === '[data-favorite]' ? this : null; },
          focus() { document.activeElement = this; } };
      });
    },
    addEventListener(type, handler) { listeners.set(`list:${type}`, handler); },
    querySelectorAll() { return buttons; }, contains(button) { return buttons.includes(button); },
  };
  const mount = { innerHTML: '', contains: button => buttons.includes(button),
    querySelector(selector) {
      return ({ '[type="search"]': input, '.count-line': count, '.word-list': list,
        '[data-favorites-status]': status, '[data-favorites-retry]': retry })[selector] ?? null;
    }, querySelectorAll: () => buttons };
  const rows = { books: structuredClone(emptyLearning({ now, timeZone: 'Asia/Taipei' }).library.books), notes: {}, intents: {} };
  rows.books.favorites.wordIds = [...favoriteIds];
  const meta = { revision: 0, dataEpoch: 'fixture-epoch' };
  const calls = [];
  let readError = null;
  let writeError = null;
  let readyError = null;
  const store = {
    async ready() { if (readyWait) await readyWait.promise; if (readyError) throw readyError; return meta; },
    async read() { if (readError) throw readError; return structuredClone({ meta, rows }); },
    async commit(operation) {
      calls.push(operation);
      if (commitWait) await commitWait.promise;
      if (writeError) throw writeError;
      const built = operation.build(structuredClone(rows), meta);
      for (const change of Array.isArray(built) ? built : built.changes) rows[change.store][change.key] = change.value;
      return { revision: ++meta.revision };
    },
  };
  const source = readFileSync(new URL('../assets/js/ui/vocab-view.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
  const init = vm.runInNewContext(source + '\ninitVocabPage;', {
    ...filters, CATEGORY_GROUPS, levelLabel, SCALE_NAME, SCALE_NOTE, speakTextOf,
    createLibraryService, FAVORITES_BOOK_ID, storageMessage, getLearningStore: () => store,
    applySpeechFallback() {}, bindSpeakButtons() {}, document,
    window: { addEventListener(type, handler) { pageListeners.set(type, handler); } },
    setTimeout, clearTimeout,
  });
  const ready = Promise.resolve(init({ lang, words, mount, store }));
  const click = id => listeners.get('list:click')({ target: buttons.find(b => b.dataset.favorite === id) });
  return { ready, store, rows, calls, input, count, status, retry, mount, list, document, click,
    buttons: () => buttons,
    retryLoad: () => listeners.get('retry:click')(),
    focusPage: () => pageListeners.get('focus')?.(),
    visibility: () => visibilityListeners.get('visibilitychange')?.(),
    search: async query => { input.value = query; listeners.get('input:input')(); await new Promise(done => setTimeout(done, 140)); },
    failRead: value => { readError = value; }, failWrite: value => { writeError = value; },
    failReady: value => { readyError = value; },
  };
}

test('F23 英日卡片從既有收藏簿載入，提供原生按鈕與可讀的切換狀態', async () => {
  for (const lang of ['en', 'ja']) {
    const h = harness({ lang, words: [word(lang), word(lang, 2)], favoriteIds: [`${lang}-w-1`] });
    await h.ready;
    assert.equal(h.buttons().length, 2);
    assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
    assert.match(h.buttons()[0].getAttribute('aria-label'), /取消收藏/);
    assert.ok(h.buttons()[0].getAttribute('aria-label').includes(word(lang).target));
    assert.ok(h.buttons()[0].getAttribute('aria-label').includes(word(lang).zh));
    assert.equal(h.buttons()[1].getAttribute('aria-pressed'), 'false');
    assert.match(h.buttons()[1].getAttribute('aria-label'), /收藏/);
    assert.match(h.list.innerHTML, /type="button" class="btn ghost"/);
    assert.match(h.list.innerHTML, /<svg[^>]*aria-hidden="true"/);
  }
});

test('F23 儲存就緒前禁止收藏但仍可搜尋與朗讀', async () => {
  const wait = deferred();
  const h = harness({ readyWait: wait });
  assert.equal(h.buttons().length, 1);
  assert.equal(h.buttons()[0].disabled, true);
  assert.match(h.list.innerHTML, /data-speak="word1"/);
  await h.search('word1');
  assert.equal(h.count.textContent, '目前 1 筆');
  wait.resolve();
  await h.ready;
  assert.equal(h.buttons()[0].disabled, false);
});

test('F23 收藏與取消透過真實 library service，保存完成才更新而不重建卡片', async () => {
  const h = harness();
  await h.ready;
  const button = h.buttons()[0];
  button.focus();
  await h.click('en-w-1');
  await settle();
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1']);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(h.buttons()[0], button);
  assert.equal(h.document.activeElement, button);
  await h.click('en-w-1');
  await settle();
  assert.deepEqual(h.rows.books.favorites.wordIds, []);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.match(h.status.textContent, /已取消收藏/);
});

test('F23 保存中重複點擊及搜尋重繪不會重送，也不先亮星號', async () => {
  const wait = deferred();
  const h = harness({ commitWait: wait });
  await h.ready;
  const save = h.click('en-w-1');
  assert.equal(h.buttons()[0].disabled, true);
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'false');
  await h.click('en-w-1');
  await h.search('word1');
  assert.equal(h.buttons()[0].disabled, true);
  await h.click('en-w-1');
  assert.equal(h.calls.length, 1);
  wait.resolve();
  await save;
  await settle();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.buttons()[0].disabled, false);
});

test('F23 保存失敗不假成功，按星號重試仍只加入一次', async () => {
  const h = harness();
  await h.ready;
  h.failWrite({ code: 'STORAGE_QUOTA' });
  await h.click('en-w-1');
  await settle();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'false');
  assert.equal(h.buttons()[0].disabled, false);
  assert.match(h.status.textContent, /未保存|沒有保存/);
  assert.doesNotMatch(h.status.textContent, /已收藏/);
  assert.deepEqual(h.rows.books.favorites.wordIds, []);
  h.failWrite(null);
  await h.click('en-w-1');
  await settle();
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1']);
});

test('F23 初次讀取失敗不當作空收藏，明確重試可恢復', async () => {
  const wait = deferred();
  const h = harness({ readyWait: wait, favoriteIds: ['en-w-1'] });
  h.failRead({ code: 'STORAGE_UNAVAILABLE' });
  wait.resolve();
  await h.ready;
  assert.equal(h.buttons()[0].disabled, true);
  assert.equal(h.retry.hidden, false);
  assert.match(h.status.textContent, /讀取/);
  h.failRead(null);
  await h.retryLoad();
  await settle();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.buttons()[0].disabled, false);
  assert.equal(h.retry.hidden, true);
  assert.equal(h.calls.length, 0);
});

test('F23 成功保存後讀取失敗只重試讀取，不再反向切換收藏', async () => {
  const h = harness();
  await h.ready;
  h.failRead({ code: 'STORAGE_UNAVAILABLE' });
  await h.click('en-w-1');
  await settle();
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1']);
  assert.equal(h.buttons()[0].disabled, true);
  assert.match(h.status.textContent, /已保存.*讀取/);
  h.failRead(null);
  await h.retryLoad();
  await settle();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.calls.length, 1);
});

test('F23 回到分頁後讀回其他頁的收藏，重新搜尋保持最新狀態', async () => {
  const h = harness();
  await h.ready;
  h.rows.books.favorites.wordIds = ['en-w-1'];
  await h.focusPage();
  await settle();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  h.rows.books.favorites.wordIds = [];
  await h.visibility();
  await settle();
  await h.search('word1');
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'false');
});

test('F23 可見狀態落後時以使用者明確加入意向提交，不反向移除另一頁已加入的收藏', async () => {
  const h = harness();
  await h.ready;
  h.rows.books.favorites.wordIds = ['en-w-1'];
  await h.click('en-w-1');
  await settle();
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1']);
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
});

test('F23 字串安全逸出，搜尋與分頁仍可重繪並保留收藏', async () => {
  const words = Array.from({ length: 301 }, (_, i) => word('en', i + 1));
  words[0].target = '<img src=x onerror="alert(1)">';
  const h = harness({ words, favoriteIds: ['en-w-1'] });
  await h.ready;
  assert.equal(h.buttons().length, 300);
  assert.match(h.list.innerHTML, /data-more/);
  assert.doesNotMatch(h.list.innerHTML, /<img/);
  await h.search('word301');
  assert.equal(h.buttons().length, 1);
  assert.equal(h.buttons()[0].dataset.favorite, 'en-w-301');
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'false');
});

test('F23 ready 失敗可重試就緒，保留既有收藏且不寫入', async () => {
  const wait = deferred();
  const h = harness({ readyWait: wait, favoriteIds: ['en-w-1'] });
  h.failReady({ code: 'STORAGE_BLOCKED' });
  wait.resolve();
  await h.ready;
  assert.equal(h.buttons()[0].disabled, true);
  assert.equal(h.retry.hidden, false);
  h.failReady(null);
  await h.retryLoad();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.buttons()[0].disabled, false);
  assert.equal(h.calls.length, 0);
});

test('F23 固定收藏簿缺失不當作空收藏，更正後僅重讀', async () => {
  const wait = deferred();
  const h = harness({ readyWait: wait, favoriteIds: ['en-w-1'] });
  const book = h.rows.books.favorites;
  delete h.rows.books.favorites;
  wait.resolve();
  await h.ready;
  assert.equal(h.buttons()[0].disabled, true);
  assert.equal(h.retry.hidden, false);
  assert.match(h.status.textContent, /讀取失敗/);
  h.rows.books.favorites = book;
  await h.retryLoad();
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.calls.length, 0);
});

test('F23 取消失敗保留原收藏，明確重試後才移除', async () => {
  const h = harness({ favoriteIds: ['en-w-1'] });
  await h.ready;
  h.failWrite({ code: 'STORAGE_QUOTA' });
  await h.click('en-w-1');
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1']);
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.buttons()[0].disabled, false);
  assert.match(h.status.textContent, /未保存/);
  h.failWrite(null);
  await h.click('en-w-1');
  assert.deepEqual(h.rows.books.favorites.wordIds, []);
  assert.equal(h.buttons()[0].getAttribute('aria-pressed'), 'false');
});

test('F23 多張卡片共用保存鎖，保存期間另一張及回到分頁不送出額外操作', async () => {
  const wait = deferred();
  const h = harness({ words: [word(), word('en', 2)], commitWait: wait });
  await h.ready;
  const save = h.click('en-w-1');
  assert.ok(h.buttons().every(button => button.disabled));
  await h.click('en-w-2');
  await h.focusPage();
  await h.visibility();
  assert.equal(h.calls.length, 1);
  wait.resolve();
  await save;
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1']);
  assert.ok(h.buttons().every(button => !button.disabled));
  await h.click('en-w-2');
  assert.deepEqual(h.rows.books.favorites.wordIds, ['en-w-1', 'en-w-2']);
});
