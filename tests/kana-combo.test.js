/**
 * 五十音進階題「組合讀法」：拗音、促音、長音與看漢字選讀音。
 *
 * 干擾選項是把正解改一處產生的，最怕兩件事：
 *   改完剛好跟正解同音（兩個答案都對）；
 *   改完的羅馬音跟題庫的 romaji 規則對不上（教錯拼法）。
 * 所以每一筆題目、兩個方向都逐題掃過，不靠抽樣。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { words } from '../assets/js/data/catalog/ja-words-1.js';
import { kana } from '../assets/js/data/ja/kana.js';
import {
  COMBO_RULES, COMBO_RULE_KEYS, kanaToRomaji, comboSpots, comboEntries, comboFilter, comboDistractors, buildComboQuestion,
} from '../assets/js/core/kana-combo.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { hasKanji } from '../assets/js/core/kana.js';

function seeded(seed = 7) {
  let n = seed;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

const entries = comboEntries(words);
const HIRAGANA = /^[ぁ-ゖ]+$/;
const KATAKANA = /^[ァ-ヺー]+$/;
const combo = (extra = {}) => buildSession({
  lang: 'ja', kana, kanaWords: words, source: 'kana', kanaKind: 'combo', kanaScript: 'hiragana',
  kanaRules: COMBO_RULE_KEYS, direction: 'target2zh', count: 1000, rng: seeded(), ...extra,
});

test('假名轉羅馬音與單字題庫的 romaji 同一套規則', () => {
  assert.equal(kanaToRomaji('がっこう'), 'gakkou');
  assert.equal(kanaToRomaji('きょう'), 'kyou');
  assert.equal(kanaToRomaji('コーヒー'), 'koohii');
  assert.equal(kanaToRomaji('まっちゃ'), 'matcha');
  assert.equal(kanaToRomaji('きんえん'), "kin'en");
  assert.equal(kanaToRomaji('っか'), 'kka');
  assert.equal(kanaToRomaji('ーあ'), null, '長音符不能開頭');
  assert.equal(kanaToRomaji('かっ'), null, '促音後面要有子音');
  for (const e of entries) assert.equal(kanaToRomaji(e.kana), e.romaji, `${e.target} 的羅馬音與題庫不一致`);
});

test('找得出三種組合，動詞結尾的う不算長音', () => {
  const rules = (kanaText, pos) => comboSpots(kanaText, pos).map((s) => s.rule);
  assert.deepEqual(rules('きって'), ['sokuon']);
  assert.deepEqual(rules('きょう'), ['youon', 'chouon']);
  assert.deepEqual(rules('せんせい'), ['chouon']);
  assert.deepEqual(rules('おかあさん'), ['chouon']);
  assert.deepEqual(rules('コーヒー'), ['chouon', 'chouon']);
  assert.deepEqual(rules('おもう', 'verb'), [], 'おもう 的う是活用語尾');
  assert.deepEqual(rules('かう', 'verb'), []);
  assert.deepEqual(rules('すし'), []);
});

test('題池只用 N5 單字，每一筆至少一處組合；漢字讀音另記一份 id', () => {
  assert.ok(entries.length > 200, `題池只有 ${entries.length} 筆`);
  const byWord = new Map(words.map((w) => [w.id, w]));
  for (const e of entries) {
    const word = byWord.get(e.wordId);
    assert.equal(word.level, 1);
    assert.ok(e.rules.length > 0);
    assert.ok(e.rules.every((r) => COMBO_RULE_KEYS.includes(r)));
    assert.match(e.id, e.kanji ? /^ja-kj-\d+$/ : /^ja-kc-\d+$/);
    if (e.kanji) assert.ok(hasKanji(e.target) && HIRAGANA.test(e.reading));
    else if (e.script === 'katakana') assert.ok(KATAKANA.test(e.kana) && e.kana === word.target);
    else assert.ok(HIRAGANA.test(e.kana) && e.kana === word.reading);
  }
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
  for (const script of ['hiragana', 'katakana']) {
    for (const rule of COMBO_RULE_KEYS) {
      assert.ok(comboFilter(entries, { script, rules: [rule] }).length >= 4, `${script} ${rule} 不到四題`);
    }
  }
  for (const rule of COMBO_RULE_KEYS) assert.ok(comboFilter(entries, { kanji: true, rules: [rule] }).length >= 4);
});

test('每一題、每個方向：四個選項、只有一個對、沒有兩個選項同音', () => {
  for (const seed of [1, 2, 3]) {
    const rng = seeded(seed);
    for (const e of entries) {
      for (const direction of e.kanji ? ['target2zh'] : ['target2zh', 'zh2target']) {
        const q = buildComboQuestion(e, { direction, rng });
        assert.equal(q.options.length, 4);
        assert.equal(q.options.filter((o) => o.isCorrect).length, 1);
        assert.equal(q.options[q.correctIndex].isCorrect, true);
        const sounds = q.options.map((o) => (q.optionLang === 'romaji' ? o.text : kanaToRomaji(o.text)));
        assert.ok(sounds.every(Boolean), `${e.target} 有轉不出羅馬音的選項：${q.options.map((o) => o.text)}`);
        assert.equal(new Set(sounds).size, 4, `${e.target} 有同音選項：${sounds}`);
        const pattern = q.optionLang === 'romaji' ? /^[a-z']+$/ : e.kanji || e.script === 'hiragana' ? HIRAGANA : KATAKANA;
        assert.ok(q.options.every((o) => pattern.test(o.text)), `${e.target} 選項寫法混雜：${q.options.map((o) => o.text)}`);
        if (e.kanji) {
          assert.equal(q.prompt, e.target);
          assert.equal(q.options[q.correctIndex].text, e.reading);
        }
      }
    }
  }
});

test('干擾選項先用這個詞自己的組合規則出錯：がっこう 會出現漏掉っ與少拉一拍', () => {
  const item = entries.find((e) => e.kana === 'がっこう');
  const seen = new Set();
  for (let seed = 1; seed < 30; seed++) comboDistractors(item, 'kana', seeded(seed)).forEach((d) => seen.add(d.romaji));
  assert.ok(seen.has('gakou') || seen.has('gatsukou'), '要有促音錯誤');
  assert.ok(seen.has('gakko'), '要有長音錯誤');
  const picked = comboDistractors(item, 'kana', seeded(5));
  assert.ok(picked.filter((d) => d.rule !== 'extra').length >= 2, '規則類的錯誤優先');
});

test('解說講出每一處組合怎麼唸；漢字題補一句漢字讀音要整個詞記', () => {
  const q = buildComboQuestion(entries.find((e) => e.kana === 'がっこう' && !e.kanji), { direction: 'target2zh', rng: seeded() });
  assert.match(q.note, /学校/);
  assert.match(q.note, /っ.*停頓一拍/);
  assert.match(q.note, /kō/);
  const kj = buildComboQuestion(entries.find((e) => e.kana === 'がっこう' && e.kanji), { direction: 'zh2target', rng: seeded() });
  assert.equal(kj.direction, 'target2zh', '看漢字選讀音固定是 target2zh');
  assert.match(kj.note, /学校 讀作 がっこう/);
  assert.match(kj.note, /整個詞/);
  assert.equal(kj.speakText, 'がっこう', '朗讀用假名，避免語音引擎把漢字唸錯');
  assert.equal(COMBO_RULES.length, 3);
});

test('組合題接進測驗引擎：模式、規則、方向都照設定', () => {
  const hira = combo();
  assert.equal(hira.source, 'kana');
  assert.ok(hira.questions.every((q) => q.kanaKind === 'combo' && q.kanaScript === 'hiragana' && /^ja-kc-/.test(q.sourceId)));
  assert.ok(hira.questions.every((q) => HIRAGANA.test(q.prompt)));

  const kata = combo({ kanaScript: 'katakana', kanaRules: ['sokuon'] });
  assert.ok(kata.questions.every((q) => KATAKANA.test(q.prompt) && q.kanaRules.includes('sokuon')));

  const both = combo({ kanaScript: 'mixed', direction: 'mixed' });
  assert.deepEqual(new Set(both.questions.map((q) => q.kanaScript)), new Set(['hiragana', 'katakana']));
  assert.deepEqual(new Set(both.questions.map((q) => q.direction)), new Set(['target2zh', 'zh2target']));

  const kanji = combo({ kanaKanji: true, kanaScript: 'katakana' });
  assert.ok(kanji.questions.length > 50);
  assert.ok(kanji.questions.every((q) => /^ja-kj-/.test(q.sourceId) && q.direction === 'target2zh' && q.kanaKanji && hasKanji(q.prompt)));

  assert.throws(() => combo({ kanaRules: [] }), /至少要選一種組合/);
  assert.throws(() => combo({ kanaRules: ['nope'] }), /至少要選一種組合/);
  assert.throws(() => combo({ kanaKind: 'other' }), /題型/);
});

test('單一假名題不受影響：沒帶 kanaKind 時照舊出 ja-k- 題', () => {
  const single = buildSession({ lang: 'ja', kana, source: 'kana', kanaScript: 'hiragana', kanaGroups: ['seion-1'],
    direction: 'target2zh', count: 5, rng: seeded() });
  assert.ok(single.questions.every((q) => /^ja-k-[a-z]+-hira$/.test(q.sourceId) && q.kanaKind === undefined));
});
