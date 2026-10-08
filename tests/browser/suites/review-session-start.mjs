import assert from 'node:assert/strict';

/**
 * 專屬隔離回歸：真 IndexedDB 開局不讀歷史 sessions，Array.at 缺席仍能提交作答。
 * runner 使用獨立 Chromium context／隨機 loopback origin，不接觸使用者資料。
 */
export async function run({ page }) {
  const results = await page.evaluate(async () => {
    const [{ createWebRepository }, { createLearningStore }, { createQuizService }, { createPracticeService },
      { buildSession }, { words }, { practice }] = await Promise.all([
      import('/assets/js/ui/platform/web-repository.js'), import('/assets/js/ui/platform/learning-store.js'),
      import('/assets/js/ui/platform/quiz-service.js'), import('/assets/js/ui/platform/practice-service.js'),
      import('/assets/js/core/quiz-engine.js'), import('/assets/js/data/ja/words.js'), import('/assets/js/data/en/practice.js'),
    ]);
    const at = Date.UTC(2026, 9, 8, 1);
    const output = [];
    for (const kind of ['quiz', 'practice']) {
      const repository = createWebRepository({ name: `fixture-review-start-${kind}`, now: () => at });
      const store = createLearningStore({ repository, now: () => at, legacyStorage: { getItem: () => null } });
      const service = kind === 'quiz' ? createQuizService({ store, lang: 'ja', now: () => at })
        : createPracticeService({ store, lang: 'en', items: practice, now: () => at, rng: () => 0.42 });
      const start = () => kind === 'quiz'
        ? service.start(buildSession({ lang: 'ja', words, sentences: [], source: 'words', direction: 'mixed', level: 1, count: 4, rng: () => 0.42 }))
        : service.start({ mode: 'typing', level: 1 });
      for (let i = 0; i < 8; i++) await start();
      const before = await store.read(['sessions']);
      const sessionReads = [];
      const originals = new Map();
      for (const method of ['get', 'getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'count', 'index']) {
        const original = IDBObjectStore.prototype[method];
        originals.set(method, original);
        IDBObjectStore.prototype[method] = function (...args) {
          if (this.name === 'sessions') sessionReads.push(method);
          return original.apply(this, args);
        };
      }
      let round;
      try { round = await start(); }
      finally { for (const [method, original] of originals) IDBObjectStore.prototype[method] = original; }
      const after = await store.read(['sessions']);
      const historicalPreserved = Object.entries(before.rows.sessions).every(([id, session]) =>
        JSON.stringify(after.rows.sessions[id]) === JSON.stringify(session));
      const noPrematureStats = Object.keys((await store.read(['stats'])).rows.stats).length === 0;

      // 語法檢查抓不到 API 差異；實際走逐題提交、日曆與成就交易，不只測純投影。
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'at');
      try {
        delete Array.prototype.at;
        if (kind === 'quiz') {
          await service.submit({ sessionId: round.sessionId, index: 0, response: round.quiz.questions[0].correctIndex,
            reviewId: 'fixture-review-no-at', answeredAt: at });
        } else {
          const question = round.questions[0];
          await service.submit({ sessionId: round.session.sessionId, index: 0, question,
            response: { input: question.answerKey.accepted[0] }, reviewId: 'fixture-review-no-at' });
        }
      } finally {
        if (descriptor) Object.defineProperty(Array.prototype, 'at', descriptor);
      }
      const saved = (await store.read(['stats', 'reviewEvents'])).rows;
      let invalidBook;
      if (kind === 'practice') invalidBook = await service.eligibility({ mode: 'typing', level: 1, bookId: 'toString' });
      output.push({ kind, sessionReads, historicalPreserved, noPrematureStats,
        count: Object.keys(after.rows.sessions).length, revisionDelta: after.meta.revision - before.meta.revision,
        epochPreserved: after.meta.dataEpoch === before.meta.dataEpoch,
        stats: saved.stats[kind === 'quiz' ? 'ja:words' : 'en:practice'],
        eventCount: Object.keys(saved.reviewEvents).length, invalidBook });
    }
    return output;
  });
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.deepEqual(result.sessionReads, [], `${result.kind} 開局不能讀任何歷史 session`);
    assert.equal(result.historicalPreserved, true);
    assert.equal(result.noPrematureStats, true);
    assert.equal(result.count, 9);
    assert.equal(result.revisionDelta, 1);
    assert.equal(result.epochPreserved, true);
    assert.deepEqual(result.stats, { answered: 1, correct: 1, sessions: 0 });
    assert.equal(result.eventCount, 1);
    if (result.kind === 'practice') assert.deepEqual(result.invalidBook, {
      ok: false, reason: '找不到這本單字簿，可能已被刪除。', items: [],
    });
  }
}
