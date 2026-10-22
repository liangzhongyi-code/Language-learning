import test from 'node:test';
import assert from 'node:assert/strict';

import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { buildDailyPlan } from '../assets/js/core/daily-plan.js';
import { validateLearning } from '../assets/js/core/learning-schema.js';
import { issueReportOf, encodeIssueCode, decodeIssueCode } from '../assets/js/core/issue-code.js';
import { jlpt } from '../assets/js/data/ja/jlpt.js';

const T0 = Date.UTC(2026, 9, 22, 1);
const quizOf = (mondai = null, count = 5) =>
  buildSession({ lang: 'ja', words: [], sentences: [], jlpt, source: 'jlpt', mondai, level: 1, count, rng: () => 0.42 });

function setup() {
  const repository = createMemoryRepository({ now: () => T0 });
  const store = createLearningStore({ repository, now: () => T0 });
  const make = () => createQuizService({ store, lang: 'ja', now: () => T0 });
  return { store, make, service: make() };
}

test('J13 作答紀錄：recognition、target2zh、ja-j sourceId；續答恢復同一題面', async () => {
  const { store, make, service } = setup();
  const quiz = quizOf(['moji-1']);
  const round = await service.start(quiz, { kanjiMode: 'show' });
  for (let i = 0; i < 3; i++) {
    await service.submit({ sessionId: round.sessionId, index: i, response: quiz.questions[i].correctIndex, reviewId: `jlpt-rv-${i}`, answeredAt: T0 + i });
  }
  const { rows } = await store.read(['reviewEvents', 'itemStates', 'stats']);
  const events = Object.values(rows.reviewEvents);
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.match(event.sourceId, /^ja-j-\d{4}$/);
    assert.equal(event.skillKey, `${event.sourceId}:recognition:target2zh`);
  }
  assert.deepEqual(rows.stats['ja:jlpt'], { answered: 3, correct: 3, sessions: 0 });

  const resumed = await make().resume(round.sessionId);
  assert.equal(resumed.quiz.source, 'jlpt');
  assert.equal(resumed.quiz.cursor, 3);
  assert.deepEqual(resumed.quiz.questions.slice(3), quiz.questions.slice(3));
  for (const [i, q] of resumed.quiz.questions.entries()) {
    assert.equal(q.underline, quiz.questions[i].underline);
    assert.equal(q.mondaiKey, 'moji-1');
    assert.equal(q.context, quiz.questions[i].context);
  }
  assert.equal((await service.listActive())[0].source, 'jlpt');
});

test('J15 含 ja-j 紀錄的備份驗證通過，JSON 來回不變', async () => {
  const { store, service } = setup();
  const quiz = quizOf(null, 2);
  const round = await service.start(quiz, { kanjiMode: 'show' });
  await service.submit({ sessionId: round.sessionId, index: 0, response: (quiz.questions[0].correctIndex + 1) % 4, reviewId: 'jlpt-bk-0', answeredAt: T0 });
  const { learning } = await store.exportBackup();
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(learning)), learning);
  assert.ok(Object.keys(learning.itemStates).some((key) => key.startsWith('ja-j-')));
});

test('J14 每日清單不排入 JLPT 題：到期的 ja-j 能力不會出現在今日複習', () => {
  const now = Date.parse('2026-10-22T04:00:00Z');
  const words = Array.from({ length: 6 }, (_, i) => ({ id: `ja-w-${String(i + 1).padStart(3, '0')}`, level: 1, target: `単語${i}`, zh: `字${i}`, reading: `よみ${i}`, category: 'test' }));
  const state = (id, due) => ({ skillKey: `${id}:recognition:target2zh`, sourceId: id, ability: 'recognition', direction: 'target2zh',
    legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 1 }, due, lastEligibleReviewAt: null, learningStatus: 'review' });
  const args = { words, localDate: '2026-10-22', timeZone: 'Asia/Taipei', lang: 'ja', level: 'N5', now, planId: 'plan-j' };
  const withoutJlpt = buildDailyPlan({ ...args, itemStates: { [state('ja-w-001', now - 1).skillKey]: state('ja-w-001', now - 1) } });
  const jlptState = state('ja-j-0001', now - 1000);
  const withJlpt = buildDailyPlan({ ...args, itemStates: { [state('ja-w-001', now - 1).skillKey]: state('ja-w-001', now - 1), [jlptState.skillKey]: jlptState } });
  assert.ok(withJlpt.plan.orderedEntries.every((e) => !e.sourceId.startsWith('ja-j-')));
  assert.deepEqual(withJlpt.plan.orderedEntries.map((e) => e.sourceId), withoutJlpt.plan.orderedEntries.map((e) => e.sourceId));
});

test('J16 問題回報代碼帶題型與底線字，足以重現題目', () => {
  const quiz = quizOf(['moji-2'], 1);
  const q = quiz.questions[0];
  q.answeredIndex = (q.correctIndex + 1) % 4;
  const report = issueReportOf({ session: quiz, question: q, index: 0, settings: { kanjiMode: 'show' }, description: '選項好像有兩個都對', now: T0 });
  const decoded = decodeIssueCode(encodeIssueCode(report));
  assert.equal(decoded.source, 'jlpt');
  assert.equal(decoded.question.sourceId, q.sourceId);
  assert.equal(decoded.question.mondai, 'moji-2');
  assert.equal(decoded.question.underline, q.underline);
  assert.equal(decoded.question.prompt, q.prompt);
  assert.equal(decoded.question.context, q.context);
  assert.deepEqual(decoded.question.options.map((o) => o.text), q.options.map((o) => o.text));
  assert.equal(decoded.question.correct, q.options[q.correctIndex].text);
  assert.equal(decoded.question.chosen, q.options[q.answeredIndex].text);
  assert.ok(!('progress' in decoded) && !('learning' in decoded));
});

test('J13 題庫規模：第一批 255 題全在 N5，五個題型都有題目', () => {
  assert.equal(jlpt.length, 255);
  assert.ok(jlpt.every((q) => q.level === 1));
  const keys = new Set(jlpt.map((q) => `${q.section}-${q.mondai}`));
  assert.deepEqual([...keys].sort(), ['bunpou-1', 'goi-3', 'goi-4', 'moji-1', 'moji-2']);
});
