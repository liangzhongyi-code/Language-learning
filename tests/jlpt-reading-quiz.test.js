import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSession, answer, isCorrect, poolOf } from '../assets/js/core/quiz-engine.js';
import { jlpt } from '../assets/js/data/ja/jlpt.js';

function seeded(seed = 11) {
  let n = seed;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

const q = (setId, i, extra = {}) => ({
  id: `${setId}-q${i}`, focus: 'detail', ask: `問${i}`,
  options: [`甲${setId}${i}`, `乙${setId}${i}`, `丙${setId}${i}`, `丁${setId}${i}`], answer: `丙${setId}${i}`,
  explain: [`解甲${i}`, `解乙${i}`, `解丙${i}`, `解丁${i}`], ...extra,
});
const setOf = (n, type, count, extra = {}) => {
  const id = `ja-jr-${String(n).padStart(4, '0')}`;
  return { id, level: 5, type, passage: type === 'togo' ? null : `本文${n}`, passageA: type === 'togo' ? `A${n}` : null,
    passageB: type === 'togo' ? `B${n}` : null, underline: null, questions: Array.from({ length: count }, (_, i) => q(id, i + 1)), ...extra };
};
const READING = [
  setOf(1, 'chobun', 4), setOf(2, 'chobun', 4), setOf(3, 'tanbun', 1), setOf(4, 'tanbun', 1),
  setOf(5, 'joho', 2), setOf(6, 'togo', 2), setOf(7, 'tanbun', 1),
];
const session = (extra = {}) => buildSession({ lang: 'ja', words: [], sentences: [], jlpt: [], jlptReading: READING,
  source: 'jlpt', level: 5, count: 5, rng: seeded(), ...extra });

test('R12 按篇抽：同篇相鄰且照原順序、最後一篇不截斷', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const qs = session({ rng: seeded(seed) }).questions;
    const groups = [];
    for (const x of qs) {
      if (!groups.length || groups[groups.length - 1].id !== x.passageId) groups.push({ id: x.passageId, nos: [] });
      groups[groups.length - 1].nos.push(x.questionNo);
    }
    assert.equal(new Set(groups.map((g) => g.id)).size, groups.length, '同一篇不會分散');
    for (const g of groups) {
      const total = READING.find((s) => s.id === g.id).questions.length;
      assert.deepEqual(g.nos, Array.from({ length: total }, (_, i) => i + 1), `${g.id} 要整篇出完`);
    }
    assert.ok(qs.length >= 5 && qs.length <= 5 + 4 - 1, `題數 ${qs.length}`);
  }
});

test('R12 N5 一題一筆：出題結果與加入讀解前的逐題抽相同', () => {
  const n5 = (extra) => buildSession({ lang: 'ja', words: [], sentences: [], jlpt, source: 'jlpt', level: 1, count: 10, rng: seeded(3), ...extra });
  const withReading = n5({ jlptReading: READING });
  const without = n5({});
  assert.deepEqual(withReading.questions, without.questions, 'N5 題池沒有讀解，讀解資料存在不影響結果');
  assert.equal(without.questions.length, 10);
});

test('R13 情報檢索不打亂、其他打亂；解說跟著選項移動', () => {
  let shuffledSeen = false;
  for (let seed = 1; seed <= 20; seed++) {
    for (const x of session({ rng: seeded(seed), count: 20 }).questions) {
      const set = READING.find((s) => s.id === x.passageId);
      const src = set.questions.find((y) => y.id === x.sourceId);
      if (set.type === 'joho') assert.deepEqual(x.options.map((o) => o.text), src.options);
      else if (x.options.map((o) => o.text).join() !== src.options.join()) shuffledSeen = true;
      for (const o of x.options) assert.equal(o.explain, src.explain[src.options.indexOf(o.text)]);
      assert.equal(x.options[x.correctIndex].text, src.answer);
    }
  }
  assert.ok(shuffledSeen, '非情報檢索的題目會被打亂');
});

test('R14 讀解題面欄位：說明、短文、雙篇、題號、考點，不掛朗讀', () => {
  const qs = session({ count: 20, rng: seeded(5) }).questions;
  const togo = qs.find((x) => x.mondaiKey === 'dokkai-togo');
  assert.equal(togo.passage, null);
  assert.equal(togo.passageA, 'A6');
  assert.equal(togo.mondaiLabel, '問題11 統合理解');
  const cho = qs.find((x) => x.mondaiKey === 'dokkai-chobun');
  assert.equal(cho.passage.startsWith('本文'), true);
  assert.equal(cho.questionCount, 4);
  assert.equal(cho.focusLabel, '內容一致');
  assert.match(cho.context, /文章を読んで/);
  assert.ok(cho.askZh);
  assert.equal(cho.speakText, null);
  assert.equal(cho.direction, 'target2zh');
  assert.equal(cho.sourceId, `${cho.passageId}-q${cho.questionNo}`);
});

test('R11 題型篩選與級別：只勾長文只出長文；N5 篩選不受讀解影響', () => {
  const only = session({ mondai: ['dokkai-chobun'], count: 20 }).questions;
  assert.ok(only.length === 8 && only.every((x) => x.mondaiKey === 'dokkai-chobun'));
  assert.throws(() => session({ level: 1 }), /沒有 JLPT 模擬題/);
  assert.equal(poolOf('jlpt', [], [], [], [], [], READING).length, 15);
});

test('作答判定沿用 choice', () => {
  const s = session();
  answer(s, 0, s.questions[0].correctIndex);
  assert.equal(isCorrect(s.questions[0]), true);
});
