import assert from 'node:assert/strict';

/**
 * 用真正 IndexedDB 與兩個頁面驗證交易，資料僅存在隔離 context 的 fixture DB。
 */
async function legacyTransactions({ page, context, origin }) {
  await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    window.makeFixtureRepo = (options = {}) => createWebRepository({
      name: 'fixture-repository', now: () => 1750000000000, timeZone: 'Asia/Taipei', ...options,
    });
    window.repo = window.makeFixtureRepo();
  });
  const first = await page.evaluate(() => window.repo.ready());
  assert.equal(first.revision, 0, 'F03/D18 初次版本');
  assert.equal(first.schemaVersion, 2, 'F03/D18 真實儲存格式');
  assert.equal(first.migrationStatus, 'pending');
  const command = {
    operationId: 'fixture-1', epoch: first.dataEpoch, expectedRevision: first.revision,
    payload: { changes: [
      { store: 'progress', key: 'ja-w-001', value: { n: 1, w: 0, box: 1, last: 1750000000000, due: 1750086400000 } },
      { store: 'stats', key: 'ja:words', value: { sessions: 0, total: 1, correct: 1 } },
    ] },
  };
  const committed = await page.evaluate((operation) => window.repo.commit(operation), command);
  assert.equal(committed.revision, 1, 'F03/D12 成功後才增加版本');
  assert.equal((await page.evaluate(() => window.repo.get('progress', 'ja-w-001'))).n, 1);

  const replay = await page.evaluate((operation) => window.repo.commit(operation), command);
  assert.deepEqual(replay, committed, 'F03/D12 回應遺失重送不可重複寫入');
  const changed = structuredClone(command);
  changed.payload.changes[0].value.n = 2;
  assert.equal(await page.evaluate(async (operation) => {
    try { await window.repo.commit(operation); } catch (error) { return error.code; }
  }, changed), 'OPERATION_MISMATCH');

  const page2 = await context.newPage();
  await page2.goto(origin + '/__harness__');
  await page2.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    window.repo2 = createWebRepository({ name: 'fixture-repository', timeZone: 'Asia/Taipei' });
    await window.repo2.ready();
  });
  const stale = { ...command, operationId: 'stale-write' };
  assert.equal(await page2.evaluate(async (operation) => {
    try { await window.repo2.commit(operation); } catch (error) { return error.code; }
  }, stale), 'REVISION_CONFLICT', 'F03/D13 不覆蓋別頁進度');

  const failed = { ...structuredClone(command), operationId: 'injected-failure', expectedRevision: 1 };
  failed.payload.changes[0].value.n = 9;
  const failureResult = await page.evaluate(async (operation) => {
    const failing = window.makeFixtureRepo({ beforeCommit() { throw new Error('fixture abort'); } });
    try { await failing.commit(operation); } catch (error) { return error.code; }
    finally { failing.close(); }
  }, failed);
  assert.equal(failureResult, 'STORAGE_ABORTED', 'F03/S05 故障不可假成功');
  assert.equal((await page.evaluate(() => window.repo.get('progress', 'ja-w-001'))).n, 1);
  assert.equal((await page.evaluate(() => window.repo.ready())).revision, 1);

  await page.evaluate(async () => {
    window.repo.close();
    window.repo = window.makeFixtureRepo();
    await window.repo.ready();
  });
  assert.equal((await page.evaluate(() => window.repo.get('stats', 'ja:words'))).total, 1,
    'F03/S07 重開連線保留成功狀態');

  const cleared = await page.evaluate((op) => window.repo.clearLearning(op), {
    operationId: 'clear-fixture', epoch: first.dataEpoch, expectedRevision: 1,
  });
  assert.equal(cleared.revision, 2);
  const afterClear = await page.evaluate(() => window.repo.ready());
  assert.notEqual(afterClear.dataEpoch, first.dataEpoch);
  assert.equal(afterClear.migrationStatus, 'cleared');
  assert.equal(await page.evaluate(() => window.repo.get('progress', 'ja-w-001')), undefined);
  assert.deepEqual(await page.evaluate(() => window.repo.list('restorePoints')), []);
  assert.equal(await page2.evaluate(async (operation) => {
    try { await window.repo2.commit(operation); } catch (error) { return error.code; }
  }, command), 'STALE_EPOCH', 'F03/O18 清除後舊頁不可復活資料');

  const future = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('fixture-future', 9);
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => reject(open.error);
    });
    const repo = window.makeFixtureRepo({ name: 'fixture-future' });
    try { await repo.ready(); } catch (error) { return error.code; } finally { repo.close(); }
  });
  assert.equal(future, 'UNSUPPORTED_SCHEMA', 'F03/D19 不可清空未來版本DB');
  await page2.evaluate(() => window.repo2.close());
  await page2.close();
  await page.evaluate(() => window.repo.close());
}

/**
 * 每個回歸有獨立 fixture DB；集中回報所有失敗，不讓首項遮住其他 RED。
 */
export async function run(args) {
  const { page } = args;
  await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    window.regression = {
      make(name, extra = {}) {
        return createWebRepository({ name: 'fixture-regression-' + name, timeZone: 'Asia/Taipei', now: () => 1791158400000, ...extra });
      },
      command(meta, operationId, changes) {
        return { operationId, epoch: meta.dataEpoch, expectedRevision: meta.revision, payload: { changes } };
      },
      async outcome(fn) {
        try { return { result: await fn() }; }
        catch (error) { return { code: error.code ?? null, name: error.name }; }
      },
      async raw(name, action) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('fixture-regression-' + name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try { return await action(db); } finally { db.close(); }
      },
    };
  });
  const cases = [
    ['F03/D12/D13/O18 原交易、回滾與 cleared marker', () => legacyTransactions(args)],
    ['F03/D12 同操作刷新 revision 仍回原收據', () => receiptReplay(page)],
    ['F03/D19 超前收據拒絕且不修改資料', () => corruptReceipt(page)],
    ['F03 索引及主鍵 token 分頁不漏同值資料、不從頭掃', () => pagination(page)],
    ['F03 缺 structuredClone 的型別保留與不可變 token', () => paginationWithoutStructuredClone(page)],
    ['F03 無 crypto 在 ready/commit/clear 前回 typed error', () => unavailableCrypto(page)],
    ['F03/D19 損毀 index/store shape 拒絕開放且保留資料', () => corruptDatabaseShape(page)],
    ['F03/D19 完整 meta 驗證在 ready 與寫入交易均拒絕且保留原資料', () => corruptMetadata(page)],
    ['F03/O18 清除後為可攜的合法空資料、保留原子回滾並拒絕舊世代', () => validEmptyAfterClear(page)],
    ['F03/D12/O18 固定入參快照與 clear 後 late write', () => immutableAndLateWrite(page)],
  ];
  const errors = [];
  for (const [name, execute] of cases) {
    try { await execute(); console.log('PASS ' + name); }
    catch (error) { errors.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
  }
  if (errors.length) throw new Error(`${errors.length}/${cases.length} repository cases failed\n${errors.join('\n')}`);
}

async function receiptReplay(page) {
  const result = await page.evaluate(async () => {
    const { make, command, outcome } = window.regression;
    const repo = make('replay');
    try {
      const op = command(await repo.ready(), 'original', [{ store: 'notes', key: 'a', value: { text: 'first' } }]);
      const saved = await repo.commit(op);
      await repo.commit(command(await repo.ready(), 'next', [{ store: 'notes', key: 'b', value: { text: 'second' } }]));
      const retries = [];
      for (const expectedRevision of [0, 1, 2]) retries.push(await outcome(() => repo.commit({ ...op, expectedRevision })));
      const changed = structuredClone(op);
      changed.expectedRevision = 2;
      changed.payload.changes[0].value.text = 'changed';
      return { saved, retries, changed: await outcome(() => repo.commit(changed)), meta: await repo.ready(), value: await repo.get('notes', 'a') };
    } finally { repo.close(); }
  });
  assert.deepEqual(result.retries, [0, 1, 2].map(() => ({ result: result.saved })));
  assert.equal(result.changed.code, 'OPERATION_MISMATCH');
  assert.equal(result.meta.revision, 2);
  assert.deepEqual(result.value, { text: 'first' });
}

async function corruptReceipt(page) {
  const result = await page.evaluate(async () => {
    const { make, command, outcome, raw } = window.regression;
    const repo = make('receipt-corrupt');
    try {
      const op = command(await repo.ready(), 'original', [{ store: 'notes', key: 'a', value: { text: 'saved' } }]);
      await repo.commit(op);
      await raw('receipt-corrupt', db => new Promise((resolve, reject) => {
        const tx = db.transaction('operations', 'readwrite');
        const store = tx.objectStore('operations');
        const key = op.epoch + ':' + op.operationId;
        const request = store.get(key);
        request.onsuccess = () => store.put({ ...request.result, result: { revision: 999 } }, key);
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      }));
      return { retry: await outcome(() => repo.commit(op)), meta: await repo.ready(), value: await repo.get('notes', 'a'), receipt: await repo.get('operations', op.epoch + ':' + op.operationId) };
    } finally { repo.close(); }
  });
  assert.equal(result.retry.code, 'INVALID_RECEIPT');
  assert.equal(result.meta.revision, 1);
  assert.deepEqual(result.value, { text: 'saved' });
  assert.equal(result.receipt.result.revision, 999, '保留損毀來源供排查，不自動修寫');
}

async function pagination(page) {
  const result = await page.evaluate(async () => {
    const { make, command, outcome } = window.regression;
    const repo = make('paging');
    const originalIndexCursor = IDBIndex.prototype.openCursor;
    const originalStoreCursor = IDBObjectStore.prototype.openCursor;
    try {
      const keys = Array.from({ length: 600 }, (_, i) => 'i-' + String(i).padStart(4, '0'));
      await repo.commit(command(await repo.ready(), 'seed', keys.map((key, i) => ({
        store: 'itemStates', key, value: { sourceId: key, skillKey: key, due: i < 300 ? 10 : 20 },
      }))));
      const first = await repo.list('itemStates', { index: 'due', limit: 127 });
      if (!first.at(-1).continuation) return { missingToken: true };
      const all = [...first];
      let after = first.at(-1).continuation;
      for (let i = 0; i < 10; i++) {
        const rows = await repo.list('itemStates', { index: 'due', limit: 127, after });
        if (!rows.length) break;
        all.push(...rows); after = rows.at(-1).continuation;
      }
      let visits = 0;
      const instrument = original => function (...args) {
        const request = original.apply(this, args);
        request.addEventListener('success', () => { visits++; });
        return request;
      };
      IDBIndex.prototype.openCursor = instrument(originalIndexCursor);
      IDBObjectStore.prototype.openCursor = instrument(originalStoreCursor);
      const mutable = { indexKey: 20, primaryKey: 'i-0580' };
      const tailPromise = repo.list('itemStates', { index: 'due', limit: 9, after: mutable });
      mutable.primaryKey = 'i-0599';
      const tail = await tailPromise;
      const indexVisits = visits; visits = 0;
      const primaryTail = await repo.list('itemStates', { limit: 9, after: { indexKey: 'i-0580', primaryKey: 'i-0580' } });
      const primaryVisits = visits;
      await repo.commit(command(await repo.ready(), 'delete-boundary', [{ store: 'itemStates', key: 'i-0580', delete: true }]));
      const deletedBoundary = await repo.list('itemStates', { index: 'due', limit: 2, after: { indexKey: 20, primaryKey: 'i-0580' } });
      const invalid = [];
      for (const token of [10, null, {}, { indexKey: 20 }, { indexKey: {}, primaryKey: 'a' }]) {
        invalid.push(await outcome(() => repo.list('itemStates', { index: 'due', after: token })));
      }
      return { firstToken: first.at(-1).continuation, all: all.map(row => row.key), keys, tail: tail.map(row => row.key),
        primaryTail: primaryTail.map(row => row.key), indexVisits, primaryVisits, deletedBoundary: deletedBoundary.map(row => row.key), invalid };
    } finally {
      IDBIndex.prototype.openCursor = originalIndexCursor;
      IDBObjectStore.prototype.openCursor = originalStoreCursor;
      repo.close();
    }
  });
  assert.equal(result.missingToken, undefined, '每列須提供可續讀的 continuation token');
  assert.deepEqual(result.firstToken, { indexKey: 10, primaryKey: 'i-0126' });
  assert.deepEqual(result.all, result.keys, '600筆同值索引跨頁完整且沒有重複');
  const tail = result.keys.slice(581, 590);
  assert.deepEqual(result.tail, tail, 'after 在 await 前快照，不受 caller 修改');
  assert.deepEqual(result.primaryTail, tail);
  assert.ok(result.indexVisits <= 12, `索引尾頁只讀附近游標，實際 ${result.indexVisits}`);
  assert.ok(result.primaryVisits <= 10, `主鍵尾頁不從頭掃，實際 ${result.primaryVisits}`);
  assert.deepEqual(result.deletedBoundary, ['i-0581', 'i-0582']);
  assert.ok(result.invalid.every(value => value.code === 'INVALID_QUERY'));
}

async function paginationWithoutStructuredClone(page) {
  const results = await page.evaluate(async () => {
    const { make, raw } = window.regression;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
    const cases = [
      ['number', n => n, () => {}],
      ['string', n => 'key-' + n, () => {}],
      ['date', n => new Date(n * 1000), key => key.setTime(99000)],
      ['array', n => ['key', [new Date(n * 1000), new Uint8Array([n])]], key => { key[1][0].setTime(99000); key[1][1][0] = 99; }],
      ['binary', n => new Uint8Array([n]).buffer, key => { new Uint8Array(key)[0] = 99; }],
      ['view', n => new DataView(new Uint8Array([99, n, 99]).buffer, 1, 1), key => key.setUint8(0, 99)],
    ];
    const results = [];
    try {
      for (const [name, keyOf, mutate] of cases) {
        const dbName = 'compat-' + name;
        const repo = make(dbName);
        try {
          await repo.ready();
          await raw(dbName, db => new Promise((resolve, reject) => {
            const tx = db.transaction('itemStates', 'readwrite');
            for (let n = 1; n <= 3; n++) tx.objectStore('itemStates').put({ due: keyOf(n), n }, keyOf(n));
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
          }));
          for (const index of [undefined, 'due']) {
            const first = await repo.list('itemStates', { limit: 1, index });
            const next = await repo.list('itemStates', { limit: 1, index, after: first[0].continuation });
            const token = { indexKey: keyOf(1), primaryKey: keyOf(1) };
            const pending = repo.list('itemStates', { index, after: token });
            mutate(token.indexKey); mutate(token.primaryKey);
            token.indexKey = keyOf(3); token.primaryKey = keyOf(3);
            const rest = await pending;
            results.push({ name, index: index || 'primary', first: first[0].value.n, next: next[0].value.n,
              sameKeyType: indexedDB.cmp(next[0].key, keyOf(2)) === 0,
              rest: rest.map(row => row.value.n) });
          }
        } finally { repo.close(); }
      }
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor);
      else delete globalThis.structuredClone;
    }
    return results;
  });
  assert.equal(results.length, 12);
  for (const row of results) {
    assert.equal(row.first, 1, row.name + '/' + row.index);
    assert.equal(row.next, 2, row.name + '/' + row.index);
    assert.equal(row.sameKeyType, true, '不得把 Date/array/binary 轉成 JSON 型別');
    assert.deepEqual(row.rest, [2, 3], 'await 前須深複製 caller 的 key');
  }
}

async function unavailableCrypto(page) {
  const result = await page.evaluate(async () => {
    const { make, outcome } = window.regression;
    let digestCalls = 0;
    const variants = [null, {}, { subtle: {} }, { subtle: { digest: 1 }, getRandomValues() {} },
      { subtle: { digest() { digestCalls++; throw new Error('must not digest without RNG'); } } }];
    const results = [];
    for (let i = 0; i < variants.length; i++) {
      const repo = make('crypto-' + i, { crypto: variants[i] });
      const op = { operationId: 'save', epoch: 'fixture', expectedRevision: 0,
        payload: { changes: [{ store: 'notes', key: 'a', value: { text: 'x' } }] } };
      try {
        results.push(await outcome(() => repo.commit(op)), await outcome(() => repo.clearLearning(op)), await outcome(() => repo.ready()));
      } finally { repo.close(); }
    }
    return { results, digestCalls };
  });
  assert.deepEqual(result.results.map(value => value.code), Array(15).fill('STORAGE_UNAVAILABLE'));
  assert.equal(result.digestCalls, 0);
}

async function corruptDatabaseShape(page) {
  const result = await page.evaluate(async () => {
    const { make, outcome, command, raw } = window.regression;
    const stores = ['stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger', 'sessions',
      'operations', 'restorePoints', 'books', 'notes', 'intents', 'achievements', 'reminders', 'outbox'];
    const indexes = { itemStates: ['sourceId', 'skillKey', 'due'], reviewEvents: ['sourceId', 'skillKey', 'answeredAt', 'sessionId'],
      dailyPlans: ['localDate', 'lang'], dailyLedger: ['localDate', 'lang'], sessions: ['lang', 'status'], restorePoints: ['createdAt'] };
    const meta = { schemaVersion: 2, revision: 0, dataEpoch: 'fixture-epoch', migrationStatus: 'complete', historyStartedAt: 1791158400000, schedulerPolicyVersion: 1, timeZone: 'Asia/Taipei' };
    const results = [];
    for (const variant of ['missing', 'keyPath', 'unique', 'multiEntry', 'storeKeyPath', 'autoIncrement']) {
      const name = 'shape-' + variant;
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('fixture-regression-' + name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('meta').put(meta, 'current');
          for (const name of stores) {
            const store = db.createObjectStore(name, name === 'itemStates'
              ? { keyPath: variant === 'storeKeyPath' ? 'id' : null, autoIncrement: variant === 'autoIncrement' } : undefined);
            for (const index of indexes[name] || []) {
              const target = name === 'itemStates' && index === 'due';
              if (target && variant === 'missing') continue;
              store.createIndex(index, target && variant === 'keyPath' ? 'wrongDue' : index,
                { unique: target && variant === 'unique', multiEntry: target && variant === 'multiEntry' });
            }
            if (name === 'notes') store.put({ text: 'must survive' }, 'preserved');
          }
        };
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
      });
      const repo = make(name);
      try {
        const ready = await outcome(() => repo.ready());
        const commit = await outcome(() => repo.commit(command(meta, 'attempt', [{ store: 'notes', key: 'preserved', value: { text: 'overwritten' } }])));
        const original = await raw(name, db => new Promise((resolve, reject) => {
          const tx = db.transaction(['meta', 'notes']);
          const metadata = tx.objectStore('meta').get('current');
          const note = tx.objectStore('notes').get('preserved');
          tx.oncomplete = () => resolve({ meta: metadata.result, note: note.result });
          tx.onabort = () => reject(tx.error);
        }));
        results.push({ variant, ready, commit, original });
      } finally { repo.close(); }
    }
    return results;
  });
  for (const row of result) {
    assert.equal(row.ready.code, 'UNSUPPORTED_SCHEMA', row.variant + ' ready 必須拒絕');
    assert.equal(row.commit.code, 'UNSUPPORTED_SCHEMA', row.variant + ' commit 必須拒絕');
    assert.equal(row.original.meta.revision, 0);
    assert.deepEqual(row.original.note, { text: 'must survive' });
  }
}

async function immutableAndLateWrite(page) {
  const result = await page.evaluate(async () => {
    const { make, command, outcome } = window.regression;
    const gate = () => {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      return { release, crypto: { getRandomValues: bytes => crypto.getRandomValues(bytes),
        subtle: { digest: async (...args) => { await promise; return crypto.subtle.digest(...args); } } } };
    };
    const firstGate = gate(); const mutation = make('mutation', { crypto: firstGate.crypto });
    const normal = make('late'); const secondGate = gate(); const late = make('late', { crypto: secondGate.crypto });
    try {
      const meta = await mutation.ready();
      const input = command(meta, 'original', [{ store: 'notes', key: 'a', value: { text: 'before' } }]);
      const pending = mutation.commit(input);
      input.payload.changes[0].value.text = 'after'; input.operationId = 'mutated'; input.expectedRevision = 999;
      firstGate.release(); await pending;
      const before = await normal.ready();
      const pendingLate = outcome(() => late.commit(command(before, 'late-write', [{ store: 'notes', key: 'zombie', value: { text: 'late' } }])));
      await normal.clearLearning({ operationId: 'clear', epoch: before.dataEpoch, expectedRevision: before.revision });
      secondGate.release();
      return { original: await mutation.get('notes', 'a'), receipt: await mutation.get('operations', meta.dataEpoch + ':original'),
        late: await pendingLate, zombie: await normal.get('notes', 'zombie'), after: await normal.ready() };
    } finally { firstGate.release(); secondGate.release(); mutation.close(); normal.close(); late.close(); }
  });
  assert.deepEqual(result.original, { text: 'before' });
  assert.equal(result.receipt.operationId, 'original');
  assert.equal(result.late.code, 'STALE_EPOCH');
  assert.equal(result.zombie, undefined);
  assert.equal(result.after.migrationStatus, 'cleared');
}

async function corruptMetadata(page) {
  const results = await page.evaluate(async () => {
    const { make, command, outcome, raw } = window.regression;
    const variants = [
      ['zone', { timeZone: 'not/a-zone' }, 'UNSUPPORTED_SCHEMA'],
      ['history', { historyStartedAt: -1 }, 'UNSUPPORTED_SCHEMA'],
      ['missing-history', { historyStartedAt: undefined }, 'UNSUPPORTED_SCHEMA'],
      ['policy', { schedulerPolicyVersion: 99 }, 'UNSUPPORTED_VERSION'],
      ['schema', { schemaVersion: 99 }, 'UNSUPPORTED_SCHEMA'],
    ];
    const rows = [];
    for (const [name, patch, expected] of variants) {
      const dbName = 'meta-' + name;
      const repo = make(dbName);
      try {
        const before = await repo.ready();
        const invalid = { ...before, ...patch };
        if (name === 'missing-history') delete invalid.historyStartedAt;
        await raw(dbName, db => new Promise((resolve, reject) => {
          const tx = db.transaction(['meta', 'notes'], 'readwrite');
          tx.objectStore('meta').put(invalid, 'current');
          tx.objectStore('notes').put({ text: 'preserve this' }, 'original');
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }));
        const op = command(before, 'attempt', [{ store: 'notes', key: 'original', value: { text: 'lost' } }]);
        const ready = await outcome(() => repo.ready());
        const commit = await outcome(() => repo.commit(op));
        const clear = await outcome(() => repo.clearLearning(op));
        const migration = await outcome(() => repo.migrateFromLegacy({ getItem: () => null }));
        const original = await raw(dbName, db => new Promise((resolve, reject) => {
          const tx = db.transaction(['meta', 'notes', 'operations']);
          const meta = tx.objectStore('meta').get('current');
          const note = tx.objectStore('notes').get('original');
          const receipts = tx.objectStore('operations').count();
          tx.oncomplete = () => resolve({ meta: meta.result, note: note.result, receipts: receipts.result });
          tx.onabort = () => reject(tx.error);
        }));
        rows.push({ name, expected, invalid, ready, commit, clear, migration, original });
      } finally { repo.close(); }
    }
    return rows;
  });
  for (const row of results) {
    for (const action of ['ready', 'commit', 'clear', 'migration']) {
      assert.equal(row[action].code, row.expected, row.name + '/' + action);
    }
    assert.deepEqual(row.original.meta, row.invalid, '不自動修寫或覆蓋損毀 meta');
    assert.deepEqual(row.original.note, { text: 'preserve this' });
    assert.equal(row.original.receipts, 0, '失敗不得產生成功收據');
  }
}

async function validEmptyAfterClear(page) {
  const result = await page.evaluate(async () => {
    const { emptyLearning, validateLearning } = await import('/assets/js/core/learning-schema.js');
    const { make, command, outcome } = window.regression;
    const repo = make('clear-empty');
    const failing = make('clear-empty', { beforeCommit() { throw new Error('fixture clear abort'); } });
    try {
      await repo.migrateFromLegacy({ getItem: () => null });
      const before = await repo.ready();
      await repo.commit(command(before, 'seed', [{ store: 'notes', key: 'a', value: { text: 'keep until committed' } }]));
      const seeded = await repo.ready();
      const op = { operationId: 'clear', epoch: seeded.dataEpoch, expectedRevision: seeded.revision };
      const failed = await outcome(() => failing.clearLearning(op));
      const rollback = { meta: await repo.ready(), note: await repo.get('notes', 'a'),
        favorites: await repo.get('books', 'favorites'), receipts: await repo.list('operations') };
      const cleared = await repo.clearLearning(op);
      const meta = await repo.ready();
      const learning = emptyLearning({ now: meta.historyStartedAt, timeZone: meta.timeZone, dataEpoch: meta.dataEpoch });
      learning.meta = meta;
      learning.library.books = Object.fromEntries((await repo.list('books')).map(row => [row.key, row.value]));
      learning.achievements.policyVersion = (await repo.get('achievements', 'policy'))?.policyVersion;
      learning.reminderPreferences = await repo.get('reminders', 'preferences');
      learning.operations = Object.fromEntries((await repo.list('operations')).map(row => [row.key, row.value]));
      const ignoredMigration = await repo.migrateFromLegacy({ getItem() { throw new Error('must not read legacy after clear'); } });
      const collections = ['stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger',
        'sessions', 'operations', 'restorePoints', 'notes', 'intents', 'outbox'];
      const emptyCounts = await Promise.all(collections.map(async store => [store, (await repo.list(store)).length]));
      return { seeded, failed, rollback, cleared, meta, learning, validation: validateLearning(learning),
        ignoredMigration, emptyCounts, retry: await outcome(() => repo.clearLearning(op)) };
    } finally { repo.close(); failing.close(); }
  });
  assert.equal(result.failed.code, 'STORAGE_ABORTED');
  assert.deepEqual(result.rollback.meta, result.seeded, '清除故障必須保留 epoch/revision');
  assert.deepEqual(result.rollback.note, { text: 'keep until committed' });
  assert.ok(result.rollback.favorites, '故障不可清掉原固定簿');
  assert.equal(result.rollback.receipts.length, 1);
  assert.equal(result.cleared.revision, result.seeded.revision + 1);
  assert.notEqual(result.meta.dataEpoch, result.seeded.dataEpoch);
  assert.equal(result.validation.ok, true, JSON.stringify(result.validation.errors));
  assert.deepEqual(result.emptyCounts.map(([, count]) => count), Array(result.emptyCounts.length).fill(0));
  assert.equal(result.learning.library.books.favorites.system, true);
  assert.deepEqual(result.learning.library.books.favorites.wordIds, []);
  assert.deepEqual(result.learning.reminderPreferences, { enabled: false, localTime: '20:00', timeZone: 'Asia/Taipei', generation: 0 });
  assert.deepEqual(result.ignoredMigration, result.meta);
  assert.equal(result.retry.code, 'STALE_EPOCH', '清除回應遺失的舊 epoch 不得跨世代重送');
}
