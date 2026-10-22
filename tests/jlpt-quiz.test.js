import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSession, answer, isCorrect, hasKanaVersion, kindOf, poolOf } from '../assets/js/core/quiz-engine.js';
import { JLPT_BLANK } from '../assets/js/core/jlpt-mondai.js';

/**
 * 固定序列的假亂數，兩次出題才比得出是否相同
 */
function seeded(seed = 7) {
  let n = seed;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

const item = (n, section, mondai, extra = {}) => ({
  id: `ja-j-${String(n).padStart(4, '0')}`, level: 1, section, mondai,
  stem: section === 'moji' ? `これは 字${n} です。` : `わたし${JLPT_BLANK}${n}です。`,
  underline: section === 'moji' ? `字${n}` : null,
  options: [`甲${n}`, `乙${n}`, `丙${n}`, `丁${n}`], answer: `丙${n}`, note: `第 ${n} 題的說明`, ...extra,
});
const JLPT = [
  item(1, 'moji', 1), item(2, 'moji', 2), item(3, 'moji', 2), item(4, 'goi', 3),
  item(5, 'bunpou', 1), item(6, 'bunpou', 1, { level: 2 }),
];
const session = (extra = {}) => buildSession({ lang: 'ja', words: [], sentences: [], jlpt: JLPT, source: 'jlpt', count: 10, rng: seeded(), ...extra });

test('J11 四個選項就是資料裡的四個，只打亂順序；correctIndex 指向 answer', () => {
  const { questions } = session({ level: 1 });
  assert.equal(questions.length, 5);
  assert.equal(new Set(questions.map((q) => q.sourceId)).size, 5, '同一局不重複');
  for (const q of questions) {
    const source = JLPT.find((x) => x.id === q.sourceId);
    assert.deepEqual(q.options.map((o) => o.text).sort(), [...source.options].sort());
    assert.equal(q.options[q.correctIndex].text, source.answer);
    assert.equal(q.options.filter((o) => o.isCorrect).length, 1);
  }
});

test('J11 固定亂數可重現同一局', () => {
  const a = session({ level: 1 }).questions;
  const b = session({ level: 1 }).questions;
  assert.deepEqual(a, b);
});

test('J11 題面欄位：問法、底線、中文對照、不掛朗讀、方向 target2zh', () => {
  const q = session({ mondai: ['moji-1'] }).questions[0];
  assert.equal(q.kind, 'choice');
  assert.equal(q.direction, 'target2zh');
  assert.equal(q.prompt, 'これは 字1 です。');
  assert.equal(q.underline, '字1');
  assert.equal(q.mondaiKey, 'moji-1');
  assert.equal(q.mondaiLabel, '問題1 漢字讀法');
  assert.match(q.context, /ひらがなで/);
  assert.ok(q.askZh);
  assert.equal(q.speakText, null);
  assert.equal(q.note, '第 1 題的說明');
  const blank = session({ mondai: ['bunpou-1'], level: 1 }).questions[0];
  assert.equal(blank.underline, null);
});

test('J08 問題號篩選與級別隔離；不足四題也能出', () => {
  const only = session({ mondai: ['moji-2'] }).questions;
  assert.deepEqual(only.map((q) => q.sourceId).sort(), ['ja-j-0002', 'ja-j-0003']);
  assert.deepEqual(session({ level: 2 }).questions.map((q) => q.sourceId), ['ja-j-0006']);
  assert.throws(() => session({ mondai: [] }), /至少要選一種題型/);
  assert.throws(() => session({ level: 3 }), /沒有 JLPT 模擬題/);
  assert.throws(() => session({ mondai: ['goi-4'] }), /沒有 JLPT 模擬題/);
});

test('J09 漢字模式對 JLPT 題無效：照原樣出漢字', () => {
  assert.equal(hasKanaVersion('jlpt'), false);
  const shown = session({ level: 1 }).questions;
  const kana = session({ level: 1, kanjiMode: 'kana' }).questions;
  assert.deepEqual(kana, shown);
});

test('作答判定與題源對應', () => {
  assert.equal(kindOf('jlpt'), 'choice');
  assert.deepEqual(poolOf('jlpt', [], [], [], [], JLPT), JLPT);
  assert.deepEqual(poolOf('jlpt', [], [], [], []), []);
  const s = session({ mondai: ['goi-3'] });
  answer(s, 0, s.questions[0].correctIndex);
  assert.equal(isCorrect(s.questions[0]), true);
});
