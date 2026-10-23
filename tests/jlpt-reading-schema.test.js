import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateJlptReading, validateDataset } from '../assets/js/core/schema.js';
import {
  JLPT_READING_TYPES, jlptReadingTypeOf, jlptKindKeyOf, jlptKindsAt, JLPT_KIND_KEYS,
} from '../assets/js/core/jlpt-mondai.js';

const text = (n, head = '') => head + 'あ'.repeat(n - head.length);
const question = (setId, i, extra = {}) => ({
  id: `${setId}-q${i}`, focus: 'main', ask: '筆者が最も言いたいことはどれか。',
  options: [`甲${i}`, `乙${i}`, `丙${i}`, `丁${i}`], answer: `丙${i}`,
  explain: ['錯在範圍擴大。', '錯在主張相反。', '正解，原文寫明了。', '原文沒有提到。'], ...extra,
});
const SINGLE = {
  id: 'ja-jr-0001', level: 5, type: 'chubun', passage: text(500, '待つことの余白は、劃線句だ。'),
  passageA: null, passageB: null, underline: null,
  questions: [question('ja-jr-0001', 1), question('ja-jr-0001', 2, { focus: 'reason' })],
  sourceRef: 'sim-chu50', edited: null,
};
const DUAL = {
  id: 'ja-jr-0002', level: 5, type: 'togo', passage: null, passageA: text(300), passageB: text(300),
  underline: null, questions: [question('ja-jr-0002', 1, { focus: 'common' }), question('ja-jr-0002', 2, { focus: 'difference' })],
  sourceRef: 'sim-togo110', edited: null,
};
const UNDERLINED = { ...SINGLE, underline: '劃線句だ。', questions: [question('ja-jr-0001', 1, { focus: 'underline', ask: '「劃線句だ。」とはどういうことか。' })] };
const fields = (r) => r.errors.map((e) => e.field);

test('R01 合法的單篇、雙篇與劃線句組都通過', () => {
  for (const entry of [SINGLE, DUAL, UNDERLINED]) {
    const r = validateJlptReading(entry, 'ja');
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  }
});

test('R01 題目內容：選項、正解、逐選項解說、考點、未知欄位', () => {
  const bad = (q) => validateJlptReading({ ...SINGLE, questions: [question('ja-jr-0001', 1, q), question('ja-jr-0001', 2)] }, 'ja');
  assert.ok(fields(bad({ options: ['a', 'b', 'c'] })).includes('questions[0].options'));
  assert.ok(fields(bad({ options: ['a', 'a', 'b', 'c'], answer: 'a' })).includes('questions[0].options'));
  assert.ok(fields(bad({ answer: '戊' })).includes('questions[0].options'));
  assert.ok(fields(bad({ explain: ['一', '二', '三'] })).includes('questions[0].explain'));
  assert.ok(fields(bad({ explain: ['一', '二', '', '四'] })).includes('questions[0].explain'));
  assert.ok(fields(bad({ focus: '主旨把握' })).includes('questions[0].focus'));
  assert.ok(fields(bad({ label: '主旨把握' })).includes('questions[0].label'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, title: '模拟④' }, 'ja')).includes('title'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, type: 'kaiwa' }, 'ja')).includes('type'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, level: 1 }, 'ja')).includes('level'), 'N5 沒有讀解問題號');
  assert.ok(fields(validateJlptReading({ ...SINGLE, sourceRef: 'moji-1.1' }, 'ja')).includes('sourceRef'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, edited: '' }, 'ja')).includes('edited'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, questions: [] }, 'ja')).includes('questions'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, questions: [1, 2, 3, 4, 5].map((i) => question('ja-jr-0001', i)) }, 'ja')).includes('questions'));
  assert.equal(validateJlptReading({ ...SINGLE, id: 'en-jr-0001' }, 'en').ok, false);
});

test('R02 雙篇只給統合理解，其他題型只能單篇', () => {
  assert.ok(fields(validateJlptReading({ ...DUAL, passage: text(600) }, 'ja')).includes('passage'));
  assert.ok(fields(validateJlptReading({ ...DUAL, passageB: null }, 'ja')).includes('passageB'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, passageA: text(300) }, 'ja')).includes('passageA'));
  assert.ok(fields(validateJlptReading({ ...SINGLE, passage: null }, 'ja')).includes('passage'));
});

test('R03 劃線句：有劃線題才要、原文剛好一次、不留標記', () => {
  assert.ok(fields(validateJlptReading({ ...UNDERLINED, underline: null }, 'ja')).includes('underline'));
  assert.ok(fields(validateJlptReading({ ...UNDERLINED, underline: '原文沒有這句。' }, 'ja')).includes('underline'));
  assert.ok(fields(validateJlptReading({ ...UNDERLINED, underline: 'あ' }, 'ja')).includes('underline'), '出現不只一次');
  assert.ok(fields(validateJlptReading({ ...SINGLE, underline: '劃線句だ。' }, 'ja')).includes('underline'), '沒有劃線題');
  assert.ok(fields(validateJlptReading({ ...SINGLE, passage: text(500, '⟪劃線⟫') }, 'ja')).includes('passage'));
});

test('R04 字數下限依題型，統合理解算兩篇合計', () => {
  const short = validateJlptReading({ ...SINGLE, passage: text(349) }, 'ja');
  assert.match(short.errors.map((e) => e.message).join(), /349 字.*350/);
  assert.equal(validateJlptReading({ ...SINGLE, passage: text(350) }, 'ja').ok, true);
  assert.ok(fields(validateJlptReading({ ...DUAL, passageA: text(200), passageB: text(219) }, 'ja')).includes('passage'));
  assert.equal(validateJlptReading({ ...DUAL, passageA: text(200), passageB: text(220) }, 'ja').ok, true);
});

test('R05 組 id 連號、題目 id 為組 id-qN、上游組不重複', () => {
  assert.ok(fields(validateJlptReading({ ...SINGLE, questions: [question('ja-jr-0001', 2)] }, 'ja')).includes('questions[0].id'));
  const errors = validateDataset({ jlptReading: [SINGLE, { ...DUAL, id: 'ja-jr-0003', questions: DUAL.questions.map((q, i) => ({ ...q, id: `ja-jr-0003-q${i + 1}` })) }] }, 'ja');
  assert.ok(errors.some((e) => e.id === '(jlptReading)' && /不連續/.test(e.message)), JSON.stringify(errors));
  const dupRef = validateDataset({ jlptReading: [SINGLE, { ...DUAL, sourceRef: 'sim-chu50' }] }, 'ja');
  assert.ok(dupRef.some((e) => e.field === 'sourceRef'));
});

test('題型定義：N1 為問題8～13、鍵值與題型對照、題型清單依級別', () => {
  assert.deepEqual(JLPT_READING_TYPES.map((t) => t.mondaiByLevel[5]), [8, 9, 10, 11, 12, 13]);
  assert.equal(jlptReadingTypeOf('joho').shuffle, false);
  assert.equal(JLPT_READING_TYPES.filter((t) => t.dual).map((t) => t.type).join(), 'togo');
  assert.equal(jlptKindKeyOf({ type: 'chobun' }), 'dokkai-chobun');
  assert.equal(jlptKindKeyOf({ section: 'moji', mondai: 2 }), 'moji-2');
  assert.deepEqual(jlptKindsAt(5).map((k) => k.label), ['問題8 內容理解（短文）', '問題9 內容理解（中文）', '問題10 內容理解（長文）',
    '問題11 統合理解', '問題12 主張理解（長文）', '問題13 情報檢索']);
  assert.deepEqual(jlptKindsAt(1).map((k) => k.key), ['moji-1', 'moji-2', 'goi-3', 'goi-4', 'bunpou-1']);
  assert.equal(jlptKindsAt(null).length, 11);
  assert.equal(new Set(JLPT_KIND_KEYS).size, 11);
});
