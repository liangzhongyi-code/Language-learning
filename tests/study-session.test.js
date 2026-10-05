import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPlan } from '../assets/js/core/daily-plan.js';
import { prepareEntry, skipEntry, queueReinforcement, resumeStudySession } from '../assets/js/core/study-session.js';
import { emptyLearning, validateLearning, validateLearningRecord } from '../assets/js/core/learning-schema.js';

const now = Date.parse('2026-10-05T04:00:00Z');
const words = Array.from({ length: 9 }, (_, i) => ({ id: `ja-w-${String(i + 1).padStart(3, '0')}`, level: 1, target: `単語${i}`, zh: `字${i}`, reading: `よみ${i}`, romaji: null, category: 'test' }));
const options = { words, localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', now, planId: 'p' };

/**
 * 與 planner stub 獨立的有效 fixture，讓 session RED 檢查自身行為。
 */
function fixture(count = 5) {
  return {
    plan: { planId: 'p', sessionId: null, localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', policyVersion: 1, orderedEntries: words.slice(0, count).map(w => ({ entryId: `p:${w.id}`, sourceId: w.id, skillKey: null, kind: 'new', status: 'pending', questionSnapshot: null, reviewId: null, introducedAt: null })), quotaSnapshot: { newLimit: 5, reviewLimit: 20 }, generatedAt: now, status: count ? 'active' : 'completed' },
    ledger: { ledgerId: '2026-10-05:ja', localDate: '2026-10-05', timeZone: 'Asia/Taipei', lang: 'ja', startedSourceIds: [], excludedSourceIds: [], newLimit: 5, updatedAt: now },
    session: null,
  };
}
const prep = (data, index = 0, extra = {}) => prepareEntry({ ...data, words, entryId: data.plan.orderedEntries[index].entryId, now, sessionId: 's', rng: () => 0.3, ...extra });

function withSession(data) {
  const entries = data.plan.orderedEntries;
  data.session = { sessionId: data.plan.sessionId, lang: 'ja', source: 'words', mode: 'choice', planId: data.plan.planId,
    orderedEntryIds: entries.map(e => e.entryId), submittedReviewIds: entries.filter(e => e.reviewId !== null).map(e => e.reviewId),
    questionSnapshots: Object.fromEntries(entries.filter(e => e.questionSnapshot !== null).map(e => [e.entryId, e.questionSnapshot])),
    status: 'active', createdAt: now, completedAt: null };
  return data;
}

test('D08 prepare 保存題面與 claim，只介紹不偽造作答／熟練／例句', () => {
  const initial = fixture();
  const result = prep(initial);
  const entry = result.plan.orderedEntries[0];
  assert.equal(entry.status, 'prepared');
  assert.equal(entry.introducedAt, now);
  assert.equal(entry.reviewId, null);
  assert.deepEqual(result.ledger.startedSourceIds, [entry.sourceId]);
  assert.deepEqual(result.session.submittedReviewIds, []);
  assert.equal('example' in entry.questionSnapshot, false);
  assert.equal(initial.plan.orderedEntries[0].status, 'pending');
  const learning = emptyLearning({ now, timeZone: 'Asia/Taipei' });
  learning.dailyPlans.p = result.plan;
  learning.dailyLedger[result.ledger.ledgerId] = result.ledger;
  learning.sessions.s = result.session;
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
});

test('D02 prepare 重送保留 fixed options，配額只 claim 一次；next 指向保存題面', () => {
  const first = prep(fixture());
  assert.ok(first.session);
  const again = prep(first, 0, { words: [], rng: () => { throw new Error('不可重產'); } });
  assert.deepEqual(again, first);
  assert.equal(resumeStudySession(again).entry.entryId, first.plan.orderedEntries[0].entryId);
  assert.deepEqual(resumeStudySession(again).entry.questionSnapshot, first.plan.orderedEntries[0].questionSnapshot);
});

test('D03 跨級別計畫在 prepare 再檢查帳本，不能用過期清單多領', () => {
  const data = fixture();
  data.ledger.startedSourceIds = words.slice(3, 8).map(w => w.id);
  assert.throws(() => prep(data), e => e.code === 'QUOTA_EXCEEDED');
});

test('D06 只有一個目標仍從完整同級池選四選項，不混入 N4', () => {
  const n4 = words.map(w => ({ ...w, id: w.id.replace('ja-w-', 'ja-w-9'), level: 2 }));
  const result = prep(fixture(1), 0, { words: [...words, ...n4] });
  assert.ok(result.session);
  assert.equal(result.plan.orderedEntries.length, 1);
  const question = result.plan.orderedEntries[0].questionSnapshot;
  assert.equal(question.options.length, 4);
  assert.ok(question.options.every(o => words.some(w => w.id === o.id)));
  assert.equal(new Set(question.options.map(o => o.text)).size, 4);
});

test('D06 同級題库不足明確拒絕，不跨級湊選項且不 claim', () => {
  const initial = fixture(1);
  const small = [words[0], ...words.slice(1).map(w => ({ ...w, level: 2 }))];
  assert.throws(() => prep(initial, 0, { words: small }), /不足/);
  assert.deepEqual(initial.ledger.startedSourceIds, []);
});

test('D10 已開始可在額度降零後續答，未開始不准新增 claim', () => {
  const result = prep(fixture());
  result.ledger.newLimit = 0;
  assert.equal(prep(result).plan.orderedEntries[0].status, 'prepared');
  assert.throws(() => prep(result, 1), e => e.code === 'QUOTA_EXCEEDED');
});

test('O03 略過未開始新字會替換並保存排除，重開不重發；隔日可再領', () => {
  const initial = fixture();
  const result = skipEntry({ ...options, ...initial, entryId: initial.plan.orderedEntries[0].entryId });
  assert.ok(!result.plan.orderedEntries.some(e => e.sourceId === words[0].id));
  assert.deepEqual(result.ledger.excludedSourceIds, [words[0].id]);
  assert.equal(result.plan.orderedEntries.length, 5);
  assert.deepEqual(result.ledger.startedSourceIds, []);
  const tomorrow = buildDailyPlan({ ...options, localDate: '2026-10-06', now: now + 86400000, planId: 'tomorrow', existingPlans: { p: result.plan } });
  assert.equal(tomorrow.plan.orderedEntries[0].sourceId, words[0].id);
});

test('O03 已開始項目不可略過，也不能退還已 claim 額度', () => {
  const started = prep(fixture());
  assert.throws(() => skipEntry({ ...options, ...started, entryId: started.plan.orderedEntries[0].entryId }), e => e.code === 'ENTRY_CONFLICT');
});

test('D09 同字每段補強一次，隔至少兩個其他未完成項目，不修改原計畫', () => {
  const data = fixture();
  const first = data.plan.orderedEntries[0];
  data.plan.sessionId = 's';
  Object.assign(first, { status: 'completed', reviewId: 'r', introducedAt: now, questionSnapshot: { sourceId: first.sourceId, prompt: '固定' } });
  const result = queueReinforcement({ ...withSession(data), entryId: first.entryId, correct: false });
  assert.equal(result.plan.orderedEntries.length, 6);
  assert.equal(result.plan.orderedEntries[3].kind, 'reinforcement');
  assert.equal(result.plan.orderedEntries[3].sourceId, first.sourceId);
  assert.equal(data.plan.orderedEntries.length, 5);
  const again = queueReinforcement({ ...result, entryId: first.entryId, correct: false });
  assert.deepEqual(again, result);
  assert.equal(validateLearningRecord('dailyPlans', result.plan).ok, true);
});

test('D09 只有零或一個其他項目就尾端補強；答對有提示也需一次', () => {
  for (const count of [1, 2]) {
    const data = fixture(count);
    const entry = data.plan.orderedEntries[0];
    data.plan.sessionId = 's';
    Object.assign(entry, { status: 'completed', reviewId: 'r', introducedAt: now, questionSnapshot: { sourceId: entry.sourceId } });
    const result = queueReinforcement({ ...withSession(data), entryId: entry.entryId, correct: true, hintUsed: true });
    assert.equal(result.plan.orderedEntries.length, count + 1);
    assert.equal(result.plan.orderedEntries.at(-1).kind, 'reinforcement');
    assert.equal(result.plan.orderedEntries.at(-1).reviewId, null);
  }
});

test('D09 未提交或無提示答對不憑空補強；reinforcement 不再遞迴排題', () => {
  const data = fixture();
  assert.throws(() => queueReinforcement({ ...data, entryId: data.plan.orderedEntries[0].entryId, correct: false }), /完成|提交/);
  const completed = prep(data);
  const entry = completed.plan.orderedEntries[0];
  entry.status = 'completed'; entry.reviewId = 'r'; completed.session.submittedReviewIds = ['r'];
  const unchanged = queueReinforcement({ ...completed, entryId: entry.entryId, correct: true });
  assert.deepEqual(unchanged, { plan: completed.plan, session: completed.session });
  const reinforced = queueReinforcement({ ...completed, entryId: entry.entryId, correct: false });
  const next = reinforced.plan.orderedEntries.find(e => e.kind === 'reinforcement');
  next.status = 'completed'; next.reviewId = 'r2'; reinforced.session.submittedReviewIds.push('r2');
  assert.deepEqual(queueReinforcement({ ...reinforced, entryId: next.entryId, correct: false }), reinforced);
});

test('D02/D11 純續答只根據持久完成狀態前進，不保存半填答案', () => {
  const data = fixture(3);
  data.plan.sessionId = 's';
  for (const e of data.plan.orderedEntries.slice(0, 2)) Object.assign(e, { status: 'completed', reviewId: `${e.entryId}:r`, questionSnapshot: { sourceId: e.sourceId } });
  const resumed = resumeStudySession(data);
  assert.equal(resumed.done, false);
  assert.equal(resumed.index, 2);
  assert.equal(resumed.entry.entryId, data.plan.orderedEntries[2].entryId);
  assert.deepEqual(resumeStudySession(fixture(0)), { entry: null, index: -1, done: true });
});

test('D14 有 skillKey 時不把產出題默換成辨認題，須提供匹配的既定題面', () => {
  const data = fixture(1);
  const e = data.plan.orderedEntries[0];
  const state = { skillKey: `${e.sourceId}:production:zh-ja`, sourceId: e.sourceId, ability: 'production', direction: 'zh-ja',
    legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due: now, lastEligibleReviewAt: null, learningStatus: 'review' };
  e.kind = 'review'; e.skillKey = state.skillKey;
  const itemStates = { [state.skillKey]: state };
  assert.throws(() => prep(data, 0, { itemStates }), /題面|能力/);
  const snapshot = { sourceId: e.sourceId, ability: 'production', direction: 'zh-ja', kind: 'typing', prompt: '請輸入', acceptedAnswers: ['假答案'], reportContext: { sourceId: e.sourceId } };
  const result = prep(data, 0, { itemStates, questionSnapshot: snapshot });
  assert.deepEqual(result.plan.orderedEntries[0].questionSnapshot, snapshot);
  snapshot.acceptedAnswers[0] = '已改';
  assert.equal(result.plan.orderedEntries[0].questionSnapshot.acceptedAnswers[0], '假答案');
  assert.deepEqual(result.ledger.startedSourceIds, []);
});

test('D14 辨認反向 due 使用 state 的實際方向；拒絕錯 source／能力的外來題面', () => {
  const data = fixture(1);
  const e = data.plan.orderedEntries[0];
  const state = { skillKey: `${e.sourceId}:recognition:zh-ja`, sourceId: e.sourceId, ability: 'recognition', direction: 'zh-ja',
    legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due: now, lastEligibleReviewAt: null, learningStatus: 'review' };
  e.kind = 'review'; e.skillKey = state.skillKey;
  const itemStates = { [state.skillKey]: state };
  const result = prep(data, 0, { itemStates });
  assert.equal(result.plan.orderedEntries[0].questionSnapshot.direction, 'zh2target');
  assert.throws(() => prep(data, 0, { itemStates, questionSnapshot: { sourceId: 'other', ability: 'recognition', direction: 'zh-ja' } }));
});

test('D09 補強必須同步已存在的 session，防止順序與題面快照脫節', () => {
  const data = prep(fixture());
  const e = data.plan.orderedEntries[0];
  e.status = 'completed'; e.reviewId = 'r';
  data.session.submittedReviewIds = ['r'];
  assert.throws(() => queueReinforcement({ plan: data.plan, entryId: e.entryId, correct: false }), /session/);
  const result = queueReinforcement({ ...data, entryId: e.entryId, correct: false });
  assert.deepEqual(result.session.orderedEntryIds, result.plan.orderedEntries.map(row => row.entryId));
});

test('D02 session 的順序或保存題面不符時拒絕，不假稱可恢復', () => {
  const data = prep(fixture());
  data.session.orderedEntryIds.reverse();
  assert.throws(() => prep(data), /session/);
  const snapshots = prep(fixture());
  snapshots.session.questionSnapshots[snapshots.plan.orderedEntries[0].entryId].options[0].text = '相異選項';
  assert.throws(() => prep(snapshots), /session/);
});

test('D09 補強結果的整體 learning 關聯通過 schema，只有原題具有已提交事件', () => {
  const data = fixture(1);
  const e = data.plan.orderedEntries[0];
  const state = { skillKey: `${e.sourceId}:recognition:ja-zh`, sourceId: e.sourceId, ability: 'recognition', direction: 'ja-zh',
    legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due: now, lastEligibleReviewAt: null, learningStatus: 'review' };
  e.kind = 'review'; e.skillKey = state.skillKey;
  const prepared = prep(data, 0, { itemStates: { [state.skillKey]: state } });
  const done = prepared.plan.orderedEntries[0];
  done.status = 'completed'; done.reviewId = 'r'; prepared.plan.status = 'completed';
  Object.assign(prepared.session, { submittedReviewIds: ['r'], status: 'completed', completedAt: now });
  const queued = queueReinforcement({ ...prepared, entryId: done.entryId, correct: false });
  const learning = emptyLearning({ now, timeZone: 'Asia/Taipei' });
  learning.itemStates[state.skillKey] = state;
  learning.dailyPlans.p = queued.plan;
  learning.dailyLedger[prepared.ledger.ledgerId] = prepared.ledger;
  learning.sessions.s = queued.session;
  learning.reviewEvents.r = { reviewId: 'r', sessionId: 's', planId: 'p', entryId: done.entryId, sourceId: done.sourceId, skillKey: state.skillKey,
    answeredAt: now, correct: false, assistance: { hintUsed: false, retry: false, replayCount: 0 }, responseMs: null,
    questionMode: 'choice', scheduleEligible: true, schedulerVersion: '1', before: null, after: { due: now } };
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  assert.deepEqual(queued.session.submittedReviewIds, ['r']);
  assert.equal(queued.session.completedAt, null);
});

test('O03 有 session 的略過替換仍保留原 claim，整體 learning 通過 schema', () => {
  const started = prep(fixture());
  const before = structuredClone(started.plan.orderedEntries[0]);
  const result = skipEntry({ ...options, ...started, entryId: started.plan.orderedEntries[1].entryId });
  assert.deepEqual(result.plan.orderedEntries[0], before);
  assert.deepEqual(result.ledger.startedSourceIds, [before.sourceId]);
  const learning = emptyLearning({ now, timeZone: 'Asia/Taipei' });
  learning.dailyPlans.p = result.plan; learning.dailyLedger[result.ledger.ledgerId] = result.ledger; learning.sessions.s = result.session;
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
});

test('D08 題面保留題庫既有例句、ruby 與回報脈絡，修改候選值不污染題庫', () => {
  const pool = structuredClone(words);
  pool[0].example = { target: '既有例句', zh: '既有翻譯' };
  pool[0].ruby = [{ base: '字', reading: 'じ' }];
  const before = structuredClone(pool);
  const result = prep(fixture(1), 0, { words: pool });
  const q = result.plan.orderedEntries[0].questionSnapshot;
  assert.deepEqual(q.example, pool[0].example);
  assert.deepEqual(q.promptRuby, pool[0].ruby);
  assert.equal(q.reportContext.sourceId, pool[0].id);
  q.example.target = '改候選'; q.promptRuby[0].base = '改候選';
  assert.deepEqual(pool, before);
});

test('F12 整合：state 使用 target2zh／zh2target 仍保留正確能力方向', () => {
  for (const direction of ['target2zh', 'zh2target']) {
    const data = fixture(1);
    const e = data.plan.orderedEntries[0];
    const state = { skillKey: `${e.sourceId}:recognition:${direction}`, sourceId: e.sourceId, ability: 'recognition', direction,
      legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due: now, lastEligibleReviewAt: null, learningStatus: 'review' };
    e.kind = 'review'; e.skillKey = state.skillKey;
    const itemStates = { [state.skillKey]: state };
    const result = prep(data, 0, { itemStates });
    const snapshot = result.plan.orderedEntries[0].questionSnapshot;
    assert.equal(snapshot.direction, direction);
    const injected = prep(data, 0, { itemStates, questionSnapshot: snapshot });
    assert.deepEqual(injected.plan.orderedEntries[0].questionSnapshot, snapshot);
  }
});
