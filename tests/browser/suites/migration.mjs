import assert from 'node:assert/strict';

/**
 * 舊資料只用 fixture storage；確認完成／禁止重遷移標記與領域資料同交易。
 */
export async function run({ page }) {
  await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    window.createMigrationRepo = (name, extra = {}) => createWebRepository({
      name, timeZone: 'Asia/Taipei', now: () => 1791158400000, ...extra,
    });
    window.legacyFixture = {
      'lang-learn.stats.v1': JSON.stringify({ schemaVersion: 1, byScope: {
        'ja:words': { sessions: 1, answered: 2, correct: 1 },
      } }),
      'lang-learn.progress.v1': JSON.stringify({ schemaVersion: 1, items: {
        'ja-w-001': { n: 2, w: 1, box: 2, last: 1700000000000, due: 1800000000000 },
      } }),
      'lang-learn.prefs.v1': JSON.stringify({ theme: 'light' }),
    };
    window.fixtureStorage = { getItem(key) { return window.legacyFixture[key] ?? null; } };
    window.repo = window.createMigrationRepo('fixture-migration');
  });
  const result = await page.evaluate(async () => {
    if (typeof window.repo.migrateFromLegacy !== 'function') return null;
    return window.repo.migrateFromLegacy(window.fixtureStorage);
  });
  assert.equal(result?.migrationStatus, 'complete', 'F04/D18 遷移資料與完成標記');
  assert.equal((await page.evaluate(() => window.repo.get('progress', 'ja-w-001'))).due, 1800000000000);
  assert.equal((await page.evaluate(() => window.repo.get('stats', 'ja:words'))).answered, 2);
  assert.deepEqual(await page.evaluate(() => window.repo.list('reviewEvents')), []);
  assert.equal(await page.evaluate(() => JSON.parse(window.legacyFixture['lang-learn.prefs.v1']).theme), 'light');

  const again = await page.evaluate(() => window.repo.migrateFromLegacy({
    getItem() { throw new Error('不應再次讀取舊來源'); },
  }));
  assert.equal(again.revision, result.revision, 'F04/D18 重跑不重遷移');

  const failed = await page.evaluate(async () => {
    const repo = window.createMigrationRepo('fixture-migration-abort', {
      beforeCommit() { throw new Error('fixture migration abort'); },
    });
    try { await repo.migrateFromLegacy(window.fixtureStorage); }
    catch (error) {
      const meta = await repo.ready();
      return { code: error.code, status: meta.migrationStatus, items: await repo.list('progress') };
    } finally { repo.close(); }
  });
  assert.deepEqual(failed, { code: 'STORAGE_ABORTED', status: 'pending', items: [] }, 'F04/D18 故障回滾');

  const invalid = await page.evaluate(async () => {
    const repo = window.createMigrationRepo('fixture-migration-invalid');
    try { await repo.migrateFromLegacy({ getItem() { return '{'; } }); }
    catch (error) {
      return { code: error.code, status: (await repo.ready()).migrationStatus, items: await repo.list('stats') };
    } finally { repo.close(); }
  });
  assert.deepEqual(invalid, { code: 'MIGRATION_INVALID', status: 'pending', items: [] }, 'F04/D19 不把壞來源覆寫成空庫');

  const cleared = await page.evaluate(async () => {
    const meta = await window.repo.ready();
    await window.repo.clearLearning({ operationId: 'clear-migration', epoch: meta.dataEpoch, expectedRevision: meta.revision });
    window.repo.close();
    window.repo = window.createMigrationRepo('fixture-migration');
    const after = await window.repo.migrateFromLegacy({
      getItem() { throw new Error('清除後不應再讀殘留舊 key'); },
    });
    return { status: after.migrationStatus, items: await window.repo.list('progress') };
  });
  assert.deepEqual(cleared, { status: 'cleared', items: [] }, 'F04/O18 清除後舊key即使殘留也不復活');
  await page.evaluate(() => window.repo.close());
}
