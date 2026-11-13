import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createCloudBaseline, CLOUD_BASELINE_KEY } from '../assets/js/ui/platform/cloud-baseline.js';
import { CloudApiError, SNAPSHOT_MAX_BYTES } from '../assets/js/ui/platform/cloud-api.js';
import { createCloudSyncRunner, SYNC_STATUSES, RETRY_DELAYS_MS } from '../assets/js/ui/platform/cloud-sync-runner.js';
import { emptyLearning } from '../assets/js/core/learning-schema.js';

/**
 * 執行器測試：時鐘、雲端 API、Web Locks 與頁面生命週期全部注入；學習資料用記憶體 repository。
 * 帳號 ID 都是假值，不連任何網路。
 */
const ACCOUNT = 'acct-run-1';
const AT = 1_791_158_400_000;

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

function fakeClock(start = AT) {
  let time = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { at: time + Math.max(0, ms), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending() { return [...timers.values()].map((timer) => timer.at - time).sort((a, b) => a - b); },
    async advance(ms, runners = []) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].fn();
        await settle(runners);
      }
      time = target;
      await settle(runners);
    },
  };
}

async function settle(runners) {
  for (let round = 0; round < 3; round++) {
    await flush();
    for (const runner of runners) await runner.whenIdle();
  }
}

/**
 * 假雲端：與伺服器相同的 If-Match 規則；可排入失敗模式。
 * 失敗模式：offline（請求沒到伺服器）、lost（伺服器已套用但回應遺失）、server、unauthorized、forbidden、rate、conflict。
 */
function fakeCloud({ revision = 0, locks = null } = {}) {
  const state = { revision, uploadId: null, bytes: null, puts: [], metaCalls: 0, failMeta: [], failPut: [], holdPut: null, insideLock: [] };
  const fail = (mode) => {
    if (mode === 'offline') return new CloudApiError('NETWORK', '連不上', { outcomeUnknown: true });
    if (mode === 'lost') return new CloudApiError('TIMEOUT', '逾時', { outcomeUnknown: true });
    if (mode === 'server') return new CloudApiError('SERVER', '伺服器錯誤', { status: 503, outcomeUnknown: true });
    if (mode === 'unauthorized') return new CloudApiError('UNAUTHENTICATED', '需要登入', { status: 401 });
    if (mode === 'forbidden') return new CloudApiError('FORBIDDEN', '沒有權限', { status: 403 });
    if (mode === 'rate') return new CloudApiError('RATE_LIMITED', '太頻繁', { status: 429, retryAfterMs: 900000 });
    return new CloudApiError('NETWORK', '連不上');
  };
  const api = {
    state,
    async meta() {
      state.metaCalls++;
      await flush();
      const mode = state.failMeta.shift();
      if (mode) throw fail(mode === 'offline' ? 'meta-offline' : mode);
      return { revision: state.revision, uploadId: state.uploadId, schemaVersion: 2, byteSize: 1, deviceLabel: '', updatedAt: 1 };
    },
    async upload(bytes, options) {
      state.puts.push({ ...options, size: bytes.byteLength });
      if (locks) state.insideLock.push(locks.held);
      if (state.holdPut) await state.holdPut;
      await flush();
      const mode = state.failPut.shift();
      if (mode && mode !== 'lost') throw fail(mode);
      if (options.ifMatch !== state.revision) {
        throw new CloudApiError('REVISION_MISMATCH', '版本不符', { status: 409, current: { revision: state.revision, uploadId: state.uploadId } });
      }
      state.revision++;
      state.uploadId = options.uploadId;
      state.bytes = bytes;
      if (mode === 'lost') throw fail('lost');
      return { revision: state.revision };
    },
    async download() {
      await flush();
      return { text: state.bytes ? new TextDecoder().decode(state.bytes) : '', revision: state.revision };
    },
  };
  return api;
}

function fakeLocks() {
  const queues = new Map();
  const locks = {
    held: 0, maxHeld: 0, requests: 0,
    request(name, callback) {
      locks.requests++;
      const previous = queues.get(name) || Promise.resolve();
      const run = previous.then(async () => {
        locks.held++;
        locks.maxHeld = Math.max(locks.maxHeld, locks.held);
        try { return await callback({ name }); } finally { locks.held--; }
      });
      queues.set(name, run.catch(() => {}));
      return run;
    },
  };
  return locks;
}

function memoryStorage() {
  const data = new Map();
  return { data, getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}

const quiz = (id) => ({ source: 'words', questions: [{ kind: 'choice', sourceId: id, options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: 0 }] });
let opCounter = 0;
const answer = (store, id = 'ja-w-001') => store.recordQuizSession({ lang: 'ja', source: 'words', session: quiz(id),
  summary: { total: 1, correct: 1 }, operationId: `op-${++opCounter}`, at: AT });

/**
 * 清除紀錄：記憶體 repository 清除後不會補回預設收藏簿與政策列（web-repository 會），
 * 這裡在清除後以同一個新 epoch 補回，讓匯出內容與真的清除結果一致。
 */
async function clearLearning(store) {
  await store.clearAll();
  const empty = emptyLearning({ now: AT, timeZone: 'Asia/Taipei' });
  await store.commit({ stores: ['books'], operationId: `restore-defaults-${++opCounter}`, build: () => [
    { store: 'books', key: 'favorites', value: empty.library.books.favorites },
    { store: 'achievements', key: 'policy', value: { policyVersion: empty.achievements.policyVersion } },
    { store: 'reminders', key: 'preferences', value: empty.reminderPreferences },
  ] });
}

/**
 * 組出一個分頁的執行器；同一組 shared（repository、storage、cloud、locks、clock）可模擬多個分頁。
 */
function setup({ shared = {}, accountId = ACCOUNT, compress, exportBackup, cloudRevision = 0 } = {}) {
  const clock = shared.clock || fakeClock();
  const locks = shared.locks || fakeLocks();
  const cloud = shared.cloud || fakeCloud({ revision: cloudRevision, locks });
  const repository = shared.repository || createMemoryRepository();
  const storage = shared.storage || memoryStorage();
  const store = createLearningStore({ repository, now: () => AT });
  const baseline = createCloudBaseline({ storage, now: clock.now });
  let lifecycle = null;
  const exports = { count: 0 };
  const runner = createCloudSyncRunner({
    api: cloud, store, baseline, accountId, clock, locks,
    exportBackup: exportBackup || (async () => { exports.count++; return store.exportBackup({}); }),
    compress: compress || (async (text) => new TextEncoder().encode(text)),
    newUploadId: (() => { let n = 0; return () => `up-${accountId}-${++n}`; })(),
    lifecycle: (handlers) => { lifecycle = handlers; return () => { lifecycle = null; }; },
  });
  const states = [];
  runner.subscribe((state) => states.push(state));
  return { clock, locks, cloud, repository, storage, store, baseline, runner, states, exports, shared: { clock, locks, cloud, repository, storage },
    life: () => lifecycle, settle: () => settle([runner]) };
}

test('runner：公開狀態清單涵蓋畫面需要的全部狀態', () => {
  for (const status of ['idle', 'checking', 'synced', 'pending', 'uploading', 'unsynced', 'cloud-newer', 'cloud-available',
    'conflict', 'ask-replace', 'too-large', 'reauth', 'paused', 'applying', 'stopped']) {
    assert.ok(SYNC_STATUSES.includes(status), status);
  }
  assert.deepEqual(RETRY_DELAYS_MS, [30000, 60000, 120000, 300000]);
});

test('C01 執行器：雲端空、本機有資料 → 開頁即上傳，記下基準並顯示已同步', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start();
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 1);
  assert.equal(t.cloud.state.puts[0].ifMatch, 0);
  const meta = await t.store.ready();
  assert.deepEqual({ ...t.baseline.get(ACCOUNT), updatedAt: 0 },
    { cloudRevision: 1, localRevision: meta.revision, localEpoch: meta.dataEpoch, origin: 'upload', paused: false, updatedAt: 0 });
  assert.equal(t.runner.getState().status, 'synced');
  assert.ok(t.states.some((state) => state.status === 'uploading'), '上傳期間有「上傳中」狀態');
  t.runner.stop();
});

test('runner：兩邊都空 → 不上傳，狀態為已同步', async () => {
  const t = setup();
  await t.runner.start();
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 0);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('runner：C02／C03／C05／C06 只改狀態，不上傳也不改本機', async () => {
  const fresh = setup({ cloudRevision: 3 });
  await fresh.runner.start(); await fresh.settle();
  assert.equal(fresh.runner.getState().status, 'cloud-available');

  const both = setup({ cloudRevision: 3 });
  await answer(both.store);
  await both.runner.start(); await both.settle();
  assert.deepEqual([both.runner.getState().status, both.runner.getState().reason], ['conflict', 'first-login']);

  const newer = setup({ cloudRevision: 3 });
  await answer(newer.store);
  const meta = await newer.store.ready();
  newer.baseline.set(ACCOUNT, { cloudRevision: 2, localRevision: meta.revision, localEpoch: meta.dataEpoch, origin: 'upload' });
  await newer.runner.start(); await newer.settle();
  assert.equal(newer.runner.getState().status, 'cloud-newer');
  await answer(newer.store);
  await newer.clock.advance(10000, [newer.runner]);
  assert.deepEqual([newer.runner.getState().status, newer.runner.getState().reason], ['conflict', 'both-changed']);

  for (const t of [fresh, both, newer]) {
    assert.equal(t.cloud.state.puts.length, 0);
    t.runner.stop();
  }
});

test('C14 執行器：帳號 A 的基準不沿用到帳號 B，B 雲端有資料時不自動上傳', async () => {
  const a = setup();
  await answer(a.store);
  await a.runner.start(); await a.settle();
  a.runner.stop();
  assert.equal(a.cloud.state.puts.length, 1);
  const b = setup({ shared: { ...a.shared, cloud: fakeCloud({ revision: 2 }) }, accountId: 'acct-run-b' });
  await b.runner.start(); await b.settle();
  assert.equal(b.cloud.state.puts.length, 0);
  assert.equal(b.runner.getState().status, 'conflict');
  assert.equal(b.baseline.get('acct-run-b'), null);
  assert.notEqual(b.baseline.get(ACCOUNT), null, 'A 的基準保留，不被 B 覆蓋');
  b.runner.stop();
});

test('C04 本機變更 10 秒防抖後以基準 revision 上傳；連續作答合併成一次', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  assert.equal(t.cloud.state.puts.length, 1);
  await answer(t.store, 'ja-w-002');
  await t.settle();
  assert.equal(t.runner.getState().status, 'pending');
  await t.clock.advance(5000, [t.runner]);
  await answer(t.store, 'ja-w-003');
  await t.clock.advance(9999, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 1, '最後一次寫入後未滿 10 秒不上傳');
  await t.clock.advance(1, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 2);
  assert.equal(t.cloud.state.puts[1].ifMatch, 1, 'If-Match 是同步基準的雲端 revision');
  const meta = await t.store.ready();
  assert.equal(t.baseline.get(ACCOUNT).cloudRevision, 2);
  assert.equal(t.baseline.get(ACCOUNT).localRevision, meta.revision);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('C04 頁面變成隱藏時立刻上傳，不等 10 秒', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await answer(t.store, 'ja-w-002');
  await t.settle();
  t.life().hidden();
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 2);
  assert.equal(t.runner.getState().status, 'synced');
  assert.deepEqual(t.clock.pending(), [], '防抖計時器已取消');
  t.runner.stop();
});

test('C04 上傳期間作答照常；上傳後的新變更會再排一次上傳', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  let release;
  t.cloud.state.holdPut = new Promise((resolve) => { release = resolve; });
  await answer(t.store, 'ja-w-002');
  await t.clock.advance(10000);
  assert.equal(t.runner.getState().status, 'uploading');
  const during = await answer(t.store, 'ja-w-003');
  assert.ok(during.revision > 0, '上傳中寫入不受阻');
  t.cloud.state.holdPut = null;
  release();
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 2);
  assert.equal(t.runner.getState().status, 'pending', '上傳的是較早的快照，新變更待上傳');
  await t.clock.advance(10000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 3);
  assert.equal(t.baseline.get(ACCOUNT).localRevision, (await t.store.ready()).revision);
  t.runner.stop();
});

test('C08 執行器：清除紀錄後詢問，不自動上傳；選是依 C04 上傳', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await clearLearning(t.store);
  await t.settle();
  assert.equal(t.runner.getState().status, 'ask-replace');
  t.life().hidden();
  await t.clock.advance(60000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 1, '詢問前不上傳');
  await t.runner.answerReplace(true);
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 2);
  assert.equal(t.cloud.state.puts[1].ifMatch, 1);
  const meta = await t.store.ready();
  assert.equal(t.baseline.get(ACCOUNT).localEpoch, meta.dataEpoch);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('C08 執行器：選否 → 暫停自動上傳並記在基準', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await clearLearning(t.store);
  await t.settle();
  await t.runner.answerReplace(false);
  await t.settle();
  assert.equal(t.runner.getState().status, 'paused');
  assert.equal(t.baseline.get(ACCOUNT).paused, true);
  await answer(t.store, 'ja-w-009');
  t.life().hidden();
  t.life().visible();
  await t.clock.advance(600000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 1);
  assert.equal(t.runner.getState().status, 'paused');
  await t.runner.resolveConflict('local');
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 2, '暫停時可選「用這台的」上傳');
  assert.equal(t.baseline.get(ACCOUNT).paused, false);
  t.runner.stop();
});

test('C08 執行器：由雲端套用造成的替換不詢問，並記下 origin=cloud 的基準', async () => {
  const t = setup({ cloudRevision: 0 });
  await answer(t.store);
  await t.runner.start(); await t.settle();
  t.cloud.state.revision = 5;
  t.life().visible();
  await t.settle();
  assert.equal(t.runner.getState().status, 'cloud-newer');
  const downloaded = await t.runner.downloadCloud();
  assert.equal(downloaded.revision, 5);
  assert.equal(t.runner.getState().status, 'applying');
  await clearLearning(t.store);
  t.life().visible();
  await t.settle();
  assert.equal(t.runner.getState().status, 'applying', '套用期間不判斷、不詢問');
  const meta = await t.store.ready();
  await t.runner.recordCloudApplied({ revision: meta.revision, dataEpoch: meta.dataEpoch, cloudRevision: 5 });
  await t.settle();
  assert.equal(t.runner.getState().status, 'synced');
  assert.equal(t.baseline.get(ACCOUNT).origin, 'cloud');
  assert.equal(t.baseline.get(ACCOUNT).cloudRevision, 5);
  assert.equal(t.cloud.state.puts.length, 1);
  await answer(t.store, 'ja-w-005');
  await t.clock.advance(10000, [t.runner]);
  assert.equal(t.cloud.state.puts.at(-1).ifMatch, 5, '套用後的作答依 C04 上傳');
  t.runner.stop();
});

test('runner：取消套用雲端後恢復判斷，本機零寫入', async () => {
  const t = setup({ cloudRevision: 3 });
  await t.runner.start(); await t.settle();
  const before = await t.store.ready();
  await t.runner.downloadCloud();
  t.runner.cancelCloudApply();
  await t.settle();
  assert.equal(t.runner.getState().status, 'cloud-available');
  assert.deepEqual(await t.store.ready(), before);
  t.runner.stop();
});

test('C09 失敗以 30 秒、1 分、2 分、5 分退避，之後每 5 分鐘；狀態顯示尚未同步', async () => {
  const t = setup();
  await answer(t.store);
  t.cloud.state.failPut.push('offline', 'offline', 'offline', 'offline', 'offline', 'offline');
  await t.runner.start(); await t.settle();
  assert.equal(t.runner.getState().status, 'unsynced');
  const attemptsAt = [];
  let last = t.cloud.state.puts.length;
  for (let elapsed = 0; elapsed < 1200000; elapsed += 1000) {
    await t.clock.advance(1000, [t.runner]);
    if (t.cloud.state.puts.length !== last) { attemptsAt.push(elapsed + 1000); last = t.cloud.state.puts.length; }
  }
  assert.deepEqual(attemptsAt.slice(0, 6), [30000, 90000, 210000, 510000, 810000, 1110000]);
  assert.equal(t.runner.getState().status, 'synced', '第 7 次成功');
  t.runner.stop();
});

test('C09 作答期間不打亂退避；恢復連線或回到頁面立即再試', async () => {
  const t = setup();
  await answer(t.store);
  t.cloud.state.failMeta.push('offline', 'offline');
  await t.runner.start(); await t.settle();
  assert.equal(t.runner.getState().status, 'unsynced');
  assert.ok(t.runner.getState().nextRetryAt > t.clock.now());
  await answer(t.store, 'ja-w-002');
  await t.clock.advance(15000, [t.runner]);
  assert.equal(t.cloud.state.metaCalls, 1, '尚未同步時，本機作答不額外觸發請求');
  t.life().online();
  await t.settle();
  assert.equal(t.cloud.state.metaCalls, 2, '恢復連線立即再試');
  assert.equal(t.runner.getState().status, 'unsynced');
  t.life().visible();
  await t.settle();
  assert.equal(t.cloud.state.puts.length, 1, '回到頁面立即再試並成功');
  assert.equal(t.runner.getState().status, 'synced');
  assert.deepEqual(t.clock.pending(), [], '成功後不留重試計時器');
  t.runner.stop();
});

test('C09 5xx 也進入退避，且作答不受影響', async () => {
  const t = setup();
  await answer(t.store);
  t.cloud.state.failPut.push('server');
  await t.runner.start(); await t.settle();
  assert.deepEqual([t.runner.getState().status, t.runner.getState().reason], ['unsynced', 'SERVER']);
  assert.ok((await answer(t.store, 'ja-w-002')).revision > 0);
  await t.clock.advance(30000, [t.runner]);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('C10 上傳已被伺服器接受但回應遺失：下一次先查 meta，revision＝基準＋1 且 uploadId 相符就視為成功', async () => {
  const t = setup();
  await answer(t.store);
  t.cloud.state.failPut.push('lost');
  await t.runner.start(); await t.settle();
  assert.equal(t.runner.getState().status, 'unsynced');
  assert.equal(t.cloud.state.revision, 1, '伺服器其實已套用');
  assert.equal(t.baseline.get(ACCOUNT), null, '結果不明時不宣稱成功');
  await t.clock.advance(30000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 1, '不重複上傳');
  assert.equal(t.baseline.get(ACCOUNT).cloudRevision, 1);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('C10 請求沒到伺服器：查 meta 後依 C04 重新上傳，用新的 uploadId', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await answer(t.store, 'ja-w-002');
  t.cloud.state.failPut.push('offline');
  await t.clock.advance(10000, [t.runner]);
  assert.equal(t.runner.getState().status, 'unsynced');
  const metaBefore = t.cloud.state.metaCalls;
  await t.clock.advance(30000, [t.runner]);
  assert.ok(t.cloud.state.metaCalls > metaBefore, '重試前先查 meta');
  assert.equal(t.cloud.state.puts.length, 3);
  assert.equal(t.cloud.state.puts[2].ifMatch, 1);
  assert.notEqual(t.cloud.state.puts[2].uploadId, t.cloud.state.puts[1].uploadId);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('C10 結果不明期間另一台裝置上傳了：uploadId 不符 → 轉入衝突（C06）', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await answer(t.store, 'ja-w-002');
  t.cloud.state.failPut.push('offline');
  await t.clock.advance(10000, [t.runner]);
  t.cloud.state.revision = 2;
  t.cloud.state.uploadId = 'up-other-device';
  await t.clock.advance(30000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 2);
  assert.deepEqual([t.runner.getState().status, t.runner.getState().reason], ['conflict', 'both-changed']);
  t.runner.stop();
});

test('C11 前端：壓縮後超過 8 MiB 不送出、進入太大狀態、不自動重試', async () => {
  const seen = [];
  const t = setup({ compress: async (text, { maxBytes }) => {
    seen.push(maxBytes);
    throw new CloudApiError('TOO_LARGE', '紀錄太大', { limitBytes: maxBytes });
  } });
  await answer(t.store);
  await t.runner.start(); await t.settle();
  assert.deepEqual(seen, [SNAPSHOT_MAX_BYTES]);
  assert.equal(SNAPSHOT_MAX_BYTES, 8388608);
  assert.equal(t.cloud.state.puts.length, 0);
  assert.equal(t.runner.getState().status, 'too-large');
  assert.equal(t.runner.getState().limitBytes, 8388608);
  assert.deepEqual(t.clock.pending(), [], '沒有重試計時器');
  await answer(t.store, 'ja-w-002');
  t.life().hidden();
  t.life().visible();
  t.life().online();
  await t.clock.advance(3600000, [t.runner]);
  assert.equal(seen.length, 1, '同一個 epoch 的作答、隱藏、回到頁面都不重試');
  assert.equal(t.cloud.state.puts.length, 0);
  assert.equal(t.runner.getState().status, 'too-large');
  t.runner.stop();
});

test('C11 前端：用真的 gzip 串流，超過上限時不送出', async () => {
  const { gzipText } = await import('../assets/js/ui/platform/cloud-api.js');
  const t = setup({ compress: (text, options) => gzipText(text, { ...options, maxBytes: 64 }) });
  await answer(t.store);
  await t.runner.start(); await t.settle();
  assert.equal(t.runner.getState().status, 'too-large');
  assert.equal(t.cloud.state.puts.length, 0);
  t.runner.stop();
});

test('runner：伺服器回 413 也進入太大狀態且不重試', async () => {
  const t = setup();
  await answer(t.store);
  t.cloud.upload = async () => { throw new CloudApiError('TOO_LARGE', '紀錄太大', { status: 413 }); };
  await t.runner.start(); await t.settle();
  assert.equal(t.runner.getState().status, 'too-large');
  assert.deepEqual(t.clock.pending(), []);
  t.runner.stop();
});

test('C15 兩個分頁同時觸發：同一時間只有一個上傳，另一個讀到新基準後不重複上傳', async () => {
  const a = setup();
  const b = setup({ shared: a.shared });
  await answer(a.store);
  await a.runner.start(); await b.runner.start();
  await settle([a.runner, b.runner]);
  assert.equal(a.cloud.state.puts.length, 1, '開頁時兩個分頁也只上傳一次');
  await answer(a.store, 'ja-w-002');
  await answer(b.store, 'ja-w-003');
  await a.clock.advance(10000, [a.runner, b.runner]);
  assert.equal(a.cloud.state.puts.length, 2, '只有一個分頁送出');
  assert.equal(a.locks.maxHeld, 1, '同一時間只有一個持有鎖');
  assert.ok(a.cloud.state.insideLock.every((held) => held === 1), '上傳一律在鎖內');
  assert.equal(a.runner.getState().status, 'synced');
  assert.equal(b.runner.getState().status, 'synced');
  assert.equal(a.baseline.get(ACCOUNT).localRevision, (await a.store.ready()).revision);
  a.runner.stop(); b.runner.stop();
});

test('runner：409 進入衝突、不重試；選「用這台的」以目前雲端 revision 上傳', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await answer(t.store, 'ja-w-002');
  const realUpload = t.cloud.upload;
  t.cloud.upload = async (bytes, options) => { t.cloud.state.revision = 4; t.cloud.upload = realUpload; return realUpload(bytes, options); };
  await t.clock.advance(10000, [t.runner]);
  assert.deepEqual([t.runner.getState().status, t.runner.getState().reason], ['conflict', 'revision-mismatch']);
  assert.equal(t.runner.getState().cloudRevision, 4);
  assert.deepEqual(t.clock.pending(), []);
  await t.runner.resolveConflict('later');
  assert.equal(t.runner.getState().status, 'conflict');
  assert.equal(t.runner.getState().deferred, true);
  await t.clock.advance(600000, [t.runner]);
  assert.equal(t.cloud.state.revision, 4, '稍後再說：不上傳');
  await t.runner.resolveConflict('local');
  await t.settle();
  assert.equal(t.cloud.state.puts.at(-1).ifMatch, 4);
  assert.equal(t.cloud.state.revision, 5);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('runner：選「用雲端的」進入套用中，等畫面完成預覽與還原', async () => {
  const t = setup({ cloudRevision: 2 });
  await answer(t.store);
  await t.runner.start(); await t.settle();
  await t.runner.resolveConflict('cloud');
  assert.equal(t.runner.getState().status, 'applying');
  assert.equal(t.cloud.state.puts.length, 0);
  t.runner.stop();
});

test('runner：401 需要重新登入、403 沒有權限，都停止重試', async () => {
  const t = setup();
  t.cloud.state.failMeta.push('unauthorized');
  await answer(t.store);
  await t.runner.start(); await t.settle();
  assert.equal(t.runner.getState().status, 'reauth');
  t.life().visible(); t.life().online();
  await t.clock.advance(600000, [t.runner]);
  assert.equal(t.cloud.state.metaCalls, 1);
  t.runner.stop();

  const f = setup();
  f.cloud.state.failMeta.push('forbidden');
  await f.runner.start(); await f.settle();
  assert.deepEqual([f.runner.getState().status, f.runner.getState().reason], ['reauth', 'forbidden']);
  f.runner.stop();
});

test('C12 執行器：429 延到 Retry-After 之後才再試，不提早重送', async () => {
  const t = setup();
  await answer(t.store);
  t.cloud.state.failPut.push('rate');
  await t.runner.start(); await t.settle();
  assert.deepEqual([t.runner.getState().status, t.runner.getState().reason], ['unsynced', 'RATE_LIMITED']);
  t.life().online(); t.life().visible();
  await t.clock.advance(899000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 1, 'Retry-After 之前不重送');
  await t.clock.advance(1000, [t.runner]);
  assert.equal(t.cloud.state.puts.length, 2);
  assert.equal(t.runner.getState().status, 'synced');
  t.runner.stop();
});

test('runner：stop 後不再有任何請求、計時器或狀態變化', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  t.runner.stop();
  assert.equal(t.runner.getState().status, 'stopped');
  assert.equal(t.life(), null, '已解除頁面事件');
  const count = t.states.length;
  const metaCalls = t.cloud.state.metaCalls;
  await answer(t.store, 'ja-w-002');
  await t.clock.advance(600000, [t.runner]);
  await t.runner.check();
  assert.equal(t.cloud.state.metaCalls, metaCalls);
  assert.equal(t.states.length, count);
  assert.deepEqual(t.clock.pending(), []);
});

test('runner：subscribe 立即收到目前狀態，可取消訂閱；getState 回傳副本', async () => {
  const t = setup();
  const seen = [];
  const off = t.runner.subscribe((state) => seen.push(state.status));
  assert.deepEqual(seen, ['idle']);
  await t.runner.start(); await t.settle();
  off();
  const after = seen.length;
  await answer(t.store);
  await t.clock.advance(10000, [t.runner]);
  assert.equal(seen.length, after);
  const state = t.runner.getState();
  state.status = 'hacked';
  assert.notEqual(t.runner.getState().status, 'hacked');
  t.runner.stop();
});

test('runner：downloadCloud 回傳文字與雲端 revision，recordCloudApplied 未給 cloudRevision 時沿用下載的 revision', async () => {
  const t = setup({ cloudRevision: 0 });
  await answer(t.store);
  await t.runner.start(); await t.settle();
  t.cloud.state.revision = 7;
  const { text, revision } = await t.runner.downloadCloud();
  assert.equal(revision, 7);
  assert.equal(JSON.parse(text).format, 'lang-learn.backup');
  const meta = await t.store.ready();
  await t.runner.recordCloudApplied({ revision: meta.revision, dataEpoch: meta.dataEpoch });
  assert.equal(t.baseline.get(ACCOUNT).cloudRevision, 7);
  t.runner.stop();
});

test('runner：同步基準只存在 lang-learn.cloud.v1，不寫其他 key', async () => {
  const t = setup();
  await answer(t.store);
  await t.runner.start(); await t.settle();
  assert.deepEqual([...t.storage.data.keys()], [CLOUD_BASELINE_KEY]);
  t.runner.stop();
});
