import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listCategories,
  listLevels,
  groupState,
  selectionSummary,
  filterWords,
  listPatterns,
  filterSentences,
} from '../assets/js/core/filter.js';

const WORDS = [
  { id: 'ja-w-001', zh: '雨', target: '雨', reading: 'あめ', romaji: 'ame', category: 'weather', level: 1 },
  { id: 'ja-w-002', zh: '雪', target: '雪', reading: 'ゆき', romaji: 'yuki', category: 'weather', level: 1 },
  { id: 'ja-w-003', zh: '蘋果', target: 'りんご', reading: 'りんご', romaji: 'ringo', category: 'food', level: 1 },
  { id: 'ja-w-004', zh: '羽毛球', target: 'バドミントン', reading: 'ばどみんとん', romaji: 'badominton', category: 'sport', level: 2 },
];

const EN_WORDS = [
  { id: 'en-w-001', zh: '羽毛球', target: 'badminton', reading: null, romaji: null, category: 'sport', level: 1 },
  { id: 'en-w-002', zh: '蘋果', target: 'apple', reading: null, romaji: null, category: 'food', level: 1 },
];

const SENTENCES = [
  { id: 'en-s-001', patternId: 'en-p-svo' },
  { id: 'en-s-002', patternId: 'en-p-svo' },
  { id: 'en-s-003', patternId: 'en-p-svo-time' },
];

const PATTERNS = [
  { id: 'en-p-svo', lang: 'en', name: '主詞 + 動詞 + 受詞' },
  { id: 'en-p-svo-time', lang: 'en', name: '主詞 + 動詞 + 受詞 + 時間' },
  { id: 'en-p-neg', lang: 'en', name: '主詞 + 否定 + 動詞 + 受詞' },
];

/* ── 分類 ─────────────────────────────────────────────────── */

test('listCategories：只列出資料中實際存在的分類', () => {
  const cats = listCategories(WORDS);
  assert.deepEqual(cats.map((c) => c.key).sort(), ['food', 'sport', 'weather']);
});

test('listCategories：帶出中文標籤與筆數', () => {
  const weather = listCategories(WORDS).find((c) => c.key === 'weather');
  assert.equal(weather.count, 2);
  assert.equal(weather.label, '天氣');
});

test('listCategories：空題庫回傳空陣列', () => {
  assert.deepEqual(listCategories([]), []);
});

/* ── 篩選與搜尋 ───────────────────────────────────────────── */

test('filterWords：無條件時回傳全部', () => {
  assert.equal(filterWords(WORDS, {}).length, 4);
  assert.equal(filterWords(WORDS, { category: 'all', query: '' }).length, 4);
});

test('filterWords：依分類篩選', () => {
  const r = filterWords(WORDS, { category: 'weather' });
  assert.equal(r.length, 2);
  assert.ok(r.every((w) => w.category === 'weather'));
});

test('filterWords：以中文搜尋', () => {
  const r = filterWords(WORDS, { query: '羽毛' });
  assert.deepEqual(r.map((w) => w.id), ['ja-w-004']);
});

test('filterWords：以羅馬拼音搜尋日文', () => {
  const r = filterWords(WORDS, { query: 'ame' });
  assert.deepEqual(r.map((w) => w.id), ['ja-w-001']);
});

test('filterWords：以假名讀音搜尋', () => {
  const r = filterWords(WORDS, { query: 'ゆき' });
  assert.deepEqual(r.map((w) => w.id), ['ja-w-002']);
});

test('filterWords：搜尋不分大小寫', () => {
  assert.deepEqual(filterWords(EN_WORDS, { query: 'BADMIN' }).map((w) => w.id), ['en-w-001']);
  assert.deepEqual(filterWords(EN_WORDS, { query: 'Apple' }).map((w) => w.id), ['en-w-002']);
});

test('filterWords：頭尾空白不影響搜尋', () => {
  assert.equal(filterWords(EN_WORDS, { query: '  apple  ' }).length, 1);
});

test('filterWords：reading 為 null 的英文資料不會爆', () => {
  assert.doesNotThrow(() => filterWords(EN_WORDS, { query: 'x' }));
  assert.deepEqual(filterWords(EN_WORDS, { query: 'zzz' }), []);
});

test('filterWords：分類與關鍵字同時生效', () => {
  const r = filterWords(WORDS, { category: 'weather', query: '雨' });
  assert.deepEqual(r.map((w) => w.id), ['ja-w-001']);
  assert.deepEqual(filterWords(WORDS, { category: 'food', query: '雨' }), []);
});

test('filterWords：不改動來源陣列', () => {
  const snapshot = WORDS.map((w) => w.id);
  filterWords(WORDS, { category: 'food' });
  assert.deepEqual(WORDS.map((w) => w.id), snapshot);
});

/* ── 句型 ─────────────────────────────────────────────────── */

test('listPatterns：帶出每個句型的例句數', () => {
  const r = listPatterns(SENTENCES, PATTERNS);
  const svo = r.find((p) => p.id === 'en-p-svo');
  assert.equal(svo.count, 2);
  assert.equal(svo.name, '主詞 + 動詞 + 受詞');
});

test('listPatterns：例句數為 0 的句型不出現在清單中', () => {
  const r = listPatterns(SENTENCES, PATTERNS);
  assert.ok(!r.some((p) => p.id === 'en-p-neg'), '沒有例句的句型不該出現');
  assert.equal(r.length, 2);
});

test('filterSentences：依 patternId 篩選', () => {
  assert.equal(filterSentences(SENTENCES, 'en-p-svo').length, 2);
  assert.equal(filterSentences(SENTENCES, 'en-p-svo-time').length, 1);
});

test('filterSentences：all 或空值回傳全部', () => {
  assert.equal(filterSentences(SENTENCES, 'all').length, 3);
  assert.equal(filterSentences(SENTENCES, '').length, 3);
  assert.equal(filterSentences(SENTENCES).length, 3);
});

/* ── 等級篩選（多益分數帶 / JLPT 級別）─────────────────────── */

test('listLevels：只列出題庫實際有資料的等級，並依由易到難排序', () => {
  const levels = listLevels(WORDS, 'ja');
  assert.deepEqual(levels.map((l) => l.level), [1, 2]);
  assert.deepEqual(levels.map((l) => l.count), [3, 1]);
  assert.deepEqual(levels.map((l) => l.label), ['N5', 'N4']);
});

test('listLevels：英文用多益分數帶當標籤，日文用 N 級', () => {
  assert.equal(listLevels(EN_WORDS, 'en')[0].label, '≤400');
  assert.equal(listLevels(WORDS, 'ja')[0].label, 'N5');
});

test('listLevels：未知語言回傳空陣列而不是丟例外', () => {
  assert.deepEqual(listLevels(WORDS, 'kr'), []);
});

test('filterWords：依等級篩選', () => {
  assert.equal(filterWords(WORDS, { level: 2 }).length, 1);
  assert.equal(filterWords(WORDS, { level: 1 }).length, 3);
  assert.equal(filterWords(WORDS, { level: 'all' }).length, 4);
});

/**
 * 等級是從 dataset 讀出來的，一定是字串。
 * 題庫裡卻是數字，用 === 直接比會一筆都篩不到。
 */
test('filterWords：等級傳字串時也要篩得到', () => {
  assert.equal(filterWords(WORDS, { level: '2' }).length, 1);
  assert.equal(filterWords(WORDS, { level: '1' }).length, 3);
});

test('filterWords：等級、分類、關鍵字三個條件同時生效', () => {
  assert.equal(filterWords(WORDS, { level: 1, category: 'weather' }).length, 2);
  assert.equal(filterWords(WORDS, { level: 1, category: 'weather', query: '雪' }).length, 1);
  assert.equal(filterWords(WORDS, { level: 2, category: 'weather' }).length, 0);
});

/* ── 多選篩選 ─────────────────────────────────────────────── */

test('filterWords：分類可傳陣列，取聯集', () => {
  const r = filterWords(WORDS, { category: ['weather', 'food'] });
  assert.deepEqual(r.map((w) => w.id), ['ja-w-001', 'ja-w-002', 'ja-w-003']);
});

test('filterWords：等級可傳陣列，數字與字串混用都要篩得到', () => {
  assert.equal(filterWords(WORDS, { level: [1, 2] }).length, 4);
  assert.equal(filterWords(WORDS, { level: ['1', '2'] }).length, 4);
  assert.equal(filterWords(WORDS, { level: [2] }).length, 1);
});

/**
 * 這是多選介面最容易寫錯的一條：全部取消勾選時，
 * 使用者期待的是「沒有符合的單字」，不是「顯示全部」。
 * 空陣列若被當成「不篩選」，取消全選會變成什麼都沒篩，完全反直覺。
 */
test('filterWords：空陣列代表一筆都不留，不是不篩選', () => {
  assert.deepEqual(filterWords(WORDS, { category: [] }), []);
  assert.deepEqual(filterWords(WORDS, { level: [] }), []);
});

test('filterWords：全選等同於不篩選', () => {
  const allCats = [...new Set(WORDS.map((w) => w.category))];
  assert.equal(filterWords(WORDS, { category: allCats }).length, WORDS.length);
  assert.equal(filterWords(WORDS, { category: 'all' }).length, WORDS.length);
});

test('filterWords：分類與等級都是陣列時同時生效', () => {
  const r = filterWords(WORDS, { category: ['weather', 'sport'], level: [1] });
  assert.deepEqual(r.map((w) => w.id), ['ja-w-001', 'ja-w-002']);
});

/* ── 群組核取方塊的三態 ───────────────────────────────────── */

test('groupState：全勾是 all、全不勾是 none、勾一部分是 partial', () => {
  const keys = ['food', 'drink', 'animal'];
  assert.equal(groupState(keys, new Set(keys)), 'all');
  assert.equal(groupState(keys, new Set()), 'none');
  assert.equal(groupState(keys, new Set(['food'])), 'partial');
  assert.equal(groupState(keys, new Set(['food', 'drink'])), 'partial');
});

test('groupState：只勾到一個就不能算全選，即使清單只有一項也要分清楚', () => {
  assert.equal(groupState(['food'], new Set(['food'])), 'all');
  assert.equal(groupState(['food'], new Set(['drink'])), 'none');
});

/**
 * 小分類清單是空的時候不能顯示成全選——
 * 「零個項目全部勾起來了」在畫面上會變成一個沒有任何子項的打勾群組。
 */
test('groupState：空清單回傳 none 而不是 all', () => {
  assert.equal(groupState([], new Set()), 'none');
  assert.equal(groupState(null, new Set(['food'])), 'none');
});

test('groupState：selected 不是 Set 也不會爆', () => {
  assert.equal(groupState(['food'], null), 'none');
  assert.equal(groupState(['food'], undefined), 'none');
});

/* ── 篩選摘要文字 ─────────────────────────────────────────── */

test('selectionSummary：全選顯示「全部」而不是列出四十個名字', () => {
  assert.equal(selectionSummary(['食物', '飲料', '動物'], 3), '全部');
});

test('selectionSummary：選得少就列名字，選得多就報數量', () => {
  assert.equal(selectionSummary(['食物'], 5), '食物');
  assert.equal(selectionSummary(['食物', '飲料'], 5), '食物、飲料');
  assert.equal(selectionSummary(['食物', '飲料', '動物'], 5), '已選 3 項');
});

test('selectionSummary：一個都沒選顯示「未選取」', () => {
  assert.equal(selectionSummary([], 5), '未選取');
  assert.equal(selectionSummary(null, 5), '未選取');
});
