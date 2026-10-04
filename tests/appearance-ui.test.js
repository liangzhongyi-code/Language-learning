import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PALETTES, BACKGROUNDS, normalizeAppearance } from '../assets/js/core/appearance.js';

/**
 * 執行真實 prefs 與外觀模組，僅用小型 DOM／儲存替身測跨模組事件。
 * 版面、原生 details 與鍵盤行為另外在瀏覽器驗證。
 */
function harness(initial = {}, fail = false, navEntry = null) {
  let blocked = fail;
  const key = 'lang-learn.prefs.v1';
  const values = new Map([[key, JSON.stringify(initial)]]);
  const listeners = new Map();
  const controls = [
    ...['dark', 'light'].map((value) => ({ type: 'radio', value, dataset: { appearance: 'theme' } })),
    ...PALETTES.map(({ value }) => ({ type: 'radio', value, dataset: { appearance: 'palette' } })),
    ...BACKGROUNDS.map(({ value }) => ({ type: 'radio', value, dataset: { appearance: 'background' } })),
    { type: 'checkbox', dataset: { appearance: 'reducedEffects' } },
  ];
  const status = { textContent: '' };
  const systemNote = { hidden: true };
  const panelListeners = new Map();
  const content = { top: 181, getBoundingClientRect() { return { top: this.top }; }, style: { setProperty(name, value) { this[name] = value; } } };
  const panel = {
    open: false,
    querySelectorAll: () => controls,
    querySelector: (selector) => selector === '.appearance-panel' ? content : selector === '[data-appearance-status]' ? status : selector === '[data-system-effects]' ? systemNote : { addEventListener() {}, focus() {} },
    addEventListener(type, callback) { panelListeners.set(type, callback); },
  };
  const body = { dataset: { lang: 'ja', page: 'home' }, html: '', insertAdjacentHTML(position, html) { this.html += html; } };
  const document = { body, documentElement: { dataset: {} }, querySelector: () => panel, addEventListener() {} };
  const media = { matches: true, addEventListener(type, callback) { this.change = callback; } };
  const window = {
    innerHeight: 568,
    localStorage: {
      getItem: (name) => values.get(name) ?? null,
      setItem(name, value) { if (blocked) throw new Error('quota'); values.set(name, value); },
    },
    matchMedia: () => media,
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
  };
  const strip = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .+;\r?\n/gm, '').replace(/\bexport /g, '');
  const code = strip('../assets/js/ui/prefs.js') + '\n' + strip('../assets/js/ui/appearance.js') + '\n' + strip('../assets/js/ui/nav.js');
  const api = vm.runInNewContext(code + '\n({setAppearance, bindAppearance, renderNav, renderRootNav});', { window, document, Event, PALETTES, BACKGROUNDS, normalizeAppearance });
  if (navEntry) api[navEntry]();
  else api.bindAppearance();
  return { ...api, values, key, window, document, controls, status, systemNote, media, panel, content, change: (input) => panelListeners.get('change')({ target: input }), toggle: () => panelListeners.get('toggle')(), allowStorage() { blocked = false; } };
}

test('根頁與語言內頁只有外觀入口，且可直接切換並保存深淺模式', () => {
  for (const navEntry of ['renderNav', 'renderRootNav']) {
    const h = harness({}, false, navEntry);
    assert.equal((h.document.body.html.match(/data-appearance-panel/g) || []).length, 1);
    assert.doesNotMatch(h.document.body.html, /data-theme-toggle/);
    for (const theme of ['light', 'dark']) {
      h.change(h.controls.find((c) => c.dataset.appearance === 'theme' && c.value === theme));
      assert.equal(h.document.documentElement.dataset.theme, theme);
      assert.equal(JSON.parse(h.values.get(h.key)).theme, theme);
      assert.equal(h.controls.find((c) => c.value === theme).checked, true);
    }
  }
});

test('外觀設定寫入同一份 prefs，且保留漢字與學習設定', () => {
  const h = harness({ kanjiMode: 'kana', grammarLines: false });
  h.setAppearance('palette', 'forest');
  h.setAppearance('background', 'dust');
  h.setAppearance('theme', 'light');
  const prefs = JSON.parse(h.values.get(h.key));
  assert.equal(prefs.kanjiMode, 'kana');
  assert.equal(prefs.grammarLines, false);
  assert.equal(prefs.palette, 'forest');
  assert.equal(prefs.background, 'dust');
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  assert.equal(h.controls.find((c) => c.value === 'forest').checked, true);
  assert.match(h.status.textContent, /已套用並儲存/);
});

test('儲存被拒絕後連續更換外觀仍保留本頁狀態，並明確提醒', () => {
  const h = harness({}, true);
  h.setAppearance('palette', 'warm');
  h.setAppearance('background', 'dust');
  h.setAppearance('theme', 'light');
  assert.equal(h.document.documentElement.dataset.palette, 'warm');
  assert.equal(h.document.documentElement.dataset.background, 'dust');
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  assert.match(h.status.textContent, /無法保存/);
  h.setAppearance('theme', 'dark');
  assert.match(h.status.textContent, /無法保存/, '切回預設值不代表寫入成功');
  h.allowStorage();
  h.setAppearance('reducedEffects', true);
  const saved = JSON.parse(h.values.get(h.key));
  assert.equal(saved.palette, 'warm', '恢復儲存時先前未存成功的配色也要保存');
  assert.equal(saved.background, 'dust');
});

test('備份匯入與其他分頁變更會同步根節點和已展開面板', () => {
  const h = harness({ palette: 'forest', background: 'dust' });
  h.values.set(h.key, JSON.stringify({ theme: 'light' }));
  h.window.dispatchEvent(new Event('lang-learn:prefs-imported'));
  assert.equal(h.document.documentElement.dataset.palette, 'classic');
  assert.equal(h.document.documentElement.dataset.background, 'aurora');
  assert.equal(h.controls.find((c) => c.value === 'light').checked, true);
  h.values.set(h.key, JSON.stringify({ palette: 'warm', reducedEffects: true }));
  h.window.dispatchEvent({ type: 'storage', key: h.key });
  assert.equal(h.document.documentElement.dataset.palette, 'warm');
  assert.equal(h.controls.find((c) => c.type === 'checkbox').checked, true);
});

test('系統減少動態提示隨系統變更，且不冒充使用者已勾選', () => {
  const h = harness();
  assert.equal(h.systemNote.hidden, false);
  assert.equal(h.controls.find((c) => c.type === 'checkbox').checked, false);
  h.media.matches = false;
  h.media.change();
  assert.equal(h.systemNote.hidden, true);
});

test('外觀面板依實際導覽高度與視窗大小保留底部空間', () => {
  const h = harness();
  h.panel.open = true;
  h.toggle();
  assert.equal(h.content.style['--appearance-room'], '371px');
  h.window.innerHeight = 400;
  h.window.dispatchEvent({ type: 'resize' });
  assert.equal(h.content.style['--appearance-room'], '203px');
  h.window.innerHeight = 100;
  h.window.dispatchEvent({ type: 'resize' });
  assert.equal(h.content.style['--appearance-room'], '0px');
});
