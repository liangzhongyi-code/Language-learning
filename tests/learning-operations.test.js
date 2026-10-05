import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, checkOperation, operationReceipt } from '../assets/js/core/learning-operations.js';

const meta = { revision: 3, dataEpoch: 'epoch-a' };
const operation = { operationId: 'answer-1', epoch: 'epoch-a', expectedRevision: 3, payload: { value: 1 } };
const hash = 'a'.repeat(64);
const check = (extra = {}) => checkOperation({ meta, operation, payloadHash: hash, ...extra });
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);

test('F02/D12：同語意物件以相同排序編碼，不依物件插入顺序', () => {
  assert.equal(canonicalJson({ z: [1, { b: 2, a: 1 }], a: false }),
    canonicalJson({ a: false, z: [1, { a: 1, b: 2 }] }));
  assert.notEqual(canonicalJson({ x: [1, 2] }), canonicalJson({ x: [2, 1] }));
});

test('F02：雜湊輸入拒絕非JSON值、循環、非finite與原型污染', () => {
  const loop = {}; loop.x = loop;
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), { x: undefined }, { x() {} },
    loop, JSON.parse('{"__proto__":{}}'), JSON.parse('{"constructor":1}')]) {
    rejects(() => canonicalJson(value), 'INVALID_OPERATION');
  }
});

test('F02/D13：只允許目前 epoch 與 revision 的新操作', () => {
  assert.deepEqual(check(), { replay: false });
  rejects(() => check({ operation: { ...operation, epoch: 'old' } }), 'STALE_EPOCH');
  rejects(() => check({ operation: { ...operation, expectedRevision: 2 } }), 'REVISION_CONFLICT');
});

test('F02/D12：成功重送先查收據，舊 revision 不重複計分', () => {
  const receipt = operationReceipt(operation, hash, 4);
  assert.deepEqual(check({ meta: { ...meta, revision: 8 }, receipt }), { replay: true, result: { revision: 4 } });
  rejects(() => check({ meta: { ...meta, dataEpoch: 'new' }, receipt }), 'STALE_EPOCH');
});

test('F02/D12：同 operationId 不同內容必須拒絕', () => {
  const receipt = operationReceipt(operation, hash, 4);
  rejects(() => check({ meta: { ...meta, revision: 4 }, receipt, payloadHash: 'b'.repeat(64) }), 'OPERATION_MISMATCH');
});

test('F02：錯配或畸形的收據不可以冒用為成功', () => {
  const receipt = operationReceipt(operation, hash, 4);
  for (const broken of [
    { ...receipt, operationId: 'answer-2' },
    { ...receipt, epoch: 'epoch-b' },
    { ...receipt, result: { revision: NaN } },
    { ...receipt, result: { revision: 0 } },
  ]) rejects(() => check({ receipt: broken }), 'INVALID_RECEIPT');
});

test('F02：非法操作id、revision或hash在寫入前拒絕', () => {
  for (const id of ['', '__proto__', 'bad/id', 'a'.repeat(129)]) {
    rejects(() => check({ operation: { ...operation, operationId: id } }), 'INVALID_OPERATION');
  }
  for (const expectedRevision of [-1, 1.5, NaN, Infinity, '3']) {
    rejects(() => check({ operation: { ...operation, expectedRevision } }), 'INVALID_OPERATION');
  }
  rejects(() => check({ payloadHash: 'not-a-hash' }), 'INVALID_OPERATION');
  rejects(() => check({ meta: { ...meta, revision: Number.MAX_SAFE_INTEGER },
    operation: { ...operation, expectedRevision: Number.MAX_SAFE_INTEGER } }), 'REVISION_EXHAUSTED');
});

test('F02：回放結果是複本，不可改掉既有收據', () => {
  const receipt = operationReceipt(operation, hash, 4);
  const result = check({ meta: { ...meta, revision: 4 }, receipt }).result;
  assert.ok(result);
  result.revision = 90;
  assert.equal(receipt.result.revision, 4);
});

test('F02/D12：同 ID 同 hash 重送不因刷新 expectedRevision 誤判收據損毀', () => {
  const receipt = operationReceipt(operation, hash, 4);
  for (const expectedRevision of [3, 4, 8]) {
    assert.deepEqual(check({ meta: { ...meta, revision: 8 }, receipt,
      operation: { ...operation, expectedRevision } }), { replay: true, result: { revision: 4 } });
  }
});

test('F02/D12：刷新 revision 仍須辨識同 ID 異 hash', () => {
  rejects(() => check({ meta: { ...meta, revision: 8 }, receipt: operationReceipt(operation, hash, 4),
    operation: { ...operation, expectedRevision: 8 }, payloadHash: 'b'.repeat(64) }), 'OPERATION_MISMATCH');
});

test('F02/D19：收據結果不得超過資料庫目前 revision', () => {
  for (const revision of [4, 999]) {
    rejects(() => check({ receipt: { ...operationReceipt(operation, hash, 4), result: { revision } } }), 'INVALID_RECEIPT');
  }
});

test('F02/D19：零版本收據不可因 caller expectedRevision 較低而被接受', () => {
  rejects(() => check({ operation: { ...operation, expectedRevision: 0 },
    receipt: { ...operationReceipt(operation, hash, 4), result: { revision: 0 } } }), 'INVALID_RECEIPT');
});
