import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPlan, revisePendingNew } from '../assets/js/core/daily-plan.js';
import { emptyLearning, validateLearning, validateLearningRecord } from '../assets/js/core/learning-schema.js';
import { createStudyDayState, resolveStudyDay } from '../assets/js/core/study-day.js';

const now = Date.parse('2026-10-05T04:00:00Z');
const words = Array.from({ length: 45 }, (_, i) => ({ id: `ja-w-${String(i + 1).padStart(3, '0')}`, level: 1, target: `単語${i}`, zh: `字${i}`, reading: `よみ${i}`, category: 'test' }));
const args = (extra = {}) => ({ words, localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', now, planId: 'plan-1', ...extra });
const ids = (plan) => plan.orderedEntries.map(e => e.sourceId);
const progressOf = (count) => ({ schemaVersion: 1, items: Object.fromEntries(words.slice(0, count).map((w, i) => [w.id, { n: 1, w: 0, due: now - 1000 + i, last: now - 5000 }])) });
const ledger = (startedSourceIds = []) => ({ ledgerId: '2026-10-05:ja', localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', startedSourceIds, excludedSourceIds: [], newLimit: 5, updatedAt: now });
const state = (id, ability, due) => ({ skillKey: `${id}:${ability}:ja-zh`, sourceId: id, ability, direction: 'ja-zh', legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due, lastEligibleReviewAt: null, learningStatus: 'review' });

test('D01 首日 N5 只取穩定 ID 前五字、零複習，數字 level1 正規化且符合 schema', () => {
  const result = buildDailyPlan(args({ words: [...words].reverse(), level: 1, rng: () => 0.99 }));
  assert.ok(result.plan, '應建立每日計畫而非空 stub');
  assert.equal(result.plan.level, 'N5');
  assert.deepEqual(ids(result.plan), words.slice(0, 5).map(w => w.id));
  assert.equal(result.summary.dueCount, 0);
  assert.equal(result.plan.sessionId, null);
  assert.deepEqual(result.ledger.startedSourceIds, []);
  const learning = emptyLearning({ now, timeZone: 'Asia/Taipei' });
  learning.dailyPlans[result.plan.planId] = result.plan;
  learning.dailyLedger[result.ledger.ledgerId] = result.ledger;
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
});

test('D02 重開保留 ID、順序、已保存題面，不受 rng 或題庫順序影響', () => {
  const first = buildDailyPlan(args());
  assert.ok(first.plan);
  first.plan.orderedEntries[0].questionSnapshot = { sourceId: words[0].id, prompt: '保存題面' };
  const again = buildDailyPlan(args({ words: [...words].reverse(), planId: 'other', existingPlans: { 'plan-1': first.plan }, ledger: first.ledger }));
  assert.deepEqual(again.plan, first.plan);
  again.plan.orderedEntries[0].questionSnapshot.prompt = '候選值修改';
  assert.equal(first.plan.orderedEntries[0].questionSnapshot.prompt, '保存題面');
});

test('D03 N5 已 claim 三字後 N4 只剩兩字；不同語言帳本獨立', () => {
  const n4 = words.map(w => ({ ...w, id: w.id.replace('ja-w-', 'ja-w-1'), level: 2 }));
  const result = buildDailyPlan(args({ words: [...words, ...n4], level: 'N4', ledger: ledger(words.slice(0, 3).map(w => w.id)) }));
  assert.ok(result.plan);
  assert.equal(result.plan.orderedEntries.length, 2);
  assert.ok(ids(result.plan).every(id => id.startsWith('ja-w-1')));
  const en = buildDailyPlan(args({ words: words.map(w => ({ ...w, id: w.id.replace('ja-', 'en-') })), lang: 'en', level: 1 }));
  assert.equal(en.ledger.ledgerId, '2026-10-05:en');
  assert.equal(en.plan.orderedEntries.length, 5);
});

test('D04 下一日帶入未完成複習及已介紹新字，不重新消耗新字配額', () => {
  const old = buildDailyPlan(args());
  assert.ok(old.plan);
  old.plan.sessionId = 'old-session';
  const entry = old.plan.orderedEntries[0];
  Object.assign(entry, { status: 'prepared', introducedAt: now, questionSnapshot: { sourceId: entry.sourceId, prompt: '昨日' } });
  const next = buildDailyPlan(args({ localDate: '2026-10-06', now: now + 86400000, planId: 'next', existingPlans: { 'plan-1': old.plan } }));
  assert.equal(next.plan.orderedEntries[0].sourceId, entry.sourceId);
  assert.equal(next.plan.orderedEntries[0].kind, 'review');
  assert.equal(next.plan.orderedEntries[0].questionSnapshot.prompt, '昨日');
  assert.deepEqual(next.ledger.startedSourceIds, []);
  assert.ok(next.plan.orderedEntries.every(e => e.kind === 'review'));
});

test('D04 固定日界倒退仍使用 resolveStudyDay 所給日期與既有帳本', () => {
  const day = resolveStudyDay(createStudyDayState('Asia/Taipei'), now);
  const rolled = resolveStudyDay(day.state, now - 86400000);
  const first = buildDailyPlan(args());
  assert.ok(first.plan);
  const result = buildDailyPlan(args({ ...rolled, now: now - 86400000, ledger: first.ledger, existingPlans: { 'plan-1': first.plan } }));
  assert.deepEqual(result.plan, first.plan);
  assert.equal(result.ledger.ledgerId, first.ledger.ledgerId);
});

test('D05 backlog35 按 due、last、ID 排序，20／15 清完後才發新字', () => {
  const progress = progressOf(35);
  const first = buildDailyPlan(args({ progress }));
  assert.ok(first.plan);
  assert.equal(first.plan.orderedEntries.length, 20);
  assert.equal(first.summary.remainingDue, 15);
  assert.ok(first.plan.orderedEntries.every(e => e.kind === 'review'));
  const plans = {};
  function finish(plan) {
    plan.status = 'completed';
    plan.sessionId = `${plan.planId}:session`;
    for (const e of plan.orderedEntries) Object.assign(e, { status: 'completed', reviewId: `${e.entryId}:answer`, questionSnapshot: { sourceId: e.sourceId } });
    plans[plan.planId] = plan;
  }
  finish(first.plan);
  const second = buildDailyPlan(args({ progress, ledger: first.ledger, existingPlans: plans, planId: 'second', nextSegment: true }));
  assert.equal(second.plan.orderedEntries.length, 15);
  assert.deepEqual(ids(second.plan), words.slice(20, 35).map(w => w.id));
  finish(second.plan);
  const third = buildDailyPlan(args({ progress, ledger: first.ledger, existingPlans: plans, planId: 'third', nextSegment: true }));
  assert.deepEqual(ids(third.plan), words.slice(35, 40).map(w => w.id));
});

test('D05 due 相同再按 last 與穩定 ID，不按 frequency 或輸入順序', () => {
  const progress = progressOf(3);
  for (const row of Object.values(progress.items)) row.due = now;
  progress.items[words[0].id].last = now - 1;
  const result = buildDailyPlan(args({ progress, words: [...words].reverse() }));
  assert.ok(result.plan);
  assert.deepEqual(ids(result.plan), [words[1].id, words[2].id, words[0].id]);
});

test('D06 一至三個到期均合法；零題 completed 且不偽造 session', () => {
  for (const count of [1, 2, 3]) {
    const result = buildDailyPlan(args({ progress: progressOf(count) }));
    assert.ok(result.plan);
    assert.equal(result.plan.orderedEntries.length, count);
  }
  const zero = buildDailyPlan(args({ words: [], newLimit: 0 }));
  assert.equal(zero.plan.status, 'completed');
  assert.equal(zero.plan.sessionId, null);
  assert.deepEqual(zero.plan.orderedEntries, []);
});

test('D07 新到期另列 summary，不變動原清單；完成後須明確請求下一段', () => {
  const first = buildDailyPlan(args({ progress: progressOf(1) }));
  assert.ok(first.plan);
  const again = buildDailyPlan(args({ progress: progressOf(2), ledger: first.ledger, existingPlans: { 'plan-1': first.plan } }));
  assert.deepEqual(again.plan, first.plan);
  assert.equal(again.summary.remainingDue, 1);
  assert.throws(() => buildDailyPlan(args({ existingPlans: { 'plan-1': first.plan }, ledger: first.ledger, nextSegment: true, planId: 'next' })), /未完成/);
});

test('D10 額度降零只移除未開始新字，保留已開始三字與題面', () => {
  const result = buildDailyPlan(args());
  assert.ok(result.plan);
  result.plan.sessionId = 's';
  for (const e of result.plan.orderedEntries.slice(0, 3)) Object.assign(e, { status: 'prepared', introducedAt: now, questionSnapshot: { sourceId: e.sourceId, prompt: '固定' } });
  const old = structuredClone(result.plan);
  const session = { sessionId: 's', lang: 'ja', source: 'words', mode: 'choice', planId: old.planId, orderedEntryIds: old.orderedEntries.map(e => e.entryId), submittedReviewIds: [], questionSnapshots: Object.fromEntries(old.orderedEntries.slice(0, 3).map(e => [e.entryId, e.questionSnapshot])), status: 'active', createdAt: now, completedAt: null };
  const revised = revisePendingNew({ ...args(), ...result, session, ledger: ledger(ids(result.plan).slice(0, 3)), newLimit: 0 });
  assert.deepEqual(revised.plan.orderedEntries, old.orderedEntries.slice(0, 3));
  assert.equal(revised.ledger.startedSourceIds.length, 3);
  assert.deepEqual(revised.session.orderedEntryIds, revised.plan.orderedEntries.map(e => e.entryId));
  assert.deepEqual(result.plan, old);
});

test('D14 同字不同能力各自按 due，沒有把辨認當產出熟練', () => {
  const rec = state(words[0].id, 'recognition', now + 1000);
  const prod = state(words[0].id, 'production', now - 1);
  const result = buildDailyPlan(args({ itemStates: { [rec.skillKey]: rec, [prod.skillKey]: prod } }));
  assert.ok(result.plan);
  assert.deepEqual(result.plan.orderedEntries.map(e => e.skillKey), [prod.skillKey]);
});

test('O01 想學只調整未開始新字，不能擠 due 或多發配額', () => {
  const intents = { [words[8].id]: { sourceId: words[8].id, wantToLearn: true, selfAssessedKnown: false, updatedAt: now } };
  const first = buildDailyPlan(args());
  assert.ok(first.plan);
  const revised = revisePendingNew({ ...args(), ...first, intents });
  assert.equal(revised.plan.orderedEntries[0].sourceId, words[8].id);
  assert.equal(revised.plan.orderedEntries.length, 5);
  const due = buildDailyPlan(args({ progress: progressOf(1), intents }));
  assert.deepEqual(ids(due.plan), [words[0].id]);
});

test('O02 自評已會跳過新字但不抹 due，撤回恢復資格', () => {
  const intents = { [words[0].id]: { sourceId: words[0].id, wantToLearn: false, selfAssessedKnown: true, updatedAt: now } };
  const fresh = buildDailyPlan(args({ intents }));
  assert.ok(fresh.plan);
  assert.ok(!ids(fresh.plan).includes(words[0].id));
  assert.deepEqual(ids(buildDailyPlan(args({ intents, progress: progressOf(1) })).plan), [words[0].id]);
  assert.equal(buildDailyPlan(args()).plan.orderedEntries[0].sourceId, words[0].id);
});

test('資料界線：異日／異語言 ledger、非法額度、未支援級別明確拒絕', () => {
  for (const extra of [{ ledger: { ...ledger(), localDate: '2026-10-04' } }, { newLimit: -1 }, { reviewLimit: 0 }, { newLimit: Infinity }, { level: 'N9' }]) {
    assert.throws(() => buildDailyPlan(args(extra)));
  }
});

test('純函數不修改 frozen 輸入，候選 plan／ledger 通過單筆 schema', () => {
  const input = args({ words: Object.freeze(words.map(w => Object.freeze({ ...w }))), ledger: Object.freeze(ledger()) });
  const before = JSON.stringify(input);
  const result = buildDailyPlan(input);
  assert.ok(result.plan);
  assert.equal(JSON.stringify(input), before);
  for (const [collection, row] of [['dailyPlans', result.plan], ['dailyLedger', result.ledger]]) assert.deepEqual(validateLearningRecord(collection, row), { ok: true, errors: [] });
});

test('D04 已在後續日完成的 carry 不會被更舊未完成計畫每日復活', () => {
  const original = buildDailyPlan(args({ progress: progressOf(1) })).plan;
  const successor = structuredClone(original);
  Object.assign(successor, { planId: 'next', sessionId: 'next-s', localDate: '2026-10-06', generatedAt: now + 86400000, status: 'completed' });
  Object.assign(successor.orderedEntries[0], { entryId: 'next-e', status: 'completed', reviewId: 'r', questionSnapshot: { sourceId: words[0].id } });
  const progress = progressOf(1);
  progress.items[words[0].id].due = now + 5 * 86400000;
  const result = buildDailyPlan(args({ localDate: '2026-10-07', now: now + 2 * 86400000, planId: 'third', progress, newLimit: 0, existingPlans: { 'plan-1': original, next: successor } }));
  assert.equal(result.plan.orderedEntries.length, 0);
});

test('D10 修改已有 session 的清單必須同步 session，不能遺留相異題序', () => {
  const first = buildDailyPlan(args());
  first.plan.sessionId = 's';
  assert.throws(() => revisePendingNew({ ...args(), ...first, newLimit: 0 }), /session/);
});
