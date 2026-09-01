/**
 * 出題範圍（只練易錯、今天該複習）。
 *
 * 這個功能最容易寫錯的地方不是「有沒有濾對」，而是連干擾選項一起濾掉：
 * 只錯過四個字的人會拿到一局四個選項永遠是那四個字的測驗，
 * 第二題開始就能用刪去法，而畫面上完全看不出有什麼不對。
 * 所以這裡把「題目來自小池、選項來自大池」當成主要的斷言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSession, poolOf } from '../assets/js/core/quiz-engine.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { sentences as jaSentences } from '../assets/js/data/ja/sentences.js';

function seeded() {
  let n = 0;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

const build = (over = {}) =>
  buildSession({
    lang: 'ja',
    words: jaWords,
    sentences: jaSentences,
    source: 'words',
    count: 10,
    rng: seeded(),
    ...over,
  });

test('沒給 onlyIds 就是整個題庫，與沒有這個參數時完全相同', () => {
  assert.deepEqual(build({ onlyIds: null }), build());
});

test('題目只會來自指定的 id', () => {
  const ids = jaWords.slice(0, 12).map((w) => w.id);
  const session = build({ onlyIds: ids, count: 12 });
  const set = new Set(ids);
  for (const q of session.questions) {
    assert.ok(set.has(q.sourceId), `${q.sourceId} 不在指定範圍內`);
  }
});

test('干擾選項仍然從完整題庫抽，不會因為範圍變小就變好猜', () => {
  /* 只留四個字。全部都濾的話，一局裡的選項就只會是這四個字反覆出現 */
  const ids = jaWords.slice(0, 4).map((w) => w.id);
  const only = new Set(jaWords.slice(0, 4).map((w) => w.target));

  const session = build({ onlyIds: ids, count: 4 });
  const shown = new Set(session.questions.flatMap((q) => q.options.map((o) => o.text)));

  assert.ok(shown.size > only.size, '選項應該包含範圍以外的字');
  assert.ok(
    [...shown].some((t) => !only.has(t)),
    '一局四題十六個選項全部落在那四個字裡，等於送分'
  );
});

test('範圍小於一局的題數時，就出那幾題，不會湊數也不會重複', () => {
  const ids = jaWords.slice(0, 5).map((w) => w.id);
  const session = build({ onlyIds: ids, count: 10 });
  assert.equal(session.questions.length, 5);
  const seen = session.questions.map((q) => q.sourceId);
  assert.equal(new Set(seen).size, seen.length, '同一局不該出現重複的題目');
});

test('範圍是空的就拋出看得懂的錯誤，不是拋出內部代號', () => {
  assert.throws(
    () => build({ onlyIds: [] }),
    /這個範圍裡沒有題目/,
    '空範圍要給使用者看得懂的訊息'
  );
  assert.throws(() => build({ onlyIds: ['不存在的-id'] }), /這個範圍裡沒有題目/);
});

test('接受陣列也接受 Set', () => {
  const ids = jaWords.slice(0, 8).map((w) => w.id);
  const fromArray = build({ onlyIds: ids, count: 8 }).questions.map((q) => q.sourceId);
  const fromSet = build({ onlyIds: new Set(ids), count: 8 }).questions.map((q) => q.sourceId);
  assert.deepEqual(fromArray, fromSet);
});

test('填空題也吃範圍，而且候選詞仍然從完整句庫湊', () => {
  const clozePool = poolOf('cloze', jaWords, jaSentences);
  const ids = clozePool.slice(0, 4).map((s) => s.id);
  const session = build({ source: 'cloze', onlyIds: ids, count: 4 });

  const set = new Set(ids);
  for (const q of session.questions) assert.ok(set.has(q.sourceId));

  /* 候選詞若只從那四句湊，很容易湊不滿 BANK_EXTRA，這一條同時擋住那個回歸 */
  for (const q of session.questions) {
    assert.ok(q.bank.length > q.blanks.length, `${q.sourceId} 的候選詞沒有比空格多`);
  }
});

test('範圍與隱藏漢字可以同時用', () => {
  const ids = jaWords.filter((w) => w.reading).slice(0, 10).map((w) => w.id);
  const session = build({ onlyIds: ids, kanjiMode: 'kana', count: 10 });
  const KANJI = /[々㐀-䶿一-鿿]/;
  for (const q of session.questions) {
    assert.ok(new Set(ids).has(q.sourceId));
    for (const o of q.options) assert.ok(!KANJI.test(o.text), `選項出現漢字：${o.text}`);
  }
});
