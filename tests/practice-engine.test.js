import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_MODES, eligiblePractice, buildPracticeQuestion, judgePractice } from '../assets/js/core/practice-engine.js';
import { createReviewEvent } from '../assets/js/core/review-events.js';
import { LearningError } from '../assets/js/core/learning-errors.js';
import { practice as enPractice } from '../assets/js/data/en/practice.js';
import { practice as jaPractice } from '../assets/js/data/ja/practice.js';

const NOW = 1791158400000;
const ALL = [...enPractice, ...jaPractice];
const code = (expected) => (error) => error instanceof LearningError && error.code === expected;
/**
 * 固定序列的假亂數，值域 [0,1)，可重現洗牌結果
 */
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const zero = () => 0;
const find = (id) => ALL.find((item) => item.id === id);
const lift = (id, rng = zero) => buildPracticeQuestion(find(id), rng);
/**
 * 依題面上的 instanceId 找出「依指定文字順序」的作答，重複文字時依出現順序取用
 */
function pick(question, texts, list = question.fragments ?? question.chunks) {
  const used = new Set();
  return texts.map((text) => {
    const hit = list.find((piece) => piece.text === text && !used.has(piece.instanceId));
    used.add(hit.instanceId);
    return hit.instanceId;
  });
}

/* ── 模式對照 ─────────────────────────────────────────────── */

test('F32 PRACTICE_MODES 的能力與方向對照', () => {
  const expected = {
    typing: ['production', 'zh2target'], kana: ['production', 'target2zh'],
    listening: ['listening-recognition', 'target2zh'], dictation: ['listening-production', 'target2zh'],
    tiles: ['assembly', 'zh2target'], reorder: ['assembly', 'zh2target'], pos: ['grammar', 'target2zh'],
  };
  assert.deepEqual(Object.keys(PRACTICE_MODES).sort(), Object.keys(expected).sort());
  for (const [mode, [ability, direction]] of Object.entries(expected)) {
    assert.equal(PRACTICE_MODES[mode].ability, ability, mode);
    assert.equal(PRACTICE_MODES[mode].direction, direction, mode);
  }
  assert.ok(Object.isFrozen(PRACTICE_MODES));
});

/* ── O10 出題範圍：同語言、同題型、同級，不跨級也不拿全題庫補 ───────── */

test('O10 只取同語言、同題型、同級的題目', () => {
  const result = eligiblePractice({ items: ALL, lang: 'en', mode: 'tiles', level: 1 });
  assert.equal(result.ok, true);
  assert.ok(result.items.length >= 10);
  assert.ok(result.items.every((item) => item.mode === 'tiles' && item.id.startsWith('en-x-') && item.level === 1));
  const ja = eligiblePractice({ items: ALL, lang: 'ja', mode: 'kana', level: 'N5' });
  assert.equal(ja.ok, true);
  assert.deepEqual(ja.items, eligiblePractice({ items: ALL, lang: 'ja', mode: 'kana', level: 1 }).items);
});

test('O10 指定單字簿時只取 sourceId 在簿內者，不足不拿全題庫補', () => {
  const book = ['en-w-004', 'en-w-003', 'en-w-999'];
  const result = eligiblePractice({ items: ALL, lang: 'en', mode: 'tiles', level: 1, bookWordIds: book });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map((item) => item.sourceId).sort(), ['en-w-003', 'en-w-004']);
  const viaSet = eligiblePractice({ items: ALL, lang: 'en', mode: 'tiles', level: 1, bookWordIds: new Set(book) });
  assert.deepEqual(viaSet.items, result.items);
  const empty = eligiblePractice({ items: ALL, lang: 'en', mode: 'tiles', level: 1, bookWordIds: ['en-w-999'] });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.items, []);
  assert.match(empty.reason, /單字簿/);
});

test('O10 不跨級補題：英文 2 級沒有題目時回 ok:false 與中文原因，不產生空 session', () => {
  const result = eligiblePractice({ items: ALL, lang: 'en', mode: 'typing', level: 2 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.reason, /此級別尚未提供/);
});

test('O10 日文非 N5 回 ok:false 並說明尚未補齊', () => {
  for (const level of ['N4', 'N1', 2, 5]) {
    for (const mode of Object.keys(PRACTICE_MODES)) {
      const result = eligiblePractice({ items: ALL, lang: 'ja', mode, level });
      assert.equal(result.ok, false, `${level} ${mode}`);
      assert.deepEqual(result.items, []);
      assert.match(result.reason, /尚未補齊/);
    }
  }
});

test('O10 英文沒有 kana 題型；未知題型、語言或級別直接拋錯', () => {
  const result = eligiblePractice({ items: ALL, lang: 'en', mode: 'kana', level: 1 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /假名/);
  assert.throws(() => eligiblePractice({ items: ALL, lang: 'en', mode: 'essay', level: 1 }), code('INVALID_DATA'));
  assert.throws(() => eligiblePractice({ items: ALL, lang: 'ko', mode: 'typing', level: 1 }), code('INVALID_DATA'));
  assert.throws(() => eligiblePractice({ items: ALL, lang: 'en', mode: 'typing', level: 9 }), code('INVALID_DATA'));
  assert.throws(() => eligiblePractice({ items: 'x', lang: 'en', mode: 'typing', level: 1 }), code('INVALID_DATA'));
  assert.throws(() => eligiblePractice({ items: [find('en-x-001'), find('en-x-001')], lang: 'en', mode: 'typing', level: 1 }), code('INVALID_DATA'));
});

/* ── 題面：可放進 review 事件、正解只放在 answerKey ──────────────── */

test('F32 每種題型的題面都能實際呼叫 createReviewEvent 而不拋錯，能力 key 正確', () => {
  for (const item of ALL) {
    const question = buildPracticeQuestion(item, seq(0.3, 0.7, 0.1));
    const spec = PRACTICE_MODES[item.mode];
    assert.equal(question.sourceId, item.sourceId);
    assert.equal(question.ability, spec.ability);
    assert.equal(question.direction, spec.direction);
    assert.equal(question.practiceMode, item.mode);
    const lang = item.id.slice(0, 2);
    for (const correct of [true, false]) {
      const event = createReviewEvent({ sessionId: 'session-1', entryId: `entry-${item.id}`, reviewId: `review-${item.id}`,
        question, lang, source: 'practice', answerContext: { submitted: true, correct }, now: NOW });
      assert.equal(event.correct, correct);
      assert.equal(event.skillKey, `${item.sourceId}:${spec.ability}:${spec.direction}`);
      assert.equal(event.questionMode, question.questionMode);
    }
  }
});

test('F32 kana 沿用 review 事件既有的 typing 形狀，以 practiceMode 區分且方向是 target2zh', () => {
  const question = lift('ja-x-013');
  assert.equal(question.kind, 'typing');
  assert.equal(question.questionMode, 'typing');
  assert.equal(question.practiceMode, 'kana');
  assert.equal(question.direction, 'target2zh');
  const typing = lift('ja-x-004');
  assert.equal(typing.direction, 'zh2target');
  assert.notEqual(`${question.sourceId}:${question.ability}:${question.direction}`,
    `${typing.sourceId}:${typing.ability}:${typing.direction}`);
});

test('F32 題面頂層不放正解欄位，正解只在 answerKey', () => {
  const forbidden = ['accepted', 'answer', 'correctIndex', 'legalOrders', 'caseSensitive'];
  for (const item of ALL) {
    const question = buildPracticeQuestion(item, zero);
    for (const key of forbidden) assert.ok(!(key in question), `${item.id} 頂層含 ${key}`);
    assert.equal(typeof question.answerKey, 'object');
  }
});

test('F32 rng 由呼叫端注入，缺少或超出 [0,1) 直接拋錯', () => {
  assert.throws(() => buildPracticeQuestion(find('en-x-037')), code('INVALID_DATA'));
  assert.throws(() => buildPracticeQuestion(find('en-x-037'), () => 1), code('INVALID_DATA'));
  assert.throws(() => buildPracticeQuestion(find('en-x-037'), () => Number.NaN), code('INVALID_DATA'));
  assert.throws(() => buildPracticeQuestion({ ...find('en-x-037'), mode: 'essay' }, zero), code('INVALID_DATA'));
});

/* ── 輸入題與選項題判題 ────────────────────────────────────────── */

test('F32 typing／kana／dictation 走白名單判題，空輸入判無效', () => {
  const typing = lift('en-x-012');
  assert.deepEqual(judgePractice(typing, { input: ' Mom ' }), { correct: true, valid: true, reason: null });
  assert.equal(judgePractice(typing, { input: 'mothr' }).correct, false);
  assert.equal(judgePractice(typing, { input: 'mothr' }).valid, true);
  const empty = judgePractice(typing, { input: '  ' });
  assert.equal(empty.correct, false);
  assert.equal(empty.valid, false);
  assert.equal(typeof empty.reason, 'string');
  const kana = lift('ja-x-013');
  assert.equal(judgePractice(kana, { input: 'ガッコウ' }).correct, true);
  assert.equal(judgePractice(kana, { input: 'がこう' }).correct, false);
  const ja = lift('ja-x-004');
  assert.equal(judgePractice(ja, { input: '学校' }).correct, true);
  const dictation = lift('ja-x-039');
  assert.equal(judgePractice(dictation, { input: 'がっこう' }).correct, true);
  assert.equal(judgePractice(dictation, { input: '学校' }).correct, true);
});

test('F32 listening 以 rng 洗選項，正解索引跟著選項走；pos 選項順序固定', () => {
  const item = find('en-x-013');
  const question = buildPracticeQuestion(item, seq(0.9, 0.1, 0.5));
  const correctText = item.options[item.correctIndex];
  assert.equal(question.options[question.answerKey.correctIndex], correctText);
  assert.deepEqual([...question.options].sort(), [...item.options].sort());
  assert.equal(judgePractice(question, { selectedIndex: question.answerKey.correctIndex }).correct, true);
  const wrong = question.options.findIndex((text) => text !== correctText);
  assert.deepEqual(judgePractice(question, { selectedIndex: wrong }), { correct: false, valid: true, reason: null });
  assert.equal(judgePractice(question, { selectedIndex: 9 }).valid, false);
  assert.equal(judgePractice(question, { selectedIndex: 1.5 }).valid, false);
  const pos = lift('en-x-061', seq(0.9, 0.1));
  assert.deepEqual(pos.options, find('en-x-061').options);
  assert.equal(judgePractice(pos, { selectedIndex: 1 }).correct, true);
  assert.equal(judgePractice(pos, { selectedIndex: 0 }).correct, false);
  const homophone = lift('ja-x-038');
  assert.equal(homophone.context, 'はしをわたります');
});

/* ── O13 拼字片段：重複片段各自獨立、可互換；同一片段不可用兩次 ───── */

test('O13 tiles 片段包成 instance，重複文字的 instanceId 不同，並以 rng 洗牌', () => {
  const item = find('en-x-037');
  const question = buildPracticeQuestion(item, seq(0.1, 0.8, 0.4, 0.6));
  const ids = question.fragments.map((piece) => piece.instanceId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(question.fragments.map((piece) => piece.text).sort(), [...item.fragments].sort());
  assert.notDeepEqual(question.fragments.map((piece) => piece.text), item.fragments, '洗牌後不應維持原順序');
  const again = buildPracticeQuestion(item, seq(0.1, 0.8, 0.4, 0.6));
  assert.deepEqual(again, question, '相同 rng 序列應得到相同題面');
  assert.deepEqual(ids, question.fragments.map((_, index) => `t${index}`), 'instanceId 依顯示順序編號，不洩漏正解順序');
});

test('O13 tiles 相同文字的片段互換仍判正確', () => {
  const question = lift('en-x-037', seq(0.5, 0.2, 0.9));
  const ps = question.fragments.filter((piece) => piece.text === 'p').map((piece) => piece.instanceId);
  assert.equal(ps.length, 2);
  const at = (text) => question.fragments.find((piece) => piece.text === text).instanceId;
  const forward = [at('a'), ps[0], ps[1], at('l'), at('e')];
  const swapped = [at('a'), ps[1], ps[0], at('l'), at('e')];
  assert.deepEqual(judgePractice(question, { instanceIds: forward }), { correct: true, valid: true, reason: null });
  assert.deepEqual(judgePractice(question, { instanceIds: swapped }), { correct: true, valid: true, reason: null });
  const ja = lift('ja-x-054', seq(0.3, 0.6));
  assert.equal(judgePractice(ja, { instanceIds: pick(ja, ['ぎ', 'ゅ', 'う', 'に', 'ゅ', 'う']) }).correct, true);
  assert.equal(judgePractice(ja, { instanceIds: pick(ja, ['ぎ', 'う', 'ゅ', 'に', 'ゅ', 'う']) }).correct, false);
});

test('O13 tiles 同一個 instance 用兩次、或用不存在的 instance 判無效', () => {
  const question = lift('en-x-037', seq(0.5, 0.2, 0.9));
  const p = question.fragments.find((piece) => piece.text === 'p').instanceId;
  const at = (text) => question.fragments.find((piece) => piece.text === text).instanceId;
  const twice = judgePractice(question, { instanceIds: [at('a'), p, p, at('l'), at('e')] });
  assert.equal(twice.valid, false);
  assert.equal(twice.correct, false);
  assert.match(twice.reason, /兩次/);
  assert.equal(judgePractice(question, { instanceIds: ['t99'] }).valid, false);
  assert.equal(judgePractice(question, { instanceIds: [] }).valid, false);
  const partial = judgePractice(question, { instanceIds: [at('a'), p] });
  assert.equal(partial.correct, false);
  assert.equal(partial.valid, true);
});

/* ── O14 排句：只認人工列出的合法語序 ─────────────────────────── */

test('O14 reorder 原句語序與人工列出的替代語序都判正確', () => {
  const question = lift('en-x-054', seq(0.7, 0.2, 0.4));
  assert.equal(judgePractice(question, { instanceIds: pick(question, ['I', 'drink', 'milk', 'every day']) }).correct, true);
  assert.equal(judgePractice(question, { instanceIds: pick(question, ['every day', 'I', 'drink', 'milk']) }).correct, true);
  assert.equal(judgePractice(question, { instanceIds: pick(question, ['I', 'every day', 'drink', 'milk']) }).correct, false);
  const ja = lift('ja-x-067', seq(0.2, 0.9, 0.5));
  const item = find('ja-x-067');
  for (const order of item.legalOrders) {
    assert.equal(judgePractice(ja, { instanceIds: pick(ja, order.map((i) => item.chunks[i])) }).correct, true, order.join(','));
  }
  assert.equal(judgePractice(ja, { instanceIds: pick(ja, ['私', 'を', '今日', 'バドミントン', 'は', 'します']) }).correct, false);
});

test('O14 reorder 未列入的語序即使串起來的字串看似正確也判錯', () => {
  const item = { id: 'en-x-900', mode: 'reorder', sourceId: 'en-s-900', level: 1, prompt: '那隻貓看見那隻狗',
    chunks: ['the', 'cat', 'saw', 'the', 'dog'], legalOrders: [[0, 1, 2, 3, 4]] };
  const question = buildPracticeQuestion(item, seq(0.4, 0.8, 0.1, 0.6));
  const byIndex = (index) => Object.keys(question.answerKey.chunkIndexByInstance)
    .find((id) => question.answerKey.chunkIndexByInstance[id] === index);
  const legal = [0, 1, 2, 3, 4].map(byIndex);
  const lookalike = [3, 1, 2, 0, 4].map(byIndex);
  const text = (ids) => ids.map((id) => question.chunks.find((chunk) => chunk.instanceId === id).text).join(' ');
  assert.equal(text(lookalike), text(legal));
  assert.equal(judgePractice(question, { instanceIds: legal }).correct, true);
  assert.equal(judgePractice(question, { instanceIds: lookalike }).correct, false);
});

test('O14 reorder chunks 包成 instance 並洗牌，重複使用同一 chunk 判無效', () => {
  const question = lift('ja-x-063', seq(0.6, 0.3, 0.8, 0.1));
  const ids = question.chunks.map((chunk) => chunk.instanceId);
  assert.deepEqual(ids, question.chunks.map((_, index) => `c${index}`));
  assert.deepEqual(question.chunks.map((chunk) => chunk.text).sort(), [...find('ja-x-063').chunks].sort());
  const twice = judgePractice(question, { instanceIds: [ids[0], ids[0], ids[1], ids[2], ids[3]] });
  assert.equal(twice.valid, false);
  assert.equal(twice.correct, false);
});

test('F32 judgePractice 收到不合法的題面或作答形狀時拋 INVALID_DATA', () => {
  assert.throws(() => judgePractice(null, { input: 'a' }), code('INVALID_DATA'));
  assert.throws(() => judgePractice({ kind: 'typing' }, { input: 'a' }), code('INVALID_DATA'));
  assert.throws(() => judgePractice(lift('en-x-001'), null), code('INVALID_DATA'));
  assert.throws(() => judgePractice(lift('en-x-001'), { input: 3 }), code('INVALID_DATA'));
  assert.throws(() => judgePractice(lift('en-x-037'), { instanceIds: 'abc' }), code('INVALID_DATA'));
});
