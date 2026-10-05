import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPlan, dailyWordPool } from '../assets/js/core/daily-plan.js';
import { prepareEntry } from '../assets/js/core/study-session.js';
import { createReviewEvent, applyReview } from '../assets/js/core/review-events.js';
import { emptyLearning, validateLearning } from '../assets/js/core/learning-schema.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { words as enWords } from '../assets/js/data/en/words.js';

const firstNow = Date.parse('2026-10-05T04:00:00Z');
const secondNow = firstNow + 86400000;
const thirdNow = secondNow + 86400000;

function scenario(lang, words, level, direction, prepareBeforeCarry) {
  const sourceId = dailyWordPool(words, lang, level)[0].id;
  const legacy = { n: 1, w: 0, box: 1, last: firstNow - 86400000, due: firstNow - 1 };
  const common = { words, lang, level, timeZone: 'Asia/Taipei', newLimit: 1, reviewLimit: 1,
    progress: { schemaVersion: 1, items: { [sourceId]: legacy } } };
  let first = buildDailyPlan({ ...common, now: firstNow, localDate: '2026-10-05', planId: 'first' });
  if (prepareBeforeCarry) first = prepareEntry({ ...first, words, now: firstNow,
    sessionId: 'first-session', entryId: first.plan.orderedEntries[0].entryId, direction });
  const firstBytes = JSON.stringify(first);
  const second = buildDailyPlan({ ...common, now: secondNow, localDate: '2026-10-06', planId: 'second',
    existingPlans: { first: first.plan } });
  assert.equal(JSON.stringify(first), firstBytes, 'building carry must not mutate its origin');
  assert.equal(second.summary.dueCount, 1, 'carry and legacy summary represent one review');
  assert.equal(second.plan.orderedEntries.length, 1);
  assert.equal(second.plan.orderedEntries[0].entryId, first.plan.orderedEntries[0].entryId,
    'cross-day carry must retain its lineage');
  const prepared = prepareEntry({ ...second, words, now: secondNow, sessionId: 'second-session',
    entryId: second.plan.orderedEntries[0].entryId, direction });
  const entry = prepared.plan.orderedEntries[0];
  const event = createReviewEvent({ sessionId: prepared.session.sessionId, planId: prepared.plan.planId,
    entryId: entry.entryId, question: { ...entry.questionSnapshot, answeredIndex: entry.questionSnapshot.correctIndex },
    lang, source: 'words', now: secondNow, reviewId: 'review' });
  const applied = applyReview({ event, sourceProgress: legacy, initialization: { kind: 'legacy', progress: legacy } });
  assert.ok(applied.itemState.due > thirdNow);
  Object.assign(entry, { status: 'completed', skillKey: event.skillKey, reviewId: event.reviewId });
  prepared.plan.status = 'completed';
  Object.assign(prepared.session, { status: 'completed', submittedReviewIds: [event.reviewId], completedAt: secondNow });
  const learning = emptyLearning({ now: firstNow, timeZone: common.timeZone });
  learning.dailyPlans = { first: first.plan, second: prepared.plan };
  for (const row of [first, prepared]) {
    learning.dailyLedger[row.ledger.ledgerId] = row.ledger;
    if (row.session) learning.sessions[row.session.sessionId] = row.session;
  }
  learning.reviewEvents[event.reviewId] = applied.event;
  learning.itemStates[event.skillKey] = applied.itemState;
  const progress = { schemaVersion: 1, items: { [sourceId]: applied.progress } };
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  const nextArgs = { ...common, existingPlans: learning.dailyPlans, itemStates: learning.itemStates,
    progress, now: secondNow, localDate: '2026-10-06', planId: 'third',
    nextSegment: true, ledger: prepared.ledger };
  return { common, sourceId, first, prepared, learning, applied, event, nextArgs };
}

for (const [lang, words] of [['ja', jaWords], ['en', enWords]]) {
  for (const level of [1, 2, 3, 4, 5]) for (const direction of ['target2zh', 'zh2target']) {
    for (const prepareBeforeCarry of [false, true]) {
      test(`legacy carry: ${lang}/${level}/${direction}/${prepareBeforeCarry ? 'prepared' : 'pending'} stays resolved`, () => {
        const { sourceId, applied, event, nextArgs } = scenario(lang, words, level, direction, prepareBeforeCarry);
        const next = buildDailyPlan(nextArgs);
        assert.equal(next.summary.dueCount, 0, 'completed legacy ancestor must not resurrect');
        assert.equal(next.plan.orderedEntries[0].kind, 'new');
        assert.notEqual(next.plan.orderedEntries[0].sourceId, sourceId);
        const tomorrow = buildDailyPlan({ ...nextArgs, now: thirdNow, localDate: '2026-10-07', ledger: undefined });
        assert.equal(tomorrow.summary.dueCount, 0, 'completion must resolve the ancestor on later days too');
        const otherDirection = direction === 'target2zh' ? 'zh2target' : 'target2zh';
        const key = `${sourceId}:recognition:${otherDirection}`;
        const other = { ...applied.itemState, skillKey: key, direction: otherDirection, due: secondNow };
        const isolated = buildDailyPlan({ ...nextArgs, itemStates: { ...nextArgs.itemStates, [key]: other } });
        assert.deepEqual(isolated.plan.orderedEntries.map(row => row.skillKey), [key],
          'resolving one lineage must not hide another direction');
        const otherAbilityKey = `${sourceId}:production:${direction}`;
        const otherAbility = { ...applied.itemState, skillKey: otherAbilityKey, ability: 'production', due: secondNow };
        assert.deepEqual(buildDailyPlan({ ...nextArgs,
          itemStates: { [event.skillKey]: applied.itemState, [otherAbilityKey]: otherAbility } }).plan.orderedEntries.map(row => row.skillKey),
        [otherAbilityKey], 'resolving one lineage must not hide another ability');
      });
    }
  }
}

test('legacy carry: an unsubmitted prepared descendant is one stable card on a third day', () => {
  const words = enWords;
  const sourceId = dailyWordPool(words, 'en', 1)[0].id;
  const common = { words, lang: 'en', level: 1, timeZone: 'Asia/Taipei', newLimit: 1,
    progress: { schemaVersion: 1, items: { [sourceId]: { n: 1, w: 0, due: firstNow - 1 } } } };
  const first = buildDailyPlan({ ...common, now: firstNow, localDate: '2026-10-05', planId: 'first' });
  const second = buildDailyPlan({ ...common, now: secondNow, localDate: '2026-10-06', planId: 'second',
    existingPlans: { first: first.plan } });
  const prepared = prepareEntry({ ...second, words, now: secondNow, sessionId: 'session',
    entryId: second.plan.orderedEntries[0].entryId });
  const third = buildDailyPlan({ ...common, now: thirdNow, localDate: '2026-10-07', planId: 'third',
    existingPlans: { first: first.plan, second: prepared.plan } });
  assert.equal(third.summary.dueCount, 1);
  assert.equal(third.plan.orderedEntries.length, 1);
  assert.equal(third.plan.orderedEntries[0].entryId, first.plan.orderedEntries[0].entryId);
  assert.deepEqual(third.plan.orderedEntries[0].questionSnapshot, prepared.plan.orderedEntries[0].questionSnapshot);
});

/**
 * 舊 HEAD makeEntry 會在跨日重新以當日 planId 產生 review:sourceId。
 * 凍結該精確格式，不依賴修復後的 carry ID 行為；題面、session、事件仍走真實 API。
 */
function oldFormatFixture({ lang, words, level, direction, rootPrepared = false, completed = false }) {
  const sourceId = dailyWordPool(words, lang, level)[0].id;
  const legacy = { n: 1, w: 0, box: 1, last: firstNow - 86400000, due: firstNow - 1 };
  const common = { words, lang, level, timeZone: 'Asia/Taipei', newLimit: 1, reviewLimit: 1,
    progress: { schemaVersion: 1, items: { [sourceId]: legacy } } };
  let first = buildDailyPlan({ ...common, now: firstNow, localDate: '2026-10-05', planId: 'first' });
  if (rootPrepared) first = prepareEntry({ ...first, words, now: firstNow, sessionId: 'first-session',
    entryId: first.plan.orderedEntries[0].entryId, direction });
  const second = buildDailyPlan({ ...common, now: secondNow, localDate: '2026-10-06', planId: 'second',
    existingPlans: { first: first.plan } });
  second.plan.orderedEntries[0].entryId = `second:review:${sourceId}`;
  const prepared = prepareEntry({ ...second, words, now: secondNow, sessionId: 'second-session',
    entryId: second.plan.orderedEntries[0].entryId, direction });
  const entry = prepared.plan.orderedEntries[0];
  let applied = null;
  if (completed) {
    const event = createReviewEvent({ sessionId: prepared.session.sessionId, planId: prepared.plan.planId,
      entryId: entry.entryId, question: { ...entry.questionSnapshot, answeredIndex: entry.questionSnapshot.correctIndex },
      lang, source: 'words', now: secondNow, reviewId: 'review' });
    applied = applyReview({ event, sourceProgress: legacy, initialization: { kind: 'legacy', progress: legacy } });
    Object.assign(entry, { status: 'completed', skillKey: event.skillKey, reviewId: event.reviewId });
    prepared.plan.status = 'completed';
    Object.assign(prepared.session, { status: 'completed', submittedReviewIds: [event.reviewId], completedAt: secondNow });
  }
  const learning = emptyLearning({ now: firstNow, timeZone: common.timeZone });
  learning.dailyPlans = { first: first.plan, second: prepared.plan };
  for (const row of [first, prepared]) {
    learning.dailyLedger[row.ledger.ledgerId] = row.ledger;
    if (row.session) learning.sessions[row.session.sessionId] = row.session;
  }
  if (applied) {
    learning.itemStates[applied.itemState.skillKey] = applied.itemState;
    learning.reviewEvents[applied.event.reviewId] = applied.event;
  }
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  const options = { ...common, now: thirdNow, localDate: '2026-10-07', planId: 'third',
    existingPlans: learning.dailyPlans, itemStates: learning.itemStates,
    progress: applied ? { schemaVersion: 1, items: { [sourceId]: applied.progress } } : common.progress };
  return { sourceId, common, first, prepared, learning, applied, options };
}

for (const [lang, words] of [['ja', jaWords], ['en', enWords]]) {
  for (const level of [1, 2, 3, 4, 5]) for (const direction of ['target2zh', 'zh2target']) {
    for (const completed of [false, true]) for (const rootPrepared of [false, true]) {
      test(`old generated carry IDs: ${lang}/${level}/${direction}/${rootPrepared ? 'prepared-root' : 'pending-root'}/${completed ? 'completed' : 'prepared'}`, () => {
        const data = oldFormatFixture({ lang, words, level, direction, rootPrepared, completed });
        const before = JSON.stringify(data.options);
        const next = buildDailyPlan(data.options);
        assert.equal(JSON.stringify(data.options), before, 'compatibility must never rewrite saved history');
        assert.equal(next.summary.dueCount, completed ? 0 : 1);
        assert.equal(next.plan.orderedEntries.length, 1);
        if (!completed) {
          assert.equal(next.plan.orderedEntries[0].entryId, data.prepared.plan.orderedEntries[0].entryId);
          assert.deepEqual(next.plan.orderedEntries[0].questionSnapshot, data.prepared.plan.orderedEntries[0].questionSnapshot);
        } else {
          assert.equal(next.plan.orderedEntries[0].kind, 'new');
          const otherDirection = direction === 'target2zh' ? 'zh2target' : 'target2zh';
          for (const [ability, actualDirection] of [['recognition', otherDirection], ['production', direction]]) {
            const skillKey = `${data.sourceId}:${ability}:${actualDirection}`;
            const other = { ...data.applied.itemState, skillKey, ability, direction: actualDirection, due: thirdNow };
            assert.deepEqual(buildDailyPlan({ ...data.options,
              itemStates: { ...data.options.itemStates, [skillKey]: other } }).plan.orderedEntries.map(row => row.skillKey), [skillKey]);
          }
        }
      });
    }
  }
}

for (const conflict of ['direction', 'ability']) test(`old generated carry IDs: conflicting ${conflict} bindings reject without guessing or mutating history`, () => {
  const data = oldFormatFixture({ lang: 'en', words: enWords, level: 1, direction: 'target2zh' });
  const other = JSON.parse(JSON.stringify(data.prepared));
  other.plan.planId = 'conflict';
  other.plan.generatedAt += 1;
  other.plan.sessionId = 'conflict-session';
  const entry = other.plan.orderedEntries[0];
  entry.entryId = `conflict:review:${data.sourceId}`;
  if (conflict === 'direction') entry.questionSnapshot.direction = 'zh2target';
  else entry.questionSnapshot.ability = 'listening-recognition';
  other.session.sessionId = 'conflict-session';
  other.session.planId = 'conflict';
  other.session.orderedEntryIds = [entry.entryId];
  other.session.questionSnapshots = { [entry.entryId]: entry.questionSnapshot };
  data.learning.dailyPlans.conflict = other.plan;
  data.learning.sessions['conflict-session'] = other.session;
  assert.deepEqual(validateLearning(data.learning), { ok: true, errors: [] });
  const options = { ...data.options, existingPlans: data.learning.dailyPlans };
  const before = JSON.stringify(options);
  assert.throws(() => buildDailyPlan(options), error => error.code === 'UNSUPPORTED');
  assert.equal(JSON.stringify(options), before);
});

test('old generated carry IDs: another level or a same-day binding is not proof of cross-day lineage', () => {
  for (const mode of ['other-level', 'same-day']) {
    const data = oldFormatFixture({ lang: 'en', words: enWords, level: 1, direction: 'target2zh', completed: true });
    if (mode === 'other-level') data.prepared.plan.level = '2';
    else {
      data.prepared.plan.localDate = data.first.plan.localDate;
      data.prepared.plan.generatedAt = firstNow + 1;
    }
    assert.deepEqual(validateLearning(data.learning), { ok: true, errors: [] });
    const next = buildDailyPlan(data.options);
    assert.equal(next.summary.dueCount, 1, mode);
    assert.equal(next.plan.orderedEntries[0].entryId, data.first.plan.orderedEntries[0].entryId);
  }
});

test('old generated carry IDs: minimal or arbitrary-source identities are not guessed from a later binding', () => {
  for (const mode of ['minimal', 'arbitrary']) {
    const data = oldFormatFixture({ lang: 'en', words: enWords, level: 1, direction: 'target2zh', completed: true });
    const entry = data.first.plan.orderedEntries[0];
    if (mode === 'minimal') entry.questionSnapshot = { sourceId: data.sourceId };
    else entry.entryId = 'arbitrary-old-id';
    assert.deepEqual(validateLearning(data.learning), { ok: true, errors: [] });
    assert.equal(buildDailyPlan(data.options).summary.dueCount, 1,
      'a shared source alone does not prove lineage or an answerable snapshot');
  }
});
