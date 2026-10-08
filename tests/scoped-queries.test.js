import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createDailyService } from '../assets/js/ui/platform/daily-service.js';
import { words } from '../assets/js/data/ja/words.js';

const settings = { level: 1, newLimit: 5, reviewLimit: 20 };
const dailyQuery = lang => ({
  dailyPlans: { index: 'lang', key: lang }, dailyLedger: { index: 'lang', key: lang },
  progress: { prefix: `${lang}-` }, itemStates: { prefix: `${lang}-` },
  intents: { prefix: `${lang}-` }, sessions: { planRefs: 'dailyPlans' },
});

async function seed(repository, changes) {
  const meta = await repository.ready();
  await repository.commit({ operationId: `seed-${meta.revision}`, epoch: meta.dataEpoch,
    expectedRevision: meta.revision, payload: { changes } });
}

test('querySnapshot：本語言 bounded prefix/index 與去重 plan session refs', async () => {
  const repository = createMemoryRepository();
  await seed(repository, [
    ...['ja', 'en'].flatMap(lang => [
      { store: 'progress', key: `${lang}-w-001`, value: { n: 1, c: 1, box: 1, due: 0, last: 1 } },
      { store: 'itemStates', key: `${lang}-w-001:meaning:target2zh`, value: { sourceId: `${lang}-w-001` } },
      { store: 'intents', key: `${lang}-w-001`, value: { sourceId: `${lang}-w-001` } },
      { store: 'dailyLedger', key: `2026-10-08:${lang}`, value: { lang } },
      { store: 'dailyPlans', key: `${lang}-plan`, value: { lang, sessionId: `${lang}-session` } },
      { store: 'sessions', key: `${lang}-session`, value: { lang } },
    ]),
    { store: 'dailyPlans', key: 'ja-plan-again', value: { lang: 'ja', sessionId: 'ja-session' } },
    { store: 'dailyPlans', key: 'ja-plan-empty', value: { lang: 'ja', sessionId: null } },
    { store: 'sessions', key: 'ja-unrelated', value: { lang: 'ja', payload: 'unrelated' } },
    { store: 'progress', key: 'ja-other', value: { n: 2 } },
    { store: 'progress', key: 'ja-\uffffsuffix', value: { n: 3 } },
    { store: 'progress', key: 'ja.outside', value: { n: 4 } },
  ]);
  const { meta, rows } = await repository.querySnapshot(dailyQuery('ja'));
  assert.equal(meta.revision, 1);
  assert.deepEqual(Object.keys(rows.dailyPlans).sort(), ['ja-plan', 'ja-plan-again', 'ja-plan-empty']);
  assert.deepEqual(Object.keys(rows.sessions), ['ja-session']);
  assert.deepEqual(Object.keys(rows.progress).sort(), ['ja-other', 'ja-w-001', 'ja-\uffffsuffix']);
  assert.deepEqual(Object.keys(rows.dailyLedger), ['2026-10-08:ja']);
  assert.deepEqual(Object.keys(rows.intents), ['ja-w-001']);
  assert.deepEqual(Object.keys(rows.itemStates), ['ja-w-001:meaning:target2zh']);
  const exact = await repository.querySnapshot({ progress: { key: 'en-w-001' }, stats: { key: 'missing' } });
  assert.deepEqual(Object.keys(exact.rows.progress), ['en-w-001']);
  assert.deepEqual(exact.rows.stats, {});
  assert.deepEqual((await repository.querySnapshot({})).rows, {});
});

test('querySnapshot：拒絕非法 selector、prototype 與不合法 refs', async () => {
  const repository = createMemoryRepository();
  const invalid = [null, [], { meta: { key: 'current' } }, { progress: {} },
    { progress: { prefix: '' } }, { progress: { prefix: 'ja' } },
    { progress: { prefix: 'ja-', key: 'ja-w-001' } },
    { progress: { index: 'lang', key: 'ja' } }, { dailyPlans: { index: 'lang' } },
    { dailyPlans: { index: 'lang', key: 'fr' } }, { stats: { key: NaN } },
    { stats: { key: [] } }, { stats: { key: '__proto__' } },
    { sessions: { planRefs: 'dailyPlans' } },
    { sessions: { planRefs: 'progress' }, progress: { prefix: 'ja-' } },
    { dailyPlans: { key: 'ja-plan' }, sessions: { planRefs: 'dailyPlans' } },
    JSON.parse('{"__proto__":{"key":"bad"}}'),
    Object.create({ progress: { prefix: 'ja-' } }),
    { progress: Object.create({ prefix: 'ja-' }) },
    { progress: { prefix: 'ja-', extra: true } },
    { [Symbol('hidden')]: { key: 'x' } },
  ];
  let invoked = false;
  invalid.push({ get progress() { invoked = true; return { prefix: 'ja-' }; } });
  invalid.push({ progress: { get prefix() { invoked = true; return 'ja-'; } } });
  for (const query of invalid) {
    await assert.rejects(repository.querySnapshot(query), error => error.code === 'INVALID_QUERY');
  }
  assert.equal(invoked, false, '不執行 accessor');
  assert.equal((await repository.ready()).revision, 0);
});

test('legacyView(lang)：走 bounded 三集合，無參數保留相容讀取', async () => {
  const repository = createMemoryRepository();
  await seed(repository, ['ja', 'en'].flatMap(lang => [
    { store: 'progress', key: `${lang}-w-001`, value: { n: 1, c: 1, box: 1, due: 0, last: 1 } },
    { store: 'stats', key: `${lang}:words`, value: { answered: 1, correct: 1, sessions: 1 } },
  ]));
  const calls = [];
  const original = repository.querySnapshot?.bind(repository);
  repository.querySnapshot = query => { calls.push(query); return original(query); };
  const store = createLearningStore({ repository });
  const scoped = await store.legacyView('ja');
  assert.deepEqual(Object.keys(scoped.progress.items), ['ja-w-001']);
  assert.deepEqual(Object.keys(scoped.stats.byScope), ['ja:words']);
  assert.deepEqual(calls, [{ stats: { prefix: 'ja:' }, progress: { prefix: 'ja-' }, itemStates: { prefix: 'ja-' } }]);
  const all = await store.legacyView();
  assert.equal(Object.keys(all.progress.items).length, 2);
  assert.equal(calls.length, 1);
  await assert.rejects(store.legacyView('fr'), error => error.code === 'INVALID_QUERY');
});

test('store.querySnapshot：保留 migration ready 屏障與清除 epoch', async () => {
  const repository = createMemoryRepository();
  const originalReady = repository.ready.bind(repository);
  let migrated = false;
  repository.ready = async () => ({ ...await originalReady(), migrationStatus: migrated ? 'complete' : 'pending' });
  repository.migrateFromLegacy = async () => { migrated = true; return repository.ready(); };
  const query = repository.querySnapshot?.bind(repository);
  repository.querySnapshot = selectors => { assert.equal(migrated, true); return query(selectors); };
  const store = createLearningStore({ repository });
  const before = await store.querySnapshot({ progress: { prefix: 'ja-' } });
  await store.clearAll();
  const after = await store.querySnapshot({ progress: { prefix: 'ja-' } });
  assert.notEqual(after.meta.dataEpoch, before.meta.dataEpoch);
  assert.equal(after.meta.revision, before.meta.revision + 1);
  assert.deepEqual(after.rows.progress, {});
});

test('daily preview/today：不走 readAll、保留跨日 carry/跨級共用 ledger/時鐘倒退', async () => {
  let at = Date.UTC(2026, 9, 8, 1);
  const repository = createMemoryRepository({ now: () => at });
  const store = createLearningStore({ repository, now: () => at });
  const service = createDailyService({ store, lang: 'ja', words, now: () => at, rng: () => 0.42 });
  repository.readAll = async () => { throw new Error('不應全掃'); };
  const initial = await service.today(settings);
  await service.prepare(initial.plan.planId, initial.next.entry.entryId);
  const prepared = await service.preview(settings);
  assert.ok(prepared.session);
  const higher = await service.today({ ...settings, level: 2, newLimit: 1 });
  assert.equal(higher.plan.orderedEntries.length, 0, '另一級共享已用額度');
  at += 86_400_000;
  const carried = await service.today(settings);
  assert.equal(carried.next.entry.entryId, prepared.next.entry.entryId);
  assert.equal(carried.next.entry.kind, 'review');
  assert.deepEqual(carried.next.entry.questionSnapshot, prepared.next.entry.questionSnapshot);
  at -= 2 * 86_400_000;
  const rewind = await service.preview(settings);
  assert.equal(rewind.plan.localDate, carried.plan.localDate);
});

test('scoped commit：revision conflict 重讀；epoch 改變不得重試舊意圖', async () => {
  const repository = createMemoryRepository();
  const store = createLearningStore({ repository });
  const commit = repository.commit.bind(repository);
  let injected = false;
  repository.commit = async (op, options) => {
    if (!injected) {
      injected = true;
      await seed({ ready: repository.ready, commit }, [{ store: 'stats', key: 'ja:words', value: 3 }]);
    }
    return commit(op, options);
  };
  let builds = 0;
  await store.commit({ query: { stats: { prefix: 'ja:' } }, operationId: 'scoped-conflict',
    build(rows) { builds++; return [{ store: 'stats', key: 'ja:words', value: (rows.stats['ja:words'] ?? 0) + 1 }]; } });
  assert.equal(builds, 2);
  assert.equal(repository.peek('stats', 'ja:words'), 4);
  repository.commit = async (op, options) => {
    const meta = await repository.ready();
    await repository.clearLearning({ operationId: 'clear-race', epoch: meta.dataEpoch, expectedRevision: meta.revision });
    return commit(op, options);
  };
  await assert.rejects(store.commit({ query: { stats: { prefix: 'ja:' } }, operationId: 'stale-scoped',
    build: () => [{ store: 'stats', key: 'ja:words', value: 9 }] }), error => error.code === 'STALE_EPOCH');
  assert.equal(repository.peek('stats', 'ja:words'), undefined);
});

test('scoped commit：衝突後重讀已換 epoch，不能把舊操作寫入清除後資料', async () => {
  const repository = createMemoryRepository();
  const store = createLearningStore({ repository });
  const querySnapshot = repository.querySnapshot.bind(repository);
  let reads = 0;
  repository.querySnapshot = async query => {
    if (++reads === 2) {
      const meta = await repository.ready();
      await repository.clearLearning({ operationId: 'clear-between-retries', epoch: meta.dataEpoch, expectedRevision: meta.revision });
    }
    return querySnapshot(query);
  };
  const commit = repository.commit.bind(repository);
  let writes = 0;
  repository.commit = async (op, options) => {
    if (++writes === 1) await seed({ ready: repository.ready, commit }, [{ store: 'stats', key: 'en:words', value: 1 }]);
    return commit(op, options);
  };
  await assert.rejects(store.commit({ query: { stats: { prefix: 'ja:' } }, operationId: 'before-clear-retry',
    build: () => [{ store: 'stats', key: 'ja:words', value: 9 }] }), error => error.code === 'STALE_EPOCH');
  assert.equal(writes, 1);
  assert.equal(repository.peek('stats', 'ja:words'), undefined);
});
