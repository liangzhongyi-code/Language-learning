/**
 * 五十音對照表的 HTML。對照表頁與測驗頁的小抄共用同一支產生器，
 * 這裡驗的是「每個假名都在、三種寫法都在、行列標題對得上」，以及各入口連得到。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { kana } from '../assets/js/data/ja/kana.js';
import { KANA_SECTIONS, kanaGridHtml } from '../assets/js/ui/kana-chart.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const count = (text, pattern) => [...text.matchAll(pattern)].length;

test('四張表合計 104 格，並列模式每一格都有平假名、片假名與羅馬音', () => {
  const html = KANA_SECTIONS.map((section) => kanaGridHtml(section, kana, 'both')).join('');
  assert.equal(count(html, /<button class="kana"/g), 104);
  for (const item of kana) {
    const glyphs = `<span class="hira">${item.hiragana}</span><span class="kata">${item.katakana}</span>`;
    assert.ok(html.includes(glyphs), item.id);
    assert.ok(html.includes(`<span class="romaji">${item.romaji}</span>`), item.id);
  }
});

test('清音表有 a i u e o 欄標題與 11 個行標題', () => {
  const html = kanaGridHtml(KANA_SECTIONS[0], kana, 'both');
  for (const column of ['a', 'i', 'u', 'e', 'o']) assert.ok(html.includes(`<span class="kana-col">${column}</span>`));
  assert.equal(count(html, /class="kana-rowhead"/g), 11);
  assert.ok(html.includes('>あ行</span>') && html.includes('>ん</span>'));
});

test('單一模式只顯示那一套假名；小抄版不放例字', () => {
  const hira = kanaGridHtml(KANA_SECTIONS[0], kana, 'hiragana', { compact: true });
  assert.ok(hira.includes('あ') && !hira.includes('ア'));
  assert.ok(!hira.includes('class="example"'));
  assert.ok(kanaGridHtml(KANA_SECTIONS[0], kana, 'katakana').includes('class="example"'));
});

test('入口：首頁有對照表與選擇題，對照表頁能直接開三種模式，手冊與測驗頁都連得到', () => {
  const home = read('ja/index.html');
  assert.match(home, /href="\.\/kana\.html"/);
  assert.match(home, /href="\.\/quiz\.html\?source=kana"/);
  assert.match(read('assets/js/ui/kana-view.js'), /quiz\.html\?source=kana&amp;script=/);
  assert.match(read('ja/guide.html'), /quiz\.html\?source=kana/);
  assert.match(read('assets/js/ui/quiz-view.js'), /href="\.\/kana\.html"/);
  assert.match(read('ja/kana.html'), /<h1>五十音對照表<\/h1>/);
});
