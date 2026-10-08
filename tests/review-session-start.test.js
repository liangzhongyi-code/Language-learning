/**
 * 分支審查專屬回歸：開局只需要交易 meta，不應載入全部歷史 sessions／題面。
 * 使用真正 learning-store 與記憶體 repository，驗證讀取界線、revision 重試及 epoch 守衛；
 * 所有資料只留記憶體，不修改其他 suite，也不接觸使用者的 IndexedDB。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { createPracticeService } from '../assets/js/ui/platform/practice-service.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { validateLearningRecord } from '../assets/js/core/learning-schema.js';
import { words } from '../assets/js/data/ja/words.js';
import { practice } from '../assets/js/data/en/practice.js';
import { createMemoryRepository } from './helpers/memory-repository.js';

const T0 = Date.UTC(2026, 9, 8, 1);

function setup(kind, options = {}) {
  const repository = createMemoryRepository({ now: () => T0, ...options });
  const store = createLearningStore({ repository, now: () => T0 });
  const service = kind === 'quiz'
    ? createQuizService({ store, lang: 'ja', now: () => T0 })
    : createPracticeService({ store, lang: 'en', items: practice, now: () => T0, rng: () => 0.42 });
  const start = () => kind === 'quiz'
    ? service.start(buildSession({ lang: 'ja', words, sentences: [], source: 'words', direction: 'mixed', level: 1, count: 4, rng: () => 0.42 }))
    : service.start({ mode: 'typing', level: 1 });
  return { repository, store, service, start };
}

function recordReads(repository) {
  const calls = [];
  for (const method of ['readAll', 'get', 'list', 'getAllByIndex', 'querySnapshot']) {
    const original = repository[method];
    repository[method] = async (...args) => {
      calls.push({ method, args });
      return original(...args);
    };
  }
  return calls;
}

/**
 * 此 fixture 不選單字簿，開局不需任何資料列；允許 metadata-only readAll 或 querySnapshot。
 */
function assertMetaOnly(reads) {
  assert.ok(reads.length > 0, '應讀取交易快照，不可跳過 store 直接寫入');
  for (const { method, args } of reads) {
    if (method === 'readAll') assert.deepEqual(args[0], [], '開局不可全量載入 sessions 或其他集合');
    else if (method === 'querySnapshot') assert.deepEqual(args[0], {}, '開局只需 meta');
    else assert.fail(`開局不應讀取資料列：${method}`);
  }
}

for (const kind of ['quiz', 'practice']) {
  test(`審查／${kind} start：歷史局存在時仍只讀 meta，保留歷史且不提前入帳`, async () => {
    const { repository, start } = setup(kind);
    await start();
    const history = repository.all('sessions');
    const before = await repository.ready();
    const reads = recordReads(repository);
    const round = await start();
    const sessionId = round.sessionId ?? round.session.sessionId;
    const saved = repository.peek('sessions', sessionId);
    assert.equal(validateLearningRecord('sessions', saved).ok, true);
    assert.equal(saved.status, 'active');
    assert.equal(Object.keys(repository.all('sessions')).length, 2);
    for (const [id, session] of Object.entries(history)) assert.deepEqual(repository.peek('sessions', id), session);
    assert.deepEqual(repository.all('stats'), {});
    assert.deepEqual(repository.all('reviewEvents'), {});
    assert.deepEqual(saved.submittedReviewIds, []);
    const after = await repository.ready();
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.dataEpoch, before.dataEpoch);
    assertMetaOnly(reads);
  });

  test(`審查／${kind} start：revision 衝突重讀 meta，沿用 operationId 且只建立一局`, async () => {
    const { repository, start } = setup(kind);
    const original = repository.commit;
    const attempts = [];
    repository.commit = async (input, options) => {
      attempts.push(input);
      if (attempts.length === 1) {
        await original({ operationId: 'other-tab-write', epoch: input.epoch, expectedRevision: input.expectedRevision,
          payload: { changes: [{ store: 'stats', key: 'en:words', value: { answered: 2, correct: 1, sessions: 1 } }] } });
      }
      return original(input, options);
    };
    const reads = recordReads(repository);
    await start();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].operationId, attempts[0].operationId);
    assert.equal(attempts[1].expectedRevision, attempts[0].expectedRevision + 1);
    assert.equal(attempts[1].epoch, attempts[0].epoch);
    assert.equal(Object.keys(repository.all('sessions')).length, 1);
    assert.deepEqual(repository.peek('stats', 'en:words'), { answered: 2, correct: 1, sessions: 1 });
    assertMetaOnly(reads);
  });

  test(`審查／${kind} start：快照後清除資料會拒絕舊 epoch，不復活 session`, async () => {
    const { repository, store, start } = setup(kind);
    const original = repository.commit;
    repository.commit = async (input, options) => {
      await store.clearAll();
      return original(input, options);
    };
    await assert.rejects(start(), { code: 'STALE_EPOCH' });
    assert.deepEqual(repository.all('sessions'), {});
    assert.deepEqual(repository.all('stats'), {});
    assert.equal(repository.commits.length, 0);
  });

  test(`審查／${kind} start：衝突後、重讀前換 epoch 也必須停寫`, async () => {
    const { repository, store, start } = setup(kind);
    const original = repository.commit;
    let attempts = 0;
    repository.commit = async (input, options) => {
      attempts += 1;
      if (attempts === 1) {
        // 模擬 revision 衝突回傳後、下一輪快照之前，另一分頁完成清除。
        await store.clearAll();
        throw Object.assign(new Error('fixture conflict'), { code: 'REVISION_CONFLICT' });
      }
      return original(input, options);
    };
    await assert.rejects(start(), { code: 'STALE_EPOCH' });
    assert.equal(attempts, 1);
    assert.deepEqual(repository.all('sessions'), {});
  });

  test(`審查／${kind} start：較新 schema 的就緒錯誤不能被最佳化繞過`, async () => {
    const { repository, start } = setup(kind);
    repository.ready = async () => { throw Object.assign(new Error('fixture newer schema'), { code: 'UNSUPPORTED_SCHEMA' }); };
    await assert.rejects(start(), { code: 'UNSUPPORTED_SCHEMA' });
    assert.equal(repository.commits.length, 0);
    assert.deepEqual(repository.all('sessions'), {});
  });

  test(`審查／${kind} start：提交失敗不回傳成功或留下半局，可重新開局`, async () => {
    let abort = true;
    const { repository, start } = setup(kind, { failCommit: () => abort });
    await assert.rejects(start(), { code: 'STORAGE_ABORTED' });
    assert.deepEqual(repository.all('sessions'), {});
    abort = false;
    await start();
    assert.equal(Object.keys(repository.all('sessions')).length, 1);
  });
}

test('審查／quiz start：保留就緒後、第一次快照前的 epoch 檢查', async () => {
  const { repository, store, start } = setup('quiz');
  for (const method of ['readAll', 'querySnapshot']) {
    const original = repository[method];
    repository[method] = async (...args) => {
      await store.clearAll();
      return original(...args);
    };
  }
  await assert.rejects(start(), { code: 'STALE_EPOCH' });
  assert.deepEqual(repository.all('sessions'), {});
});

for (const bookId of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'missing-book']) {
  test(`審查／practice book：不存在的 ${bookId} 不可變成全題庫或建立 session`, async () => {
    const { repository, service } = setup('practice');
    const input = { mode: 'typing', level: 1, bookId };
    const eligible = await service.eligibility(input);
    assert.equal(eligible.ok, false, '非自有 bookId 必須視為不存在，不能回退全題庫');
    assert.deepEqual(eligible, {
      ok: false, reason: '找不到這本單字簿，可能已被刪除。', items: [],
    });
    await assert.rejects(service.start(input), { code: 'UNSUPPORTED' });
    assert.equal(repository.commits.length, 0);
    assert.deepEqual(repository.all('sessions'), {});
  });
}

for (const bookId of ['selected-book', 'toString', 'hasOwnProperty']) {
  test(`審查／practice book：自有 ${bookId} 只出簿內題，不以名稱黑名單誤擋合法資料`, async () => {
    const { repository, store, service } = setup('practice');
    const wordIds = ['en-w-001', 'en-w-004'];
    const book = { bookId, name: '測試單字簿', system: false, wordIds, revision: 0, createdAt: T0, updatedAt: T0 };
    assert.equal(validateLearningRecord('books', book).ok, true);
    await store.commit({ stores: [], operationId: 'fixture-book',
      build: () => [{ store: 'books', key: bookId, value: book }] });
    const reads = recordReads(repository);
    const round = await service.start({ mode: 'typing', level: 1, bookId });
    assert.deepEqual(round.questions.map((q) => q.sourceId).sort(), [...wordIds].sort());
    assert.deepEqual(repository.peek('books', bookId), book);
    assert.ok(reads.some(({ method, args }) => method === 'readAll' && args[0].includes('books')));
    assertMetaOnly(reads.filter(({ method, args }) => !(method === 'readAll' && args[0].includes('books'))));
  });
}
