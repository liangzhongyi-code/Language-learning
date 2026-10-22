import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateJlpt, validateDataset, findSerialGaps } from '../assets/js/core/schema.js';
import { JLPT_BLANK, JLPT_MONDAI, jlptMondaiOf } from '../assets/js/core/jlpt-mondai.js';

/**
 * 三種題面形式各一題合法範例。題面保留 N5 的分かち書き空格
 */
const UNDERLINE = {
  id: 'ja-j-0001', level: 1, section: 'moji', mondai: 1,
  stem: 'あの 人は 学生 です。', underline: '学生',
  options: ['かくせ', 'かくせい', 'がくせ', 'がくせい'], answer: 'がくせい',
  note: '「学」唸がく、「生」唸せい，合起來是がくせい。', sourceRef: 'moji-1.1', edited: null,
};
const BLANK = {
  id: 'ja-j-0002', level: 1, section: 'bunpou', mondai: 1,
  stem: `わたし${JLPT_BLANK}たなかです。`, underline: null,
  options: ['が', 'は', 'を', 'に'], answer: 'は',
  note: '介紹自己時用は標出主題。', sourceRef: 'bunpou-1.1', edited: null,
};
const PARAPHRASE = {
  id: 'ja-j-0003', level: 1, section: 'goi', mondai: 4,
  stem: 'でんしゃの 中で 本を 読みました。', underline: null,
  options: ['でんしゃで 本を かいました。', 'でんしゃに のる まえに 本を 読みました。',
    'でんしゃに のって いる あいだに 本を 読みました。', 'でんしゃの まえで 本を 読みました。'],
  answer: 'でんしゃに のって いる あいだに 本を 読みました。',
  note: '「電車の中で」就是搭電車的時候。', sourceRef: 'goi-5.2', edited: null,
};

const fields = (r) => r.errors.map((e) => e.field);

test('J01 合法的三種形式都通過', () => {
  for (const entry of [UNDERLINE, BLANK, PARAPHRASE]) {
    const r = validateJlpt(entry, 'ja');
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  }
});

test('J01 必填欄位缺一個就擋下', () => {
  for (const key of ['stem', 'answer', 'note', 'sourceRef']) {
    const r = validateJlpt({ ...UNDERLINE, [key]: '' }, 'ja');
    assert.equal(r.ok, false, key);
    assert.ok(fields(r).includes(key), `${key}：${JSON.stringify(r.errors)}`);
  }
});

test('J01 選項不是剛好四個、重複、不含正解都擋下', () => {
  assert.equal(validateJlpt({ ...UNDERLINE, options: UNDERLINE.options.slice(0, 3) }, 'ja').ok, false);
  assert.equal(validateJlpt({ ...UNDERLINE, options: [...UNDERLINE.options, 'がっせい'] }, 'ja').ok, false);
  /* 上游 moji-6.12 的實際狀況：兩個選項一模一樣 */
  const dup = validateJlpt({ ...UNDERLINE, options: ['描きます', '書きます', '画きます', '画きます'], answer: '書きます' }, 'ja');
  assert.match(dup.errors.map((e) => e.message).join(), /重複/);
  const missing = validateJlpt({ ...UNDERLINE, answer: 'がっこう' }, 'ja');
  assert.match(missing.errors.map((e) => e.message).join(), /包含正解/);
});

test('J01 選項頭尾空白擋下，中間空格保留', () => {
  assert.equal(validateJlpt({ ...UNDERLINE, options: ['かくせ ', 'かくせい', 'がくせ', 'がくせい'] }, 'ja').ok, false);
  assert.equal(validateJlpt(PARAPHRASE, 'ja').ok, true);
});

test('J01 id、級別、題型、語言、未知欄位、sourceRef 與 edited', () => {
  assert.ok(fields(validateJlpt({ ...UNDERLINE, id: 'ja-sc-001' }, 'ja')).includes('id'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, level: 6 }, 'ja')).includes('level'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, mondai: 3 }, 'ja')).includes('mondai'), 'moji 沒有問題3');
  assert.ok(fields(validateJlpt({ ...BLANK, mondai: 2 }, 'ja')).includes('mondai'), '文法問題2（排序）不在本批');
  assert.equal(validateJlpt({ ...UNDERLINE, id: 'en-j-0001' }, 'en').ok, false);
  assert.ok(fields(validateJlpt({ ...UNDERLINE, edit: '改過' }, 'ja')).includes('edit'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, sourceRef: 'goi-1.1' }, 'ja')).includes('sourceRef'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, edited: '' }, 'ja')).includes('edited'));
  assert.equal(validateJlpt({ ...UNDERLINE, edited: '修正重複選項' }, 'ja').ok, true);
});

test('J02 底線形式：底線字必須在題面剛好出現一次、不能有空格', () => {
  assert.ok(fields(validateJlpt({ ...UNDERLINE, underline: null }, 'ja')).includes('underline'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, underline: '先生' }, 'ja')).includes('underline'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, stem: '学生は 学生 です。' }, 'ja')).includes('underline'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, stem: `あの 人は 学生${JLPT_BLANK}です。` }, 'ja')).includes('stem'));
  assert.ok(fields(validateJlpt({ ...UNDERLINE, stem: 'あの 人は <u>学生</u> です。' }, 'ja')).includes('stem'));
});

test('J02 括號形式：剛好一個空格、沒有底線字', () => {
  assert.ok(fields(validateJlpt({ ...BLANK, stem: 'わたしは たなかです。' }, 'ja')).includes('stem'));
  assert.ok(fields(validateJlpt({ ...BLANK, stem: `わたし${JLPT_BLANK}たなか${JLPT_BLANK}です。` }, 'ja')).includes('stem'));
  /* 半形括號或空格數不同都不算，匯入時要統一 */
  assert.ok(fields(validateJlpt({ ...BLANK, stem: 'わたし（　）たなかです。' }, 'ja')).includes('stem'));
  assert.ok(fields(validateJlpt({ ...BLANK, underline: 'たなか' }, 'ja')).includes('underline'));
});

test('J02 整句形式：沒有底線、沒有空格、不留「A:」', () => {
  assert.ok(fields(validateJlpt({ ...PARAPHRASE, underline: '中で' }, 'ja')).includes('underline'));
  assert.ok(fields(validateJlpt({ ...PARAPHRASE, stem: `でんしゃ${JLPT_BLANK}本を 読みました。` }, 'ja')).includes('stem'));
  assert.ok(fields(validateJlpt({ ...PARAPHRASE, stem: 'A: でんしゃの 中で 本を 読みました。' }, 'ja')).includes('stem'));
});

test('J01 題庫層級：流水號連續、上游題號不重複', () => {
  assert.deepEqual(findSerialGaps([UNDERLINE, BLANK, PARAPHRASE]), []);
  assert.equal(findSerialGaps([UNDERLINE, PARAPHRASE]).length, 1, '少了 0002');
  const errors = validateDataset({ jlpt: [UNDERLINE, { ...BLANK, sourceRef: 'bunpou-1.1' }, { ...PARAPHRASE, sourceRef: 'goi-5.2' },
    { ...PARAPHRASE, id: 'ja-j-0004' }] }, 'ja');
  assert.ok(errors.some((e) => e.field === 'sourceRef' && e.id === 'goi-5.2'), JSON.stringify(errors));
  assert.ok(errors.some((e) => e.field === 'id' && /重複/.test(e.message)) === false);
});

test('題型定義：鍵值唯一、每個題型都有問法與中文對照', () => {
  const keys = JLPT_MONDAI.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const m of JLPT_MONDAI) {
    assert.equal(m.key, `${m.section}-${m.mondai}`);
    assert.ok(['underline', 'blank', 'paraphrase'].includes(m.form));
    assert.ok(m.ask && m.askZh && m.label);
    assert.equal(jlptMondaiOf(m.section, m.mondai), m);
  }
  assert.equal(jlptMondaiOf('bunpou', 2), null);
});
