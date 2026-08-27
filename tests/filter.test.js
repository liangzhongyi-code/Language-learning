import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listCategories,
  listLevels,
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
