import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createDailyService } from '../assets/js/ui/platform/daily-service.js';
import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { words } from '../assets/js/data/ja/words.js';
import { localStudyDate } from '../assets/js/core/study-day.js';
import { createLibraryService } from '../assets/js/ui/platform/library-service.js';

const AT = Date.UTC(2026, 9, 8, 1);
const DAY = 86_400_000;
const settings = { level: 1, newLimit: 5, reviewLimit: 20 };

function setup(failCommit) {
  const repository = createMemoryRepository({ now: () => AT, failCommit });
  const store = createLearningStore({ repository, now: () => AT });
  const daily = createDailyService({ store, lang: 'ja', words, now: () => AT, rng: () => 0.42 });
  return { repository, store, daily };
}

async function completeFirst(daily) {
  const view = await daily.today(settings);
  await daily.prepare(view.plan.planId, view.next.entry.entryId, { expectedEpoch: view.dataEpoch });
  const prepared = await daily.preview(settings);
  const entry = prepared.next.entry;
  await daily.submit({ planId: prepared.plan.planId, entryId: entry.entryId,
    answeredIndex: entry.questionSnapshot.correctIndex, reviewId: 'regression-first', expectedEpoch: prepared.dataEpoch });
  return prepared;
}

test('每日舊頁的 prepare/submit/skip/known/segment 在清除後拒絕原 epoch', async () => {
  const { repository, store, daily } = setup();
  const view = await daily.today(settings);
  const epoch = (await store.ready()).dataEpoch;
  const entry = view.next.entry;
  await store.clearAll();
  const actions = [
    () => daily.prepare(view.plan.planId, entry.entryId, { expectedEpoch: epoch }),
    () => daily.submit({ planId: view.plan.planId, entryId: entry.entryId, answeredIndex: 0,
      reviewId: 'stale-daily', expectedEpoch: epoch }),
    () => daily.skip(view.plan.planId, entry.entryId, settings, { expectedEpoch: epoch }),
    () => daily.markKnown(view.plan.planId, entry.sourceId, settings, { expectedEpoch: epoch }),
    () => daily.nextSegment(settings, { expectedEpoch: epoch }),
  ];
  for (const action of actions) await assert.rejects(action(), error => error.code === 'STALE_EPOCH');
  assert.deepEqual(repository.all('dailyPlans'), {});
  assert.deepEqual(repository.all('reviewEvents'), {});
});

test('每日預覽攜帶 epoch；讀取新預覽不會讓明確指定舊 epoch 的提交合法', async () => {
  const { store, daily } = setup();
  const original = await daily.today(settings);
  assert.equal(original.dataEpoch, (await store.ready()).dataEpoch);
  await store.clearAll();
  const fresh = await daily.today(settings);
  assert.notEqual(fresh.dataEpoch, original.dataEpoch);
  await assert.rejects(daily.submit({ planId: original.plan.planId, entryId: original.next.entry.entryId,
    answeredIndex: 0, reviewId: 'stale-after-preview', expectedEpoch: original.dataEpoch }),
  error => error.code === 'STALE_EPOCH');
});

test('額度改零使清單完成時，同交易完成 session 並只計一次局數', async () => {
  const { daily, store } = setup();
  await completeFirst(daily);
  const view = await daily.today({ ...settings, newLimit: 0 });
  assert.equal(view.plan.status, 'completed');
  assert.equal(view.session.status, 'completed');
  assert.equal(view.session.completedAt, AT);
  assert.deepEqual((await store.read(['stats'])).rows.stats['ja:daily'], { answered: 1, correct: 1, sessions: 1 });
  await daily.today({ ...settings, newLimit: 0 });
  assert.equal((await store.read(['stats'])).rows.stats['ja:daily'].sessions, 1);
  await store.exportBackup();
});

test('兩個每日服務同時調低額度不重算完成局；交易失敗保留原清單/session/統計', async () => {
  let failing = false;
  const { daily, store, repository } = setup(op => failing && op.operationId.startsWith('plan-'));
  await completeFirst(daily);
  const before = await store.read(['dailyPlans', 'sessions', 'stats']);
  failing = true;
  await assert.rejects(daily.today({ ...settings, newLimit: 0 }), error => error.code === 'STORAGE_ABORTED');
  assert.deepEqual(await store.read(['dailyPlans', 'sessions', 'stats']), before);
  failing = false;
  const other = createDailyService({ store, lang: 'ja', words, now: () => AT });
  await Promise.all([daily.today({ ...settings, newLimit: 0 }), other.today({ ...settings, newLimit: 0 })]);
  assert.equal(repository.peek('stats', 'ja:daily').sessions, 1);
  assert.equal(Object.values(repository.all('sessions'))[0].status, 'completed');
});

test('超過一千筆跨語言日曆時，作答保留當日累計與既有成就通知時間', async () => {
  const { repository, store } = setup();
  const changes = [];
  for (let day = 500; day >= 1; day--) for (const lang of ['ja', 'en']) {
    const localDate = localStudyDate(AT - day * DAY, 'Asia/Taipei');
    changes.push({ store: 'achievements', key: `calendar:${localDate}:${lang}`,
      value: { localDate, lang, reviewCount: 1, correctCount: 1 } });
  }
  const today = localStudyDate(AT, 'Asia/Taipei');
  const unlock = { achievementId: 'first-review', unlockedAt: AT - DAY, notifiedAt: AT - DAY };
  changes.push({ store: 'achievements', key: `calendar:${today}:ja`,
    value: { localDate: today, lang: 'ja', reviewCount: 12, correctCount: 12 } },
  { store: 'achievements', key: 'unlock:first-review', value: unlock });
  const meta = await store.ready();
  await repository.commit({ operationId: 'calendar-fixture', epoch: meta.dataEpoch,
    expectedRevision: meta.revision, payload: { changes } }, { large: true });
  const service = createQuizService({ store, lang: 'ja', now: () => AT });
  const quiz = buildSession({ lang: 'ja', words, source: 'words', direction: 'target2zh', level: 1, count: 2, rng: () => 0.42 });
  const round = await service.start(quiz);
  for (let index = 0; index < 2; index++) {
    await service.submit({ sessionId: round.sessionId, index, response: quiz.questions[index].correctIndex,
      reviewId: `calendar-review-${index}`, answeredAt: AT + index });
    assert.equal(repository.peek('achievements', `calendar:${today}:ja`).reviewCount, 13 + index);
    assert.deepEqual(repository.peek('achievements', 'unlock:first-review'), unlock);
  }
  assert.equal(Object.keys(repository.all('achievements')).filter(key => key.startsWith('calendar:')).length, 1001);
});

test('跨日搬動的同 entryId 在兩個 plan/session 競爭時只接受一次提交', async () => {
  for (const first of ['yesterday', 'today', 'concurrent']) {
    let at = AT;
    const repository = createMemoryRepository({ now: () => at });
    const store = createLearningStore({ repository, now: () => at });
    const make = () => createDailyService({ store, lang: 'ja', words, now: () => at, rng: () => 0.42 });
    const old = make();
    const origin = await old.today(settings);
    await old.prepare(origin.plan.planId, origin.next.entry.entryId);
    const prepared = await old.preview(settings);
    at += DAY;
    const current = make();
    const carried = await current.today(settings);
    assert.equal(carried.next.entry.entryId, prepared.next.entry.entryId);
    await current.prepare(carried.plan.planId, carried.next.entry.entryId);
    const submit = (service, view, reviewId) => service.submit({ planId: view.plan.planId,
      entryId: view.next.entry.entryId, answeredIndex: prepared.next.entry.questionSnapshot.correctIndex,
      reviewId, expectedEpoch: prepared.dataEpoch });
    const a = () => submit(old, prepared, 'carry-yesterday');
    const b = () => submit(current, carried, 'carry-today');
    if (first === 'concurrent') {
      const results = await Promise.allSettled([a(), b()]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ENTRY_CONFLICT');
    } else {
      const [winner, loser] = first === 'yesterday' ? [a, b] : [b, a];
      await winner();
      await assert.rejects(loser(), error => error.code === 'ENTRY_CONFLICT');
    }
    assert.equal(Object.keys(repository.all('reviewEvents')).length, 1);
    assert.equal(repository.peek('stats', 'ja:daily').answered, 1);
    const refreshed = await current.today(settings);
    assert.equal(refreshed.next.done, true, '被另一清單完成的 carry 不能把今日卡死');
    assert.equal(refreshed.plan.status, 'completed');
    const winner = Object.values(repository.all('reviewEvents'))[0];
    assert.equal(repository.peek('stats', 'ja:daily').sessions, winner.reviewId === 'carry-yesterday' ? 0 : 1);
    await store.exportBackup();
  }
});

test('標記想學後重開同額度清單，重排未開始槽位且保留已準備題面/session/配額', async () => {
  const { daily, repository, store } = setup();
  const original = await daily.today(settings);
  await daily.prepare(original.plan.planId, original.next.entry.entryId);
  const prepared = await daily.preview(settings);
  const selected = new Set(prepared.plan.orderedEntries.map(entry => entry.sourceId));
  const wanted = words.find(word => word.level === 1 && !selected.has(word.id));
  const library = createLibraryService({ store, now: () => AT });
  await library.setWant(wanted.id, true);
  const refreshed = await daily.today(settings);
  assert.deepEqual(refreshed.plan.orderedEntries[0], prepared.plan.orderedEntries[0]);
  assert.equal(refreshed.plan.orderedEntries[1].sourceId, wanted.id);
  assert.equal(refreshed.plan.orderedEntries.length, 5);
  assert.deepEqual(refreshed.session.questionSnapshots, prepared.session.questionSnapshots);
  assert.deepEqual(repository.peek('dailyLedger', '2026-10-08:ja').startedSourceIds, [prepared.next.entry.sourceId]);
  const commits = repository.commits.length;
  await daily.today(settings);
  assert.equal(repository.commits.length, commits, '排序相同的重開不額外寫入');
  await library.setWant(wanted.id, false);
  const withdrawn = await daily.today(settings);
  assert.deepEqual(withdrawn.plan, prepared.plan, '撤回想學後沿用原排序規則');
  await store.exportBackup();
});
