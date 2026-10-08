import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createDailyService } from '../assets/js/ui/platform/daily-service.js';
import { initializeItemState } from '../assets/js/core/scheduler.js';
import { PRACTICE_MODES } from '../assets/js/core/practice-engine.js';
import { practice as ja } from '../assets/js/data/ja/practice.js';
import { practice as en } from '../assets/js/data/en/practice.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { words as enWords } from '../assets/js/data/en/words.js';

const AT = Date.UTC(2026, 9, 8, 1);
const settings = { level: 1, newLimit: 0, reviewLimit: 20 };
const code = expected => error => error.code === expected;
async function fixture(item, options = {}) {
  const lang = item.id.slice(0, 2);
  const repository = createMemoryRepository({ now: () => AT, failCommit: options.failCommit });
  const store = createLearningStore({ repository, now: () => AT });
  const { ability, direction } = PRACTICE_MODES[item.mode];
  const state = initializeItemState({ sourceId: item.sourceId, ability, direction, initialization: { kind: 'new' } });
  const meta = await store.ready();
  await repository.commit({ operationId: 'seed-state', epoch: meta.dataEpoch, expectedRevision: meta.revision,
    payload: { changes: [{ store: 'itemStates', key: state.skillKey, value: state }] } });
  let calls = 0;
  const make = (practiceProvider = options.practiceProvider ?? (async () => { calls++; return lang === 'ja' ? ja : en; })) =>
    createDailyService({ store, lang, words: lang === 'ja' ? jaWords : enWords, now: () => AT, rng: () => 0.42, practiceProvider });
  return { repository, store, state, service: make(), make, calls: () => calls };
}

function correctResponse(q) {
  if (q.answerKey.accepted) return { input: q.answerKey.accepted[0] };
  if (q.options) return { selectedIndex: q.answerKey.correctIndex };
  if (q.fragments) {
    const remaining = [...q.fragments];
    let suffix = q.answerKey.answer;
    const instanceIds = [];
    while (remaining.length) {
      const index = remaining.findIndex(piece => suffix.startsWith(piece.text));
      assert.notEqual(index, -1);
      const [piece] = remaining.splice(index, 1);
      instanceIds.push(piece.instanceId);
      suffix = suffix.slice(piece.text.length);
    }
    return { instanceIds };
  }
  return { instanceIds: q.answerKey.legalOrders[0].map(index =>
    q.chunks.find(piece => q.answerKey.chunkIndexByInstance[piece.instanceId] === index).instanceId) };
}

test('每日實際同級單字候選的所有人工能力：按需載入、固定題面、原能力入帳、重送不重計', async () => {
  for (const [items, words] of [[ja, jaWords], [en, enWords]]) {
    const ids = new Set(words.filter(word => word.level === 1).map(word => word.id));
    const modes = [...new Set(items.filter(item => ids.has(item.sourceId)).map(item => item.mode))];
    for (const mode of modes) {
      const item = items.find(item => item.mode === mode && ids.has(item.sourceId));
      const { service, store, repository, state, calls, make } = await fixture(item);
      const view = await service.today(settings);
      assert.equal(calls(), 0, 'today 不讀練習庫');
      const entry = view.next.entry;
      assert.equal(entry.sourceId, item.sourceId);
      await service.prepare(view.plan.planId, entry.entryId, { expectedEpoch: view.dataEpoch });
      const prepared = await service.preview(settings);
      const q = prepared.next.entry.questionSnapshot;
      assert.equal(q.ability, state.ability);
      assert.equal(q.practiceMode, mode);
      assert.equal(calls(), 1);
      const offline = make(async () => { throw new Error('不應讀題庫'); });
      await offline.prepare(view.plan.planId, entry.entryId, { expectedEpoch: view.dataEpoch });
      assert.deepEqual((await offline.preview(settings)).next.entry.questionSnapshot, q);
      const args = { planId: view.plan.planId, entryId: entry.entryId, response: correctResponse(q),
        reviewId: `daily-${mode}`, replayCount: 2, expectedEpoch: view.dataEpoch };
      const committed = await service.submit(args);
      assert.equal(committed.value.event.skillKey, state.skillKey);
      assert.equal(committed.value.event.correct, true);
      assert.equal(committed.value.event.assistance.replayCount, 2);
      assert.deepEqual(committed.value.event.before, state, '保留原能力排程作為 before');
      await service.submit(args);
      assert.equal(repository.peek('stats', `${item.id.slice(0, 2)}:daily`).answered, 1);
      assert.deepEqual(repository.peek('dailyLedger', '2026-10-08:' + item.id.slice(0, 2)).startedSourceIds, []);
      await store.exportBackup();
    }
  }
});

test('非單字 source 不偷偷扩入每日候選；辨認題不呼叫 practiceProvider', async () => {
  const f = await fixture(ja.find(item => item.mode === 'reorder'));
  assert.equal((await f.service.today(settings)).plan.orderedEntries.length, 0);
  const fresh = await f.service.today({ ...settings, level: 2, newLimit: 5 });
  await f.service.prepare(fresh.plan.planId, fresh.next.entry.entryId);
  assert.equal(f.calls(), 0);
});

test('缺匹配種子或 provider 失敗不半建題面，固定錯誤碼可重試且原排程不變', async () => {
  const item = ja.find(item => item.mode === 'typing');
  let failure = 'network';
  const f = await fixture(item, { practiceProvider: async () => {
    if (failure === 'network') throw new Error('private network diagnostics');
    return failure === 'missing' ? [] : ja;
  } });
  const view = await f.service.today(settings);
  const before = await f.store.read(['dailyPlans', 'sessions', 'dailyLedger', 'itemStates', 'reviewEvents']);
  for (const [mode, expected] of [['network', 'PRACTICE_LOAD_FAILED'], ['missing', 'DAILY_PRACTICE_UNAVAILABLE']]) {
    failure = mode;
    await assert.rejects(f.service.prepare(view.plan.planId, view.next.entry.entryId), code(expected));
    assert.deepEqual(await f.store.read(['dailyPlans', 'sessions', 'dailyLedger', 'itemStates', 'reviewEvents']), before);
  }
  failure = null;
  await f.service.prepare(view.plan.planId, view.next.entry.entryId);
  await f.store.exportBackup();
});

test('人工題空答不入帳；提示作答補強沿用快照且不再讀 provider，失敗後原 reviewId 重試', async () => {
  let fail = false;
  const f = await fixture(ja.find(item => item.mode === 'typing'), { failCommit: op => fail && op.operationId.startsWith('submit-') });
  const view = await f.service.today(settings);
  await f.service.prepare(view.plan.planId, view.next.entry.entryId);
  const prepared = await f.service.preview(settings);
  const q = prepared.next.entry.questionSnapshot;
  const args = { planId: view.plan.planId, entryId: view.next.entry.entryId, reviewId: 'practice-retry',
    response: { input: '' }, hintUsed: true, expectedEpoch: view.dataEpoch };
  await assert.rejects(f.service.submit(args), code('INVALID_ANSWER'));
  args.response = correctResponse(q);
  const before = await f.store.read(['reviewEvents', 'itemStates', 'dailyPlans', 'sessions', 'stats']);
  fail = true;
  await assert.rejects(f.service.submit(args), code('STORAGE_ABORTED'));
  assert.deepEqual(await f.store.read(['reviewEvents', 'itemStates', 'dailyPlans', 'sessions', 'stats']), before);
  fail = false;
  const saved = await f.service.submit(args);
  assert.equal(saved.value.event.assistance.hintUsed, true);
  const reinforced = await f.service.preview(settings);
  assert.equal(reinforced.next.entry.kind, 'reinforcement');
  assert.deepEqual(reinforced.next.entry.questionSnapshot, q);
  await f.make(async () => { throw new Error('不應載入'); }).prepare(reinforced.plan.planId, reinforced.next.entry.entryId);
  const result = await f.service.submit({ ...args, entryId: reinforced.next.entry.entryId, reviewId: 'reinforcement', hintUsed: false });
  assert.equal(result.value.event.scheduleEligible, false);
  assert.equal(f.repository.peek('stats', 'ja:daily').sessions, 1);
  await f.store.exportBackup();
});

test('provider 等待中還原／清除世代，晚到快照不寫入新世代', async () => {
  let resolve;
  let started;
  const loading = new Promise(done => { started = done; });
  const f = await fixture(ja.find(item => item.mode === 'typing'), { practiceProvider: () => {
    started();
    return new Promise(done => { resolve = done; });
  } });
  const view = await f.service.today(settings);
  const preparing = f.service.prepare(view.plan.planId, view.next.entry.entryId, { expectedEpoch: view.dataEpoch });
  const rejected = assert.rejects(preparing, code('STALE_EPOCH'));
  await loading;
  await f.store.clearAll();
  resolve(ja);
  await rejected;
  assert.deepEqual(f.repository.all('dailyPlans'), {});
  assert.deepEqual(f.repository.all('sessions'), {});
});
