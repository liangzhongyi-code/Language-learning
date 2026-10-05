import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLearning, validateLearning } from '../assets/js/core/learning-schema.js';
import { exportLearningBackup, parseLearningBackup } from '../assets/js/core/learning-backup.js';
import { BACKUP_JSON_MAX_BYTES } from '../assets/js/core/backup-limits.js';

const now = 1791172800000;
const context = { now, timeZone: 'Asia/Taipei' };
const fresh = () => ({ stats: { schemaVersion: 1, byScope: {} },
  progress: { schemaVersion: 1, items: {} }, learning: emptyLearning(context),
  prefs: { theme: 'dark', kanjiMode: 'show' } });
const envelope = (data = fresh(), version = 2) => ({ format: 'lang-learn.backup', version, exportedAt: now, ...data });
const read = (value) => parseLearningBackup(JSON.stringify(value), context);

test('F05/O17 v2 完整群組來回一致，預覽含筆記與單字簿數', () => {
  const data = fresh();
  data.learning.library.notes['ja-w-001'] = { wordId: 'ja-w-001', text: '<b>私人筆記</b>', updatedAt: now, revision: 0 };
  const payload = exportLearningBackup(data, now);
  assert.equal(payload.version, 2);
  const result = read(payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, data);
  assert.equal(result.counts.notes, 1);
  assert.equal(result.counts.books, 1);
  assert.equal(result.legacyReplacement, false);
});

test('F05/O17 v2 學習群組缺少任一欄，不可各別救回統計／進度', () => {
  for (const missing of ['stats', 'progress', 'learning']) {
    const payload = envelope(); delete payload[missing];
    const result = read(payload);
    assert.equal(result.ok, true, '仍可獨立救偏好');
    assert.deepEqual(result.data, { prefs: payload.prefs });
    assert.match(result.errors.join(''), /完整|群組/);
  }
});

test('F05/D21 v2 深度錯誤、未知版本或外鍵損毀不進學習群組', () => {
  for (const mutate of [
    d => { d.stats.byScope['ja:words'] = { answered: 1, correct: 2, sessions: 0 }; },
    d => { d.progress.items.x = { n: -1, w: 0 }; },
    d => { d.learning.schemaVersion = 9; },
    d => { delete d.learning.library.books.favorites; },
    d => { d.learning.meta.dataEpoch = '__proto__'; },
  ]) {
    const payload = envelope(); mutate(payload);
    const result = read(payload);
    assert.deepEqual(Object.keys(result.data), ['prefs']);
    assert.ok(result.errors.length > 0);
  }
});

test('F05/D20 v1 匯入明示替換，保留原 due/n/w，不捏造事件', () => {
  const data = fresh(); delete data.learning;
  data.progress.items['ja-w-001'] = { n: 4, w: 1, box: 2, due: now + 12345, last: now - 10 };
  const result = read(envelope(data, 1));
  assert.equal(result.ok, true);
  assert.equal(result.legacyReplacement, true);
  assert.match(result.warnings.join(''), /每日|筆記/);
  assert.deepEqual(result.data.progress, data.progress);
  assert.deepEqual(result.data.learning.reviewEvents, {});
  assert.equal(result.data.learning.meta.migrationStatus, 'complete');
});

test('F05/D20 v0 外殼相容；v1 單一舊區塊補明示空群組但不救壞半份', () => {
  const result = read(envelope({ progress: fresh().progress }, 0));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.stats, fresh().stats);
  assert.equal(result.legacyReplacement, true);
  assert.equal(read(envelope({ stats: 'broken', progress: fresh().progress }, 1)).ok, false);
});

test('F05/D21 外殼版本不得缺失、字串、負數、小數或未來值', () => {
  for (const version of [undefined, '2', -1, 1.5, 3, null]) {
    const result = read(envelope(fresh(), version));
    if (version === undefined) { const p = envelope(); delete p.version; assert.equal(read(p).ok, false); }
    else assert.equal(result.ok, false);
  }
});

test('F05/O17 純偏好可救；OAuth／未知憑證欄位拒絕但不牽連學習群組', () => {
  assert.deepEqual(read(envelope({ prefs: { theme: 'light' } })).data, { prefs: { theme: 'light' } });
  const payload = envelope(); payload.prefs.accessToken = 'fixture-not-a-real-token';
  const result = read(payload);
  assert.equal(result.ok, true);
  assert.equal('prefs' in result.data, false);
  assert.ok(result.data.learning);
  assert.match(result.errors.join(''), /偏好/);
});

test('F05/O06 原型污染、非 JSON 值與不支援外殼欄位不可偷偷匯出', () => {
  const pollution = JSON.parse('{"__proto__":{"x":1}}');
  const payload = envelope({ prefs: pollution });
  assert.equal(read(payload).ok, false);
  assert.equal(read({ ...envelope(), restorePoints: [] }).ok, false);
  const data = fresh(); data.progress.items.x = { n: Infinity, w: 0 };
  assert.throws(() => exportLearningBackup(data, now), /備份|資料/);
});

test('F05/O18 匯出不攜出本機操作收據，也不修改來源物件', () => {
  const data = fresh(); data.learning.meta.revision = 1;
  data.learning.operations.op = { operationId: 'op', epoch: data.learning.meta.dataEpoch,
    payloadHash: 'a'.repeat(64), result: { revision: 1 } };
  const before = JSON.stringify(data);
  const payload = exportLearningBackup(data, now);
  assert.deepEqual(payload.learning.operations, {});
  assert.equal(JSON.stringify(data), before);
  payload.learning.library.books.favorites.name = '外部修改';
  assert.equal(data.learning.library.books.favorites.name, '收藏');
});

test('F05/O17 raw UTF-8 大小限額在 JSON.parse 前拒絕', () => {
  const result = parseLearningBackup(' '.repeat(BACKUP_JSON_MAX_BYTES + 1), context);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BACKUP_SIZE_LIMIT');
  assert.match(result.errors.join(''), /10 MiB/);
});

test('回歸：本機收據超過限額時仍可匯出小型可攜備份，來源保持不變', () => {
  const data = fresh();
  data.learning.meta.revision = 100000;
  for (let i = 1; i <= 100000; i++) {
    const operationId = `op-${i}`;
    data.learning.operations[operationId] = { operationId, epoch: data.learning.meta.dataEpoch,
      payloadHash: 'a'.repeat(64), result: { revision: i } };
  }
  assert.equal(validateLearning(data.learning).ok, true);
  const before = JSON.stringify(data);
  assert.ok(new TextEncoder().encode(before).byteLength > BACKUP_JSON_MAX_BYTES);
  const payload = exportLearningBackup(data, now);
  assert.deepEqual(payload.learning.operations, {});
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).byteLength < 10000);
  assert.equal(JSON.stringify(data), before);
  assert.equal(read(payload).ok, true);
});

test('回歸：移除本機收據不得掩蓋非法收據或其他學習資料', () => {
  for (const mutate of [
    d => { d.learning.operations.bad = { operationId: 'bad' }; },
    d => { d.learning.operations.bad = { operationId: 'bad', epoch: 'other-epoch',
      payloadHash: 'a'.repeat(64), result: { revision: 1 } }; },
    d => { d.learning.library.books.favorites.wordIds = 'broken'; },
    d => { d.progress.items['ja-w-001'] = { n: 1, w: 2 }; },
  ]) {
    const data = fresh(); mutate(data);
    const before = JSON.stringify(data);
    assert.throws(() => exportLearningBackup(data, now), { code: 'INVALID_BACKUP' });
    assert.equal(JSON.stringify(data), before);
  }
});

test('回歸：真正可攜內容超過 10 MiB 仍須拒絕匯出', () => {
  const data = fresh();
  for (let i = 0; i < 2000; i++) {
    const wordId = `ja-w-${i}`;
    data.learning.library.notes[wordId] = { wordId, text: '字'.repeat(2000), updatedAt: now, revision: 0 };
  }
  assert.equal(validateLearning(data.learning).ok, true);
  assert.throws(() => exportLearningBackup(data, now), { code: 'BACKUP_SIZE_LIMIT' });
});

test('F05/O17 空資料、錯誤 JSON、錯誤時間均有繁中訊息', () => {
  for (const text of ['null', '[]', '{}', '{']) {
    const result = parseLearningBackup(text, context);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length);
  }
  assert.equal(read(envelope({})).ok, false);
  assert.equal(read({ ...envelope(), exportedAt: -1 }).ok, false);
});
