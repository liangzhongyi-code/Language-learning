import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createNativeRepository, nativeInvoke } from '../assets/js/ui/platform/native-repository.js';
import { canonicalJson } from '../assets/js/core/learning-operations.js';
import { emptyLearning } from '../assets/js/core/learning-schema.js';

const META = { schemaVersion: 2, revision: 3, dataEpoch: 'epochA', migrationStatus: 'complete',
  historyStartedAt: 1000, schedulerPolicyVersion: 1, timeZone: 'Asia/Taipei' };

/**
 * 只記錄送往 Rust 的命令與參數；交易規則本身由 cargo test 與實機驗證。
 */
function fake(responses = {}) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === 'storage_open') return META;
    if (command === 'storage_get' && args.store === 'meta') return META;
    const handler = responses[command];
    if (handler instanceof Error || (handler && handler.code && !handler.call)) throw handler;
    return typeof handler === 'function' ? handler(args) : handler ?? null;
  };
  const repo = createNativeRepository({ invoke, crypto: webcrypto, now: () => 5000, indexedDB: undefined });
  return { repo, calls, last: (name) => calls.filter((call) => call.command === name).pop() };
}

test('S04：只有提供 Tauri 原生命令時才使用原生 repository', () => {
  assert.equal(nativeInvoke({}), null);
  assert.equal(nativeInvoke({ __TAURI__: { core: {} } }), null);
  const invoke = () => {};
  assert.equal(nativeInvoke({ __TAURI__: { core: { invoke } } }), invoke);
  assert.throws(() => createNativeRepository({ invoke: null }), (error) => error.code === 'STORAGE_UNAVAILABLE');
});

test('S05：commit 送出與網站相同的 canonical payload，由 Rust 計算雜湊', async () => {
  const { repo, last } = fake({ storage_commit: { revision: 4 } });
  const changes = [{ store: 'stats', key: 'ja:daily', value: { correct: 1, answered: 1, sessions: 0 } }];
  const result = await repo.commit({ operationId: 'op1', epoch: 'epochA', expectedRevision: 3, payload: { changes } });
  assert.deepEqual(result, { revision: 4 });
  const call = last('storage_commit');
  assert.deepEqual(call.args.operation, { operationId: 'op1', epoch: 'epochA', expectedRevision: 3 });
  assert.equal(call.args.payload, canonicalJson({ changes }));
  assert.equal(call.args.large, false);
});

test('S20：不合法的集合、key 或空變更在送出前就拒絕', async () => {
  const { repo, calls } = fake();
  for (const changes of [[], [{ store: 'operations', key: 'x', value: 1 }], [{ store: 'stats', key: '__proto__', value: 1 }],
    [{ store: 'stats', key: 'k' }]]) {
    await assert.rejects(repo.commit({ operationId: 'op', epoch: 'epochA', expectedRevision: 3, payload: { changes } }),
      (error) => error.code === 'INVALID_OPERATION');
  }
  assert.equal(calls.filter((call) => call.command === 'storage_commit').length, 0);
  await assert.rejects(repo.get('nope', 'x'), (error) => error.code === 'INVALID_STORE');
});

test('S06：Rust 端錯誤保留 code；非結構化錯誤轉為可重試的保存失敗', async () => {
  const conflict = { code: 'REVISION_CONFLICT', message: '其他頁面已更新紀錄' };
  const { repo } = fake({ storage_commit: conflict });
  await assert.rejects(repo.commit({ operationId: 'op', epoch: 'epochA', expectedRevision: 3,
    payload: { changes: [{ store: 'stats', key: 'k', value: {} }] } }), (error) => error.code === 'REVISION_CONFLICT');
  const broken = fake({ storage_read_all: () => { throw 'ipc closed'; } });
  await assert.rejects(broken.repo.readAll(['stats']), (error) => error.code === 'STORAGE_ABORTED');
});

test('O18：清除送出合法空資料（固定收藏簿、成就政策、提醒預設）與新 epoch', async () => {
  const { repo, last } = fake({ storage_clear: { revision: 4 } });
  await repo.clearLearning({ operationId: 'clear1', epoch: 'epochA', expectedRevision: 3 });
  const { args } = last('storage_clear');
  const empty = emptyLearning({ now: 5000, timeZone: 'Asia/Taipei', dataEpoch: args.freshEpoch });
  assert.match(args.freshEpoch, /^[0-9a-f]{32}$/);
  assert.notEqual(args.freshEpoch, 'epochA');
  assert.deepEqual(args.fresh.books.favorites, empty.library.books.favorites);
  assert.deepEqual(args.fresh.achievements.policy, { policyVersion: 1 });
  assert.deepEqual(args.fresh.reminders.preferences, empty.reminderPreferences);
  assert.equal(args.payload, canonicalJson({ kind: 'clear-learning' }));
});

test('O17：原生還原點以網站相同的可攜格式呈現，回到還原點時先驗證再整組替換', async () => {
  const learning = emptyLearning({ now: 1000, timeZone: 'Asia/Taipei', dataEpoch: 'epochA' });
  learning.meta.migrationStatus = 'complete';
  const point = { createdAt: 2000, reason: 'restore', format: 'native-rows-1', meta: learning.meta,
    rows: { progress: { 'ja-w-001': { n: 2, w: 1 } }, books: { favorites: learning.library.books.favorites },
      achievements: { policy: { policyVersion: 1 } }, reminders: { preferences: learning.reminderPreferences } } };
  const { repo, last } = fake({
    storage_list: [{ key: 'rp:1', value: point, indexKey: 'rp:1', continuation: {} }],
    storage_get: () => point,
    storage_restore: { revision: 4, dataEpoch: 'epochB', restorePointKey: 'rp:2' },
  });
  const [listed] = await repo.list('restorePoints', { limit: 10 });
  assert.deepEqual(listed.value.data.progress.items, { 'ja-w-001': { n: 2, w: 1 } });
  assert.equal(listed.value.createdAt, 2000);
  await repo.restoreLearning({ operationId: 'revert1', epoch: 'epochA', expectedRevision: 3, payload: { restorePointKey: 'rp:1' } },
    { reason: 'before-revert' });
  const { args } = last('storage_restore');
  assert.equal(args.input.consumePoint, 'rp:1');
  assert.equal(args.input.reason, 'before-revert');
  assert.deepEqual(args.input.rows.progress, { 'ja-w-001': { n: 2, w: 1 } });
  assert.match(args.input.pointKey, /^rp:0{12}5000:[0-9a-f]{8}$/);
  const broken = fake({ storage_get: () => ({ ...point, rows: { progress: { 'ja-w-001': { n: 1, w: 5 } } } }) });
  await assert.rejects(broken.repo.restoreLearning({ operationId: 'revert2', epoch: 'epochA', expectedRevision: 3,
    payload: { restorePointKey: 'rp:1' } }));
  assert.equal(broken.calls.some((call) => call.command === 'storage_restore'), false, '壞還原點不送出替換');
});

test('D18：沒有舊版 APP 資料時，以網站舊 localStorage 摘要遷移並保留原來源', async () => {
  const pending = { ...META, revision: 0, migrationStatus: 'pending' };
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === 'storage_open' || (command === 'storage_get' && args.store === 'meta')) return pending;
    if (command === 'storage_migrate') return { ...pending, revision: 1, migrationStatus: 'complete' };
    return null;
  };
  const repo = createNativeRepository({ invoke, crypto: webcrypto, now: () => 5000, indexedDB: undefined });
  const legacy = { getItem: (key) => (key === 'lang-learn.progress.v1'
    ? JSON.stringify({ schemaVersion: 1, items: { 'en-w-001': { n: 3, w: 1, box: 2, last: 1, due: 2 } } }) : null) };
  const result = await repo.migrateFromLegacy(legacy);
  assert.equal(result.migrationStatus, 'complete');
  const migrate = calls.find((call) => call.command === 'storage_migrate').args;
  assert.equal(migrate.expectedEpoch, 'epochA');
  assert.deepEqual(migrate.rows.progress, { 'en-w-001': { n: 3, w: 1, box: 2, last: 1, due: 2 } });
  assert.ok(migrate.rows.books.favorites);
});
