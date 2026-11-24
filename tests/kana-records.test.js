/**
 * 五十音作答與既有學習紀錄、v2 備份、每日清單、問題回報的相容性。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { buildDailyPlan } from '../assets/js/core/daily-plan.js';
import { validateLearning } from '../assets/js/core/learning-schema.js';
import { KANA_GROUP_KEYS } from '../assets/js/core/kana-quiz.js';
import { issueReportOf, encodeIssueCode, decodeIssueCode } from '../assets/js/core/issue-code.js';
import { CATALOG_META, loadDataset } from '../assets/js/data/catalog.js';
import { kana } from '../assets/js/data/ja/kana.js';

const T0 = Date.UTC(2026, 10, 24, 1);
const quizOf = (extra = {}) => buildSession({
  lang: 'ja', kana, source: 'kana', kanaScript: 'mixed', kanaGroups: KANA_GROUP_KEYS,
  direction: 'mixed', count: 6, rng: () => 0.42, ...extra,
});

function setup() {
  const repository = createMemoryRepository({ now: () => T0 });
  const store = createLearningStore({ repository, now: () => T0 });
  const make = () => createQuizService({ store, lang: 'ja', now: () => T0 });
  return { store, make, service: make() };
}

test('五十音作答寫入既有紀錄：recognition、ja:kana 統計，重開可續答同一題面', async () => {
  const { store, make, service } = setup();
  const quiz = quizOf();
  const round = await service.start(quiz, { kanjiMode: 'show' });
  for (let i = 0; i < 3; i += 1) {
    const q = quiz.questions[i];
    const response = i === 0 ? (q.correctIndex + 1) % 4 : q.correctIndex;
    await service.submit({ sessionId: round.sessionId, index: i, response, reviewId: `kana-rv-${i}`, answeredAt: T0 + i });
  }
  const { rows } = await store.read(['reviewEvents', 'stats']);
  for (const event of Object.values(rows.reviewEvents)) {
    assert.match(event.sourceId, /^ja-k-[a-z]+-(hira|kata)$/);
    assert.match(event.skillKey, /:recognition:(target2zh|zh2target)$/);
  }
  assert.deepEqual(rows.stats['ja:kana'], { answered: 3, correct: 2, sessions: 0 });

  const resumed = await make().resume(round.sessionId);
  assert.equal(resumed.quiz.source, 'kana');
  assert.equal(resumed.quiz.cursor, 3);
  assert.deepEqual(resumed.quiz.questions.slice(3), quiz.questions.slice(3));
  assert.equal((await service.listActive())[0].source, 'kana');
});

test('平假名與片假名各記各的，會 あ 不等於會 ア', async () => {
  const { store, service } = setup();
  const quiz = quizOf({ onlyIds: ['ja-k-a-hira'], direction: 'target2zh', count: 1 });
  const round = await service.start(quiz);
  await service.submit({ sessionId: round.sessionId, index: 0, response: quiz.questions[0].correctIndex, reviewId: 'kana-sep', answeredAt: T0 });
  const { rows } = await store.read(['itemStates', 'progress']);
  assert.deepEqual(Object.keys(rows.itemStates), ['ja-k-a-hira:recognition:target2zh']);
  assert.deepEqual(Object.keys(rows.progress), ['ja-k-a-hira']);
});

test('翻過對照表才作答：對錯照實記，但標成用過提示，排程當作還沒記住', async () => {
  const { store, service } = setup();
  const quiz = quizOf({ count: 2 });
  const round = await service.start(quiz);
  const submit = (index, reviewId, extra = {}) => service.submit({
    sessionId: round.sessionId, index, response: quiz.questions[index].correctIndex, reviewId, answeredAt: T0 + index, ...extra,
  });
  await submit(0, 'kana-hint', { hintUsed: true });
  await submit(1, 'kana-plain');
  const { rows } = await store.read(['reviewEvents', 'stats']);
  const hinted = rows.reviewEvents['kana-hint'];
  const plain = rows.reviewEvents['kana-plain'];
  assert.equal(hinted.correct, true);
  assert.equal(hinted.assistance.hintUsed, true);
  assert.equal(plain.assistance.hintUsed, false);
  assert.ok(hinted.after.due < plain.after.due, '翻過表的題目要比沒翻的更早回來');
  assert.deepEqual(rows.stats['ja:kana'], { answered: 2, correct: 2, sessions: 1 });
});

test('v2 備份格式不變：含五十音紀錄的備份通過既有深驗證，JSON 來回不變', async () => {
  const { store, service } = setup();
  const quiz = quizOf({ count: 2 });
  const round = await service.start(quiz);
  await service.submit({ sessionId: round.sessionId, index: 0, response: quiz.questions[0].correctIndex, reviewId: 'kana-bk', answeredAt: T0, hintUsed: true });
  const { learning } = await store.exportBackup();
  assert.equal(learning.schemaVersion, 2);
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(learning)), learning);
});

test('每日清單不排入五十音', () => {
  const now = Date.parse('2026-11-24T04:00:00Z');
  const words = Array.from({ length: 6 }, (_, i) => ({
    id: `ja-w-${String(i + 1).padStart(3, '0')}`, level: 1, target: `単語${i}`, zh: `字${i}`, reading: `よみ${i}`, category: 'test',
  }));
  const id = 'ja-k-a-hira';
  const state = {
    skillKey: `${id}:recognition:target2zh`, sourceId: id, ability: 'recognition', direction: 'target2zh',
    legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 },
    due: now - 1, lastEligibleReviewAt: null, learningStatus: 'review',
  };
  const { plan } = buildDailyPlan({
    words, localDate: '2026-11-24', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', now, planId: 'plan-k',
    itemStates: { [state.skillKey]: state },
  });
  assert.ok(plan.orderedEntries.length > 0);
  assert.ok(plan.orderedEntries.every((e) => e.sourceId.startsWith('ja-w-')));
});

test('問題回報代碼帶得出假名題', () => {
  const quiz = quizOf({ count: 1 });
  const q = quiz.questions[0];
  q.answeredIndex = q.correctIndex;
  const decoded = decodeIssueCode(encodeIssueCode(issueReportOf({ session: quiz, question: q, index: 0, now: T0 })));
  assert.equal(decoded.source, 'kana');
  assert.equal(decoded.question.sourceId, q.sourceId);
  assert.equal(decoded.question.level, null);
  assert.equal(decoded.question.chosen, q.options[q.correctIndex].text);
});

test('題庫只有日文有五十音，與對照表同一份資料', async () => {
  assert.deepEqual((await loadDataset('ja', 'kana')).kana, kana);
  assert.equal(CATALOG_META.ja.kana, kana.length);
  assert.equal(CATALOG_META.en.kana, 0);
  await assert.rejects(loadDataset('en', 'kana'), /沒有此題型/);
});
