import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSession,
  pickDistractors,
  answer,
  poolOf,
  progressPercent,
} from '../assets/js/core/quiz-engine.js';

/**
 * 造一批單字：cats 個分類 × per 筆，方便測干擾選項的遞補行為
 */
function makeWords(cats, per) {
  const out = [];
  let n = 1;
  for (const cat of cats) {
    for (let i = 0; i < per; i++) {
      const id = String(n).padStart(3, '0');
      out.push({
        id: `en-w-${id}`,
        zh: `中${cat}${i}`,
        target: `en-${cat}-${i}`,
        reading: null,
        romaji: null,
        pos: 'noun',
        category: cat,
        level: (i % 3) + 1,
      });
      n++;
    }
  }
  return out;
}

/**
 * 造一批句子
 */
function makeSentences(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `en-s-${String(i + 1).padStart(3, '0')}`,
    zh: `中文句${i}`,
    target: `english sentence ${i}`,
    reading: null,
    patternId: 'en-p-svo',
    chunks: [],
    note: `說明${i}`,
    category: 'daily',
    level: 1,
  }));
}

const WORDS = makeWords(['food', 'sport', 'animal', 'daily', 'place'], 8);
const SENTENCES = makeSentences(20);

const base = (over = {}) => ({
  lang: 'en',
  words: WORDS,
  sentences: SENTENCES,
  source: 'words',
  direction: 'zh2target',
  count: 10,
  ...over,
});

/* ── 干擾選項 ─────────────────────────────────────────────── */

test('pickDistractors：同類別足夠時三個都同類別', () => {
  const correct = WORDS.find((w) => w.category === 'food');
  const picked = pickDistractors(WORDS, correct, 'target');
  assert.equal(picked.length, 3);
  assert.ok(picked.every((w) => w.category === 'food'), '同類別足夠時不該跨類別');
});

test('pickDistractors：同類別不足時往外遞補但仍湊滿三個', () => {
  const pool = [
    ...makeWords(['sport'], 2),
    ...makeWords(['food'], 6).map((w) => ({ ...w, id: w.id.replace('en-w-', 'en-w-1') })),
  ];
  const correct = pool.find((w) => w.category === 'sport');
  const picked = pickDistractors(pool, correct, 'target');
  assert.equal(picked.length, 3);
  assert.equal(picked.filter((w) => w.category === 'sport').length, 1);
  assert.equal(picked.filter((w) => w.category !== 'sport').length, 2);
});

test('pickDistractors：不會選到正解自己', () => {
  const correct = WORDS[0];
  const picked = pickDistractors(WORDS, correct, 'target');
  assert.ok(!picked.some((w) => w.id === correct.id));
});

test('pickDistractors：不會選到與正解顯示文字相同的同義詞', () => {
  const correct = WORDS.find((w) => w.category === 'food');
  const twin = { ...correct, id: 'en-w-999', zh: '另一個寫法' };
  const picked = pickDistractors([...WORDS, twin], correct, 'target');
  assert.ok(!picked.some((w) => w.target === correct.target), '同義詞會造成雙正解');
});

test('pickDistractors：三個干擾選項彼此不重複', () => {
  const correct = WORDS[0];
  const picked = pickDistractors(WORDS, correct, 'target');
  assert.equal(new Set(picked.map((w) => w.target)).size, 3);
});

test('pickDistractors：題庫不足以湊出四個選項時明確拋錯', () => {
  const tiny = makeWords(['food'], 3);
  assert.throws(
    () => pickDistractors(tiny, tiny[0], 'target'),
    /不足/,
    '必須拋出可辨識的錯誤，而不是回傳選項不足的題目'
  );
});

/* ── 出題方向 ─────────────────────────────────────────────── */

test('buildSession：中翻外的題面是中文、選項是外語', () => {
  const s = buildSession(base({ direction: 'zh2target' }));
  for (const q of s.questions) {
    assert.ok(q.prompt.startsWith('中'), `題面應為中文，實際 ${q.prompt}`);
    assert.equal(q.promptLang, 'zh');
    assert.equal(q.optionLang, 'en');
    assert.ok(q.options.every((o) => o.text.startsWith('en-')));
  }
});

test('buildSession：外翻中的題面是外語、選項是中文', () => {
  const s = buildSession(base({ direction: 'target2zh' }));
  for (const q of s.questions) {
    assert.ok(q.prompt.startsWith('en-'));
    assert.equal(q.promptLang, 'en');
    assert.equal(q.optionLang, 'zh');
    assert.ok(q.options.every((o) => o.text.startsWith('中')));
  }
});

test('buildSession：mixed 逐題決定方向，整局兩種都會出現', () => {
  const s = buildSession(base({ direction: 'mixed', count: 30 }));
  const dirs = new Set(s.questions.map((q) => q.direction));
  assert.ok(s.questions.every((q) => q.direction), '每題都要有自己的方向');
  assert.equal(dirs.size, 2, `整局應同時出現兩種方向，實際：${[...dirs]}`);
});

/* ── 題源 ─────────────────────────────────────────────────── */

test('buildSession：words 題源只出單字題', () => {
  const s = buildSession(base({ source: 'words' }));
  assert.ok(s.questions.every((q) => q.sourceId.startsWith('en-w-')));
});

test('buildSession：sentences 題源只出句子題', () => {
  const s = buildSession(base({ source: 'sentences' }));
  assert.ok(s.questions.every((q) => q.sourceId.startsWith('en-s-')));
});

test('buildSession：mixed 題源同時包含單字與句子', () => {
  const s = buildSession(base({ source: 'mixed', count: 30 }));
  assert.ok(s.questions.some((q) => q.sourceId.startsWith('en-w-')));
  assert.ok(s.questions.some((q) => q.sourceId.startsWith('en-s-')));
});

test('buildSession：句子題帶出語序說明供錯題檢討使用', () => {
  const s = buildSession(base({ source: 'sentences' }));
  assert.ok(s.questions.every((q) => typeof q.note === 'string' && q.note.length > 0));
});

test('buildSession：單字題的 note 為 null', () => {
  const s = buildSession(base({ source: 'words' }));
  assert.ok(s.questions.every((q) => q.note === null));
});

/* ── 選項結構 ─────────────────────────────────────────────── */

test('buildSession：每題正好四個選項且恰有一個正解', () => {
  const s = buildSession(base({ count: 20 }));
  for (const q of s.questions) {
    assert.equal(q.options.length, 4);
    assert.equal(q.options.filter((o) => o.isCorrect).length, 1);
    assert.equal(q.options[q.correctIndex].isCorrect, true);
  }
});

test('buildSession：四個選項文字彼此相異', () => {
  const s = buildSession(base({ count: 20 }));
  for (const q of s.questions) {
    assert.equal(new Set(q.options.map((o) => o.text)).size, 4, `${q.sourceId} 有重複選項`);
  }
});

test('buildSession：正解位置不是永遠固定在同一格', () => {
  const s = buildSession(base({ count: 30 }));
  assert.ok(new Set(s.questions.map((q) => q.correctIndex)).size > 1, '選項順序必須洗牌');
});

/* ── 一局的組成 ───────────────────────────────────────────── */

test('buildSession：一局之內題目來源不重複', () => {
  const s = buildSession(base({ count: 20 }));
  const ids = s.questions.map((q) => q.sourceId);
  assert.equal(new Set(ids).size, ids.length);
});

test('buildSession：題數超過題庫時取全部且不報錯', () => {
  const small = makeWords(['food'], 12);
  const s = buildSession(base({ words: small, count: 20 }));
  assert.equal(s.questions.length, 12);
});

test('buildSession：題庫不足四筆時拋出可辨識的錯誤', () => {
  const tiny = makeWords(['food'], 3);
  assert.throws(() => buildSession(base({ words: tiny })), /不足/);
});

test('buildSession：每題初始為未作答', () => {
  const s = buildSession(base());
  assert.ok(s.questions.every((q) => q.answeredIndex === null));
});

test('buildSession：帶出語言與題源供統計使用', () => {
  const s = buildSession(base({ source: 'sentences' }));
  assert.equal(s.lang, 'en');
  assert.equal(s.source, 'sentences');
});

test('buildSession：固定亂數源產生完全相同的一局', () => {
  const seq = [0.11, 0.83, 0.37, 0.62, 0.05, 0.94, 0.28, 0.71, 0.46];
  const rngOf = () => {
    let i = 0;
    return () => seq[i++ % seq.length];
  };
  const a = buildSession(base({ rng: rngOf() }));
  const b = buildSession(base({ rng: rngOf() }));
  assert.deepEqual(a, b, '同樣的亂數序列必須產生同樣的題目與選項順序');
});

/* ── 作答判定 ─────────────────────────────────────────────── */

test('answer：答對回傳 correct true 並記錄選項', () => {
  const s = buildSession(base());
  const q = s.questions[0];
  const r = answer(s, 0, q.correctIndex);
  assert.equal(r.correct, true);
  assert.equal(q.answeredIndex, q.correctIndex);
});

test('answer：答錯回傳正解的索引與文字', () => {
  const s = buildSession(base());
  const q = s.questions[0];
  const wrong = (q.correctIndex + 1) % 4;
  const r = answer(s, 0, wrong);
  assert.equal(r.correct, false);
  assert.equal(r.correctIndex, q.correctIndex);
  assert.equal(r.correctText, q.options[q.correctIndex].text);
});

test('answer：同一題重複作答不會改變已記錄的答案', () => {
  const s = buildSession(base());
  const q = s.questions[0];
  const wrong = (q.correctIndex + 1) % 4;
  answer(s, 0, wrong);
  const second = answer(s, 0, q.correctIndex);
  assert.equal(second.alreadyAnswered, true);
  assert.equal(q.answeredIndex, wrong, '第一次的答案必須被保留');
  assert.equal(second.correct, false, '重複作答不得把錯的改成對的');
});

test('answer：題目索引超出範圍時拋錯而非默默失敗', () => {
  const s = buildSession(base());
  assert.throws(() => answer(s, 999, 0));
});

test('answer：選項索引不合法時拋錯', () => {
  const s = buildSession(base());
  assert.throws(() => answer(s, 0, 9));
});

/* ── 題源筆數與進度 ───────────────────────────────────────── */

test('poolOf：三種題源的池子組成正確', () => {
  assert.equal(poolOf('words', WORDS, SENTENCES).length, WORDS.length);
  assert.equal(poolOf('sentences', WORDS, SENTENCES).length, SENTENCES.length);
  assert.equal(poolOf('mixed', WORDS, SENTENCES).length, WORDS.length + SENTENCES.length);
});

test('poolOf：回傳新陣列，不會被外部改動汙染', () => {
  const pool = poolOf('words', WORDS, SENTENCES);
  pool.pop();
  assert.equal(poolOf('words', WORDS, SENTENCES).length, WORDS.length);
});

test('poolOf：缺漏的題庫視為空陣列', () => {
  assert.deepEqual(poolOf('words', undefined, SENTENCES), []);
  assert.equal(poolOf('mixed', undefined, undefined).length, 0);
});

test('progressPercent：依已作答題數計算', () => {
  const s = buildSession(base({ count: 10 }));
  assert.equal(progressPercent(s), 0);
  answer(s, 0, 0);
  assert.equal(progressPercent(s), 10);
  answer(s, 1, 0);
  answer(s, 2, 0);
  assert.equal(progressPercent(s), 30);
});

test('progressPercent：全部作答完為 100', () => {
  const s = buildSession(base({ count: 5 }));
  s.questions.forEach((q, i) => answer(s, i, q.correctIndex));
  assert.equal(progressPercent(s), 100);
});

test('progressPercent：零題不產生 NaN', () => {
  assert.equal(progressPercent({ questions: [] }), 0);
  assert.equal(progressPercent(null), 0);
});
