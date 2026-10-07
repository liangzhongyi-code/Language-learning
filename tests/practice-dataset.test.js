import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practice as enPractice } from '../assets/js/data/en/practice.js';
import { practice as jaPractice } from '../assets/js/data/ja/practice.js';
import { words as enWords } from '../assets/js/data/en/words.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { sentences as enSentences } from '../assets/js/data/en/sentences.js';
import { sentences as jaSentences } from '../assets/js/data/ja/sentences.js';

/**
 * 新題型人工種子資料的結構與內容核對。
 * 這裡驗證的是「資料跟既有題庫對得上」，判題行為另由 practice-engine 測試負責。
 */

const SETS = {
  en: { items: enPractice, words: enWords, sentences: enSentences,
    modes: ['typing', 'listening', 'dictation', 'tiles', 'reorder', 'pos'] },
  ja: { items: jaPractice, words: jaWords, sentences: jaSentences,
    modes: ['typing', 'kana', 'listening', 'dictation', 'tiles', 'reorder', 'pos'] },
};
const LANGS = Object.keys(SETS);
const byId = (list) => new Map(list.map((row) => [row.id, row]));
const hira = (text) => text.normalize('NFKC').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const SENTENCE_MODES = ['reorder'];
const sourceOf = (lang, item) => (SENTENCE_MODES.includes(item.mode) ? byId(SETS[lang].sentences) : byId(SETS[lang].words)).get(item.sourceId);
/**
 * 朗讀與拼字的「外文正解」：英文是 target，日文是假名讀音（與既有題庫朗讀假名的慣例一致）
 */
const spoken = (lang, word) => (lang === 'en' ? word.target : word.reading);
const ofMode = (lang, mode) => SETS[lang].items.filter((item) => item.mode === mode);

test('F31 每語言每種題型至少 10 筆，日文含 kana，英文沒有 kana', () => {
  for (const lang of LANGS) {
    for (const mode of SETS[lang].modes) assert.ok(ofMode(lang, mode).length >= 10, `${lang} ${mode} 不足 10 筆`);
    for (const item of SETS[lang].items) assert.ok(SETS[lang].modes.includes(item.mode), `${item.id} 題型不明：${item.mode}`);
  }
  assert.equal(ofMode('en', 'kana').length, 0);
});

test('F31 id 格式為 {lang}-x-三位數字且全域唯一', () => {
  const seen = new Set();
  for (const lang of LANGS) {
    for (const item of SETS[lang].items) {
      assert.match(item.id, new RegExp(`^${lang}-x-\\d{3}$`));
      assert.ok(!seen.has(item.id), `重複 id：${item.id}`);
      seen.add(item.id);
      assert.equal(typeof item.prompt, 'string', `${item.id} 缺 prompt`);
      assert.ok(item.prompt.length > 0);
    }
  }
});

test('F31 sourceId 引用既有題庫真實 id，且級別一致（英文 1 級、日文 N5 = level 1）', () => {
  for (const lang of LANGS) {
    for (const item of SETS[lang].items) {
      const source = sourceOf(lang, item);
      assert.ok(source, `${item.id} 的 sourceId 不存在：${item.sourceId}`);
      assert.equal(item.level, 1, `${item.id} 級別必須是 1`);
      assert.equal(source.level, item.level, `${item.id} 與來源級別不一致`);
    }
  }
});

test('F31 輸入題白名單非空，且與來源的外文一致（日文同時收假名讀音與漢字寫法）', () => {
  for (const lang of LANGS) {
    for (const item of SETS[lang].items.filter((row) => ['typing', 'kana', 'dictation'].includes(row.mode))) {
      const word = sourceOf(lang, item);
      assert.ok(Array.isArray(item.accepted) && item.accepted.length > 0, `${item.id} accepted 為空`);
      assert.ok(item.accepted.every((answer) => typeof answer === 'string' && answer.trim() === answer && answer.length > 0));
      assert.equal(new Set(item.accepted).size, item.accepted.length, `${item.id} accepted 重複`);
      if (item.mode === 'kana') {
        assert.equal(item.prompt, word.target, `${item.id} kana 的提示必須是漢字寫法`);
        assert.deepEqual(item.accepted, [word.reading], `${item.id} kana 只收平假名讀音`);
        assert.match(word.reading, /^[ぁ-ゖー]+$/u, `${item.id} 讀音必須是平假名`);
        assert.notEqual(word.target, word.reading, `${item.id} kana 的來源必須有漢字`);
      } else if (lang === 'en') {
        assert.ok(item.accepted.includes(word.target), `${item.id} 未收來源拼字`);
      } else {
        assert.ok(item.accepted.includes(word.reading) && item.accepted.includes(word.target), `${item.id} 日文須收讀音與寫法`);
      }
      if (item.mode === 'typing') {
        assert.equal(item.prompt, word.zh, `${item.id} typing 的提示是來源中文`);
        assert.equal(item.caseSensitive, false);
      }
      if (item.mode === 'dictation') assert.equal(item.speakText, spoken(lang, word), `${item.id} 朗讀文字不一致`);
    }
  }
});

test('F31 看中文打外文：中文提示不可與任何可接受答案相同，否則照抄提示就能答對', () => {
  for (const lang of LANGS) {
    for (const item of ofMode(lang, 'typing')) {
      assert.ok(!item.accepted.some((answer) => answer.normalize('NFKC') === item.prompt.normalize('NFKC')), `${item.id} 提示與答案相同`);
    }
  }
});

/**
 * 同音字：日文以假名讀音、英文以拼字相同判定（英文另列人工已知同音字清單）。
 * 出現同級同音字時必須附 context 朗讀句；任何級別的同音字中文都不可當干擾選項。
 */
const EN_HOMOPHONES = ['tea', 'eye', 'night', 'rain', 'read', 'red', 'see', 'sea', 'right', 'write', 'hear', 'here',
  'meet', 'meat', 'be', 'by', 'buy', 'for', 'four', 'one', 'won', 'no', 'know', 'two', 'too', 'to', 'son', 'sun',
  'week', 'weak', 'morning', 'flower', 'hour', 'our', 'wind', 'die', 'bear', 'break', 'sale', 'sell', 'role', 'piece'];
function homophones(lang, word) {
  if (lang === 'en') return SETS.en.words.filter((row) => row.id !== word.id && row.target.toLowerCase() === word.target.toLowerCase());
  return SETS.ja.words.filter((row) => row.id !== word.id && hira(row.reading) === hira(word.reading));
}

test('F31 聽力選項恰有一個正解，同音字排除或附 context', () => {
  for (const lang of LANGS) {
    for (const item of [...ofMode(lang, 'listening'), ...ofMode(lang, 'dictation')]) {
      const word = sourceOf(lang, item);
      const same = homophones(lang, word);
      if (lang === 'en') assert.ok(!EN_HOMOPHONES.includes(word.target.toLowerCase()), `${item.id} 是已知英文同音字`);
      if (same.some((row) => row.level === word.level)) {
        assert.equal(typeof item.context, 'string', `${item.id} 有同級同音字，必須附 context`);
        assert.ok(item.context.includes(item.speakText), `${item.id} context 必須包含朗讀的字`);
      }
      if (item.mode !== 'listening') continue;
      assert.equal(item.speakText, spoken(lang, word), `${item.id} 朗讀文字不一致`);
      assert.equal(item.options.length, 4, `${item.id} 必須 4 個選項`);
      assert.equal(new Set(item.options).size, 4, `${item.id} 選項重複`);
      assert.ok(Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < 4);
      assert.equal(item.options[item.correctIndex], word.zh, `${item.id} 正解不是來源中文`);
      assert.equal(item.options.filter((option) => option === word.zh).length, 1);
      const banned = new Set(same.map((row) => row.zh));
      item.options.forEach((option, index) => {
        if (index !== item.correctIndex) assert.ok(!banned.has(option), `${item.id} 干擾選項「${option}」是同音字的意思`);
      });
    }
  }
});

test('F31 日文聽力確實包含附 context 的同音字題（橋／箸、雨／飴）', () => {
  const withContext = ofMode('ja', 'listening').filter((item) => typeof item.context === 'string');
  assert.ok(withContext.length >= 2);
  assert.ok(withContext.some((item) => sourceOf('ja', item).target === '橋'));
});

test('F31 拼字片段：片段依序串起來等於正解，多重集合與正解的字元一致（可含重複片段）', () => {
  for (const lang of LANGS) {
    for (const item of ofMode(lang, 'tiles')) {
      const word = sourceOf(lang, item);
      assert.equal(item.prompt, word.zh, `${item.id} 提示是來源中文`);
      assert.equal(item.answer, spoken(lang, word), `${item.id} 正解與來源不一致`);
      assert.ok(Array.isArray(item.fragments) && item.fragments.length >= 2);
      assert.ok(item.fragments.every((piece) => typeof piece === 'string' && piece.length > 0));
      assert.equal(item.fragments.join(''), item.answer);
      assert.deepEqual([...item.fragments.join('')].sort(), [...item.answer].sort());
    }
  }
  assert.ok(ofMode('en', 'tiles').some((item) => item.fragments.filter((p) => p === 'p').length === 2), '英文需有 apple 這類重複片段');
  assert.ok(ofMode('ja', 'tiles').some((item) => item.fragments.some((p) => /[ぁぃぅぇぉっゃゅょ]/u.test(p))), '日文需有獨立小假名片段');
});

const isPermutation = (order, size) => Array.isArray(order) && order.length === size
  && [...order].sort((a, b) => a - b).every((value, index) => value === index);

test('F31 排句：chunks 取自來源句，每個 legalOrder 都是 chunks 索引的排列且不重複', () => {
  for (const lang of LANGS) {
    for (const item of ofMode(lang, 'reorder')) {
      const sentence = sourceOf(lang, item);
      assert.equal(item.prompt, sentence.zh, `${item.id} 提示是來源句中文`);
      assert.deepEqual(item.chunks, sentence.chunks.map((chunk) => chunk.target), `${item.id} chunks 與來源句不一致`);
      assert.ok(item.legalOrders.length >= 1);
      const keys = new Set();
      for (const order of item.legalOrders) {
        assert.ok(isPermutation(order, item.chunks.length), `${item.id} 語序不是排列：${order}`);
        keys.add(order.join(','));
      }
      assert.equal(keys.size, item.legalOrders.length, `${item.id} 合法語序重複`);
      const joiner = lang === 'en' ? ' ' : '';
      assert.equal(item.legalOrders[0].map((i) => item.chunks[i]).join(joiner), sentence.target, `${item.id} 第一個語序必須是原句`);
      assert.ok(!('zhIndex' in item), '排句不可用 zhIndex 推導語序');
    }
  }
});

test('F31 排句：至少 3 題有 2 種以上合法語序（每語言至少 2 題）', () => {
  const multi = (lang) => ofMode(lang, 'reorder').filter((item) => item.legalOrders.length >= 2).length;
  assert.ok(multi('en') + multi('ja') >= 3);
  assert.ok(multi('en') >= 2);
  assert.ok(multi('ja') >= 3);
});

test('F31 語境詞性：targetWord 是來源字，position 是它在句中的字元起點，選項恰有一個正解', () => {
  for (const lang of LANGS) {
    for (const item of ofMode(lang, 'pos')) {
      const word = sourceOf(lang, item);
      assert.equal(item.targetWord, word.target, `${item.id} targetWord 與來源不一致`);
      assert.ok(Number.isInteger(item.position) && item.position >= 0);
      assert.equal(item.sentence.slice(item.position, item.position + item.targetWord.length), item.targetWord, `${item.id} position 不正確`);
      assert.ok(item.options.length >= 4 && new Set(item.options).size === item.options.length);
      assert.ok(Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < item.options.length);
    }
  }
});

test('O15 同一單字在不同句中詞性不同：每語言至少 3 組，且兩筆答案不同', () => {
  for (const lang of LANGS) {
    const groups = new Map();
    for (const item of ofMode(lang, 'pos')) {
      if (!groups.has(item.sourceId)) groups.set(item.sourceId, []);
      groups.get(item.sourceId).push(item);
    }
    const contrasting = [...groups.values()].filter((list) => new Set(list.map((item) => item.options[item.correctIndex])).size >= 2);
    assert.ok(contrasting.length >= 3, `${lang} 同字不同詞性只有 ${contrasting.length} 組`);
    for (const list of contrasting) assert.ok(new Set(list.map((item) => item.sentence)).size === list.length, '同字題目必須是不同句子');
  }
});

test('O15 英文 run 名詞與動詞兩筆都存在且答案不同', () => {
  const runs = ofMode('en', 'pos').filter((item) => item.targetWord === 'run');
  const answers = runs.map((item) => item.options[item.correctIndex]);
  assert.ok(answers.includes('名詞') && answers.includes('動詞'));
});
