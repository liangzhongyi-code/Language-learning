/**
 * Node 測試用的記憶體 repository：介面與 web-repository 相同，交易守衛共用
 * learning-operations，讓服務層的競態、重送與 epoch 規則能在 Node 驗證。
 * 不能取代真 IndexedDB 測試；瀏覽器行為另由 tests/browser 負責。
 */
import { createHash } from 'node:crypto';
import { canonicalJson, checkOperation, operationReceipt } from '../../assets/js/core/learning-operations.js';
import { emptyLearning } from '../../assets/js/core/learning-schema.js';

const COLLECTIONS = ['stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger',
  'sessions', 'operations', 'restorePoints', 'books', 'notes', 'intents', 'achievements', 'reminders', 'outbox'];
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const tick = () => new Promise((resolve) => setImmediate(resolve));

export function createMemoryRepository({ timeZone = 'Asia/Taipei', now = () => 1_791_158_400_000, failCommit } = {}) {
  let counter = 0;
  const epoch = () => `epoch${(++counter).toString(16).padStart(8, '0')}`;
  const data = Object.fromEntries(COLLECTIONS.map((name) => [name, new Map()]));
  let meta = { schemaVersion: 2, revision: 0, dataEpoch: epoch(), migrationStatus: 'complete',
    historyStartedAt: now(), schedulerPolicyVersion: 1, timeZone };
  const empty = emptyLearning({ now: now(), timeZone });
  data.books.set('favorites', empty.library.books.favorites);
  data.achievements.set('policy', { policyVersion: 1 });
  data.reminders.set('preferences', empty.reminderPreferences);
  const commits = [];

  const repo = {
    commits,
    async ready() { await tick(); return clone(meta); },
    async get(store, key) { await tick(); return clone(data[store].get(key)); },
    async list(store, { limit = 100 } = {}) {
      await tick();
      return [...data[store].entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit)
        .map(([key, value]) => ({ key, value: clone(value) }));
    },
    async readAll(stores) {
      await tick();
      return { meta: clone(meta), rows: Object.fromEntries(stores.map((store) => [store, Object.fromEntries(clone([...data[store].entries()]))])) };
    },
    async getAllByIndex(store, index, key) {
      await tick();
      return Object.fromEntries([...data[store].entries()].filter(([, value]) => value?.[index] === key).map(([k, v]) => [k, clone(v)]));
    },
    async migrateFromLegacy() { return clone(meta); },
    async commit(input, { large = false } = {}) {
      const maxBytes = large ? 24 * 1024 * 1024 : 1024 * 1024;
      const operation = JSON.parse(canonicalJson(input, { maxBytes }));
      const payloadHash = createHash('sha256').update(canonicalJson(operation.payload, { maxBytes })).digest('hex');
      await tick();
      const receiptKey = `${operation.epoch}:${operation.operationId}`;
      const decision = checkOperation({ meta, operation, payloadHash, receipt: data.operations.get(receiptKey) });
      if (decision.replay) return decision.result;
      if (failCommit?.(operation)) {
        const error = new Error('fixture abort');
        error.code = 'STORAGE_ABORTED';
        throw error;
      }
      const next = { ...meta, revision: meta.revision + 1 };
      for (const change of operation.payload.changes) {
        if (change.delete) data[change.store].delete(change.key);
        else data[change.store].set(change.key, clone(change.value));
      }
      const receipt = operationReceipt(operation, payloadHash, next.revision);
      data.operations.set(receiptKey, receipt);
      meta = next;
      commits.push(operation.operationId);
      return receipt.result;
    },
    async clearLearning(input) {
      const operation = JSON.parse(canonicalJson(input));
      checkOperation({ meta, operation, payloadHash: 'f'.repeat(64) });
      for (const store of COLLECTIONS) data[store].clear();
      meta = { ...meta, revision: meta.revision + 1, dataEpoch: epoch(), migrationStatus: 'cleared' };
      return { revision: meta.revision };
    },
    peek(store, key) { return clone(data[store].get(key)); },
    all(store) { return Object.fromEntries(clone([...data[store].entries()])); },
  };
  return repo;
}
