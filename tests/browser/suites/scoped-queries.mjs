import assert from 'node:assert/strict';

/**
 * 真 Chromium IndexedDB：驗證查詢邊界、同交易快照、失敗與 epoch；記憶體替身不作一致性證據。
 */
export async function run({ page }) {
  const bounded = await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    const repository = createWebRepository({ name: 'scoped-bounds' });
    await repository.migrateFromLegacy({ getItem: () => null });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('scoped-bounds', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['meta', 'progress', 'stats', 'itemStates', 'intents', 'dailyPlans', 'dailyLedger', 'sessions'], 'readwrite');
      const meta = tx.objectStore('meta').get('current');
      meta.onsuccess = () => tx.objectStore('meta').put({ ...meta.result, revision: meta.result.revision + 1 }, 'current');
      for (const lang of ['ja', 'en']) {
        for (const store of ['progress', 'intents', 'itemStates']) {
          tx.objectStore(store).put({ lang }, `${lang}-w-001${store === 'itemStates' ? ':meaning:target2zh' : ''}`);
        }
        tx.objectStore('stats').put({ answered: 1 }, `${lang}:words`);
        tx.objectStore('dailyPlans').put({ lang, sessionId: `${lang}-session` }, `${lang}-plan`);
        tx.objectStore('dailyLedger').put({ lang }, `2026-10-08:${lang}`);
        tx.objectStore('sessions').put({ lang, marker: 'before' }, `${lang}-session`);
      }
      tx.objectStore('dailyPlans').put({ lang: 'ja', sessionId: 'ja-session' }, 'ja-duplicate');
      tx.objectStore('dailyPlans').put({ lang: 'ja', sessionId: null }, 'ja-empty');
      tx.objectStore('dailyPlans').put({ lang: 'ja', sessionId: 'missing-session' }, 'ja-missing');
      tx.objectStore('dailyPlans').put({ lang: 'ja', sessionId: null }, '__proto__');
      tx.objectStore('progress').put({ n: 2 }, 'ja-\uffffsuffix');
      tx.objectStore('progress').put({ n: 3 }, 'ja.outside');
      for (let i = 0; i < 300; i++) tx.objectStore('sessions').put({ lang: i % 2 ? 'ja' : 'en',
        payload: 'x'.repeat(16 * 1024) }, `unrelated-${i}`);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const before = await repository.ready();
    const calls = [];
    const txIds = new Map();
    const originals = [];
    let writing;
    let injected = false;
    function wrap(proto, method, index = false) {
      const original = proto[method];
      originals.push(() => { proto[method] = original; });
      proto[method] = function (...args) {
        const objectStore = index ? this.objectStore : this;
        const tx = objectStore.transaction;
        if (!txIds.has(tx)) txIds.set(tx, txIds.size + 1);
        calls.push({ store: objectStore.name, index: index ? this.name : null, method, key: args[0],
          bounded: args[0] !== undefined && args[0] !== null, tx: txIds.get(tx), mode: tx.mode });
        const request = original.apply(this, args);
        if (index && objectStore.name === 'dailyPlans' && method === 'openCursor') {
          request.addEventListener('success', () => {
            if (injected || !request.result) return;
            injected = true;
            writing = new Promise((resolve, reject) => {
              const write = db.transaction(['meta', 'sessions'], 'readwrite');
              write.objectStore('sessions').put({ lang: 'ja', marker: 'after' }, 'ja-session');
              const get = write.objectStore('meta').get('current');
              get.onsuccess = () => write.objectStore('meta').put({ ...get.result, revision: get.result.revision + 1 }, 'current');
              write.oncomplete = resolve;
              write.onabort = () => reject(write.error);
            });
          });
        }
        return request;
      };
    }
    let snapshot;
    let queryCalls;
    try {
      for (const method of ['get', 'getAll', 'openCursor']) wrap(IDBObjectStore.prototype, method);
      for (const method of ['getAll', 'openCursor']) wrap(IDBIndex.prototype, method, true);
      const query = { stats: { prefix: 'ja:' }, progress: { prefix: 'ja-' }, itemStates: { prefix: 'ja-' },
        intents: { prefix: 'ja-' }, dailyPlans: { index: 'lang', key: 'ja' }, dailyLedger: { index: 'lang', key: 'ja' },
        sessions: { planRefs: 'dailyPlans' } };
      const pending = repository.querySnapshot(query);
      query.progress.prefix = 'en-';
      snapshot = await pending;
      queryCalls = calls.filter(call => call.mode === 'readonly');
      await writing;
    } finally { originals.reverse().forEach(restore => restore()); }
    const fresh = await repository.querySnapshot({ sessions: { key: 'ja-session' } });
    const errors = [];
    const invalid = [null, [], { progress: {} }, { progress: { prefix: '' } },
      { progress: { prefix: 'ja-', key: 'x' } }, { progress: { index: 'lang', key: 'ja' } },
      { dailyPlans: { index: 'lang', key: 'fr' } }, { sessions: { planRefs: 'dailyPlans' } },
      { stats: { key: NaN } }, { stats: { key: '__proto__' } }, { progress: { prefix: 'ja-', typo: 1 } },
      JSON.parse('{"__proto__":{"key":"x"}}'), Object.create({ progress: { prefix: 'ja-' } }),
      { progress: Object.create({ prefix: 'ja-' }) }];
    for (const query of invalid) {
      try { await repository.querySnapshot(query); errors.push('accepted'); }
      catch (error) { errors.push(error.code); }
    }
    const originalCursor = IDBObjectStore.prototype.openCursor;
    let queryError;
    try {
      IDBObjectStore.prototype.openCursor = function (...args) {
        if (this.name === 'progress') throw new DOMException('fixture', 'DataError');
        return originalCursor.apply(this, args);
      };
      await repository.querySnapshot({ progress: { prefix: 'ja-' } });
    } catch (error) { queryError = error.code; }
    finally { IDBObjectStore.prototype.openCursor = originalCursor; }
    const originalGet = IDBObjectStore.prototype.get;
    let aborted;
    try {
      IDBObjectStore.prototype.get = function (...args) {
        const request = originalGet.apply(this, args);
        if (this.name === 'sessions') request.addEventListener('success', () => this.transaction.abort());
        return request;
      };
      await repository.querySnapshot({ sessions: { key: 'ja-session' } });
    } catch (error) { aborted = error.code; }
    finally { IDBObjectStore.prototype.get = originalGet; }
    const old = await repository.querySnapshot({ progress: { prefix: 'ja-' } });
    await repository.clearLearning({ operationId: 'scoped-clear', epoch: old.meta.dataEpoch, expectedRevision: old.meta.revision });
    const cleared = await repository.querySnapshot({ progress: { prefix: 'ja-' }, dailyPlans: { index: 'lang', key: 'ja' },
      sessions: { planRefs: 'dailyPlans' } });
    let stale;
    try { await repository.commit({ operationId: 'scoped-stale', epoch: old.meta.dataEpoch,
      expectedRevision: old.meta.revision, payload: { changes: [{ store: 'progress', key: 'ja-w-001', value: {} }] } }); }
    catch (error) { stale = error.code; }
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ schemaVersion: 99 }, 'current');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    let invalidMeta;
    try { await repository.querySnapshot({ progress: { prefix: 'ja-' } }); }
    catch (error) { invalidMeta = error.code; }
    db.close(); repository.close();
    const prototypeSafe = Object.hasOwn(snapshot.rows.dailyPlans, '__proto__') &&
      Object.getPrototypeOf(snapshot.rows.dailyPlans) === Object.prototype;
    return { snapshot, before, fresh, calls: queryCalls, errors, queryError, aborted, cleared, stale, invalidMeta, prototypeSafe };
  });
  assert.equal(bounded.snapshot.meta.revision, bounded.before.revision);
  assert.equal(bounded.snapshot.rows.sessions['ja-session'].marker, 'before', '並行寫入不得混入 session refs');
  assert.equal(bounded.fresh.rows.sessions['ja-session'].marker, 'after');
  assert.equal(bounded.fresh.meta.revision, bounded.before.revision + 1);
  assert.deepEqual(Object.keys(bounded.snapshot.rows.sessions), ['ja-session'], '300 大型無關 sessions 均不讀回');
  assert.deepEqual(Object.keys(bounded.snapshot.rows.progress).sort(), ['ja-w-001', 'ja-\uffffsuffix']);
  assert.deepEqual(Object.keys(bounded.snapshot.rows.stats), ['ja:words']);
  assert.deepEqual(Object.keys(bounded.snapshot.rows.itemStates), ['ja-w-001:meaning:target2zh']);
  assert.deepEqual(Object.keys(bounded.snapshot.rows.intents), ['ja-w-001']);
  assert.deepEqual(Object.keys(bounded.snapshot.rows.dailyLedger), ['2026-10-08:ja']);
  assert.equal(bounded.prototypeSafe, true, '資料主鍵不能更換結果物件 prototype；在瀏覽器內核對 own key');
  assert.equal(new Set(bounded.calls.map(call => call.tx)).size, 1, 'meta/ranges/session get 都在同一 readonly tx');
  assert.ok(bounded.calls.every(call => call.bounded), '不得無範圍 getAll/openCursor');
  assert.deepEqual(bounded.calls.filter(call => call.store === 'sessions').map(call => [call.method, call.key]).sort(),
    [['get', 'ja-session'], ['get', 'missing-session']], '重複引用只 get 一次；缺列維持不存在');
  assert.ok(bounded.errors.every(code => code === 'INVALID_QUERY'));
  assert.equal(bounded.queryError, 'STORAGE_ABORTED');
  assert.equal(bounded.aborted, 'STORAGE_ABORTED', 'request success 不代表 tx complete');
  assert.notEqual(bounded.cleared.meta.dataEpoch, bounded.before.dataEpoch);
  assert.equal(bounded.cleared.meta.migrationStatus, 'cleared');
  assert.deepEqual(bounded.cleared.rows, { progress: {}, dailyPlans: {}, sessions: {} });
  assert.equal(bounded.stale, 'STALE_EPOCH');
  assert.equal(bounded.invalidMeta, 'UNSUPPORTED_SCHEMA');

  const consumers = await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    const { createLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { createDailyService } = await import('/assets/js/ui/platform/daily-service.js');
    const { words } = await import('/assets/js/data/ja/words.js');
    const repository = createWebRepository({ name: 'scoped-consumers' });
    let reads = 0;
    const store = createLearningStore({ repository, legacyStorage: { getItem(key) {
      reads++;
      return key.includes('stats') ? JSON.stringify({ schemaVersion: 1,
        byScope: { 'ja:words': { answered: 2, correct: 1, sessions: 1 }, 'en:words': { answered: 1, correct: 1, sessions: 1 } } }) : null;
    } } });
    const legacy = await store.legacyView('ja');
    let at = Date.UTC(2026, 9, 8, 1);
    const service = createDailyService({ store, lang: 'ja', words, now: () => at, rng: () => 0.42 });
    const settings = { level: 1, newLimit: 5, reviewLimit: 20 };
    const initial = await service.today(settings);
    await service.prepare(initial.plan.planId, initial.next.entry.entryId);
    const prepared = await service.preview(settings);
    const higher = await service.today({ ...settings, level: 2, newLimit: 1 });
    at += 86_400_000;
    const carried = await service.today(settings);
    const readAll = repository.readAll.bind(repository);
    const full = await readAll(['dailyPlans', 'dailyLedger', 'itemStates', 'intents', 'progress', 'sessions']);
    const referenceStore = { read: async () => full, querySnapshot: async () => full };
    const reference = await createDailyService({ store: referenceStore, lang: 'ja', words, now: () => at }).preview(settings);
    repository.readAll = async () => { throw new Error('unexpected readAll'); };
    const reopened = await service.today(settings);
    at -= 2 * 86_400_000;
    const rewind = await service.preview(settings);
    await store.clearAll();
    const empty = await store.legacyView('ja');
    repository.close();
    return { legacy, reads, prepared, higher, carried, reference, reopened, rewind, empty };
  });
  assert.equal(consumers.legacy.meta.migrationStatus, 'complete', 'bounded API 仍執行舊資料遷移');
  assert.deepEqual(Object.keys(consumers.legacy.stats.byScope), ['ja:words']);
  assert.equal(consumers.reads, 2, '首次遷移只讀兩個舊 key；清除後不再遷移');
  assert.ok(consumers.prepared.session);
  assert.equal(consumers.higher.plan.orderedEntries.length, 0);
  const { revision, ...carriedView } = consumers.carried;
  assert.ok(Number.isSafeInteger(revision));
  assert.deepEqual(carriedView, consumers.reference, 'bounded 預覽等同完整快照的 core 輸出');
  assert.equal(consumers.carried.next.entry.entryId, consumers.prepared.next.entry.entryId);
  assert.deepEqual(consumers.reopened.plan, consumers.carried.plan);
  assert.equal(consumers.rewind.plan.localDate, consumers.carried.plan.localDate);
  assert.deepEqual(consumers.empty.stats.byScope, {});

  const epochRace = await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    const { createLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const repository = createWebRepository({ name: 'scoped-epoch-retry' });
    const store = createLearningStore({ repository, legacyStorage: { getItem: () => null } });
    await store.ready();
    const querySnapshot = repository.querySnapshot.bind(repository);
    const commit = repository.commit.bind(repository);
    let reads = 0;
    let writes = 0;
    repository.querySnapshot = async query => {
      if (++reads === 2) {
        const meta = await repository.ready();
        await repository.clearLearning({ operationId: 'clear-between-retries', epoch: meta.dataEpoch, expectedRevision: meta.revision });
      }
      return querySnapshot(query);
    };
    repository.commit = async (operation, options) => {
      if (++writes === 1) {
        const meta = await repository.ready();
        await commit({ operationId: 'concurrent-write', epoch: meta.dataEpoch, expectedRevision: meta.revision,
          payload: { changes: [{ store: 'stats', key: 'en:words', value: { answered: 1, correct: 1, sessions: 1 } }] } });
      }
      return commit(operation, options);
    };
    let code;
    try {
      await store.commit({ query: { stats: { prefix: 'ja:' } }, operationId: 'before-clear-retry',
        build: () => [{ store: 'stats', key: 'ja:words', value: { answered: 1, correct: 1, sessions: 1 } }] });
    } catch (error) { code = error.code; }
    const snapshot = await querySnapshot({ stats: { prefix: 'ja:' } });
    repository.close();
    return { code, writes, rows: snapshot.rows, meta: snapshot.meta };
  });
  assert.equal(epochRace.code, 'STALE_EPOCH');
  assert.equal(epochRace.writes, 1);
  assert.deepEqual(epochRace.rows.stats, {});
  assert.equal(epochRace.meta.migrationStatus, 'cleared');
}
