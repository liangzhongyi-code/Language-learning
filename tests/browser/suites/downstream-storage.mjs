import assert from 'node:assert/strict';

/**
 * 隔離 Chromium 的真 IndexedDB 回歸：epoch、完整日曆，以及清單調整的原子完成。
 * 不讀個人瀏覽器資料；所有備份與長期歷史都由本 suite 建立。
 */
export async function run({ page, origin }) {
  const actual = await page.evaluate(async () => {
    const { createWebRepository } = await import('/assets/js/ui/platform/web-repository.js');
    const { createLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { createDailyService } = await import('/assets/js/ui/platform/daily-service.js');
    const { createQuizService } = await import('/assets/js/ui/platform/quiz-service.js');
    const { buildSession } = await import('/assets/js/core/quiz-engine.js');
    const { words } = await import('/assets/js/data/ja/words.js');
    const { localStudyDate } = await import('/assets/js/core/study-day.js');
    const at = Date.UTC(2026, 9, 8, 1);
    const settings = { level: 1, newLimit: 5, reviewLimit: 20 };
    async function setup(name, rng = 0.42) {
      const repository = createWebRepository({ name: `downstream-${name}`, now: () => at });
      const store = createLearningStore({ repository, legacyStorage: { getItem: () => null }, now: () => at });
      const service = createDailyService({ store, lang: 'ja', words, now: () => at, rng: () => rng });
      const view = await service.today(settings);
      await service.prepare(view.plan.planId, view.next.entry.entryId, { expectedEpoch: view.dataEpoch });
      return { repository, store, service, view: await service.preview(settings) };
    }
    const a = await setup('restore-old');
    const b = await setup('restore-new', 0.02);
    const backup = await b.store.exportBackup();
    const oldMeta = await a.store.ready();
    await a.repository.restoreLearning({ operationId: 'restore-fixture', epoch: oldMeta.dataEpoch,
      expectedRevision: oldMeta.revision, payload: { stats: backup.stats, progress: backup.progress, learning: backup.learning } });
    const restoredMeta = await a.repository.ready();
    let staleCode = null;
    try {
      await a.service.submit({ planId: a.view.plan.planId, entryId: a.view.next.entry.entryId,
        answeredIndex: a.view.next.entry.questionSnapshot.correctIndex, reviewId: 'stale-answer', expectedEpoch: oldMeta.dataEpoch });
    } catch (error) { staleCode = error.code; }
    const staleRows = await a.repository.readAll(['stats', 'reviewEvents']);
    const epoch = { changed: restoredMeta.dataEpoch !== oldMeta.dataEpoch, staleCode,
      differentOptions: a.view.next.entry.questionSnapshot.correctIndex !== b.view.next.entry.questionSnapshot.correctIndex,
      writesAfterRestore: (await a.repository.ready()).revision - restoredMeta.revision,
      events: Object.keys(staleRows.rows.reviewEvents).length, stats: staleRows.rows.stats };

    const c = await setup('completion');
    await c.service.submit({ planId: c.view.plan.planId, entryId: c.view.next.entry.entryId,
      answeredIndex: c.view.next.entry.questionSnapshot.correctIndex, reviewId: 'finish-first', expectedEpoch: c.view.dataEpoch });
    const other = createDailyService({ store: c.store, lang: 'ja', words, now: () => at });
    await Promise.all([c.service.today({ ...settings, newLimit: 0 }), other.today({ ...settings, newLimit: 0 })]);
    const completed = await c.service.preview({ ...settings, newLimit: 0 });
    const completion = { plan: completed.plan.status, session: completed.session.status,
      completedAt: completed.session.completedAt, stats: await c.repository.get('stats', 'ja:daily') };
    await c.store.exportBackup();

    const d = await setup('calendar');
    const meta = await d.store.ready();
    const changes = [];
    for (let day = 500; day >= 1; day--) for (const lang of ['ja', 'en']) {
      const localDate = localStudyDate(at - day * 86_400_000, 'Asia/Taipei');
      changes.push({ store: 'achievements', key: `calendar:${localDate}:${lang}`,
        value: { localDate, lang, reviewCount: 1, correctCount: 1 } });
    }
    const today = localStudyDate(at, 'Asia/Taipei');
    const unlock = { achievementId: 'first-review', unlockedAt: at - 86_400_000, notifiedAt: at - 86_400_000 };
    changes.push({ store: 'achievements', key: `calendar:${today}:ja`,
      value: { localDate: today, lang: 'ja', reviewCount: 12, correctCount: 12 } },
    { store: 'achievements', key: 'unlock:first-review', value: unlock });
    await d.repository.commit({ operationId: 'calendar-fixture', epoch: meta.dataEpoch,
      expectedRevision: meta.revision, payload: { changes } }, { large: true });
    const quizService = createQuizService({ store: d.store, lang: 'ja', now: () => at });
    const quiz = buildSession({ lang: 'ja', words, source: 'words', direction: 'target2zh', level: 1, count: 2, rng: () => 0.42 });
    const round = await quizService.start(quiz);
    const counts = [];
    for (let index = 0; index < 2; index++) {
      await quizService.submit({ sessionId: round.sessionId, index, response: quiz.questions[index].correctIndex,
        reviewId: `calendar-${index}`, answeredAt: at + index });
      counts.push((await d.repository.get('achievements', `calendar:${today}:ja`)).reviewCount);
    }
    const savedUnlock = await d.repository.get('achievements', 'unlock:first-review');
    const calendar = { counts, unlockPreserved: Object.keys(unlock).every(key => savedUnlock[key] === unlock[key]) };
    for (const fixture of [a, b, c, d]) fixture.repository.close();
    return { epoch, completion, calendar };
  });
  assert.deepEqual(actual, {
    epoch: { changed: true, staleCode: 'STALE_EPOCH', differentOptions: true, writesAfterRestore: 0, events: 0, stats: {} },
    completion: { plan: 'completed', session: 'completed', completedAt: Date.UTC(2026, 9, 8, 1),
      stats: { answered: 1, correct: 1, sessions: 1 } },
    calendar: { counts: [13, 14], unlockPreserved: true },
  });

  /**
   * 實際每日 UI 保留舊題面時還原同一天的另一份合法題面，舊答案必須被拒絕。
   */
  await page.goto(origin + '/ja/daily.html');
  await page.locator('[data-continue]').click();
  await page.locator('[data-start]').click();
  await page.locator('[data-opt]').first().waitFor();
  const correctIndex = await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const store = getLearningStore();
    const backup = await store.exportBackup();
    const plan = Object.values(backup.learning.dailyPlans).find(plan => plan.status === 'active');
    const entry = plan.orderedEntries.find(entry => entry.status === 'prepared');
    const question = entry.questionSnapshot;
    const originalIndex = question.correctIndex;
    question.options.push(question.options.shift());
    question.correctIndex = (originalIndex + question.options.length - 1) % question.options.length;
    backup.learning.sessions[plan.sessionId].questionSnapshots[entry.entryId] = structuredClone(question);
    const meta = await store.ready();
    await store.repository.restoreLearning({ operationId: 'ui-restore-fixture', epoch: meta.dataEpoch,
      expectedRevision: meta.revision, payload: { stats: backup.stats, progress: backup.progress, learning: backup.learning } });
    return originalIndex;
  });
  await page.locator(`[data-opt="${correctIndex}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-continue]') || document.querySelector('[data-next]:not([disabled])'));
  const ui = await page.evaluate(async () => {
    const { getLearningStore } = await import('/assets/js/ui/platform/learning-store.js');
    const { rows } = await getLearningStore().read(['reviewEvents', 'stats']);
    return { events: Object.keys(rows.reviewEvents).length, stats: rows.stats };
  });
  assert.deepEqual(ui, { events: 0, stats: {} });
}
