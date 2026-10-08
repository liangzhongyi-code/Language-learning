import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { words } from '../assets/js/data/ja/words.js';
import { sentences } from '../assets/js/data/ja/sentences.js';
import { validateLearning } from '../assets/js/core/learning-schema.js';

const T0 = Date.UTC(2026, 9, 7, 1);
function setup(failCommit) {
  const repository = createMemoryRepository({ now: () => T0, failCommit });
  const store = createLearningStore({ repository, now: () => T0 });
  const make = () => createQuizService({ store, lang: 'ja', now: () => T0 });
  const quiz = buildSession({ lang: 'ja', words, sentences, source: 'words', direction: 'mixed', level: 1, count: 4, rng: () => 0.42 });
  return { repository, store, make, service: make(), quiz };
}
const submit = (service, round, index, response, reviewId = `quiz-rv-${index}`) => service.submit({
  sessionId: round.sessionId, index, response, reviewId, answeredAt: T0 + index,
});

test('F16/D11/D24：逐題保存，半局不算完成；重開題序、實際方向與下一題不變', async () => {
  const { service, make, quiz, store } = setup();
  const round = await service.start(quiz, { kanjiMode: 'kana' });
  await submit(service, round, 0, quiz.questions[0].correctIndex);
  const { rows } = await store.read(['stats', 'progress', 'reviewEvents']);
  assert.deepEqual(rows.stats['ja:words'], { answered: 1, correct: 1, sessions: 0 });
  assert.equal(Object.keys(rows.reviewEvents).length, 1);
  const resumed = await make().resume(round.sessionId);
  assert.equal(resumed.quiz.cursor, 1);
  assert.equal(resumed.quiz.questions[0].answeredIndex, quiz.questions[0].correctIndex);
  assert.deepEqual(resumed.quiz.questions.slice(1), quiz.questions.slice(1));
  assert.equal(resumed.kanjiMode, 'kana');
  assert.equal((await service.listActive()).length, 1);
  assert.equal(validateLearning((await store.exportBackup()).learning).ok, true);
});

test('F16/D12：重送只一次，同 reviewId 改答案拒絕；完成局僅一次', async () => {
  const { service, quiz, repository } = setup();
  const round = await service.start(quiz);
  for (let i = 0; i < quiz.questions.length; i++) {
    await submit(service, round, i, quiz.questions[i].correctIndex);
    await submit(service, round, i, quiz.questions[i].correctIndex);
  }
  assert.deepEqual(repository.peek('stats', 'ja:words'), { answered: 4, correct: 4, sessions: 1 });
  await assert.rejects(submit(service, round, 0, (quiz.questions[0].correctIndex + 1) % 4), (e) => e.code === 'OPERATION_MISMATCH');
  assert.equal((await service.listActive()).length, 0);
});

test('F16/D12：交易中斷全回滾，相同 reviewId 可重試', async () => {
  let fail = true;
  const { service, quiz, repository } = setup((op) => fail && op.operationId.startsWith('quiz-review-'));
  const round = await service.start(quiz);
  await assert.rejects(submit(service, round, 0, 0), (e) => e.code === 'STORAGE_ABORTED');
  assert.deepEqual(repository.all('stats'), {});
  assert.deepEqual(repository.all('reviewEvents'), {});
  assert.equal((await service.resume(round.sessionId)).quiz.cursor, 0);
  fail = false;
  await submit(service, round, 0, 0);
  assert.equal(repository.peek('stats', 'ja:words').answered, 1);
});

test('F16/D13：兩分頁同題不同 reviewId 只接受首次；清除後舊頁不可復活', async () => {
  const { service, make, quiz, store, repository } = setup();
  const round = await service.start(quiz);
  const other = make();
  await other.resume(round.sessionId);
  const result = await Promise.allSettled([
    submit(service, round, 0, 0, 'quiz-tab-a'), submit(other, round, 0, 1, 'quiz-tab-b'),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(repository.peek('stats', 'ja:words').answered, 1);
  await store.clearAll();
  await assert.rejects(submit(service, round, 1, 0), (e) => e.code === 'STALE_EPOCH');
  assert.deepEqual(repository.all('reviewEvents'), {});
});

test('F16/D14：填空只記句子的 assembly，不把候選詞寫成已學', async () => {
  const { service, store } = setup();
  const quiz = buildSession({ lang: 'ja', words, sentences, source: 'cloze', level: 1, count: 1, rng: () => 0.42 });
  const round = await service.start(quiz);
  await submit(service, round, 0, quiz.questions[0].blanks.map((b) => b.answer));
  const { rows } = await store.read(['itemStates', 'progress']);
  assert.equal(Object.keys(rows.itemStates).length, 1);
  assert.match(Object.keys(rows.itemStates)[0], /:assembly:/);
  assert.deepEqual(Object.keys(rows.progress), [quiz.questions[0].sourceId]);
  assert.equal(validateLearning((await store.exportBackup()).learning).ok, true);
});

test('F16/D11：只填未提交的輸入不保存；跳題與他語言 session 拒絕', async () => {
  const { service, quiz, store } = setup();
  const round = await service.start(quiz);
  quiz.questions[0].answeredIndex = 2;
  assert.equal((await service.resume(round.sessionId)).quiz.questions[0].answeredIndex, null);
  await assert.rejects(submit(service, round, 2, 0), (e) => e.code === 'ENTRY_CONFLICT');
  const en = createQuizService({ store, lang: 'en', now: () => T0 });
  await assert.rejects(en.resume(round.sessionId), (e) => e.code === 'INVALID_DATA');
});

test('F16：損壞保存題面或答題游標關係，在續答前明確拒絕', async () => {
  for (const corrupt of [
    (s) => { delete s.questionSnapshots[s.orderedEntryIds[1]].options; },
    (s) => { s.questionSnapshots[s.orderedEntryIds[1]].answeredIndex = 0; },
  ]) {
    const { service, quiz, store, repository } = setup();
    const round = await service.start(quiz);
    const saved = repository.peek('sessions', round.sessionId);
    corrupt(saved);
    const meta = await store.ready();
    await repository.commit({ operationId: 'fixture-corrupt', epoch: meta.dataEpoch, expectedRevision: meta.revision,
      payload: { changes: [{ store: 'sessions', key: round.sessionId, value: saved }] } });
    await assert.rejects(service.resume(round.sessionId), (e) => e.code === 'UNSUPPORTED');
  }
});

test('F16/D12：同一提交編號改時間不得冒充原重送', async () => {
  const { service, quiz } = setup();
  const round = await service.start(quiz);
  await submit(service, round, 0, 0);
  await assert.rejects(service.submit({ sessionId: round.sessionId, index: 0, response: 0,
    reviewId: 'quiz-rv-0', answeredAt: T0 + 1 }), (e) => e.code === 'OPERATION_MISMATCH');
});
