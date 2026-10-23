import test from 'node:test';
import assert from 'node:assert/strict';

import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { buildDailyPlan } from '../assets/js/core/daily-plan.js';
import { validateLearning } from '../assets/js/core/learning-schema.js';
import { issueReportOf, encodeIssueCode, decodeIssueCode } from '../assets/js/core/issue-code.js';

const T0 = Date.UTC(2026, 9, 23, 1);
const LONG = '長い本文です。'.repeat(120);
const READING = [{
  id: 'ja-jr-0001', level: 5, type: 'chobun', passage: `${LONG}劃線の一文である。${LONG}`, passageA: null, passageB: null,
  underline: '劃線の一文である。',
  questions: [1, 2, 3, 4].map((i) => ({
    id: `ja-jr-0001-q${i}`, focus: i === 2 ? 'underline' : 'detail', ask: `問${i}`,
    options: [`甲${i}`, `乙${i}`, `丙${i}`, `丁${i}`], answer: `乙${i}`, explain: ['解甲', '解乙', '解丙', '解丁'],
  })),
}];
const quizOf = () => buildSession({ lang: 'ja', words: [], sentences: [], jlpt: [], jlptReading: READING, source: 'jlpt', level: 5, count: 1, rng: () => 0.3 });

function setup() {
  const repository = createMemoryRepository({ now: () => T0 });
  const store = createLearningStore({ repository, now: () => T0 });
  const make = () => createQuizService({ store, lang: 'ja', now: () => T0 });
  return { store, make, service: make() };
}

test('R16 讀解作答紀錄與續答：題目 id 為 sourceId，恢復同一篇短文、劃線與選項順序', async () => {
  const { store, make, service } = setup();
  const quiz = quizOf();
  assert.equal(quiz.questions.length, 4, '整篇四題一起出');
  const round = await service.start(quiz, { kanjiMode: 'show' });
  for (let i = 0; i < 2; i++) {
    await service.submit({ sessionId: round.sessionId, index: i, response: quiz.questions[i].correctIndex, reviewId: `jr-rv-${i}`, answeredAt: T0 + i });
  }
  const { rows } = await store.read(['reviewEvents']);
  const events = Object.values(rows.reviewEvents);
  assert.deepEqual(events.map((e) => e.sourceId).sort(), ['ja-jr-0001-q1', 'ja-jr-0001-q2']);
  for (const e of events) assert.equal(e.skillKey, `${e.sourceId}:recognition:target2zh`);

  const resumed = await make().resume(round.sessionId);
  assert.equal(resumed.quiz.cursor, 2);
  const third = resumed.quiz.questions[2];
  assert.equal(third.sourceId, 'ja-jr-0001-q3');
  assert.equal(third.passage, READING[0].passage);
  assert.equal(third.passageUnderline, '劃線の一文である。');
  assert.deepEqual(third.options, quiz.questions[2].options, '選項順序與解說都照保存的題面');
  assert.equal(third.mondaiLabel, '問題10 內容理解（長文）');
});

test('R17 問題回報：帶題目 id、passageId、題型與選擇，不夾帶短文全文', () => {
  const quiz = quizOf();
  const q = quiz.questions[1];
  q.answeredIndex = (q.correctIndex + 1) % 4;
  const report = issueReportOf({ session: quiz, question: q, index: 1, settings: { kanjiMode: 'show' }, description: '解說好像不對', now: T0 });
  const code = encodeIssueCode(report);
  const decoded = decodeIssueCode(code);
  assert.equal(decoded.question.sourceId, 'ja-jr-0001-q2');
  assert.equal(decoded.question.passageId, 'ja-jr-0001');
  assert.equal(decoded.question.mondai, 'dokkai-chobun');
  assert.equal(decoded.question.prompt, '問2');
  assert.equal(decoded.question.correct, q.options[q.correctIndex].text);
  assert.equal(decoded.question.chosen, q.options[q.answeredIndex].text);
  assert.ok(!code.includes(encodeURIComponent('長い本文')) && !JSON.stringify(decoded).includes('長い本文'), '短文全文不在代碼裡');
  assert.ok(code.length < 2000, `代碼長度 ${code.length}`);
});

test('R17 每日清單不排入讀解題；含讀解紀錄的備份驗證通過', async () => {
  const now = Date.parse('2026-10-23T04:00:00Z');
  const words = Array.from({ length: 6 }, (_, i) => ({ id: `ja-w-${String(i + 1).padStart(3, '0')}`, level: 5, target: `語${i}`, zh: `字${i}`, reading: `よみ${i}`, category: 'test' }));
  const state = (id, due) => ({ skillKey: `${id}:recognition:target2zh`, sourceId: id, ability: 'recognition', direction: 'target2zh',
    legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due, lastEligibleReviewAt: null, learningStatus: 'review' });
  const reading = state('ja-jr-0001-q1', now - 1000);
  const plan = buildDailyPlan({ words, localDate: '2026-10-23', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N1', now, planId: 'plan-r',
    itemStates: { [reading.skillKey]: reading } }).plan;
  assert.ok(plan.orderedEntries.every((e) => !e.sourceId.startsWith('ja-jr-')));

  const { store, service } = setup();
  const quiz = quizOf();
  const round = await service.start(quiz, { kanjiMode: 'show' });
  await service.submit({ sessionId: round.sessionId, index: 0, response: quiz.questions[0].correctIndex, reviewId: 'jr-bk-0', answeredAt: T0 });
  const { learning } = await store.exportBackup();
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(learning)), learning);
});
