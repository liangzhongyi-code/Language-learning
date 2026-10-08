import test from 'node:test';
import assert from 'node:assert/strict';
import { weakest, dueIds, progressOfLang } from '../assets/js/core/progress.js';
import { initializeItemState } from '../assets/js/core/scheduler.js';
import { scheduleFsrs } from '../assets/js/core/fsrs-adapter.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';

const T0 = Date.UTC(2026, 9, 7, 1);
const DAY = 86_400_000;
const record = (box, due = T0 + 30 * DAY) => ({ n: 10, w: 2, box, last: T0 - DAY, due });
const progressOf = (items) => ({ schemaVersion: 1, items });
const statesOf = (...states) => Object.fromEntries(states.map((state) => [state.skillKey, state]));

function stateOf(sourceId, { ability = 'recognition', direction = 'target2zh',
  learningStatus = 'review', due = T0 + DAY, schedulerName = 'fsrs' } = {}) {
  const initial = initializeItemState({ sourceId, ability, direction, initialization: { kind: 'new' } });
  const scheduled = schedulerName === 'fsrs'
    ? { ...initial, ...scheduleFsrs({ previousState: initial, rating: 'Again', at: T0 }) }
    : initial;
  return { ...scheduled, learningStatus, due };
}

async function project(progress, itemStates) {
  const { projectLearningProgress } = await import('../assets/js/core/learning-progress.js');
  return projectLearningProgress({ progress, itemStates });
}

function freezeDeep(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeDeep(child);
  return Object.freeze(value);
}

test('舊 box 4 答錯後的 FSRS learning 重新進入 weak；首頁與 quiz 相同', async () => {
  const progress = progressOf({ 'ja-w-001': record(4) });
  const states = statesOf(stateOf('ja-w-001', { learningStatus: 'learning', due: T0 }));
  const view = await project(progress, states);
  assert.equal(view.items['ja-w-001'].box, 1);
  assert.deepEqual(weakest(view, { lang: 'ja' }), ['ja-w-001']);
  assert.deepEqual(dueIds(view, 'ja', T0), ['ja-w-001']);
  assert.deepEqual(progressOfLang(view, 'ja', T0), { tracked: 1, weak: 1, due: 1 });
});

test('舊 box 1 的全部 FSRS 能力 mastered 畢業，due 仍按排程判斷', async () => {
  const progress = progressOf({ 'ja-w-001': record(1) });
  const states = statesOf(
    stateOf('ja-w-001', { learningStatus: 'mastered', due: T0 + DAY }),
    stateOf('ja-w-001', { ability: 'production', direction: 'zh2target', learningStatus: 'mastered', due: T0 }),
  );
  const view = await project(progress, states);
  assert.equal(view.items['ja-w-001'].box, 4);
  assert.deepEqual(weakest(view, { lang: 'ja' }), []);
  assert.deepEqual(dueIds(view, 'ja', T0), ['ja-w-001']);
  assert.deepEqual(progressOfLang(view, 'ja', T0), { tracked: 1, weak: 0, due: 1 });
});

test('mixed 能力及方向取同 source 全部狀態最早 due，其他來源不干擾', async () => {
  const progress = progressOf({ 'ja-w-001': record(4), 'en-w-001': record(1) });
  const states = statesOf(
    stateOf('ja-w-001', { learningStatus: 'mastered', due: T0 + 10 * DAY }),
    stateOf('ja-w-001', { direction: 'zh2target', learningStatus: 'review', due: T0 + 2 * DAY }),
    stateOf('ja-w-001', { ability: 'listening-recognition', due: T0 - DAY }),
    stateOf('en-w-001', { learningStatus: 'mastered', due: T0 - 5 * DAY }),
  );
  const view = await project(progress, states);
  assert.equal(view.items['ja-w-001'].box, 1);
  assert.equal(view.items['ja-w-001'].due, T0 - DAY);
  assert.equal(view.items['en-w-001'].box, 4);
  assert.equal(view.items['en-w-001'].due, T0 - 5 * DAY);
});

test('有 FSRS 的來源也包含尚未轉換的能力；所有 learningStatus 才能決定畢業', async () => {
  for (const learningStatus of ['introduced', 'learning', 'review', 'mastered']) {
    const progress = progressOf({ 'ja-w-001': record(4) });
    const states = statesOf(
      stateOf('ja-w-001', { learningStatus: 'mastered', due: T0 + DAY }),
      stateOf('ja-w-001', { ability: 'production', schedulerName: 'leitner', learningStatus, due: 0 }),
    );
    const view = await project(progress, states);
    assert.equal(view.items['ja-w-001'].box, learningStatus === 'mastered' ? 4 : 1, learningStatus);
    assert.equal(view.items['ja-w-001'].due, 0, '最早 due 包含非 FSRS 能力與 0');
  }
});

test('無 FSRS source 保持原 progress 完全一致，包含缺 box／due 的舊資料', async () => {
  const progress = progressOf({ 'ja-w-001': record(4), 'ja-w-002': { n: 1, w: 1 }, 'en-w-001': record(1) });
  const states = statesOf(
    stateOf('ja-w-001', { schedulerName: 'leitner', learningStatus: 'learning', due: 0 }),
    stateOf('en-w-001', { schedulerName: 'leitner', learningStatus: 'mastered', due: 0 }),
    stateOf('ja-w-orphan', { learningStatus: 'mastered', due: 0 }),
  );
  const view = await project(progress, states);
  assert.deepEqual(view, progress);
  assert.deepEqual(await project(progress), progress);
  assert.deepEqual(await project(progressOf({}), states), progressOf({}));
  assert.deepEqual(weakest(view, { lang: 'ja' }), weakest(progress, { lang: 'ja' }));
  assert.deepEqual(dueIds(view, 'ja', T0), dueIds(progress, 'ja', T0));
});

test('投影是純函式：凍結的輸入不 mutate，n／w／last 與 schemaVersion 原樣保留', async () => {
  const progress = freezeDeep(progressOf({ 'ja-w-001': record(4) }));
  const states = freezeDeep(statesOf(stateOf('ja-w-001', { learningStatus: 'learning', due: T0 })));
  const before = structuredClone({ progress, states });
  const view = await project(progress, states);
  assert.deepEqual({ progress, states }, before);
  assert.deepEqual(view, progressOf({ 'ja-w-001': { ...record(4), box: 1, due: T0 } }));
  assert.notEqual(view, progress);
  assert.notEqual(view.items, progress.items);
  assert.notEqual(view.items['ja-w-001'], progress.items['ja-w-001']);
  assert.deepEqual(await project(progress, states), view);
});

async function seededStore() {
  const repository = createMemoryRepository({ now: () => T0 });
  const store = createLearningStore({ repository, now: () => T0 });
  const progress = { 'ja-w-001': record(4), 'ja-w-002': record(1), 'ja-w-003': record(5) };
  const itemStates = statesOf(
    stateOf('ja-w-001', { learningStatus: 'learning', due: T0 }),
    stateOf('ja-w-002', { learningStatus: 'mastered', due: T0 + DAY }),
  );
  const stats = { 'ja:words': { answered: 30, correct: 24, sessions: 3 } };
  await store.commit({ stores: ['progress', 'stats', 'itemStates'], operationId: 'scope-fixture',
    build: () => Object.entries({ progress, stats, itemStates }).flatMap(([collection, rows]) =>
      Object.entries(rows).map(([key, value]) => ({ store: collection, key, value }))),
  });
  return { store, repository, progress, stats, itemStates };
}

test('實際 learning store 的 legacyView 共用投影；原 repository 與 export 保留原 box／n／w／due', async () => {
  const { store, repository, progress, stats, itemStates } = await seededStore();
  const meta = await store.ready();
  const commits = [...repository.commits];
  const view = await store.legacyView();
  assert.equal(view.progress.items['ja-w-001'].box, 1);
  assert.equal(view.progress.items['ja-w-002'].box, 4);
  assert.deepEqual(view.progress.items['ja-w-003'], progress['ja-w-003']);
  assert.deepEqual(weakest(view.progress, { lang: 'ja' }), ['ja-w-001']);
  assert.deepEqual(dueIds(view.progress, 'ja', T0), ['ja-w-001']);
  assert.deepEqual(progressOfLang(view.progress, 'ja', T0), { tracked: 3, weak: 1, due: 1 });
  assert.deepEqual(view.stats, { schemaVersion: 1, byScope: stats });
  assert.deepEqual(view.meta, meta);
  assert.deepEqual((await store.read(['progress'])).rows.progress, progress);
  const backup = await store.exportBackup();
  assert.deepEqual(backup.progress, progressOf(progress));
  assert.deepEqual(backup.learning.itemStates, itemStates);
  assert.equal(backup.version, 2);
  assert.equal(backup.learning.schemaVersion, 2);
  assert.deepEqual(repository.all('progress'), progress);
  assert.deepEqual(await store.ready(), meta);
  assert.deepEqual(repository.commits, commits, '視圖與匯出沒有額外提交');
});

test('legacyView 每次只讀 scope 所需的三集合一致快照，不讀事件或逐 source 查詢', async () => {
  const { store, repository } = await seededStore();
  const reads = [];
  const readAll = repository.readAll.bind(repository);
  repository.readAll = (stores) => { reads.push(stores); return readAll(stores); };
  repository.getAllByIndex = () => { assert.fail('scope view 不應逐 source 查詢'); };
  await store.legacyView();
  assert.deepEqual(reads, [['stats', 'progress', 'itemStates']]);
});
