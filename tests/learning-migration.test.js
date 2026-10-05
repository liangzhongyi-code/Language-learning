import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacy } from '../assets/js/core/learning-migration.js';
const now = 1791158400000;
const options = { now, timeZone: 'Asia/Taipei', dataEpoch: 'fixture-epoch' };
const stats = { schemaVersion: 1, byScope: { 'ja:words': { sessions: 2, answered: 20, correct: 12 } } };
const progress = { schemaVersion: 1, items: { 'ja-w-001': { n: 8, w: 3, box: 2, last: now - 1000, due: now + 60000 } } };

test('F04/D17：舊due/n/w及統計原樣保留，不反推不存在的日誌或能力', () => {
  const result = migrateLegacy({ ...options, statsRaw: JSON.stringify(stats), progressRaw: JSON.stringify(progress) });
  assert.deepEqual(result.stats, stats);
  assert.deepEqual(result.progress, progress);
  assert.deepEqual(result.learning.itemStates, {});
  assert.deepEqual(result.learning.reviewEvents, {});
  assert.equal(result.learning.meta.migrationStatus, 'complete');
  assert.equal(result.learning.meta.dataEpoch, 'fixture-epoch');
});

test('F04/D18：首次無舊資料建立空模型且標完成，不製造作答', () => {
  const result = migrateLegacy({ ...options, statsRaw: null, progressRaw: null });
  assert.deepEqual(result.progress.items, {});
  assert.deepEqual(result.learning.sessions, {});
  assert.equal(result.learning.meta.historyStartedAt, now);
  assert.equal(result.learning.meta.migrationStatus, 'complete');
});

test('F04/D19：畸形JSON、未來版本與非法計數拒絕而非靜默清空', () => {
  for (const raw of ['', '{', 'null', '[]', '{"schemaVersion":2,"items":{}}',
    '{"schemaVersion":1,"items":{"ja-w-001":{"n":-1,"w":0}}}']) {
    assert.throws(() => migrateLegacy({ ...options, statsRaw: JSON.stringify(stats), progressRaw: raw }),
      (error) => error.code === 'MIGRATION_INVALID');
  }
  assert.throws(() => migrateLegacy({ ...options, statsRaw: '{"schemaVersion":1,"byScope":{"ja:words":{"answered":1,"correct":2,"sessions":0}}}', progressRaw: null }),
    (error) => error.code === 'MIGRATION_INVALID');
});

test('F04：只有progress或stats的合法備份可遷入，另一項不捏造歷史', () => {
  const onlyProgress = migrateLegacy({ ...options, progressRaw: JSON.stringify(progress) });
  assert.deepEqual(onlyProgress.progress, progress);
  assert.deepEqual(onlyProgress.stats.byScope, {});
  const onlyStats = migrateLegacy({ ...options, statsRaw: JSON.stringify(stats) });
  assert.deepEqual(onlyStats.stats, stats);
  assert.deepEqual(onlyStats.progress.items, {});
});
