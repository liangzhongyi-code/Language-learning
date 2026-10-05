import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewEvent, applyReview, reviewIdentity } from '../assets/js/core/review-events.js';
import { initializeItemState, LEITNER_VERSION } from '../assets/js/core/scheduler.js';
import { dueAfter } from '../assets/js/core/srs.js';
import { validateLearningRecord, validateProgress, validateStats } from '../assets/js/core/learning-schema.js';
import { LearningError } from '../assets/js/core/learning-errors.js';

const NOW = 1791158400000;
const question = (overrides = {}) => ({ kind: 'choice', sourceId: 'ja-w-001', direction: 'target2zh',
  options: [{ text: '假資料甲' }, { text: '假資料乙' }], correctIndex: 0, answeredIndex: 0, ...overrides });
const makeEvent = (overrides = {}) => createReviewEvent({ sessionId: 'session-1', entryId: 'entry-1',
  reviewId: 'review-1', question: question(), lang: 'ja', source: 'words', now: NOW, ...overrides });
const legacy = (overrides = {}) => ({ n: 7, w: 2, box: 3, last: NOW - 1000, due: NOW - 1, ...overrides });
const state = (overrides = {}) => ({ sourceId: 'ja-w-001', ability: 'recognition', direction: 'target2zh',
  skillKey: 'ja-w-001:recognition:target2zh', legacySummary: legacy(), schedulerName: 'leitner',
  schedulerVersion: LEITNER_VERSION, schedulerState: { box: 3 }, due: NOW - 1, lastEligibleReviewAt: NOW - 1000,
  learningStatus: 'review', ...overrides });
const counters = () => ({ answered: 20, correct: 15, sessions: 2 });
const invalid = (fn) => assert.throws(fn, (error) => error instanceof LearningError && error.code === 'INVALID_DATA');

test('D14 actual direction isolates skill keys; zh2target choice remains recognition', () => {
  const forward = makeEvent();
  const reverse = makeEvent({ question: question({ direction: 'zh2target' }) });
  assert.equal(forward.skillKey, 'ja-w-001:recognition:target2zh');
  assert.equal(reverse.skillKey, 'ja-w-001:recognition:zh2target');
  assert.equal(forward.correct, true);
  assert.equal(reviewIdentity({ question: question() }).ability, 'recognition');
  invalid(() => makeEvent({ question: question({ direction: 'mixed' }) }));
});

test('D14 cloze credits the sentence assembly only, never its bank words', () => {
  const q = { kind: 'cloze', sourceId: 'ja-s-001', direction: 'zh2target', submitted: true,
    blanks: [{ answer: '私は' }, { answer: '学生です' }], filled: ['私は', '学生です'], bank: ['私は', '学生です', '他の字'] };
  const event = makeEvent({ question: q, source: 'sentences' });
  assert.equal(event.skillKey, 'ja-s-001:assembly:zh2target');
  assert.equal(event.correct, true);
  const applied = applyReview({ event, initialization: { kind: 'new' } });
  assert.equal(applied.itemState?.sourceId, 'ja-s-001');
  assert.equal(applied.progress?.n, 1);
  assert.equal('items' in applied.progress, false);
});

test('O09 typing, dictation, listening, tiles, reorder and pos remain separate capabilities', () => {
  const expected = { typing: 'production', dictation: 'listening-production', listening: 'listening-recognition',
    tiles: 'assembly', reorder: 'assembly', pos: 'grammar' };
  for (const [mode, ability] of Object.entries(expected)) {
    const event = makeEvent({ question: { kind: mode, sourceId: 'ja-w-001', direction: 'zh2target' },
      answerContext: { submitted: true, correct: true } });
    assert.equal(event.skillKey, `ja-w-001:${ability}:zh2target`, mode);
  }
  invalid(() => makeEvent({ questionMode: 'typing' }));
});

test('O09 hint and retry produce Again without changing actual correct counts', () => {
  for (const answerContext of [{ hintUsed: true }, { retry: true }]) {
    const result = applyReview({ event: makeEvent({ answerContext }), previousState: state(), sourceProgress: legacy(), statsScope: counters() });
    assert.equal(result.rating, 'Again');
    assert.equal(result.itemState.schedulerState.box, 1);
    assert.equal(result.event.correct, true);
    assert.equal(result.statsScope.correct, 16);
    assert.equal(result.progress.w, 2);
  }
});

test('O09 replay and real kanji display context persist without inventing hint or Hard/Easy', () => {
  const event = makeEvent({ answerContext: { replayCount: 2, kanjiMode: 'show', responseMs: 125 } });
  assert.equal(event.assistance.replayCount, 2);
  assert.equal(event.assistance.kanjiMode, 'show');
  assert.equal(event.responseMs, 125);
  assert.equal(applyReview({ event, initialization: { kind: 'new' } }).rating, 'Good');
  assert.equal(validateLearningRecord('reviewEvents', event).ok, true);
});

test('D17 initialization preserves the legacy due and counters without constructing a review', () => {
  const previous = legacy({ due: NOW + 86400000 });
  const value = initializeItemState({ sourceId: 'ja-w-001', ability: 'recognition', direction: 'target2zh', initialization: { kind: 'legacy', progress: previous } });
  assert.equal(value.due, previous.due);
  assert.deepEqual(value.legacySummary, previous);
  assert.equal(value.schedulerName, 'legacy');
  assert.equal(value.schedulerState, null);
  assert.equal(value.lastEligibleReviewAt, null);
  assert.equal(value.learningStatus, 'review');
});

test('D15 non-due correct adds a true event and counters but preserves due and box', () => {
  const previous = state({ due: NOW + 86400000 });
  const oldProgress = legacy({ due: previous.due });
  const result = applyReview({ event: makeEvent(), previousState: previous, sourceProgress: oldProgress, statsScope: counters() });
  assert.equal(result.event.scheduleEligible, false);
  assert.equal(result.itemState.due, previous.due);
  assert.equal(result.itemState.schedulerState.box, 3);
  assert.deepEqual(result.progress, { ...oldProgress, n: 8, last: NOW });
  assert.deepEqual(result.statsScope, { answered: 21, correct: 16, sessions: 2 });
});

test('D15 eligible Good advances Leitner exactly once and records before/after', () => {
  const result = applyReview({ event: makeEvent(), previousState: state(), sourceProgress: legacy(), statsScope: counters() });
  assert.equal(result.event.scheduleEligible, true);
  assert.equal(result.rating, 'Good');
  assert.equal(result.itemState.schedulerState.box, 4);
  assert.equal(result.itemState.due, dueAfter(4, NOW));
  assert.equal(result.itemState.lastEligibleReviewAt, NOW);
  assert.equal(result.event.before.schedulerState.box, 3);
  assert.equal(result.event.after.schedulerState.box, 4);
});

test('D15 first non-due failure resets once; same-session failures preserve the first due', () => {
  const wrong = question({ answeredIndex: 1 });
  const first = applyReview({ event: makeEvent({ question: wrong }), previousState: state({ due: NOW + 86400000 }), sourceProgress: legacy() });
  assert.equal(first.rating, 'Again');
  assert.equal(first.event.scheduleEligible, true);
  assert.equal(first.itemState.schedulerState.box, 1);
  const second = applyReview({ event: makeEvent({ question: wrong, entryId: 'entry-2', reviewId: 'review-2', now: NOW + 60000 }),
    previousState: first.itemState, sourceProgress: first.progress, statsScope: first.statsScope, sessionEvents: [first.event] });
  assert.equal(second.event.scheduleEligible, false);
  assert.equal(second.itemState.due, first.itemState.due);
  assert.equal(second.progress.w, 4);
});

test('D15 reinforcement and same-session later success cannot advance another long-term stage', () => {
  const first = applyReview({ event: makeEvent(), previousState: state(), sourceProgress: legacy() });
  const later = makeEvent({ entryId: 'entry-2', reviewId: 'review-2', now: first.itemState.due + 1 });
  const second = applyReview({ event: later, previousState: first.itemState, sourceProgress: first.progress, sessionEvents: [first.event] });
  assert.equal(second.event.scheduleEligible, false);
  assert.equal(second.itemState.due, first.itemState.due);
  const explicit = applyReview({ event: makeEvent({ answerContext: { reinforcement: true } }), previousState: state(), sourceProgress: legacy() });
  assert.equal(explicit.event.scheduleEligible, false);
});

test('D24 per-answer reducer increments counts but never complete-session count', () => {
  const result = applyReview({ event: makeEvent({ question: question({ answeredIndex: 1 }) }), initialization: { kind: 'new' }, statsScope: counters() });
  assert.deepEqual(result.statsScope, { answered: 21, correct: 15, sessions: 2 });
  assert.equal(result.progress.n, 1);
  assert.equal(result.progress.w, 1);
  assert.equal(result.scopeKey, 'ja:words');
});

test('D12 same entry/review in supplied session history is refused before another increment', () => {
  const first = applyReview({ event: makeEvent(), previousState: state(), sourceProgress: legacy() });
  assert.throws(() => applyReview({ event: makeEvent(), previousState: first.itemState, sourceProgress: first.progress, sessionEvents: [first.event] }), LearningError);
  assert.throws(() => applyReview({ event: makeEvent({ reviewId: 'other' }), previousState: first.itemState, sourceProgress: first.progress, sessionEvents: [first.event] }), LearningError);
});

test('D17 untouched legacy future due remains legacy until a qualified real review', () => {
  const oldProgress = legacy({ due: NOW + 86400000 });
  const result = applyReview({ event: makeEvent(), sourceProgress: oldProgress, initialization: { kind: 'legacy', progress: oldProgress } });
  assert.equal(result.itemState?.schedulerName, 'legacy');
  assert.equal(result.itemState?.due, oldProgress.due);
  assert.equal(result.event.scheduleEligible, false);
  assert.deepEqual(result.itemState?.legacySummary, oldProgress);
});

test('F12 unsubmitted, contradictory or invalid answers do not produce a review', () => {
  for (const q of [question({ answeredIndex: null }), question({ answeredIndex: -1 }), question({ correctIndex: Infinity }),
    { kind: 'cloze', sourceId: 'ja-s-001', direction: 'zh2target', submitted: true, blanks: [], filled: [] }]) invalid(() => makeEvent({ question: q }));
  invalid(() => makeEvent({ answerContext: { correct: false } }));
  invalid(() => makeEvent({ question: { kind: 'typing', sourceId: 'ja-w-001', direction: 'zh2target' }, answerContext: { correct: true } }));
});

test('F12 finite validation refuses invalid times, counts, state identity and unsupported FSRS', () => {
  for (const now of [NaN, Infinity, -1, '1']) invalid(() => makeEvent({ now }));
  for (const answerContext of [{ responseMs: Infinity }, { responseMs: -1 }, { retry: 'true' }, { replayCount: 0.5 }]) invalid(() => makeEvent({ answerContext }));
  invalid(() => applyReview({ event: makeEvent(), previousState: state({ sourceId: 'ja-w-other' }) }));
  invalid(() => applyReview({ event: makeEvent(), sourceProgress: legacy({ n: Infinity }) }));
  invalid(() => applyReview({ event: makeEvent(), initialization: { kind: 'new' }, statsScope: { answered: Number.MAX_SAFE_INTEGER, correct: 0, sessions: 0 } }));
  assert.throws(() => applyReview({ event: makeEvent(), previousState: state({ schedulerName: 'fsrs', schedulerState: {} }) }), (e) => e.code === 'UNSUPPORTED');
});

test('F12 output stays F01-compatible and does not mutate or alias caller state', () => {
  const args = { event: makeEvent(), previousState: state(), sourceProgress: legacy(), statsScope: counters() };
  const before = JSON.stringify(args);
  const result = applyReview(args);
  assert.equal(JSON.stringify(args), before);
  assert.equal(validateLearningRecord('reviewEvents', result.event).ok, true);
  assert.equal(validateLearningRecord('itemStates', result.itemState).ok, true);
  assert.equal(validateProgress({ schemaVersion: 1, items: { [result.event.sourceId]: result.progress } }).ok, true);
  assert.equal(validateStats({ schemaVersion: 1, byScope: { 'ja:words': result.statsScope } }).ok, true);
  result.itemState.schedulerState.box = 1;
  assert.equal(args.previousState.schedulerState.box, 3);
  assert.equal(result.event.after.schedulerState.box, 4);
});

test('F01/F12 real show/ruby/kana values are schema-compatible and obsolete kanji is rejected', () => {
  for (const kanjiMode of ['show', 'ruby', 'kana']) {
    const event = makeEvent();
    event.assistance.kanjiMode = kanjiMode;
    assert.equal(validateLearningRecord('reviewEvents', event).ok, true, kanjiMode);
  }
  const obsolete = makeEvent(); obsolete.assistance.kanjiMode = 'kanji';
  assert.equal(validateLearningRecord('reviewEvents', obsolete).ok, false);
});
