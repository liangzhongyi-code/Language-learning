import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isLearningEmpty, SYNC_ACTIONS } from '../assets/js/core/cloud-sync.js';

/**
 * 同步判斷的狀態表：每列是「本機、同步基準、雲端」的一種組合與預期動作。
 * 只用假資料；帳號 ID 是隨機樣式的假值，不含 email。
 */
const ACCOUNT = 'acct-a1';
const OTHER = 'acct-b2';
const local = (revision, dataEpoch = 'e1', empty = false) => ({ revision, dataEpoch, empty });
const base = (cloudRevision, localRevision, localEpoch = 'e1', extra = {}) => ({
  accountId: ACCOUNT, cloudRevision, localRevision, localEpoch, origin: 'upload', paused: false, updatedAt: 1, ...extra,
});
const cloud = (revision, uploadId = null) => ({ revision, uploadId });

const TABLE = [
  // 沒有同步基準：第一次登入（C01～C03）
  ['C01 雲端空、本機有資料、沒有基準 → 自動上傳（If-Match 0）',
    { local: local(5), baseline: null, cloud: cloud(0) }, { action: 'upload', reason: 'first-upload', ifMatch: 0 }],
  ['兩邊都空、沒有基準 → 無事',
    { local: local(1, 'e1', true), baseline: null, cloud: cloud(0) }, { action: 'none', reason: 'both-empty' }],
  ['C02 雲端有、本機空、沒有基準 → 提示雲端有紀錄（新裝置）',
    { local: local(1, 'e1', true), baseline: null, cloud: cloud(3) }, { action: 'offer-cloud', reason: 'new-device' }],
  ['C03 兩邊都有資料、沒有基準 → 衝突，不上傳',
    { local: local(5), baseline: null, cloud: cloud(3) }, { action: 'conflict', reason: 'first-login' }],

  // C14 換帳號：別的帳號的基準一律不沿用
  ['C14 只有帳號 A 的基準、帳號 B 雲端空、本機有資料 → 依 C01 上傳到 B',
    { local: local(5), baseline: base(4, 5, 'e1', { accountId: OTHER }), cloud: cloud(0) }, { action: 'upload', reason: 'first-upload', ifMatch: 0 }],
  ['C14 只有帳號 A 的基準、帳號 B 雲端有資料、本機有資料 → 衝突（不自動上傳到 B）',
    { local: local(5), baseline: base(4, 5, 'e1', { accountId: OTHER }), cloud: cloud(4) }, { action: 'conflict', reason: 'first-login' }],
  ['C14 只有帳號 A 的基準、帳號 B 雲端有資料、本機空 → 提示新裝置',
    { local: local(1, 'e1', true), baseline: base(4, 5, 'e1', { accountId: OTHER }), cloud: cloud(4) }, { action: 'offer-cloud', reason: 'new-device' }],
  ['C14 帳號 A 的基準即使暫停，也不影響帳號 B',
    { local: local(5), baseline: base(4, 5, 'e1', { accountId: OTHER, paused: true }), cloud: cloud(0) }, { action: 'upload', reason: 'first-upload', ifMatch: 0 }],

  // 有同步基準、同一個 dataEpoch
  ['已同步、兩邊都沒變 → 無事',
    { local: local(5), baseline: base(2, 5), cloud: cloud(2) }, { action: 'none', reason: 'in-sync' }],
  ['C04 本機有變更、雲端等於基準 → 上傳（If-Match 基準 revision）',
    { local: local(7), baseline: base(2, 5), cloud: cloud(2) }, { action: 'upload', reason: 'local-changed', ifMatch: 2 }],
  ['C05 雲端較新、本機未變 → 提示套用雲端',
    { local: local(5), baseline: base(2, 5), cloud: cloud(3) }, { action: 'offer-cloud', reason: 'cloud-newer' }],
  ['C06 雲端較新、本機也有變更 → 衝突',
    { local: local(6), baseline: base(2, 5), cloud: cloud(3) }, { action: 'conflict', reason: 'both-changed' }],
  ['本機 revision 小於基準（同 epoch，不應發生）→ 視為未變更',
    { local: local(4), baseline: base(2, 5), cloud: cloud(2) }, { action: 'none', reason: 'in-sync' }],

  // C08 整組替換
  ['C08 清除或匯入後（dataEpoch 改變）、雲端等於基準 → 詢問，不上傳',
    { local: local(9, 'e2'), baseline: base(2, 5), cloud: cloud(2) }, { action: 'ask-replace', reason: 'local-replaced' }],
  ['C08 清除後本機變空，仍要詢問，不視為新裝置',
    { local: local(9, 'e2', true), baseline: base(2, 5), cloud: cloud(2) }, { action: 'ask-replace', reason: 'local-replaced' }],
  ['整組替換且雲端也較新 → 衝突',
    { local: local(9, 'e2'), baseline: base(2, 5), cloud: cloud(3) }, { action: 'conflict', reason: 'replaced-and-cloud-newer' }],
  ['C08 由雲端套用造成的替換（基準 origin=cloud 且 epoch 已記錄）→ 不詢問、無事',
    { local: local(9, 'e2'), baseline: base(3, 9, 'e2', { origin: 'cloud' }), cloud: cloud(3) }, { action: 'none', reason: 'in-sync' }],
  ['套用雲端後本機再作答 → 依 C04 上傳',
    { local: local(11, 'e2'), baseline: base(3, 9, 'e2', { origin: 'cloud' }), cloud: cloud(3) }, { action: 'upload', reason: 'local-changed', ifMatch: 3 }],
  ['套用雲端後又從檔案匯入（epoch 再變）→ 仍要詢問',
    { local: local(12, 'e3'), baseline: base(3, 9, 'e2', { origin: 'cloud' }), cloud: cloud(3) }, { action: 'ask-replace', reason: 'local-replaced' }],

  // 暫停
  ['C08 選否後暫停 → 不上傳',
    { local: local(9, 'e2'), baseline: base(2, 5, 'e1', { paused: true }), cloud: cloud(2) }, { action: 'paused', reason: 'paused' }],
  ['暫停中本機繼續作答 → 仍暫停',
    { local: local(12, 'e1'), baseline: base(2, 5, 'e1', { paused: true }), cloud: cloud(2) }, { action: 'paused', reason: 'paused' }],
  ['呼叫端另外要求暫停 → 暫停',
    { local: local(7), baseline: base(2, 5), cloud: cloud(2), paused: true }, { action: 'paused', reason: 'paused' }],

  // 雲端比基準舊（例如雲端資料被刪除）→ 基準作廢，依第一次登入處理
  ['雲端 revision 小於基準、雲端空、本機有資料 → 基準作廢並依 C01 上傳',
    { local: local(5), baseline: base(4, 5), cloud: cloud(0) }, { action: 'upload', reason: 'first-upload', ifMatch: 0 }],
  ['雲端 revision 小於基準但仍有資料 → 基準作廢並依 C03 衝突',
    { local: local(5), baseline: base(4, 5), cloud: cloud(2) }, { action: 'conflict', reason: 'first-login' }],

  // C10 結果不明的上傳
  ['C10 雲端 revision 等於基準＋1 且 uploadId 相符 → 視為上傳成功',
    { local: local(7), baseline: base(2, 5), cloud: cloud(3, 'up-1'), pendingUpload: { uploadId: 'up-1', ifMatch: 2 } },
    { action: 'confirm-upload', reason: 'upload-confirmed', cloudRevision: 3 }],
  ['C10 第一次上傳（沒有基準）結果不明、雲端為 1 且 uploadId 相符 → 視為成功',
    { local: local(7), baseline: null, cloud: cloud(1, 'up-0'), pendingUpload: { uploadId: 'up-0', ifMatch: 0 } },
    { action: 'confirm-upload', reason: 'upload-confirmed', cloudRevision: 1 }],
  ['C10 uploadId 不符 → 依目前狀態重新判斷（C06）',
    { local: local(7), baseline: base(2, 5), cloud: cloud(3, 'up-x'), pendingUpload: { uploadId: 'up-1', ifMatch: 2 } },
    { action: 'conflict', reason: 'both-changed' }],
  ['C10 雲端沒變（請求沒到伺服器）→ 依目前狀態重新判斷（C04）',
    { local: local(7), baseline: base(2, 5), cloud: cloud(2, 'up-old'), pendingUpload: { uploadId: 'up-1', ifMatch: 2 } },
    { action: 'upload', reason: 'local-changed', ifMatch: 2 }],
];

for (const [name, input, expected] of TABLE) {
  test(`decide：${name}`, () => {
    const result = decide({ accountId: ACCOUNT, ...input });
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(result[key], value, `${key} 不符：${JSON.stringify(result)}`);
    }
    assert.ok(SYNC_ACTIONS.includes(result.action), '動作必須在公開清單內');
  });
}

test('decide：只有 upload 會帶 ifMatch，其餘動作都不會觸發上傳', () => {
  for (const [, input] of TABLE) {
    const result = decide({ accountId: ACCOUNT, ...input });
    if (result.action !== 'upload') assert.equal(result.ifMatch, undefined, JSON.stringify(result));
  }
});

test('decide：沒有帳號時不做任何事', () => {
  assert.deepEqual(decide({ accountId: '', local: local(5), baseline: null, cloud: cloud(0) }).action, 'none');
  assert.deepEqual(decide({ local: local(5), baseline: null, cloud: cloud(0) }).reason, 'no-account');
});

test('decide：輸入不合法時丟出 INVALID_SYNC_INPUT，不猜測動作', () => {
  const bad = [
    { local: local(5), baseline: null, cloud: { revision: -1 } },
    { local: local(5), baseline: null, cloud: { revision: 1.5 } },
    { local: local(5), baseline: null, cloud: null },
    { local: { revision: 'x', dataEpoch: 'e1', empty: false }, baseline: null, cloud: cloud(0) },
    { local: { revision: 1, dataEpoch: '', empty: false }, baseline: null, cloud: cloud(0) },
  ];
  for (const input of bad) {
    assert.throws(() => decide({ accountId: ACCOUNT, ...input }), (error) => error.code === 'INVALID_SYNC_INPUT');
  }
});

test('decide：壞掉的基準當作沒有基準', () => {
  const broken = { accountId: ACCOUNT, cloudRevision: 'x', localRevision: 5, localEpoch: 'e1' };
  assert.deepEqual(decide({ accountId: ACCOUNT, local: local(5), baseline: broken, cloud: cloud(0) }).action, 'upload');
  assert.deepEqual(decide({ accountId: ACCOUNT, local: local(5), baseline: broken, cloud: cloud(2) }).action, 'conflict');
});

test('decide：純函式，不改動輸入', () => {
  const input = { accountId: ACCOUNT, local: local(7), baseline: base(2, 5), cloud: cloud(2) };
  const before = JSON.stringify(input);
  decide(input);
  assert.equal(JSON.stringify(input), before);
});

/**
 * 本機是否為空：只看學習群組；預設的空收藏簿、成就政策與提醒預設不算資料。
 */
const emptyRows = () => ({
  stats: {}, progress: {}, itemStates: {}, reviewEvents: {}, dailyPlans: {}, dailyLedger: {}, sessions: {},
  notes: {}, intents: {}, books: { favorites: { id: 'favorites', wordIds: [] } },
  achievements: { policy: { policyVersion: 1 } }, reminders: { preferences: { enabled: false } },
});

test('isLearningEmpty：全新資料庫為空', () => {
  assert.equal(isLearningEmpty(emptyRows()), true);
  assert.equal(isLearningEmpty({}), true);
});

test('isLearningEmpty：任何學習資料都讓本機不為空', () => {
  const cases = [
    (rows) => { rows.stats['ja:words'] = { answered: 1, correct: 1, sessions: 1 }; },
    (rows) => { rows.progress['ja-w-001'] = { n: 1 }; },
    (rows) => { rows.itemStates['ja-w-001'] = {}; },
    (rows) => { rows.reviewEvents.e1 = {}; },
    (rows) => { rows.dailyPlans.p1 = {}; },
    (rows) => { rows.dailyLedger.l1 = {}; },
    (rows) => { rows.sessions.s1 = {}; },
    (rows) => { rows.notes['ja-w-001'] = {}; },
    (rows) => { rows.intents.i1 = {}; },
    (rows) => { rows.books.favorites.wordIds.push('ja-w-001'); },
    (rows) => { rows.books.b2 = { id: 'b2', wordIds: [] }; },
    (rows) => { rows.achievements['unlock:first-review'] = {}; },
    (rows) => { rows.achievements['calendar:2026-11-13:ja'] = {}; },
  ];
  for (const mutate of cases) {
    const rows = emptyRows();
    mutate(rows);
    assert.equal(isLearningEmpty(rows), false, mutate.toString());
  }
});
