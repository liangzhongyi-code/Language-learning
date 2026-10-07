import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnglish, normalizeKana, judgeTyping, shouldSubmitOnEnter } from '../assets/js/core/practice-answers.js';
import { LearningError } from '../assets/js/core/learning-errors.js';

const code = (expected) => (error) => error instanceof LearningError && error.code === expected;

/* ── O07 英文輸入正規化：只抹平大小寫與空白，不抹平拼字 ───────────── */

test('O07 英文正規化：NFKC、去頭尾空白、連續空白折成一個，預設不分大小寫', () => {
  assert.equal(normalizeEnglish('  Ｈｅｌｌｏ　　World  '), 'hello world');
  assert.equal(normalizeEnglish('a\t\n b'), 'a b');
  assert.equal(normalizeEnglish('Apple', { caseSensitive: true }), 'Apple');
});

test('O07 英文正規化：保留重音、標點與縮寫撇號，café 不等於 cafe、don\'t 不等於 dont', () => {
  assert.equal(normalizeEnglish('Café'), 'café');
  assert.notEqual(normalizeEnglish('café'), normalizeEnglish('cafe'));
  assert.notEqual(normalizeEnglish("don't"), normalizeEnglish('dont'));
  assert.equal(normalizeEnglish('Hello, world!'), 'hello, world!');
});

test('O07 英文正規化：手機智慧標點的彎撇號視為同一個撇號，仍不等於沒有撇號', () => {
  assert.equal(normalizeEnglish('don’t'), "don't");
  assert.notEqual(normalizeEnglish('don’t'), 'dont');
});

test('O07 英文判題：只比對白名單，不做模糊比對或編輯距離', () => {
  const accepted = ['mother', 'mom'];
  assert.deepEqual(judgeTyping({ input: '  Mother ', accepted, lang: 'en' }),
    { correct: true, empty: false, normalized: 'mother', matched: 'mother' });
  assert.equal(judgeTyping({ input: 'MOM', accepted, lang: 'en' }).matched, 'mom');
  assert.equal(judgeTyping({ input: 'mothr', accepted, lang: 'en' }).correct, false);
  assert.equal(judgeTyping({ input: 'mothers', accepted, lang: 'en' }).correct, false);
  assert.equal(judgeTyping({ input: 'cafe', accepted: ['café'], lang: 'en' }).correct, false);
});

test('O07 英文判題：caseSensitive 為 true 時大小寫不同判錯', () => {
  assert.equal(judgeTyping({ input: 'tokyo', accepted: ['Tokyo'], lang: 'en', caseSensitive: true }).correct, false);
  assert.equal(judgeTyping({ input: 'Tokyo', accepted: ['Tokyo'], lang: 'en', caseSensitive: true }).correct, true);
});

test('O07 空輸入：只有空白也回 correct:false 並標示 empty', () => {
  for (const input of ['', '   ', '　']) {
    const result = judgeTyping({ input, accepted: ['apple'], lang: 'en' });
    assert.equal(result.correct, false);
    assert.equal(result.empty, true);
    assert.equal(result.matched, null);
  }
  assert.equal(judgeTyping({ input: ' ', accepted: ['ねこ'], lang: 'ja' }).empty, true);
});

test('O07 判題參數錯誤：白名單空、語言不明、輸入非字串都拋 INVALID_DATA；未知 policy 拋 UNSUPPORTED', () => {
  assert.throws(() => judgeTyping({ input: 'a', accepted: [], lang: 'en' }), code('INVALID_DATA'));
  assert.throws(() => judgeTyping({ input: 'a', accepted: [''], lang: 'en' }), code('INVALID_DATA'));
  assert.throws(() => judgeTyping({ input: 'a', accepted: ['a'], lang: 'ko' }), code('INVALID_DATA'));
  assert.throws(() => judgeTyping({ input: 1, accepted: ['a'], lang: 'en' }), code('INVALID_DATA'));
  assert.throws(() => judgeTyping({ input: 'a', accepted: ['a'], lang: 'en', policy: 'fuzzy' }), code('UNSUPPORTED'));
  assert.equal(judgeTyping({ input: 'a', accepted: ['a'], lang: 'en', policy: 'exact' }).correct, true);
});

/* ── O08 假名輸入正規化：片假名轉平假名，但不吃掉任何有辨義作用的差異 ── */

test('O08 假名正規化：半形片假名轉全形再轉平假名，長音「ー」保留', () => {
  assert.equal(normalizeKana('ｺｰﾋｰ'), 'こーひー');
  assert.equal(normalizeKana('コーヒー'), 'こーひー');
  assert.equal(normalizeKana(' ｶﾞｯｺｳ '), 'がっこう');
  assert.equal(normalizeKana('ヴァ'), 'ゔぁ');
  assert.equal(normalizeKana('ヵヶ'), 'ゕゖ');
});

test('O08 假名正規化：促音、長音、拗音小字不可被吃掉', () => {
  assert.notEqual(normalizeKana('きって'), normalizeKana('きて'));
  assert.notEqual(normalizeKana('おばあさん'), normalizeKana('おばさん'));
  assert.notEqual(normalizeKana('こーひー'), normalizeKana('こひ'));
  assert.notEqual(normalizeKana('びょういん'), normalizeKana('びよういん'));
  assert.notEqual(normalizeKana('しゃしん'), normalizeKana('しやしん'));
});

test('O08 假名正規化：濁音／半濁音與 じ／ぢ、ず／づ 的差異保留', () => {
  assert.notEqual(normalizeKana('かき'), normalizeKana('かぎ'));
  assert.notEqual(normalizeKana('はん'), normalizeKana('ぱん'));
  assert.notEqual(normalizeKana('ばん'), normalizeKana('ぱん'));
  assert.notEqual(normalizeKana('はなぢ'), normalizeKana('はなじ'));
  assert.notEqual(normalizeKana('ちず'), normalizeKana('ちづ'));
  assert.equal(normalizeKana('ヂ'), 'ぢ');
  assert.equal(normalizeKana('ヅ'), 'づ');
});

test('O08 日文判題：假名讀音與白名單漢字寫法都接受，片假名輸入等同平假名', () => {
  const accepted = ['ねこ', '猫'];
  assert.equal(judgeTyping({ input: 'ねこ', accepted, lang: 'ja' }).correct, true);
  assert.equal(judgeTyping({ input: 'ネコ', accepted, lang: 'ja' }).correct, true);
  assert.equal(judgeTyping({ input: 'ﾈｺ', accepted, lang: 'ja' }).correct, true);
  const kanji = judgeTyping({ input: ' 猫 ', accepted, lang: 'ja' });
  assert.equal(kanji.correct, true);
  assert.equal(kanji.matched, '猫');
  assert.equal(judgeTyping({ input: 'ねこ', accepted: ['コーヒー'], lang: 'ja' }).correct, false);
  assert.equal(judgeTyping({ input: 'こーひー', accepted: ['コーヒー'], lang: 'ja' }).correct, true);
});

test('O08 日文判題：少一個促音、長音或濁點都判錯', () => {
  assert.equal(judgeTyping({ input: 'がこう', accepted: ['がっこう'], lang: 'ja' }).correct, false);
  assert.equal(judgeTyping({ input: 'こひー', accepted: ['こーひー'], lang: 'ja' }).correct, false);
  assert.equal(judgeTyping({ input: 'ちづ', accepted: ['ちず'], lang: 'ja' }).correct, false);
  assert.equal(judgeTyping({ input: 'きゆうにゆう', accepted: ['ぎゅうにゅう'], lang: 'ja' }).correct, false);
});

test('O08 IME 組字中按 Enter 不送出，組字結束後的 Enter 才送出', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', isComposing: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Process', keyCode: 229, isComposing: false }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 13, isComposing: false }), true);
  assert.equal(shouldSubmitOnEnter({ key: 'a', keyCode: 65 }), false);
  assert.equal(shouldSubmitOnEnter(null), false);
});
