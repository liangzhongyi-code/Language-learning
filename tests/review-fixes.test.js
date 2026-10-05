import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPlan } from '../assets/js/core/daily-plan.js';
import { prepareEntry } from '../assets/js/core/study-session.js';
import { createReviewEvent, applyReview, reviewIdentity } from '../assets/js/core/review-events.js';
import { emptyLearning, validateLearning, validateLearningRecord } from '../assets/js/core/learning-schema.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { words as enWords } from '../assets/js/data/en/words.js';

test('review regression: legacy records without due remain reviewable', () => {
  const words = Array.from({ length: 5 }, (_, i) => ({ id: `ja-w-${i + 1}`, level: 1, target: `word${i}`, zh: `meaning${i}`, category: 'test' }));
  const result = buildDailyPlan({ words, lang: 'ja', level: 'N5', localDate: '2026-10-05', timeZone: 'Asia/Taipei',
    now: Date.parse('2026-10-05T04:00:00Z'), progress: { schemaVersion: 1, items: { 'ja-w-1': { n: 1, w: 0 } } } });
  assert.equal(result.summary.dueCount, 1);
  assert.equal(result.plan.orderedEntries[0].sourceId, 'ja-w-1');
  assert.equal(result.plan.orderedEntries[0].kind, 'review');
});

function carryCase({ mode = 'choice', alias = false } = {}) {
  const now = Date.parse('2026-10-05T04:00:00Z');
  const tomorrow = now + 86400000;
  const words = Array.from({ length: 5 }, (_, i) => ({ id: `ja-w-${i + 1}`, level: 1,
    target: `word${i}`, zh: `meaning${i}`, category: 'test' }));
  const common = { words, lang: 'ja', level: 'N5', timeZone: 'Asia/Taipei', newLimit: 1 };
  const first = buildDailyPlan({ ...common, now, localDate: '2026-10-05', planId: 'first' });
  const args = { ...first, words, now, sessionId: 'old-session', entryId: first.plan.orderedEntries[0].entryId };
  const original = prepareEntry(args).plan.orderedEntries[0].questionSnapshot;
  const ability = mode === 'listening' ? 'listening-recognition' : mode === 'pos' ? 'grammar' : 'recognition';
  const snapshot = { ...original, ability, ...(alias ? { direction: 'ja-zh' } : {}) };
  const old = prepareEntry({ ...args, questionSnapshot: snapshot });
  const carried = buildDailyPlan({ ...common, now: tomorrow, localDate: '2026-10-06', planId: 'second', existingPlans: { first: old.plan } });
  const prepared = prepareEntry({ ...carried, words, now: tomorrow, sessionId: 'second-session', entryId: carried.plan.orderedEntries[0].entryId });
  const done = prepared.plan.orderedEntries[0];
  const event = createReviewEvent({ sessionId: 'second-session', planId: 'second', entryId: done.entryId,
    question: { ...snapshot, answeredIndex: snapshot.correctIndex },
    lang: 'ja', source: 'words', now: tomorrow, reviewId: 'r1' });
  const applied = applyReview({ event, initialization: { kind: 'new' } });
  Object.assign(done, { status: 'completed', reviewId: event.reviewId, skillKey: event.skillKey });
  prepared.plan.status = 'completed';
  Object.assign(prepared.session, { status: 'completed', completedAt: tomorrow, submittedReviewIds: [event.reviewId] });
  const learning = emptyLearning({ now, timeZone: common.timeZone });
  Object.assign(learning.dailyPlans, { first: old.plan, second: prepared.plan });
  for (const row of [old, prepared]) {
    learning.dailyLedger[row.ledger.ledgerId] = row.ledger;
    learning.sessions[row.session.sessionId] = row.session;
  }
  learning.reviewEvents[event.reviewId] = applied.event;
  learning.itemStates[event.skillKey] = applied.itemState;
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  const options = { ...common, now: tomorrow, localDate: '2026-10-06', planId: 'third', nextSegment: true,
    ledger: prepared.ledger, existingPlans: learning.dailyPlans, itemStates: learning.itemStates,
    progress: { schemaVersion: 1, items: { [event.sourceId]: applied.progress } } };
  return { options, old, prepared, applied, event, common, now, tomorrow };
}

for (const mode of ['listening', 'pos']) {
  test(`review regression: choice-shaped ${mode} carry completion uses the actual ability`, () => {
    const { options, applied } = carryCase({ mode });
    assert.ok(applied.itemState.due > options.now);
    assert.equal(buildDailyPlan(options).summary.dueCount, 0);
  });
}

test('review regression: legacy direction aliases resolve independently of carry entry IDs', () => {
  const { options, old, event, applied } = carryCase({ alias: true });
  old.plan.orderedEntries[0].entryId = 'older-format-entry-id';
  assert.equal(buildDailyPlan(options).summary.dueCount, 0);
  const key = `${event.sourceId}:production:zh2target`;
  const other = { ...applied.itemState, skillKey: key, ability: 'production', direction: 'zh2target', due: options.now };
  assert.deepEqual(buildDailyPlan({ ...options, itemStates: { ...options.itemStates, [key]: other } }).plan.orderedEntries.map(e => e.skillKey), [key]);
  const dueState = { ...applied.itemState, due: options.now };
  const pending = buildDailyPlan({ ...options, nextSegment: false, existingPlans: { first: old.plan },
    itemStates: { [event.skillKey]: dueState } });
  assert.equal(pending.summary.dueCount, 1, 'alias carry and canonical state must not create two cards');
  assert.equal(pending.plan.orderedEntries.length, 1);
  assert.equal(reviewIdentity({ question: pending.plan.orderedEntries[0].questionSnapshot }).skillKey, event.skillKey);
});

test('review regression: event and carry use the same explicit snapshot ability/mode contract', () => {
  const now = Date.parse('2026-10-05T04:00:00Z');
  for (const [ability, mode] of [['recognition', 'choice'], ['listening-recognition', 'listening'], ['grammar', 'pos']]) {
    const question = { sourceId: 'ja-w-1', kind: 'choice', direction: 'target2zh', ability,
      options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: 0 };
    const args = { question, sessionId: 's', entryId: 'e', reviewId: 'r', lang: 'ja', source: 'words', now };
    const event = createReviewEvent(args);
    assert.equal(event.questionMode, mode);
    assert.equal(event.skillKey, `ja-w-1:${ability}:target2zh`);
    assert.equal(reviewIdentity({ question }).skillKey, event.skillKey);
    const conflicting = mode === 'choice' ? 'listening' : 'choice';
    assert.throws(() => createReviewEvent({ ...args, questionMode: conflicting }), e => e.code === 'INVALID_DATA');
    assert.throws(() => createReviewEvent({ ...args, question: { ...question, questionMode: conflicting } }), e => e.code === 'INVALID_DATA');
  }
});

test('review regression: legacy aliases create the same event skill, not a second capability', () => {
  for (const lang of ['ja', 'en']) for (const [direction, alias] of [['target2zh', `${lang}-zh`], ['zh2target', `zh-${lang}`]]) {
    const question = { sourceId: `${lang}-w-1`, kind: 'typing', ability: 'production', direction: alias };
    const canonical = reviewIdentity({ question: { ...question, direction } });
    const event = createReviewEvent({ question, lang, source: 'words', sessionId: 's', entryId: 'e', reviewId: 'r',
      now: 1791158400000, answerContext: { submitted: true, correct: true } });
    assert.equal(event.skillKey, canonical.skillKey);
    assert.equal(event.assistance.context.actualDirection, direction);
  }
});

test('review regression: prepare rejects contradictory snapshot mode before saving or claiming', () => {
  const { options, now } = carryCase();
  const first = buildDailyPlan({ words: options.words, lang: 'ja', level: 'N5', localDate: '2026-10-05',
    timeZone: 'Asia/Taipei', now, planId: 'new-first', newLimit: 1 });
  const args = { ...first, words: options.words, now, sessionId: 'new-session', entryId: first.plan.orderedEntries[0].entryId };
  const valid = prepareEntry(args).plan.orderedEntries[0].questionSnapshot;
  const before = JSON.stringify(args);
  assert.throws(() => prepareEntry({ ...args, questionSnapshot: { ...valid, ability: 'production' } }), e => e.code === 'INVALID_DATA');
  assert.equal(JSON.stringify(args), before);
  const saved = prepareEntry(args);
  const id = saved.plan.orderedEntries[0].entryId;
  saved.plan.orderedEntries[0].questionSnapshot.ability = 'production';
  saved.session.questionSnapshots[id].ability = 'production';
  const savedBefore = JSON.stringify(saved);
  assert.throws(() => prepareEntry({ ...saved, words: options.words, now, entryId: id }), e => e.code === 'INVALID_DATA');
  assert.equal(JSON.stringify(saved), savedBefore);
});

test('review regression: unanswerable minimal snapshots fail explicitly and are not erased by another completed ability', () => {
  const { options, old, event } = carryCase();
  const entry = old.plan.orderedEntries[0];
  entry.questionSnapshot = { sourceId: entry.sourceId };
  old.session.questionSnapshots[entry.entryId] = entry.questionSnapshot;
  assert.equal(validateLearningRecord('dailyPlans', old.plan).ok, true);
  assert.throws(() => createReviewEvent({ question: entry.questionSnapshot, sessionId: 's', entryId: 'e', reviewId: 'r',
    now: options.now, lang: 'ja', source: 'words' }), e => e.code === 'INVALID_DATA');
  const remaining = buildDailyPlan(options);
  assert.equal(remaining.summary.dueCount, 1, 'canonical completion is not proof of completing this minimal snapshot');
  assert.equal(remaining.plan.orderedEntries[0].sourceId, event.sourceId);
  assert.throws(() => prepareEntry({ ...remaining, words: options.words, now: options.now, sessionId: 'minimal-session',
    entryId: remaining.plan.orderedEntries[0].entryId }), e => e.code === 'UNSUPPORTED');
  assert.throws(() => prepareEntry({ ...old, words: options.words, now: options.now,
    entryId: entry.entryId }), e => e.code === 'UNSUPPORTED');
});

test('review regression: completed carry resolves its original identity without hiding another ability', () => {
  const now = Date.parse('2026-10-05T04:00:00Z');
  const tomorrow = now + 86400000;
  for (const [lang, words] of [['ja', jaWords], ['en', enWords]]) {
    for (const level of [1, 2, 3, 4, 5]) for (const direction of ['target2zh', 'zh2target']) {
      const common = { words, lang, level, timeZone: 'Asia/Taipei', newLimit: 1 };
      const first = buildDailyPlan({ ...common, now, localDate: '2026-10-05', planId: 'first' });
      const old = prepareEntry({ ...first, words, now, sessionId: 'old-session', entryId: first.plan.orderedEntries[0].entryId, direction });
      const carried = buildDailyPlan({ ...common, now: tomorrow, localDate: '2026-10-06', planId: 'second', existingPlans: { first: old.plan } });
      const prepared = prepareEntry({ ...carried, words, now: tomorrow, sessionId: 'second-session', entryId: carried.plan.orderedEntries[0].entryId });
      const done = prepared.plan.orderedEntries[0];
      const q = { ...done.questionSnapshot, answeredIndex: done.questionSnapshot.correctIndex };
      const event = createReviewEvent({ sessionId: prepared.session.sessionId, planId: prepared.plan.planId, entryId: done.entryId,
        question: q, lang, source: 'words', now: tomorrow, reviewId: 'review-1' });
      const applied = applyReview({ event, initialization: { kind: 'new' } });
      Object.assign(done, { status: 'completed', reviewId: event.reviewId, skillKey: event.skillKey });
      prepared.plan.status = 'completed';
      Object.assign(prepared.session, { status: 'completed', completedAt: tomorrow, submittedReviewIds: [event.reviewId] });
      const learning = emptyLearning({ now, timeZone: common.timeZone });
      Object.assign(learning.dailyPlans, { first: old.plan, second: prepared.plan });
      learning.dailyLedger[old.ledger.ledgerId] = old.ledger;
      learning.dailyLedger[prepared.ledger.ledgerId] = prepared.ledger;
      learning.sessions[old.session.sessionId] = old.session;
      learning.sessions[prepared.session.sessionId] = prepared.session;
      learning.reviewEvents[event.reviewId] = applied.event;
      learning.itemStates[event.skillKey] = applied.itemState;
      assert.equal(validateLearning(learning).ok, true);
      const options = { ...common, now: tomorrow, localDate: '2026-10-06', planId: 'third', nextSegment: true,
        ledger: prepared.ledger, existingPlans: learning.dailyPlans, itemStates: learning.itemStates,
        progress: { schemaVersion: 1, items: { [event.sourceId]: applied.progress } } };
      const next = buildDailyPlan(options);
      assert.equal(next.summary.dueCount, 0, `${lang}/${level}/${direction}: completed carry reappeared`);
      assert.equal(next.plan.orderedEntries[0].kind, 'new');
      assert.notEqual(next.plan.orderedEntries[0].sourceId, event.sourceId);
      const otherDirection = direction === 'target2zh' ? 'zh2target' : 'target2zh';
      const otherKey = `${event.sourceId}:recognition:${otherDirection}`;
      const otherState = { ...applied.itemState, skillKey: otherKey, direction: otherDirection, due: tomorrow };
      const another = buildDailyPlan({ ...options, itemStates: { ...learning.itemStates, [otherKey]: otherState } });
      assert.deepEqual(another.plan.orderedEntries.map(e => e.skillKey), [otherKey]);
    }
  }
});
