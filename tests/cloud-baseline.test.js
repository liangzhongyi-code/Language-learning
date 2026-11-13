import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { createLearningStore, openLearningChannel, LEARNING_CHANNEL } from '../assets/js/ui/platform/learning-store.js';
import { createCloudBaseline, CLOUD_BASELINE_KEY } from '../assets/js/ui/platform/cloud-baseline.js';
import { encodeBackupCode, decodeBackupCode } from '../assets/js/core/backup-code.js';

/**
 * 假帳號與假 email 只用於確認它們不會出現在任何匯出內容；不是真實資料。
 */
const ACCOUNT = 'acct-test-7f3a91';
const EMAIL = 'learner@example.test';
const AT = 1_791_158_400_000;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

const quiz = (ids) => ({ source: 'words', questions: ids.map((id) => ({
  kind: 'choice', sourceId: id, options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: 0,
})) });

async function record(store, id, operationId) {
  return store.recordQuizSession({ lang: 'ja', source: 'words', session: quiz([id]),
    summary: { total: 1, correct: 1 }, operationId, at: AT });
}

/**
 * 假的 BroadcastChannel：記下送出的訊息，並可模擬其他分頁送來的訊息。
 */
function fakeChannel() {
  const sent = [];
  let handler = null;
  return {
    sent,
    closed: false,
    postMessage(message) { sent.push(JSON.parse(JSON.stringify(message))); },
    addEventListener(type, listener) { if (type === 'message') handler = listener; },
    removeEventListener() { handler = null; },
    close() { this.closed = true; },
    deliver(data) { handler?.({ data }); },
  };
}

test('T15 寫入成功後通知訂閱者 {revision, dataEpoch}', async () => {
  const repository = createMemoryRepository();
  const store = createLearningStore({ repository, now: () => AT });
  const events = [];
  store.onChange((change) => events.push(change));
  const meta = await store.ready();
  const result = await record(store, 'ja-w-001', 'op-1');
  assert.equal(result.revision, meta.revision + 1, '既有回傳值不變');
  assert.deepEqual(events, [{ revision: meta.revision + 1, dataEpoch: meta.dataEpoch, source: 'local' }]);
});

test('T15 沒有變更或寫入失敗時不通知', async () => {
  const repository = createMemoryRepository();
  const store = createLearningStore({ repository, now: () => AT });
  const events = [];
  store.onChange((change) => events.push(change));
  await store.commit({ stores: ['stats'], operationId: 'noop', build: () => [] });
  await assert.rejects(store.commit({ stores: ['stats'], operationId: 'bad', build: () => [{ store: 'nope', key: 'x', value: 1 }] }));
  assert.deepEqual(events, []);
});

test('T15 清除與重新開始都通知新的 dataEpoch', async () => {
  const repository = createMemoryRepository();
  const store = createLearningStore({ repository, now: () => AT });
  const events = [];
  store.onChange((change) => events.push(change));
  await record(store, 'ja-w-001', 'op-1');
  const before = await store.ready();
  await store.clearAll();
  const cleared = await store.ready();
  assert.notEqual(cleared.dataEpoch, before.dataEpoch);
  assert.deepEqual(events.at(-1), { revision: cleared.revision, dataEpoch: cleared.dataEpoch, source: 'local' });
  await store.startFresh();
  const fresh = await store.ready();
  assert.deepEqual(events.at(-1), { revision: fresh.revision, dataEpoch: fresh.dataEpoch, source: 'local' });
});

test('T15 訂閱者丟出例外不影響寫入結果與其他訂閱者', async () => {
  const repository = createMemoryRepository();
  const store = createLearningStore({ repository, now: () => AT });
  const seen = [];
  store.onChange(() => { throw new Error('訂閱者壞掉'); });
  store.onChange((change) => seen.push(change.revision));
  const result = await record(store, 'ja-w-001', 'op-1');
  assert.equal(result.revision, 1);
  assert.deepEqual(seen, [1]);
  assert.equal((await store.ready()).revision, 1, '只寫入一次，沒有因例外重試');
});

test('T15 取消訂閱後不再收到通知', async () => {
  const store = createLearningStore({ repository: createMemoryRepository(), now: () => AT });
  const events = [];
  const off = store.onChange((change) => events.push(change));
  off();
  await record(store, 'ja-w-001', 'op-1');
  assert.deepEqual(events, []);
});

test('T15 以 BroadcastChannel 通知其他分頁，並把其他分頁的通知轉給本頁訂閱者', async () => {
  const channel = fakeChannel();
  const store = createLearningStore({ repository: createMemoryRepository(), now: () => AT, channel });
  const events = [];
  store.onChange((change) => events.push(change));
  const meta = await store.ready();
  await record(store, 'ja-w-001', 'op-1');
  assert.deepEqual(channel.sent, [{ type: 'learning-change', revision: 1, dataEpoch: meta.dataEpoch }]);
  channel.deliver({ type: 'learning-change', revision: 7, dataEpoch: 'epoch-other' });
  channel.deliver({ type: 'something-else', revision: 8, dataEpoch: 'x' });
  channel.deliver({ type: 'learning-change', revision: -1, dataEpoch: 'x' });
  channel.deliver(null);
  assert.deepEqual(events.at(-1), { revision: 7, dataEpoch: 'epoch-other', source: 'remote' });
  assert.equal(events.length, 2, '格式不對的訊息直接忽略');
});

test('T15 BroadcastChannel 送出失敗或不支援時安全略過', async () => {
  const broken = { postMessage() { throw new Error('closed'); }, addEventListener() {}, close() {} };
  const store = createLearningStore({ repository: createMemoryRepository(), now: () => AT, channel: broken });
  assert.equal((await record(store, 'ja-w-001', 'op-1')).revision, 1);
  assert.equal(openLearningChannel(null), null, '沒有 BroadcastChannel 時回傳 null');
  assert.equal(openLearningChannel(function Broken() { throw new Error('nope'); }), null, '建構失敗時回傳 null');
});

test('T15 真的 BroadcastChannel：兩個 store 互相收到通知', async () => {
  const channelA = openLearningChannel(globalThis.BroadcastChannel, 'lang-learn.test-' + Math.random());
  const channelB = new BroadcastChannel(channelA.name);
  const repository = createMemoryRepository();
  const a = createLearningStore({ repository, now: () => AT, channel: channelA });
  const b = createLearningStore({ repository, now: () => AT, channel: channelB });
  try {
    const received = new Promise((resolve) => b.onChange(resolve));
    const meta = await a.ready();
    await record(a, 'ja-w-001', 'op-1');
    assert.deepEqual(await received, { revision: 1, dataEpoch: meta.dataEpoch, source: 'remote' });
    assert.equal(LEARNING_CHANNEL, 'lang-learn.learning');
  } finally {
    a.close(); b.close();
  }
});

test('T15 同步基準：依帳號分開存取，key 固定為 lang-learn.cloud.v1', () => {
  const storage = memoryStorage();
  const baseline = createCloudBaseline({ storage, now: () => 1000 });
  assert.equal(CLOUD_BASELINE_KEY, 'lang-learn.cloud.v1');
  assert.equal(baseline.get(ACCOUNT), null);
  assert.equal(baseline.set(ACCOUNT, { cloudRevision: 3, localRevision: 9, localEpoch: 'e1', origin: 'upload' }), true);
  assert.equal(baseline.set('acct-other', { cloudRevision: 1, localRevision: 2, localEpoch: 'e9', origin: 'cloud', paused: true }), true);
  assert.deepEqual(baseline.get(ACCOUNT), { cloudRevision: 3, localRevision: 9, localEpoch: 'e1', origin: 'upload', paused: false, updatedAt: 1000 });
  assert.deepEqual(baseline.get('acct-other'), { cloudRevision: 1, localRevision: 2, localEpoch: 'e9', origin: 'cloud', paused: true, updatedAt: 1000 });
  const raw = JSON.parse(storage.getItem(CLOUD_BASELINE_KEY));
  assert.deepEqual(Object.keys(raw).sort(), [ACCOUNT, 'acct-other'].sort());
  assert.equal(baseline.update(ACCOUNT, { paused: true }), true);
  assert.equal(baseline.get(ACCOUNT).paused, true);
  assert.equal(baseline.get('acct-other').localEpoch, 'e9', '更新一個帳號不影響其他帳號');
  baseline.clear(ACCOUNT);
  assert.equal(baseline.get(ACCOUNT), null);
  assert.notEqual(baseline.get('acct-other'), null);
});

test('T15 同步基準：壞資料當作沒有基準，不丟例外', () => {
  const broken = ['{', 'null', '[]', '"x"', '42', JSON.stringify({ [ACCOUNT]: 'x' }),
    JSON.stringify({ [ACCOUNT]: { cloudRevision: -1, localRevision: 1, localEpoch: 'e1', origin: 'upload' } }),
    JSON.stringify({ [ACCOUNT]: { cloudRevision: 1, localRevision: 1.5, localEpoch: 'e1', origin: 'upload' } }),
    JSON.stringify({ [ACCOUNT]: { cloudRevision: 1, localRevision: 1, localEpoch: '', origin: 'upload' } }),
    JSON.stringify({ [ACCOUNT]: { cloudRevision: 1, localRevision: 1, localEpoch: 'e1', origin: 'hack' } }),
    JSON.stringify({ [ACCOUNT]: { cloudRevision: 1, localRevision: 1, localEpoch: 'e1', origin: 'upload', paused: 'yes' } })];
  for (const value of broken) {
    const baseline = createCloudBaseline({ storage: memoryStorage({ [CLOUD_BASELINE_KEY]: value }) });
    assert.equal(baseline.get(ACCOUNT), null, value);
  }
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  const baseline = createCloudBaseline({ storage: throwing });
  assert.equal(baseline.get(ACCOUNT), null);
  assert.equal(baseline.set(ACCOUNT, { cloudRevision: 1, localRevision: 1, localEpoch: 'e1', origin: 'upload' }), false);
  assert.doesNotThrow(() => baseline.clear(ACCOUNT));
  assert.equal(createCloudBaseline({ storage: null }).get(ACCOUNT), null, '沒有 storage 時也不丟例外');
});

test('T15 同步基準：壞掉的整份資料在下一次寫入時被乾淨取代', () => {
  const storage = memoryStorage({ [CLOUD_BASELINE_KEY]: '{oops' });
  const baseline = createCloudBaseline({ storage, now: () => 5 });
  assert.equal(baseline.set(ACCOUNT, { cloudRevision: 1, localRevision: 2, localEpoch: 'e1', origin: 'cloud' }), true);
  assert.deepEqual(JSON.parse(storage.getItem(CLOUD_BASELINE_KEY)), {
    [ACCOUNT]: { cloudRevision: 1, localRevision: 2, localEpoch: 'e1', origin: 'cloud', paused: false, updatedAt: 5 } });
});

test('T15 同步基準：拒絕不合法的帳號 ID 與紀錄', () => {
  const storage = memoryStorage();
  const baseline = createCloudBaseline({ storage });
  const good = { cloudRevision: 1, localRevision: 1, localEpoch: 'e1', origin: 'upload' };
  for (const id of ['', '__proto__', 'constructor', 'prototype', 42, null, 'x'.repeat(300)]) {
    assert.equal(baseline.set(id, good), false, String(id));
    assert.equal(baseline.get(id), null);
  }
  assert.equal(baseline.set(ACCOUNT, { ...good, origin: 'x' }), false);
  assert.equal(baseline.set(ACCOUNT, { ...good, cloudRevision: -1 }), false);
  assert.equal(baseline.update('acct-missing', { paused: true }), false, '沒有基準時不能只改暫停');
  assert.equal(storage.getItem(CLOUD_BASELINE_KEY), null);
  assert.equal(Object.prototype.polluted, undefined);
});

test('C16 匯出的備份 JSON 與備份代碼都不含同步基準、帳號 ID 或 email', async () => {
  const storage = memoryStorage();
  const baseline = createCloudBaseline({ storage, now: () => AT });
  const store = createLearningStore({ repository: createMemoryRepository(), now: () => AT });
  await record(store, 'ja-w-001', 'op-1');
  const meta = await store.ready();
  baseline.set(ACCOUNT, { cloudRevision: 4, localRevision: meta.revision, localEpoch: meta.dataEpoch, origin: 'upload' });
  storage.setItem('lang-learn.prefs.v1', JSON.stringify({ theme: 'light' }));
  assert.notEqual(storage.getItem(CLOUD_BASELINE_KEY), null, '前提：同步基準已存在');

  const payload = await store.exportBackup({ prefs: { theme: 'light' } });
  const json = JSON.stringify(payload, null, 2);
  const decoded = await decodeBackupCode(await encodeBackupCode(payload));
  for (const [label, text] of [['備份檔', json], ['備份代碼解碼後', decoded]]) {
    for (const secret of [CLOUD_BASELINE_KEY, 'cloudRevision', 'localEpoch', ACCOUNT, EMAIL, 'accountId', '__Host-ll_session']) {
      assert.equal(text.includes(secret), false, `${label} 不可含有 ${secret}`);
    }
  }
});
