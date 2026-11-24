/**
 * 五十音選擇題的出題規則。
 *
 * 最容易出事的是「兩個選項都對」：を 與 お 同音、じ 與 ぢ 同音，
 * 混合模式下 あ 與 ア 的羅馬音完全一樣。這些情況全部逐題掃過，不靠抽樣。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kana } from '../assets/js/data/ja/kana.js';
import {
  KANA_SCRIPTS, KANA_GROUPS, KANA_GROUP_KEYS, KANA_SCRIPT_KEYS, kanaEntries, kanaFilter, kanaGroupOf, kanaNote,
} from '../assets/js/core/kana-quiz.js';
import { buildSession, poolOf, kindOf, hasKanaVersion, answer, isCorrect } from '../assets/js/core/quiz-engine.js';
import { summarize } from '../assets/js/core/stats.js';

/**
 * 固定序列的假亂數，讓同一組設定每次都抽到同一批題目
 */
function seeded(seed = 7) {
  let n = seed;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

const session = (extra = {}) => buildSession({
  lang: 'ja', kana, source: 'kana', kanaScript: 'hiragana', kanaGroups: KANA_GROUP_KEYS,
  direction: 'target2zh', count: 1000, rng: seeded(), ...extra,
});

const HIRAGANA = /^[ぁ-ゖ]+$/;
const KATAKANA = /^[ァ-ヺ]+$/;

/**
 * 現代日文同音、羅馬音寫法卻不同的假名，不能同時出現在一題裡
 */
const SAME_SOUND = [['o', 'wo'], ['ji', 'di'], ['zu', 'du']];
const soundOf = (romaji) => SAME_SOUND.find((set) => set.includes(romaji))?.[0] ?? romaji;

test('三種模式齊全：平假名、片假名、混合', () => {
  assert.deepEqual(KANA_SCRIPTS.map((s) => [s.key, s.label]), [['hiragana', '平假名'], ['katakana', '片假名'], ['mixed', '混合']]);
  assert.deepEqual(KANA_SCRIPT_KEYS, ['hiragana', 'katakana', 'mixed']);
});

test('範圍不重疊也不遺漏，104 個假名各屬一組', () => {
  const counts = Object.fromEntries(KANA_GROUP_KEYS.map((key) => [key, kana.filter((k) => kanaGroupOf(k) === key).length]));
  assert.deepEqual(counts, { 'seion-1': 15, 'seion-2': 15, 'seion-3': 16, dakuon: 20, handakuon: 5, youon: 33 });
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), kana.length);
  for (const group of KANA_GROUPS) assert.ok(group.label && group.note, `${group.key} 要有給初學者看的說明`);
});

test('平假名與片假名分開成兩筆，id 合法、唯一且互不共用', () => {
  const entries = kanaEntries(kana);
  assert.equal(entries.length, 208);
  assert.equal(new Set(entries.map((e) => e.id)).size, 208);
  assert.ok(entries.every((e) => /^ja-k-[a-z]+-(hira|kata)$/.test(e.id)));
  const a = entries.filter((e) => e.romaji === 'a');
  assert.deepEqual(a.map((e) => [e.id, e.script, e.target]), [['ja-k-a-hira', 'hiragana', 'あ'], ['ja-k-a-kata', 'katakana', 'ア']]);
});

test('poolOf／kindOf 認得五十音，而且沒有漢字可換', () => {
  assert.equal(poolOf('kana', [], [], [], [], [], [], kana).length, 208);
  assert.deepEqual(poolOf('kana', [], []), []);
  assert.equal(kindOf('kana'), 'choice');
  assert.equal(hasKanaVersion('kana'), false);
});

test('看假名選羅馬音：平假名模式只出平假名，片假名模式只出片假名', () => {
  for (const [script, pattern] of [['hiragana', HIRAGANA], ['katakana', KATAKANA]]) {
    const s = session({ kanaScript: script });
    assert.equal(s.questions.length, 104);
    for (const q of s.questions) {
      assert.match(q.prompt, pattern);
      assert.equal(q.kanaScript, script);
      assert.equal(q.direction, 'target2zh');
      assert.ok(q.options.every((o) => /^[a-z]+$/.test(o.text)));
      const item = kana.find((k) => k[script] === q.prompt);
      assert.equal(q.options[q.correctIndex].text, item.romaji);
    }
  }
});

test('看羅馬音選假名：題面是羅馬音，四個選項是同一套假名', () => {
  for (const [script, pattern] of [['hiragana', HIRAGANA], ['katakana', KATAKANA]]) {
    for (const q of session({ kanaScript: script, direction: 'zh2target' }).questions) {
      assert.match(q.prompt, /^[a-z]+$/);
      assert.ok(q.options.every((o) => pattern.test(o.text)));
      assert.equal(q.options[q.correctIndex].text, kana.find((k) => k.romaji === q.prompt)[script]);
    }
  }
});

test('混合模式兩套都出，但同一題的假名選項不混兩套', () => {
  const forward = session({ kanaScript: 'mixed' });
  assert.equal(forward.questions.length, 208);
  assert.equal(forward.questions.filter((q) => q.kanaScript === 'hiragana').length, 104);
  for (const q of session({ kanaScript: 'mixed', direction: 'zh2target', rng: seeded(99) }).questions) {
    const pattern = q.kanaScript === 'hiragana' ? HIRAGANA : KATAKANA;
    assert.ok(q.options.every((o) => pattern.test(o.text)), `${q.sourceId}: ${q.options.map((o) => o.text)}`);
  }
});

test('兩個方向混著出時兩種題目都有', () => {
  const dirs = new Set(session({ direction: 'mixed' }).questions.map((q) => q.direction));
  assert.deepEqual([...dirs].sort(), ['target2zh', 'zh2target']);
});

test('每一題恰好四個相異選項、一個正解，而且同音的假名不會一起出現', () => {
  for (const script of KANA_SCRIPT_KEYS) {
    for (const direction of ['target2zh', 'zh2target']) {
      for (let seed = 1; seed <= 5; seed += 1) {
        for (const q of session({ kanaScript: script, direction, rng: seeded(seed) }).questions) {
          assert.equal(q.options.length, 4, q.sourceId);
          assert.equal(new Set(q.options.map((o) => o.text)).size, 4, q.sourceId);
          assert.equal(q.options.filter((o) => o.isCorrect).length, 1, q.sourceId);
          const romaji = q.options.map((o) => direction === 'target2zh'
            ? o.text : kana.find((k) => k[q.kanaScript] === o.text).romaji);
          assert.equal(new Set(romaji.map(soundOf)).size, 4, `${q.sourceId}: ${romaji}`);
        }
      }
    }
  }
});

test('每一組單獨選都出得了題，選項只來自選取的範圍', () => {
  for (const group of KANA_GROUP_KEYS) {
    const allowed = new Set(kana.filter((k) => kanaGroupOf(k) === group).map((k) => k.romaji));
    const s = session({ kanaGroups: [group] });
    assert.equal(s.questions.length, allowed.size);
    for (const q of s.questions) {
      assert.ok(q.options.every((o) => allowed.has(o.text)), `${group}：還沒學的假名不該出現在選項裡 ${q.options.map((o) => o.text)}`);
    }
  }
});

test('干擾選項優先放長得像的字', () => {
  const hits = (script, glyph, wanted) => {
    const { id } = kanaEntries(kana).find((e) => e.target === glyph);
    let hit = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const [q] = session({ kanaScript: script, direction: 'zh2target', rng: seeded(seed), onlyIds: [id], count: 1 }).questions;
      if (q.options.some((o) => wanted.includes(o.text))) hit += 1;
    }
    return hit;
  };
  assert.equal(hits('katakana', 'シ', ['ツ', 'ン', 'ソ', 'ノ', 'ジ', 'ヅ', 'ゾ']), 20);
  assert.equal(hits('hiragana', 'ぬ', ['め', 'あ', 'お']), 20);
  assert.equal(hits('hiragana', 'る', ['ろ', 'そ']), 20);
});

test('只練易錯時縮小的是題目，不是選項池', () => {
  const s = session({ kanaGroups: ['seion-1'], onlyIds: ['ja-k-a-hira'], count: 10 });
  assert.equal(s.questions.length, 1);
  assert.equal(s.questions[0].options.length, 4);
});

test('沒選範圍、不認得的模式、沒有資料都明確拒絕', () => {
  assert.throws(() => session({ kanaGroups: [] }), /至少要選一個範圍/);
  assert.throws(() => session({ kanaScript: 'romaji' }), /模式/);
  assert.throws(() => session({ kana: [] }), /題庫/);
  assert.equal(kanaFilter(kanaEntries(kana), { script: 'hiragana', groups: ['toString'] }).length, 0);
});

test('解說：兩套寫法、羅馬音與例字都有，特殊唸法另外提醒', () => {
  const of = (romaji) => kana.find((k) => k.romaji === romaji);
  assert.match(kanaNote(of('a')), /平假名 あ.*片假名 ア.*a.*あめ（雨）/);
  assert.match(kanaNote(of('wo')), /お.*同音/);
  assert.match(kanaNote(of('di')), /じ.*同音/);
  assert.match(kanaNote(of('ha')), /wa/);
  assert.match(kanaNote(of('shi')), /si/);
});

test('題面快照是純資料，作答與結算沿用共用規則', () => {
  const s = session({ count: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(s.questions)), s.questions);
  s.questions.forEach((q, i) => answer(s, i, i === 0 ? (q.correctIndex + 1) % 4 : q.correctIndex));
  assert.equal(isCorrect(s.questions[0]), false);
  const summary = summarize(s);
  assert.deepEqual([summary.total, summary.correct, summary.accuracy], [4, 3, 75]);
  assert.equal(summary.wrongList[0].prompt, s.questions[0].prompt);
  assert.ok(summary.wrongList[0].speakText);
});
