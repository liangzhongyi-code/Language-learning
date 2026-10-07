import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createDailyService } from '../assets/js/ui/platform/daily-service.js';
import { validateLearning } from '../assets/js/core/learning-schema.js';
import { portableFromRows, PORTABLE_STORES } from '../assets/js/core/learning-snapshot.js';
import { words } from '../assets/js/data/ja/words.js';

const DAY = 86_400_000;
const settings = { level: 1, newLimit: 5, reviewLimit: 20 };

function setup({ start = Date.UTC(2026, 9, 7, 1, 0), failCommit } = {}) {
  const clock = { now: start };
  const repository = createMemoryRepository({ now: () => clock.now, failCommit });
  const store = createLearningStore({ repository, legacyStorage: null, now: () => clock.now });
  const make = () => createDailyService({ store, lang: 'ja', words, now: () => clock.now, rng: () => 0.42 });
  return { clock, repository, store, service: make(), make };
}

/**
 * 依題面找出正解或錯解索引；測試以外不得讀取 correctIndex。
 */
async function answer(service, view, { correct = true, reviewId } = {}) {
  const entry = view.next.entry;
  if (entry.status === 'pending') await service.prepare(view.plan.planId, entry.entryId);
  const fresh = await service.preview(settings);
  const target = fresh.plan.orderedEntries.find((row) => row.entryId === entry.entryId);
  const q = target.questionSnapshot;
  const index = correct ? q.correctIndex : (q.correctIndex + 1) % q.options.length;
  const result = await service.submit({ planId: fresh.plan.planId, entryId: entry.entryId, answeredIndex: index,
    reviewId: reviewId ?? `rv-${entry.entryId.replace(/[^A-Za-z0-9]/g, '')}-${Math.random().toString(16).slice(2, 8)}` });
  return { result, entry };
}

async function exportOk(store) {
  const { meta, rows } = await store.read([...PORTABLE_STORES]);
  const checked = validateLearning(portableFromRows(rows, meta).learning);
  assert.deepEqual(checked.errors, [], '每一步之後完整學習資料都必須能通過匯入驗證');
}

test('F15/D01：首日 N5 建立固定 5 個新字、0 複習，重開不重建', async () => {
  const { service, make, repository } = setup();
  const view = await service.today(settings);
  assert.equal(view.plan.orderedEntries.length, 5);
  assert.ok(view.plan.orderedEntries.every((entry) => entry.kind === 'new'));
  assert.equal(view.summary.reviewCount, 0);
  const commits = repository.commits.length;
  const again = await make().today(settings);
  assert.deepEqual(again.plan, view.plan);
  assert.equal(repository.commits.length, commits, '已存在的清單重開不再寫入');
});

test('F15/D02/D11：完成兩題後重開，順序與完成狀態相同，從第三題繼續，不另發新字', async () => {
  const { service, make, store } = setup();
  let view = await service.today(settings);
  await answer(service, view);
  view = await service.preview(settings);
  await answer(service, view);
  const reopened = await make().today(settings);
  assert.deepEqual(reopened.plan.orderedEntries.map((e) => e.entryId), view.plan.orderedEntries.map((e) => e.entryId));
  assert.equal(reopened.summary.completedCount, 2);
  assert.equal(reopened.next.index, 2);
  const ledger = (await store.read(['dailyLedger'])).rows.dailyLedger;
  assert.equal(Object.values(ledger)[0].startedSourceIds.length, 2, '只有實際開始的兩個字用掉額度');
  await exportOk(store);
});

test('F13/D12：同一 reviewId 重送只入帳一次，統計不重複', async () => {
  const { service, store } = setup();
  const view = await service.today(settings);
  const entry = view.next.entry;
  await service.prepare(view.plan.planId, entry.entryId);
  const fresh = await service.preview(settings);
  const q = fresh.plan.orderedEntries[0].questionSnapshot;
  const args = { planId: fresh.plan.planId, entryId: entry.entryId, answeredIndex: q.correctIndex, reviewId: 'rv-retry-1' };
  await service.submit(args);
  const replay = await service.submit(args);
  assert.equal(replay.value.replay, true);
  const { rows } = await store.read(['stats', 'reviewEvents']);
  assert.equal(rows.stats['ja:daily'].answered, 1);
  assert.equal(Object.keys(rows.reviewEvents).length, 1);
});

test('F13/D12：交易失敗不寫入任何一部分，之後以同一 reviewId 重試成功', async () => {
  let fail = true;
  const { service, store } = setup({ failCommit: (op) => fail && op.operationId.startsWith('submit-') });
  const view = await service.today(settings);
  const entry = view.next.entry;
  await service.prepare(view.plan.planId, entry.entryId);
  const fresh = await service.preview(settings);
  const q = fresh.plan.orderedEntries[0].questionSnapshot;
  const args = { planId: fresh.plan.planId, entryId: entry.entryId, answeredIndex: q.correctIndex, reviewId: 'rv-fail-1' };
  await assert.rejects(service.submit(args), (error) => error.code === 'STORAGE_ABORTED');
  let rows = (await store.read(['stats', 'reviewEvents', 'itemStates'])).rows;
  assert.deepEqual([Object.keys(rows.reviewEvents).length, Object.keys(rows.itemStates).length, rows.stats['ja:daily']], [0, 0, undefined]);
  fail = false;
  await service.submit(args);
  rows = (await store.read(['stats', 'reviewEvents'])).rows;
  assert.equal(rows.stats['ja:daily'].answered, 1);
});

test('F13/D13：兩個分頁同時提交不同題次，兩題都保存（衝突重讀重算）', async () => {
  const { service, make, store } = setup();
  const view = await service.today(settings);
  const [a, b] = view.plan.orderedEntries;
  await service.prepare(view.plan.planId, a.entryId);
  await service.prepare(view.plan.planId, b.entryId);
  const fresh = await service.preview(settings);
  const qa = fresh.plan.orderedEntries[0].questionSnapshot;
  const qb = fresh.plan.orderedEntries[1].questionSnapshot;
  await Promise.all([
    service.submit({ planId: fresh.plan.planId, entryId: a.entryId, answeredIndex: qa.correctIndex, reviewId: 'rv-tab-a' }),
    make().submit({ planId: fresh.plan.planId, entryId: b.entryId, answeredIndex: qb.correctIndex, reviewId: 'rv-tab-b' }),
  ]);
  const after = await service.preview(settings);
  assert.equal(after.summary.completedCount, 2);
  assert.equal((await store.read(['stats'])).rows.stats['ja:daily'].answered, 2);
  await exportOk(store);
});

test('F15/D09/D24：答錯補強一次且不升排程；全部完成後完成局數只加一', async () => {
  const { service, store } = setup();
  let view = await service.today({ ...settings, newLimit: 3 });
  const first = await answer(service, view, { correct: false });
  view = await service.preview({ ...settings, newLimit: 3 });
  assert.equal(view.plan.orderedEntries.length, 4, '答錯加入一次補強');
  for (let guard = 0; guard < 10 && !view.next.done; guard++) {
    await answer(service, view, { correct: false });
    view = await service.preview({ ...settings, newLimit: 3 });
  }
  assert.equal(view.plan.status, 'completed');
  assert.equal(view.plan.orderedEntries.filter((e) => e.kind === 'reinforcement').length, 3, '每字每段最多一次補強');
  const { rows } = await store.read(['stats', 'reviewEvents']);
  assert.equal(rows.stats['ja:daily'].sessions, 1);
  const eligible = Object.values(rows.reviewEvents).filter((event) => event.scheduleEligible);
  assert.equal(eligible.length, 3, '補強作答不改長期排程');
  assert.ok(first.entry);
  await exportOk(store);
});

test('F15/D04：跨日後未完成題目帶入複習、額度重新計算，舊清單不改寫', async () => {
  const { service, clock, store } = setup();
  let view = await service.today(settings);
  const wrong = await answer(service, view, { correct: false });
  view = await service.preview(settings);
  const started = view.plan.orderedEntries.find((entry) => entry.kind === 'new' && entry.status === 'pending');
  await service.prepare(view.plan.planId, started.entryId);
  const yesterday = (await service.preview(settings)).plan;
  clock.now += DAY;
  view = await service.today(settings);
  assert.notEqual(view.plan.planId, yesterday.planId);
  assert.ok(view.plan.orderedEntries.every((entry) => entry.kind === 'review'), '有到期／未完成題先複習，清完才發新字');
  const sources = view.plan.orderedEntries.map((entry) => entry.sourceId);
  assert.ok(sources.includes(wrong.entry.sourceId), '答錯的字隔天到期');
  assert.ok(sources.includes(started.sourceId), '已介紹未作答的字帶入隔天');
  assert.equal(view.plan.orderedEntries.find((e) => e.sourceId === started.sourceId).entryId, started.entryId, '跨日搬動沿用原題次 ID');
  const { rows } = await store.read(['dailyPlans', 'dailyLedger']);
  assert.deepEqual(rows.dailyPlans[yesterday.planId], yesterday, '昨天的清單不被改寫');
  assert.equal(Object.keys(rows.dailyLedger).length, 2, '新的一天有自己的日帳本');
  for (let guard = 0; guard < 10 && !view.next.done; guard++) {
    await answer(service, view);
    view = await service.preview(settings);
  }
  assert.equal(view.plan.status, 'completed', '跨日帶入的題次可正常作答完成');
  await exportOk(store);
});

test('F15/D10：每日新字改為 0，未開始的新字移除、已開始的保留', async () => {
  const { service } = setup();
  let view = await service.today(settings);
  await service.prepare(view.plan.planId, view.plan.orderedEntries[0].entryId);
  view = await service.today({ ...settings, newLimit: 0 });
  assert.equal(view.plan.orderedEntries.length, 1);
  assert.equal(view.plan.orderedEntries[0].status, 'prepared');
});

test('F22/O03：今日略過只替換未開始新字，不退還額度；O02 自評已會從今日新字移除', async () => {
  const { service, store } = setup();
  let view = await service.today(settings);
  const skipped = view.plan.orderedEntries[0];
  await service.skip(view.plan.planId, skipped.entryId, settings);
  view = await service.preview(settings);
  assert.ok(!view.plan.orderedEntries.some((entry) => entry.sourceId === skipped.sourceId));
  assert.equal(view.plan.orderedEntries.length, 5, '補上下一個新字');
  const known = view.plan.orderedEntries[0];
  await service.markKnown(view.plan.planId, known.sourceId, settings);
  view = await service.preview(settings);
  assert.ok(!view.plan.orderedEntries.some((entry) => entry.sourceId === known.sourceId));
  const { rows } = await store.read(['intents', 'dailyLedger']);
  assert.equal(rows.intents[known.sourceId].selfAssessedKnown, true);
  assert.deepEqual(Object.values(rows.dailyLedger)[0].excludedSourceIds, [skipped.sourceId]);
  await exportOk(store);
});

test('F15/D06：完全沒有可學項目時顯示今日完成，不建立空 session', async () => {
  const { service } = setup();
  const view = await service.today({ ...settings, newLimit: 0 });
  assert.equal(view.plan.orderedEntries.length, 0);
  assert.equal(view.plan.status, 'completed');
  assert.equal(view.plan.sessionId, null);
});
