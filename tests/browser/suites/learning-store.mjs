import assert from 'node:assert/strict';

/**
 * 真 IndexedDB：頁面入口的遷移、整局入帳、衝突重算、v2 匯出還原與還原點。
 * 每個案例使用獨立 DB 名稱與假 localStorage，不碰使用者資料。
 */
export async function run({ page }) {
  await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    const { createLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    window.makeStore = (name, legacy = {}) => createLearningStore({
      repository: createWebRepository({ name, timeZone: 'Asia/Taipei' }),
      legacyStorage: { getItem: (key) => legacy[key] ?? null },
    });
    window.quizSession = (ids) => ({ source: 'words', questions: ids.map((id, i) => ({
      kind: 'choice', sourceId: id, options: [{ text: 'a' }, { text: 'b' }], correctIndex: 0, answeredIndex: i % 2,
    })) });
  });

  const migrated = await page.evaluate(async () => {
    const store = window.makeStore('store-migrate', {
      'lang-learn.stats.v1': JSON.stringify({ schemaVersion: 1, byScope: { 'en:words': { answered: 4, correct: 3, sessions: 1 } } }),
      'lang-learn.progress.v1': JSON.stringify({ schemaVersion: 1, items: { 'en-w-001': { n: 4, w: 1, box: 2, last: 1, due: 2 } } }),
    });
    const view = await store.legacyView();
    return { status: view.meta.migrationStatus, stats: view.stats.byScope['en:words'], due: view.progress.items['en-w-001'].due };
  });
  assert.deepEqual(migrated, { status: 'complete', stats: { answered: 4, correct: 3, sessions: 1 }, due: 2 }, 'F07/D18 頁面入口先遷移再讀取');

  const recorded = await page.evaluate(async () => {
    const store = window.makeStore('store-quiz');
    const session = window.quizSession(['ja-w-001', 'ja-w-002']);
    const first = await store.recordQuizSession({ lang: 'ja', source: 'words', session,
      summary: { total: 2, correct: 1 }, operationId: 'quiz-op-1', at: 1000 });
    const replay = await store.repository.commit({ operationId: 'quiz-op-1', epoch: (await store.ready()).dataEpoch,
      expectedRevision: 0, payload: { changes: [{ store: 'stats', key: 'ja:words', value: { answered: 9, correct: 9, sessions: 9 } }] } })
      .catch((error) => error.code);
    const view = await store.legacyView();
    return { revision: first.revision, replay, stats: view.stats.byScope['ja:words'], items: Object.keys(view.progress.items).sort() };
  });
  assert.equal(recorded.revision, 2);
  assert.deepEqual(recorded.stats, { answered: 2, correct: 1, sessions: 1 }, 'F08/D24 完成一局只加一局');
  assert.deepEqual(recorded.items, ['ja-w-001', 'ja-w-002']);
  assert.equal(recorded.replay, 'OPERATION_MISMATCH', '同 ID 不同內容不可重用');

  const twoTabs = await page.evaluate(async () => {
    const a = window.makeStore('store-two-tabs');
    const b = window.makeStore('store-two-tabs');
    await a.ready(); await b.ready();
    await Promise.all([
      a.recordQuizSession({ lang: 'en', source: 'words', session: window.quizSession(['en-w-001']), summary: { total: 1, correct: 1 }, operationId: 'tab-a' }),
      b.recordQuizSession({ lang: 'en', source: 'words', session: window.quizSession(['en-w-002']), summary: { total: 1, correct: 1 }, operationId: 'tab-b' }),
    ]);
    const view = await a.legacyView();
    return { stats: view.stats.byScope['en:words'], items: Object.keys(view.progress.items).sort() };
  });
  assert.deepEqual(twoTabs.stats, { answered: 2, correct: 2, sessions: 2 }, 'D13 兩分頁同時入帳不互相覆蓋');
  assert.deepEqual(twoTabs.items, ['en-w-001', 'en-w-002']);

  const restored = await page.evaluate(async () => {
    const { createRestoreController } = await import('/assets/js/core/restore-controller.js');
    const source = window.makeStore('store-export');
    await source.recordQuizSession({ lang: 'ja', source: 'words', session: window.quizSession(['ja-w-005']),
      summary: { total: 1, correct: 1 }, operationId: 'export-op' });
    const payload = await source.exportBackup({ prefs: { theme: 'light' } });
    const target = window.makeStore('store-import');
    await target.recordQuizSession({ lang: 'en', source: 'words', session: window.quizSession(['en-w-099']),
      summary: { total: 1, correct: 0 }, operationId: 'local-op' });
    const before = await target.ready();
    let prefs = null;
    const controller = createRestoreController({ repository: target.repository, now: () => 5000,
      timeZone: () => 'Asia/Taipei', nextOperationId: () => 'restore-op-1', savePreferences: async (value) => { prefs = value; return true; } });
    const preview = await controller.preview(async () => JSON.stringify(payload));
    const result = await controller.confirm();
    const after = await target.ready();
    const view = await target.legacyView();
    const points = await target.restorePoints();
    const reverted = await target.revertToRestorePoint(points[0].key);
    const back = await target.legacyView();
    let stale;
    try {
      await target.repository.commit({ operationId: 'old-page', epoch: before.dataEpoch, expectedRevision: before.revision,
        payload: { changes: [{ store: 'stats', key: 'x:y', value: { answered: 1, correct: 1, sessions: 1 } }] } });
    } catch (error) { stale = error.code; }
    return { counts: preview.counts, learningSaved: result.learningSaved, prefs, epochChanged: after.dataEpoch !== before.dataEpoch,
      items: Object.keys(view.progress.items), points: points.length, revertedItems: Object.keys(back.progress.items),
      revertEpoch: reverted.dataEpoch !== after.dataEpoch, stale };
  });
  assert.equal(restored.learningSaved, true, 'F06/D20 v2 完整往返');
  assert.deepEqual(restored.prefs, { theme: 'light' });
  assert.equal(restored.epochChanged, true, '還原換新 epoch');
  assert.deepEqual(restored.items, ['ja-w-005'], '學習群組整組替換不合併');
  assert.equal(restored.points, 1, 'O17 還原前自動保存還原點');
  assert.deepEqual(restored.revertedItems, ['en-w-099'], 'O17 可回到還原前');
  assert.equal(restored.revertEpoch, true);
  assert.equal(restored.stale, 'STALE_EPOCH', 'G07 舊頁晚到寫入被擋');

  const capped = await page.evaluate(async () => {
    const store = window.makeStore('store-cap');
    const payload = await store.exportBackup();
    for (let i = 0; i < 5; i++) {
      const meta = await store.ready();
      const fresh = await store.repository.ready();
      await store.repository.restoreLearning({ operationId: `cap-${i}`, epoch: fresh.dataEpoch,
        expectedRevision: fresh.revision, payload: { stats: payload.stats, progress: payload.progress, learning: payload.learning } });
      void meta;
    }
    return (await store.restorePoints()).length;
  });
  assert.equal(capped, 3, 'O17 只保留最近三個還原點');

  const failedRestore = await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    const { createLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const repository = createWebRepository({ name: 'store-restore-abort', timeZone: 'Asia/Taipei',
      beforeCommit() { if (window.failNext) throw new Error('fixture abort'); } });
    const store = createLearningStore({ repository, legacyStorage: { getItem: () => null } });
    await store.recordQuizSession({ lang: 'ja', source: 'words', session: window.quizSession(['ja-w-007']),
      summary: { total: 1, correct: 1 }, operationId: 'keep-op' });
    const payload = await store.exportBackup();
    payload.progress.items = {};
    window.failNext = true;
    const meta = await repository.ready();
    let code;
    try {
      await repository.restoreLearning({ operationId: 'abort-op', epoch: meta.dataEpoch, expectedRevision: meta.revision,
        payload: { stats: payload.stats, progress: payload.progress, learning: payload.learning } });
    } catch (error) { code = error.code; }
    window.failNext = false;
    return { code, items: Object.keys((await store.legacyView()).progress.items), points: (await store.restorePoints()).length };
  });
  assert.deepEqual(failedRestore, { code: 'STORAGE_ABORTED', items: ['ja-w-007'], points: 0 }, 'O17/D22 還原交易失敗原資料不變');
}
