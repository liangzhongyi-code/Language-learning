import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLearning, validateLearning, validateLearningRecord } from '../assets/js/core/learning-schema.js';
import { parseLearningBackup } from '../assets/js/core/learning-backup.js';
import { initializeItemState } from '../assets/js/core/scheduler.js';
import { buildDailyPlan } from '../assets/js/core/daily-plan.js';
import { prepareEntry } from '../assets/js/core/study-session.js';
import { localStudyDate, createStudyDayState, resolveStudyDay, requestStudyTimeZone } from '../assets/js/core/study-day.js';

const beforeMidnight = Date.parse('2026-10-05T15:59:00Z');
const afterMidnight = Date.parse('2026-10-05T16:01:00Z');
const wordsOf = lang => Array.from({ length: 8 }, (_, i) => ({ id: `${lang}-w-${i + 1}`, level: 1,
  target: `target${i}`, zh: `中文${i}`, reading: `かな${i}`, category: 'test' }));

function candidate(lang = 'ja', timeZone = 'Asia/Taipei', now = beforeMidnight) {
  const words = wordsOf(lang);
  return { ...buildDailyPlan({ words, lang, level: lang === 'ja' ? 'N5' : '1', timeZone,
    localDate: localStudyDate(now, timeZone), now, planId: 'p', newLimit: 5 }), words };
}
function prepared(data, now = beforeMidnight) {
  return prepareEntry({ ...data, now, sessionId: 's', entryId: data.plan.orderedEntries[0].entryId });
}
function learningOf(data) {
  const value = emptyLearning({ now: beforeMidnight, timeZone: data.plan.timeZone });
  value.dailyPlans[data.plan.planId] = data.plan;
  value.dailyLedger[data.ledger.ledgerId] = data.ledger;
  value.sessions[data.session.sessionId] = data.session;
  return value;
}

test('review: started new entries require introducedAt and an existing quota claim before import', () => {
  for (const damage of ['introduction', 'claim']) {
    const data = prepared(candidate());
    const value = learningOf(data);
    assert.equal(validateLearning(value).ok, true);
    if (damage === 'introduction') data.plan.orderedEntries[0].introducedAt = null;
    else data.ledger.startedSourceIds = [];
    const before = JSON.stringify(value);
    assert.equal(validateLearning(value).ok, false, damage);
    const parsed = parseLearningBackup(JSON.stringify({ format: 'lang-learn.backup', version: 2,
      exportedAt: beforeMidnight, stats: { schemaVersion: 1, byScope: {} },
      progress: { schemaVersion: 1, items: {} }, learning: value }));
    assert.equal(parsed.ok, false, damage);
    assert.equal(JSON.stringify(value), before, 'reject, never repair or mutate imported data');
  }
});

test('review: completed new record cannot omit its introduction timestamp either', () => {
  const data = prepared(candidate());
  const entry = data.plan.orderedEntries[0];
  Object.assign(entry, { status: 'completed', reviewId: 'r', introducedAt: null });
  assert.equal(validateLearningRecord('dailyPlans', data.plan).ok, false);
});

test('review: introduced new words cannot be imported as unstarted or skipped and become impossible to resume', () => {
  for (const status of ['pending', 'skipped']) {
    const data = prepared(candidate());
    data.plan.orderedEntries[0].status = status;
    assert.equal(validateLearningRecord('dailyPlans', data.plan).ok, false);
    assert.equal(validateLearning(learningOf(data)).ok, false);
  }
});

test('review: itemState skill identity is canonical and agrees with its source, ability and direction', () => {
  for (const lang of ['en', 'ja']) for (const direction of ['target2zh', 'zh2target']) {
    const state = initializeItemState({ sourceId: `${lang}-w-1`, ability: 'recognition', direction, initialization: { kind: 'new' } });
    assert.equal(validateLearningRecord('itemStates', state).ok, true);
    for (const changes of [{ sourceId: `${lang}-w-2` }, { ability: 'production' },
      { direction: direction === 'target2zh' ? 'zh2target' : 'target2zh' },
      { direction: `${lang}-zh`, skillKey: `${lang}-w-1:recognition:${lang}-zh` }]) {
      const damaged = { ...state, ...changes };
      assert.equal(validateLearningRecord('itemStates', damaged).ok, false, JSON.stringify(changes));
      const value = emptyLearning({ now: beforeMidnight, timeZone: 'Asia/Taipei' });
      value.itemStates[damaged.skillKey] = damaged;
      assert.equal(validateLearning(value).ok, false);
    }
  }
});

test('review: crossing midnight cannot claim new words against yesterday ledger', () => {
  for (const lang of ['ja', 'en']) {
    const data = candidate(lang);
    const before = JSON.stringify(data);
    assert.throws(() => prepared(data, afterMidnight), error => error.code === 'STALE_PLAN');
    assert.equal(JSON.stringify(data), before, 'stale plan cannot consume a quota or create a session');
    const today = candidate(lang, 'Asia/Taipei', afterMidnight);
    const started = prepared(today, afterMidnight);
    assert.deepEqual(started.ledger.startedSourceIds, [today.plan.orderedEntries[0].sourceId]);
  }
});

test('review: prepared yesterday words can resume after midnight without an extra claim', () => {
  const data = prepared(candidate());
  const replay = prepared({ ...data, words: [] }, afterMidnight);
  assert.deepEqual(replay, data);
});

test('review: clock rollback keeps the established study day; only elapsed forward dates expire new claims', () => {
  const today = candidate('ja', 'Asia/Taipei', afterMidnight);
  const started = prepared(today, beforeMidnight);
  assert.equal(started.ledger.localDate, '2026-10-06');
  assert.equal(started.ledger.startedSourceIds.length, 1);
  const utc = candidate('en', 'UTC', beforeMidnight);
  assert.doesNotThrow(() => prepared(utc, afterMidnight), 'Taipei midnight is not UTC midnight');
});

test('review: deferred time-zone change keeps the resolved day, then expires yesterday quota atomically', () => {
  const data = candidate();
  const state = requestStudyTimeZone(resolveStudyDay(createStudyDayState('Asia/Taipei'), beforeMidnight).state, 'America/Los_Angeles');
  assert.equal(resolveStudyDay(state, afterMidnight).localDate, '2026-10-05');
  assert.doesNotThrow(() => prepared({ ...data, studyDayState: state }, afterMidnight));
  assert.throws(() => prepared({ ...data, studyDayState: state }, Date.parse('2026-10-06T08:00:00Z')), { code: 'STALE_PLAN' });
  assert.throws(() => prepared({ ...data, studyDayState: {} }, afterMidnight), { code: 'INVALID_DATA' });
});
