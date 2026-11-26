/**
 * 跟讀比對：辨識引擎回漢字或假名都要認得，多講少講要扣分，沒對上的字要標得出來。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSpeech, compareSpeech } from '../assets/js/core/shadow-compare.js';

const sentence = { target: '日本へ行きたいです。', reading: 'にほんへいきたいです。' };

test('比對前去掉標點空白、片假名轉平假名，長音符保留', () => {
  assert.equal(normalizeSpeech(' コーヒー、ください。 '), 'こーひーください');
  assert.equal(normalizeSpeech('ＡＢＣ！？'), 'abc');
});

test('辨識回漢字寫法或假名讀音都算完全一樣', () => {
  const byKanji = compareSpeech({ heard: '日本へ行きたいです', ...sentence });
  assert.equal(byKanji.score, 1);
  assert.equal(byKanji.verdict, 'good');
  assert.equal(byKanji.reference, 'target');
  const byKana = compareSpeech({ heard: 'にほんへいきたいです', ...sentence });
  assert.equal(byKana.score, 1);
  assert.equal(byKana.reference, 'reading');
});

test('多個候選取最像的；少講一段會扣分並標出沒對上的字', () => {
  const result = compareSpeech({ heard: ['日本に生きたい', '日本へ行きたい'], ...sentence });
  assert.equal(result.heard, '日本へ行きたい');
  assert.ok(result.score > 0.6 && result.score < 1);
  assert.equal(result.verdict, 'close');
  assert.deepEqual(result.chars.filter((c) => !c.ok).map((c) => c.ch), ['で', 'す']);
});

test('完全不相干或沒聽到東西是 retry，逐字全部標成沒對上', () => {
  const off = compareSpeech({ heard: 'おはようございます', ...sentence });
  assert.equal(off.verdict, 'retry');
  const none = compareSpeech({ heard: [], ...sentence });
  assert.equal(none.score, 0);
  assert.equal(none.verdict, 'retry');
  assert.ok(none.chars.length > 0 && none.chars.every((c) => !c.ok));
});

test('只有讀音沒有寫法（單字卡只給假名）也能比', () => {
  const result = compareSpeech({ heard: 'がっこう', target: '', reading: 'がっこう' });
  assert.equal(result.score, 1);
});
