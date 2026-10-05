import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLearning, validatePlainJson, validateStats, validateProgress,
  validateLearning, validateLearningRecord, LEARNING_SCHEMA_VERSION,
} from '../assets/js/core/learning-schema.js';
import { LearningError, LEARNING_ERROR_CODES } from '../assets/js/core/learning-errors.js';
import { parseLearningBackup } from '../assets/js/core/learning-backup.js';
import { prepareEntry } from '../assets/js/core/study-session.js';

const now = 1791158400000;
const fresh = () => emptyLearning({ now, timeZone: 'Asia/Taipei' });
const legacy = () => ({ n: 7, w: 2, box: 3, last: now - 1000, due: now + 60000 });
const bad = (result) => {
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  for (const error of result.errors) {
    assert.equal(typeof error.code, 'string');
    assert.equal(typeof error.path, 'string');
    assert.equal(typeof error.message, 'string');
  }
};

test('F01 D19 emptyLearning creates independent versioned collections without history', () => {
  const value = fresh();
  assert.equal(value.schemaVersion, LEARNING_SCHEMA_VERSION);
  assert.equal(value.meta.historyStartedAt, now);
  assert.equal(value.meta.timeZone, 'Asia/Taipei');
  assert.deepEqual(value.reviewEvents, {});
  assert.deepEqual(validateLearning(value), { ok: true, errors: [] });
  value.itemStates.example = {};
  assert.deepEqual(fresh().itemStates, {});
});

test('F01 O06 plain JSON rejects prototype keys at arbitrary depth', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    bad(validatePlainJson(JSON.parse(`{"nested":[{"${key}":{}}]}`)));
  }
});

test('F01 plain JSON rejects lossy values, cycles, sparse arrays and accessors without invoking them', () => {
  const cycle = {}; cycle.self = cycle;
  let invoked = false;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return 1; } });
  for (const value of [NaN, Infinity, undefined, 1n, () => 1, Symbol('x'), new Date(), new Map(), /x/, cycle, [, 1], getter, Object.create({ inherited: 1 })]) {
    bad(validatePlainJson(value));
  }
  assert.equal(invoked, false);
  assert.deepEqual(validatePlainJson({ nested: [null, true, 0, '字'] }), { ok: true, errors: [] });
});

test('F01 D17 legacy progress validation preserves due/n/w and absent old scheduler fields', () => {
  const value = { schemaVersion: 1, items: { 'ja-w-001': legacy(), 'en-w-removed': { n: 1, w: 0 } } };
  const before = JSON.stringify(value);
  assert.equal(validateProgress(value).ok, true);
  assert.equal(JSON.stringify(value), before);
  assert.equal('due' in value.items['en-w-removed'], false);
});

test('F01 D19 legacy counters and versions reject nonfinite, fractional, negative and impossible values', () => {
  for (const n of [NaN, Infinity, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    bad(validateProgress({ schemaVersion: 1, items: { 'ja-w-001': { ...legacy(), n } } }));
    bad(validateStats({ schemaVersion: 1, byScope: { 'ja:words': { answered: n, correct: 0, sessions: 0 } } }));
  }
  bad(validateProgress({ schemaVersion: 1, items: { x: { ...legacy(), w: 8 } } }));
  bad(validateProgress({ schemaVersion: 1, items: { x: { ...legacy(), due: Infinity } } }));
  bad(validateStats({ schemaVersion: 1, byScope: { 'ja:words': { answered: 2, correct: 3, sessions: 0 } } }));
  bad(validateStats({ schemaVersion: 2, byScope: {} }));
  bad(validateProgress({ schemaVersion: '1', items: {} }));
});

test('F01 D19 learning refuses future versions, missing collections and unsafe meta counters', () => {
  const future = fresh(); future.schemaVersion = 3; bad(validateLearning(future));
  const missing = fresh(); delete missing.sessions; bad(validateLearning(missing));
  const revision = fresh(); revision.meta = { ...revision.meta, revision: Infinity }; bad(validateLearning(revision));
  bad(validateLearningRecord('unknown', {}));
});

test('F01 typed errors expose stable code and details', () => {
  const error = new LearningError(LEARNING_ERROR_CODES.INVALID_DATA, '資料不合法', { path: '$.meta' });
  assert.equal(error.name, 'LearningError');
  assert.equal(error.code, 'INVALID_DATA');
  assert.equal(error.message, '資料不合法');
  assert.deepEqual(error.details, { path: '$.meta' });
});

function populated() {
  const value = fresh();
  const skillKey = 'ja-w-001:recognition:ja-zh';
  const state = { skillKey, sourceId: 'ja-w-001', ability: 'recognition', direction: 'ja-zh', legacySummary: legacy(), schedulerName: 'legacy', schedulerVersion: '1', schedulerState: null, due: now + 60000, lastEligibleReviewAt: null, learningStatus: 'review' };
  const entry = { entryId: 'entry-1', sourceId: 'ja-w-001', skillKey, kind: 'review', status: 'completed', questionSnapshot: { sourceId: 'ja-w-001', prompt: '假資料', options: ['一', '二'] }, reviewId: 'review-1', introducedAt: null };
  value.itemStates = { [skillKey]: state };
  value.reviewEvents = { 'review-1': { reviewId: 'review-1', sessionId: 'session-1', planId: 'plan-1', entryId: 'entry-1', sourceId: 'ja-w-001', skillKey, answeredAt: now, correct: true, assistance: { hintUsed: false, retry: false, replayCount: 0 }, responseMs: null, questionMode: 'choice', scheduleEligible: false, schedulerVersion: '1', before: null, after: { due: now + 60000 } } };
  value.dailyPlans = { 'plan-1': { planId: 'plan-1', sessionId: 'session-1', localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', policyVersion: 1, orderedEntries: [entry], quotaSnapshot: { newLimit: 5, reviewLimit: 20 }, generatedAt: now, status: 'completed' } };
  value.dailyLedger = { '2026-10-05:ja': { ledgerId: '2026-10-05:ja', localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', startedSourceIds: [], excludedSourceIds: [], newLimit: 5, updatedAt: now } };
  value.sessions = { 'session-1': { sessionId: 'session-1', lang: 'ja', source: 'words', mode: 'choice', planId: 'plan-1', orderedEntryIds: ['entry-1'], submittedReviewIds: ['review-1'], questionSnapshots: { 'entry-1': entry.questionSnapshot }, status: 'completed', createdAt: now, completedAt: now } };
  value.operations = { 'operation-1': { operationId: 'operation-1', payloadHash: 'a'.repeat(64), epoch: value.meta.dataEpoch, result: { revision: 1, reviewId: 'review-1' } } };
  value.meta.revision = 1;
  return value;
}

test('F01 D20 populated learning preserves records and saved question snapshots', () => {
  const value = populated();
  const before = JSON.stringify(value);
  assert.deepEqual(validateLearning(value), { ok: true, errors: [] });
  assert.equal(JSON.stringify(value), before);
  for (const collection of ['itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger', 'sessions', 'operations']) {
    assert.equal(validateLearningRecord(collection, Object.values(value[collection])[0]).ok, true, collection);
  }
});

test('F01 D21 cross-collection links reject orphaned and contradictory records', () => {
  const mutations = [
    (v) => { v.reviewEvents['review-1'].sessionId = 'missing'; },
    (v) => { v.reviewEvents['review-1'].skillKey = 'missing'; },
    (v) => { v.reviewEvents['review-1'].sourceId = 'ja-w-other'; },
    (v) => { v.reviewEvents['review-1'].entryId = 'missing'; },
    (v) => { v.sessions['session-1'].submittedReviewIds = []; },
    (v) => { v.dailyPlans['plan-1'].orderedEntries[0].reviewId = 'missing'; },
    (v) => { v.dailyPlans['plan-1'].sessionId = 'missing'; },
    (v) => { v.sessions['session-1'].orderedEntryIds = ['entry-2']; },
    (v) => { v.operations['operation-1'].epoch = 'other-epoch'; },
    (v) => { v.operations['operation-1'].result.revision = 2; },
    (v) => { v.dailyLedger['2026-10-05:ja'].localDate = '2026-10-06'; },
    (v) => { v.itemStates[Object.keys(v.itemStates)[0]].skillKey = 'other'; },
  ];
  for (const mutate of mutations) { const value = populated(); mutate(value); bad(validateLearning(value)); }
});

test('F01 O04/O05 library preserves unknown canonical ids and independent plain-text notes', () => {
  const value = fresh();
  value.library.notes['ja-w-removed'] = { wordId: 'ja-w-removed', text: '<script>假資料</script>', updatedAt: now, revision: 0 };
  value.library.books.favorites.wordIds = ['ja-w-removed'];
  assert.equal(validateLearning(value).ok, true);
  value.library.books.favorites.wordIds = [];
  assert.equal(validateLearning(value).ok, true);
});

test('F01 O06 collection shapes reject duplicate ids, overlong notes, invalid dates and platform ids', () => {
  const mutations = [
    (v) => { v.library.books.favorites.wordIds = ['x', 'x']; },
    (v) => { v.library.books.favorites.name = '字'.repeat(61); },
    (v) => { v.library.notes.x = { wordId: 'x', text: '字'.repeat(2001), updatedAt: now, revision: 0 }; },
    (v) => { v.reminderPreferences.osId = 'not-portable'; },
    (v) => { v.dailyPlans['plan-1'].localDate = '2026-02-30'; },
    (v) => { v.dailyPlans['plan-1'].orderedEntries.push(v.dailyPlans['plan-1'].orderedEntries[0]); },
    (v) => { v.reviewEvents['review-1'].responseMs = -1; },
    (v) => { v.reviewEvents['review-1'].assistance.hintUsed = 'true'; },
    (v) => { v.meta.timeZone = 'Not/AZone'; },
    (v) => { v.intents.x = { sourceId: 'x', wantToLearn: true, selfAssessedKnown: 'yes', updatedAt: now }; },
    (v) => { v.achievements.calendar['2026-10-05:ja'] = { localDate: '2026-10-05', lang: 'ja', reviewCount: 0, correctCount: 1 }; },
  ];
  for (const mutate of mutations) { const value = populated(); mutate(value); bad(validateLearning(value)); }
});

test('F01 factory rejects invalid initialization instead of manufacturing timestamps or time zones', () => {
  for (const options of [undefined, {}, { now: NaN, timeZone: 'UTC' }, { now, timeZone: 'Invalid/Zone' }]) {
    assert.throws(() => emptyLearning(options), (error) => error instanceof LearningError && error.code === 'INVALID_DATA');
  }
});

test('F01 D21 inherited object names are not valid external references', () => {
  for (const key of ['toString', 'valueOf', 'hasOwnProperty']) {
    const value = populated();
    value.reviewEvents['review-1'].sessionId = key;
    bad(validateLearning(value));
  }
});

test('F01 D06 zero-work and unstarted plans do not fabricate a session', () => {
  const value = populated();
  value.dailyPlans['plan-1'].sessionId = null;
  value.dailyPlans['plan-1'].orderedEntries = [];
  value.sessions = {};
  value.reviewEvents = {};
  assert.equal(validateLearning(value).ok, true);
});

test('F01 JSON depth and hidden properties fail safely, while null-prototype maps remain legal', () => {
  let deep = {};
  for (let i = 0; i < 130; i += 1) deep = { next: deep };
  bad(validatePlainJson(deep));
  bad(validatePlainJson(Object.defineProperty({}, 'hidden', { value: 1 })));
  bad(validatePlainJson({ [Symbol('private')]: 1 }));
  const extra = [1]; extra.extra = 2; bad(validatePlainJson(extra));
  const map = Object.create(null); map.item = { n: 1 };
  assert.equal(validatePlainJson(map).ok, true);
});

test('F01 safe own keys and frozen valid inputs preserve validation semantics', () => {
  const stats = Object.freeze({ schemaVersion: 1, byScope: Object.freeze({ 'ja:words': Object.freeze({ answered: 30, correct: 24, sessions: 3 }) }) });
  assert.deepEqual(validateStats(stats), { ok: true, errors: [] });
  bad(validateStats({ ...stats, ignored: true }));
  bad(validateProgress({ schemaVersion: 1, items: [] }));
  const value = populated();
  value.meta.schemaVersion = 999;
  bad(validateLearning(value));
  assert.equal(validateLearning(value).errors[0].code, 'UNSUPPORTED_VERSION');
});

test('F01 O06 library size boundaries are explicit and reject excess without truncation', () => {
  const value = fresh();
  value.library.books.favorites.wordIds = Array.from({ length: 15000 }, (_, i) => `ja-w-${i}`);
  assert.equal(validateLearning(value).ok, true);
  value.library.books.favorites.wordIds.push('ja-w-overflow');
  bad(validateLearning(value));
  assert.equal(value.library.books.favorites.wordIds.length, 15001);
  const books = fresh();
  for (let i = 1; i <= 100; i += 1) books.library.books[`book-${i}`] = { ...books.library.books.favorites, bookId: `book-${i}`, system: false };
  bad(validateLearning(books));
});

test('F01 F02 receipts share SHA-256 and transaction identifier constraints', () => {
  const valid = populated().operations['operation-1'];
  assert.equal(validateLearningRecord('operations', valid).ok, true);
  for (const payloadHash of ['hash', 'a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64)]) {
    bad(validateLearningRecord('operations', { ...valid, payloadHash }));
  }
  bad(validateLearningRecord('operations', { ...valid, operationId: '含空 白' }));
  bad(validateLearningRecord('operations', { ...valid, epoch: 'x'.repeat(129) }));
});

test('F01 many malformed records return bounded errors without throwing', () => {
  const value = fresh();
  value.itemStates = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`bad-${i}`, null]));
  const checked = validateLearning(value);
  bad(checked);
  assert.equal(checked.errors.length, 100);
});

test('F01 date and reminder clock strings reject hidden trailing newlines', () => {
  const value = populated();
  value.dailyPlans['plan-1'].localDate += '\n';
  bad(validateLearningRecord('dailyPlans', value.dailyPlans['plan-1']));
  value.reminderPreferences.localTime += '\n';
  bad(validateLearningRecord('reminderPreferences', value.reminderPreferences));
});

test('review regression: prepared and completed snapshots must match the linked session', () => {
  for (const status of ['prepared', 'completed']) {
    for (const damage of ['missing', 'prompt', 'options', 'nested']) {
      const value = populated();
      const plan = value.dailyPlans['plan-1'];
      const entry = plan.orderedEntries[0];
      const session = value.sessions['session-1'];
      if (status === 'prepared') {
        entry.status = 'prepared'; entry.reviewId = null; plan.status = 'active';
        session.status = 'active'; session.completedAt = null; session.submittedReviewIds = [];
        value.reviewEvents = {};
      }
      Object.assign(entry.questionSnapshot, {
        kind: 'choice', ability: 'recognition', direction: 'target2zh',
        options: [{ text: '一', isCorrect: true }, { text: '二', isCorrect: false }],
        correctIndex: 0, answeredIndex: status === 'completed' ? 0 : null,
        context: { choices: [{ text: '原始題面', correct: true }] },
      });
      session.questionSnapshots['entry-1'] = JSON.parse(JSON.stringify(entry.questionSnapshot));
      assert.equal(validateLearning(value).ok, true, `${status}: baseline`);
      const read = () => parseLearningBackup(JSON.stringify({
        format: 'lang-learn.backup', version: 2, exportedAt: now,
        stats: { schemaVersion: 1, byScope: {} }, progress: { schemaVersion: 1, items: {} }, learning: value,
      }));
      assert.equal(read().ok, true, `${status}: valid backup`);
      if (status === 'prepared') {
        assert.doesNotThrow(() => prepareEntry({
          plan, ledger: value.dailyLedger['2026-10-05:ja'], session, entryId: entry.entryId, now,
        }));
      }
      const saved = session.questionSnapshots['entry-1'];
      if (damage === 'missing') delete session.questionSnapshots['entry-1'];
      if (damage === 'prompt') saved.prompt = '其他題面';
      if (damage === 'options') saved.options.reverse();
      if (damage === 'nested') saved.context.choices[0].correct = false;
      const before = JSON.stringify(value);
      bad(validateLearning(value));
      assert.equal(read().ok, false, `${status}/${damage}: backup must reject before restore`);
      assert.equal(JSON.stringify(value), before, `${status}/${damage}: validation must not repair input`);
    }
  }
});

test('review regression: snapshot equality ignores object key order, but not array order', () => {
  const value = populated();
  const entry = value.dailyPlans['plan-1'].orderedEntries[0];
  const { sourceId, prompt, options } = entry.questionSnapshot;
  value.sessions['session-1'].questionSnapshots['entry-1'] = { options: [...options], prompt, sourceId };
  assert.equal(validateLearning(value).ok, true);
});

test('review regression: every schema time zone accepts supported IANA aliases and rejects loose abbreviations', () => {
  for (const timeZone of ['EST5EDT', 'CST6CDT', 'PST8PDT', 'UTC', 'Asia/Taipei', 'US/Eastern', 'Etc/GMT+8']) {
    const value = populated();
    value.meta.timeZone = timeZone;
    value.reminderPreferences.timeZone = timeZone;
    value.dailyPlans['plan-1'].timeZone = timeZone;
    value.dailyLedger['2026-10-05:ja'].timeZone = timeZone;
    assert.equal(validateLearning(value).ok, true, timeZone);
    assert.equal(emptyLearning({ now, timeZone }).meta.timeZone, timeZone);
  }
  for (const timeZone of ['PST', 'CST', 'ACT', 'AET', 'UTC\n', '+08:00', 'Mars/Nope']) {
    for (const collection of ['meta', 'reminderPreferences', 'dailyPlans', 'dailyLedger']) {
      const value = populated();
      const row = ['meta', 'reminderPreferences'].includes(collection) ? value[collection] : Object.values(value[collection])[0];
      row.timeZone = timeZone;
      assert.equal(validateLearningRecord(collection, row).ok, false, `${collection}/${JSON.stringify(timeZone)}`);
    }
    assert.throws(() => emptyLearning({ now, timeZone }), { code: 'INVALID_DATA' });
  }
});
