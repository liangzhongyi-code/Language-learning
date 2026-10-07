import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setWantToLearn, setSelfAssessedKnown, withdrawSelfAssessed, afterReview, describeIntent,
} from '../assets/js/core/learning-intents.js';
import { buildDailyPlan, revisePendingNew } from '../assets/js/core/daily-plan.js';
import { prepareEntry, skipEntry } from '../assets/js/core/study-session.js';
import { validateLearningRecord } from '../assets/js/core/learning-schema.js';

const now = Date.parse('2026-10-05T04:00:00Z');
const tomorrow = now + 86400000;
const words = Array.from({ length: 20 }, (_, i) => ({ id: `ja-w-${String(i + 1).padStart(3, '0')}`, level: 1, target: `単語${i}`, zh: `字${i}`, reading: `よみ${i}`, romaji: null, category: 'test' }));
const W = i => words[i].id;
const args = (extra = {}) => ({ words, localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', now, planId: 'plan-1', ...extra });
const ids = plan => plan.orderedEntries.map(e => e.sourceId);
const ledger = (startedSourceIds = []) => ({ ledgerId: '2026-10-05:ja', localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', startedSourceIds, excludedSourceIds: [], newLimit: 5, updatedAt: now });
const dueProgress = count => ({ schemaVersion: 1, items: Object.fromEntries(words.slice(0, count).map((w, i) => [w.id, { n: 1, w: 0, due: now - 1000 + i, last: now - 5000 }])) });
const state = (id, due) => ({ skillKey: `${id}:recognition:target2zh`, sourceId: id, ability: 'recognition', direction: 'target2zh', legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 2 }, due, lastEligibleReviewAt: now - 86400000, learningStatus: 'review' });

/**
 * 把 changes 套進 intents 集合，模擬 repository 同交易保存後下一次讀到的資料。
 */
function applyIntents(intents, changes) {
  const next = structuredClone(intents);
  for (const change of changes) {
    assert.equal(change.store, 'intents');
    if (change.delete === true) delete next[change.key];
    else {
      assert.deepEqual(validateLearningRecord('intents', change.value), { ok: true, errors: [] });
      next[change.key] = change.value;
    }
  }
  return next;
}

/**
 * 把首段全部標成已完成，供 nextSegment 取得下一段。
 */
function finish(plan) {
  const done = structuredClone(plan);
  done.status = 'completed';
  done.sessionId = `${done.planId}:session`;
  for (const e of done.orderedEntries) Object.assign(e, { status: 'completed', reviewId: `${e.entryId}:answer`, questionSnapshot: { sourceId: e.sourceId }, introducedAt: e.kind === 'new' ? now : null });
  return done;
}

test('O01 標記想學只產生 intents 變更並通過 schema；取消想學且無其他意向時刪除紀錄', () => {
  const marked = setWantToLearn({ intent: null, sourceId: W(9), value: true, now });
  assert.deepEqual(marked.intent, { sourceId: W(9), wantToLearn: true, selfAssessedKnown: false, updatedAt: now });
  assert.deepEqual(marked.changes, [{ store: 'intents', key: W(9), value: marked.intent }]);
  assert.deepEqual(setWantToLearn({ intent: marked.intent, sourceId: W(9), value: true, now }).changes, []);
  const cleared = setWantToLearn({ intent: marked.intent, sourceId: W(9), value: false, now: now + 1 });
  assert.equal(cleared.intent, null);
  assert.deepEqual(cleared.changes, [{ store: 'intents', key: W(9), delete: true }]);
  assert.throws(() => setWantToLearn({ intent: marked.intent, sourceId: W(8), value: true, now }), e => e.code === 'INVALID_DATA');
  assert.throws(() => setWantToLearn({ intent: null, sourceId: '__proto__', value: true, now }), e => e.code === 'INVALID_DATA');
  assert.throws(() => setWantToLearn({ intent: null, sourceId: W(1), value: 'yes', now }), e => e.code === 'INVALID_DATA');
});

test('O01 想學只提升未開始新字順位：到期複習照常獨佔首段、題數不變', () => {
  const intents = applyIntents({}, setWantToLearn({ intent: null, sourceId: W(15), value: true, now }).changes);
  const progress = dueProgress(3);
  const plain = buildDailyPlan(args({ progress }));
  const wanted = buildDailyPlan(args({ progress, intents }));
  assert.deepEqual(ids(wanted.plan), ids(plain.plan));
  assert.deepEqual(ids(wanted.plan), [W(0), W(1), W(2)]);
  assert.ok(wanted.plan.orderedEntries.every(e => e.kind === 'review'), '想學不擠掉到期題');
  assert.deepEqual(revisePendingNew({ ...args({ progress, intents }), ...wanted }).plan.orderedEntries, wanted.plan.orderedEntries, '複習段不因意向插入新字');
  const next = buildDailyPlan(args({ progress, intents, ledger: wanted.ledger, existingPlans: { 'plan-1': finish(wanted.plan) }, planId: 'plan-2', nextSegment: true }));
  assert.equal(next.plan.orderedEntries[0].sourceId, W(15), '複習清完後想學字排第一');
  assert.equal(next.plan.orderedEntries.length, 5, '每日新字額度不變');
});

test('O01 想學不增加跨級共用額度，已開始新字與題面不被替換', () => {
  const intents = applyIntents({}, setWantToLearn({ intent: null, sourceId: W(12), value: true, now }).changes);
  const crossLevel = buildDailyPlan(args({ intents, ledger: ledger(['ja-w-901', 'ja-w-902', 'ja-w-903']) }));
  assert.deepEqual(ids(crossLevel.plan), [W(12), W(0)], '別級已領 3 字，只剩 2 個名額');

  const first = buildDailyPlan(args());
  const started = prepareEntry({ ...first, session: null, words, entryId: first.plan.orderedEntries[0].entryId, now, sessionId: 's', rng: () => 0.3 });
  const revised = revisePendingNew({ ...args({ intents }), ...started });
  assert.deepEqual(revised.plan.orderedEntries[0], started.plan.orderedEntries[0], '已開始題次原樣保留');
  assert.equal(revised.plan.orderedEntries[1].sourceId, W(12), '想學字只佔未開始槽位的最前面');
  assert.equal(revised.plan.orderedEntries.length, 5);
  assert.deepEqual(revised.ledger.startedSourceIds, [W(0)], '不增加已領額度');
  assert.deepEqual(revised.session.orderedEntryIds, revised.plan.orderedEntries.map(e => e.entryId));
});

test('O02 自評已會標示未驗證，撤回後回復一般狀態', () => {
  const known = setSelfAssessedKnown({ intent: null, sourceId: W(0), now });
  assert.deepEqual(known.intent, { sourceId: W(0), wantToLearn: false, selfAssessedKnown: true, updatedAt: now });
  assert.deepEqual(describeIntent(known.intent), { wantToLearn: false, selfAssessedKnown: true, verified: false });
  assert.deepEqual(describeIntent(null), { wantToLearn: false, selfAssessedKnown: false, verified: null });
  const withdrawn = withdrawSelfAssessed({ intent: known.intent, sourceId: W(0), now: now + 1 });
  assert.equal(withdrawn.intent, null);
  assert.deepEqual(withdrawn.changes, [{ store: 'intents', key: W(0), delete: true }]);
  const both = setSelfAssessedKnown({ intent: setWantToLearn({ intent: null, sourceId: W(1), value: true, now }).intent, sourceId: W(1), now });
  const back = withdrawSelfAssessed({ intent: both.intent, sourceId: W(1), now });
  assert.deepEqual(back.intent, { sourceId: W(1), wantToLearn: true, selfAssessedKnown: false, updatedAt: now }, '撤回自評保留想學');
});

test('O02 自評已會不清除既有 itemStates 的 due：到期能力照常排入複習', () => {
  const s = state(W(0), now - 1);
  const itemStates = { [s.skillKey]: s };
  const before = structuredClone(itemStates);
  const result = setSelfAssessedKnown({ intent: null, sourceId: W(0), now });
  assert.ok(result.changes.every(c => c.store === 'intents'), '自評不寫 itemStates／排程');
  const intents = applyIntents({}, result.changes);
  const plan = buildDailyPlan(args({ itemStates, intents }));
  assert.deepEqual(plan.plan.orderedEntries.map(e => e.skillKey), [s.skillKey]);
  assert.deepEqual(itemStates, before);
  const legacy = buildDailyPlan(args({ progress: dueProgress(1), intents }));
  assert.deepEqual(ids(legacy.plan), [W(0)], '舊 progress 的到期也不抹去');
});

test('O02 自評已會的新字不介紹；撤回後重新取得新字資格', () => {
  const intents = applyIntents({}, setSelfAssessedKnown({ intent: null, sourceId: W(0), now }).changes);
  const skipped = buildDailyPlan(args({ intents }));
  assert.ok(!ids(skipped.plan).includes(W(0)));
  assert.equal(skipped.plan.orderedEntries.length, 5);
  const withdrawn = applyIntents(intents, withdrawSelfAssessed({ intent: intents[W(0)], sourceId: W(0), now }).changes);
  const revised = revisePendingNew({ ...args({ intents: withdrawn }), ...skipped });
  assert.equal(revised.plan.orderedEntries[0].sourceId, W(0));
  assert.equal(buildDailyPlan(args({ intents: withdrawn })).plan.orderedEntries[0].sourceId, W(0));
});

test('O02 真正答錯解除自評已會；答對或沒有自評不變', () => {
  const intent = setSelfAssessedKnown({ intent: setWantToLearn({ intent: null, sourceId: W(0), value: true, now }).intent, sourceId: W(0), now }).intent;
  const wrong = afterReview({ intent, correct: false, now: now + 5 });
  assert.deepEqual(wrong.intent, { sourceId: W(0), wantToLearn: true, selfAssessedKnown: false, updatedAt: now + 5 });
  assert.deepEqual(wrong.changes, [{ store: 'intents', key: W(0), value: wrong.intent }]);
  assert.deepEqual(afterReview({ intent, correct: true, now }).changes, []);
  assert.deepEqual(afterReview({ intent, correct: true, now }).intent, intent);
  assert.deepEqual(afterReview({ intent: null, correct: false, now }), { intent: null, changes: [] });
  const onlyKnown = setSelfAssessedKnown({ intent: null, sourceId: W(1), now }).intent;
  assert.deepEqual(afterReview({ intent: onlyKnown, correct: false, now }).changes, [{ store: 'intents', key: W(1), delete: true }]);
  assert.throws(() => afterReview({ intent, correct: 'no', now }), e => e.code === 'INVALID_DATA');
  assert.throws(() => afterReview({ intent, sourceId: W(2), correct: false, now }), e => e.code === 'INVALID_DATA');
});

test('O02 意向時間不倒退且拒絕非法輸入紀錄', () => {
  const intent = { sourceId: W(0), wantToLearn: true, selfAssessedKnown: false, updatedAt: now + 100 };
  assert.equal(setSelfAssessedKnown({ intent, sourceId: W(0), now }).intent.updatedAt, now + 100);
  assert.throws(() => setSelfAssessedKnown({ intent: { ...intent, extra: 1 }, sourceId: W(0), now }), e => e.code === 'INVALID_DATA');
  assert.throws(() => setSelfAssessedKnown({ intent, sourceId: W(0), now: -1 }), e => e.code === 'INVALID_DATA');
});

test('O03 今日略過未開始新字：當日重開與意向重排都不重發同字，已開始額度不退還', () => {
  const first = buildDailyPlan(args());
  const started = prepareEntry({ ...first, session: null, words, entryId: first.plan.orderedEntries[0].entryId, now, sessionId: 's', rng: () => 0.3 });
  const skipped = skipEntry({ ...args(), ...started, entryId: started.plan.orderedEntries[1].entryId });
  assert.ok(!ids(skipped.plan).includes(W(1)));
  assert.deepEqual(skipped.ledger.excludedSourceIds, [W(1)]);
  assert.deepEqual(skipped.ledger.startedSourceIds, [W(0)], '不退還已開始額度');
  assert.equal(skipped.plan.orderedEntries.length, 5);
  assert.deepEqual(skipped.plan.orderedEntries[0], started.plan.orderedEntries[0]);
  const reopened = buildDailyPlan(args({ ledger: skipped.ledger, existingPlans: { 'plan-1': skipped.plan } }));
  assert.ok(!ids(reopened.plan).includes(W(1)), '重開不重發');
  assert.equal(reopened.summary.remainingNewQuota, 4);
  const intents = applyIntents({}, setWantToLearn({ intent: null, sourceId: W(1), value: true, now }).changes);
  const revised = revisePendingNew({ ...args({ intents }), plan: skipped.plan, ledger: skipped.ledger, session: skipped.session });
  assert.ok(!ids(revised.plan).includes(W(1)), '當日即使標想學也不重發已略過的字');
  assert.throws(() => skipEntry({ ...args(), ...skipped, entryId: skipped.plan.orderedEntries[0].entryId }), e => e.code === 'ENTRY_CONFLICT');
});

test('O03 隔日新帳本讓略過的字重新取得新字資格；已開始字改以複習延續', () => {
  const first = buildDailyPlan(args());
  const started = prepareEntry({ ...first, session: null, words, entryId: first.plan.orderedEntries[0].entryId, now, sessionId: 's', rng: () => 0.3 });
  const skipped = skipEntry({ ...args(), ...started, entryId: started.plan.orderedEntries[1].entryId });
  const carry = buildDailyPlan(args({ localDate: '2026-10-06', now: tomorrow, planId: 'day-2', existingPlans: { 'plan-1': skipped.plan } }));
  assert.deepEqual(carry.ledger.excludedSourceIds, [], '隔日帳本不帶入略過清單');
  assert.deepEqual(ids(carry.plan), [W(0)], '已開始未作答的字以複習延續，不重新領額度');
  assert.equal(carry.plan.orderedEntries[0].kind, 'review');
  const done = structuredClone(skipped.plan);
  Object.assign(done.orderedEntries[0], { status: 'completed', reviewId: 'r-1' });
  const fresh = buildDailyPlan(args({ localDate: '2026-10-06', now: tomorrow, planId: 'day-2', existingPlans: { 'plan-1': done } }));
  assert.equal(fresh.plan.orderedEntries[0].sourceId, W(1), '略過的字隔日重新有資格');
  assert.ok(!ids(fresh.plan).includes(W(0)));
});
