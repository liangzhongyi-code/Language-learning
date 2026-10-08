import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeItemState } from '../assets/js/core/scheduler.js';
import { scheduleFsrs, validateFsrsState } from '../assets/js/core/fsrs-adapter.js';
import { createReviewEvent, applyReview } from '../assets/js/core/review-events.js';
import { projectLearningProgress } from '../assets/js/core/learning-progress.js';
import { weakest, dueIds, progressOfLang } from '../assets/js/core/progress.js';
import { reviewChanges } from '../assets/js/ui/platform/review-commit.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';

const T0 = Date.UTC(2026, 9, 8, 1);
const DAY = 86_400_000;
const SOURCE = 'ja-w-fixture-fsrs';
const legacy = { n: 40, w: 7, box: 4, last: T0 - DAY, due: T0 + 5 * DAY };
const initial = (direction = 'target2zh') => initializeItemState({ sourceId: SOURCE,
  ability: 'recognition', direction, initialization: { kind: 'new' } });

function eventFor({ index = 1, at = T0, correct = true, reinforcement = false, direction = 'target2zh' } = {}) {
  return createReviewEvent({ sessionId: 'session-fsrs-fixture', entryId: `entry-${index}`, planId: null,
    lang: 'ja', source: 'words', now: at, reviewId: `review-${index}`,
    question: { sourceId: SOURCE, kind: 'choice', direction, options: [{ text: 'a' }, { text: 'b' }],
      correctIndex: 0, answeredIndex: correct ? 0 : 1 },
    answerContext: { submitted: true, reinforcement } });
}

/**
 * 狀態全部由正式 adapter 產生，避免手改 learningStatus 冒充真實 FSRS 畢業或答錯。
 */
function masteredState(direction = 'target2zh') {
  let state = initial(direction);
  let at = T0;
  for (let step = 0; step < 20; step++) {
    state = { ...state, ...scheduleFsrs({ previousState: state, rating: 'Good', at }) };
    validateFsrsState(state, at);
    if (state.learningStatus === 'mastered') return state;
    at = state.due;
  }
  assert.fail('固定 5.4.2 Good 序列應到達 mastered');
}

test('F40/D17/O09：真實 reviewChanges 保留舊摘要，首次未到期 Again 只建立本方向一筆 FSRS', () => {
  const context = { sourceStates: {}, sourceProgress: legacy, statsScope: null, sessionEvents: [],
    achievementRows: {}, intent: null };
  const before = structuredClone(context);
  const early = reviewChanges({ event: eventFor(), context, timeZone: 'Asia/Taipei', now: T0 }).applied;
  assert.equal(early.event.scheduleEligible, false);
  assert.equal(early.itemState.schedulerName, 'legacy');
  assert.equal(early.itemState.lastEligibleReviewAt, null);
  assert.equal(early.itemState.due, legacy.due);
  const first = reviewChanges({ event: eventFor({ correct: false }), context,
    timeZone: 'Asia/Taipei', now: T0 }).applied;
  assert.equal(first.event.scheduleEligible, true);
  assert.equal(first.itemState.schedulerName, 'fsrs');
  assert.deepEqual(first.itemState.legacySummary, legacy);
  assert.equal(first.itemState.schedulerState.reps, 1);
  assert.equal(first.itemState.schedulerState.lapses, 0);
  assert.equal(first.itemState.due, T0 + DAY);
  assert.deepEqual(first.progress, { ...legacy, n: 41, w: 8, last: T0, due: T0 + DAY });
  assert.deepEqual(context, before);
  const otherContext = { ...context, sourceStates: { [first.itemState.skillKey]: first.itemState },
    sourceProgress: first.progress, sessionEvents: [first.event] };
  const other = reviewChanges({ event: eventFor({ index: 2, direction: 'zh2target' }), context: otherContext,
    timeZone: 'Asia/Taipei', now: T0 }).applied;
  assert.notEqual(other.itemState.skillKey, first.itemState.skillKey);
  assert.equal(other.itemState.legacySummary, null);
  assert.equal(other.itemState.schedulerState.reps, 1);
  assert.equal(other.progress.n, 42);
  assert.equal(other.progress.w, 8);
});

test('F40/D15：Good、未到期 Good、Again、再次 Again、到期補強的真實事件只排程兩次', () => {
  let state = initial();
  let progress = null;
  let statsScope = null;
  const events = [];
  const inputs = [{}, {}, { correct: false }, { correct: false },
    { at: T0 + 10 * DAY, reinforcement: true }];
  for (let index = 0; index < inputs.length; index++) {
    const previous = structuredClone(state);
    const result = applyReview({ event: eventFor({ index: index + 1, ...inputs[index] }),
      previousState: state, sourceProgress: progress, statsScope, sessionEvents: events, policy: 'fsrs' });
    assert.deepEqual(state, previous);
    assert.equal(result.event.scheduleEligible, index === 0 || index === 2);
    if (!result.event.scheduleEligible) assert.deepEqual(result.itemState, previous);
    assert.deepEqual(result.event.before, previous);
    assert.deepEqual(result.event.after, result.itemState);
    state = result.itemState;
    progress = result.progress;
    statsScope = result.statsScope;
    events.push(result.event);
  }
  assert.equal(state.schedulerState.reps, 2);
  assert.equal(state.schedulerState.lapses, 1);
  assert.equal(state.lastEligibleReviewAt, T0);
  assert.deepEqual(statsScope, { answered: 5, correct: 3, sessions: 0 });
  assert.equal(progress.n, 5);
  assert.equal(progress.w, 2);
  assert.equal(progress.due, state.due);
});

function mixedFixture() {
  const mastered = masteredState();
  const untouched = initial('zh2target');
  return { progress: { schemaVersion: 1, items: { [SOURCE]: legacy } },
    itemStates: { [mastered.skillKey]: mastered, [untouched.skillKey]: untouched } };
}

function assertMixedProjection(project) {
  const input = mixedFixture();
  const before = structuredClone(input);
  const view = project(input);
  assert.equal(view.items[SOURCE].box, 1, '尚未轉 FSRS 的 introduced 能力阻止整個來源畢業');
  assert.equal(view.items[SOURCE].due, 0, '最早 due 包含未轉 FSRS 的能力');
  assert.deepEqual(weakest(view, { lang: 'ja' }), [SOURCE]);
  assert.deepEqual(dueIds(view, 'ja', T0), [SOURCE]);
  assert.deepEqual(input, before);
}

test('F40：真實 mastered 與未轉 FSRS 能力共存，全部能力 mastered 才使來源畢業', () => {
  assertMixedProjection(projectLearningProgress);
  const first = masteredState();
  const second = masteredState('zh2target');
  const view = projectLearningProgress({ progress: { schemaVersion: 1, items: { [SOURCE]: legacy } },
    itemStates: { [first.skillKey]: first, [second.skillKey]: second } });
  assert.equal(view.items[SOURCE].box, 4);
  assert.equal(view.items[SOURCE].due, Math.min(first.due, second.due));
  assert.deepEqual(weakest(view, { lang: 'ja' }), []);
  assert.deepEqual(dueIds(view, 'ja', view.items[SOURCE].due), [SOURCE], '畢業仍可到期');
});

test('F40：真實 mastered 後 Again 經 legacyView 重新進入 weak，視圖與 export 不回寫摘要', async () => {
  const mastered = masteredState();
  const at = mastered.due;
  const result = applyReview({ event: eventFor({ at, correct: false }), previousState: mastered,
    sourceProgress: { ...legacy, due: mastered.due }, policy: 'fsrs' });
  assert.equal(result.itemState.learningStatus, 'review', 'd1 關閉短期步驟，Again 不假造 learning 狀態');
  validateFsrsState(result.itemState, at);
  const repository = createMemoryRepository({ now: () => at });
  const store = createLearningStore({ repository, now: () => at });
  const itemStates = { [result.itemState.skillKey]: result.itemState };
  await store.commit({ stores: ['progress', 'itemStates'], operationId: 'fsrs-real-state-fixture',
    build: () => [{ store: 'progress', key: SOURCE, value: result.progress },
      { store: 'itemStates', key: result.itemState.skillKey, value: result.itemState }] });
  const before = structuredClone({ progress: repository.all('progress'), itemStates: repository.all('itemStates'),
    commits: repository.commits, meta: await store.ready() });
  const reads = [];
  const readAll = repository.readAll.bind(repository);
  repository.readAll = (stores) => { reads.push(stores); return readAll(stores); };
  const view = await store.legacyView();
  assert.deepEqual(reads, [['stats', 'progress', 'itemStates']]);
  assert.equal(view.progress.items[SOURCE].box, 1);
  assert.equal(result.progress.box, 4);
  assert.equal(view.progress.items[SOURCE].due, result.itemState.due);
  assert.deepEqual(weakest(view.progress, { lang: 'ja' }), [SOURCE]);
  assert.deepEqual(progressOfLang(view.progress, 'ja', result.itemState.due), { tracked: 1, weak: 1, due: 1 });
  const backup = await store.exportBackup();
  assert.deepEqual(backup.progress, { schemaVersion: 1, items: { [SOURCE]: result.progress } });
  assert.deepEqual(backup.learning.itemStates, itemStates);
  assert.deepEqual({ progress: repository.all('progress'), itemStates: repository.all('itemStates'),
    commits: repository.commits, meta: await store.ready() }, before);
});

test('F40/V：上述真實混合能力斷言可殺死只看 FSRS 或忽略 due=0 的投影突變', async () => {
  const url = new URL('../assets/js/core/learning-progress.js', import.meta.url);
  const source = readFileSync(url, 'utf8');
  for (const [before, after] of [
    ['Object.values(itemStates)', "Object.values(itemStates).filter((state) => state.schedulerName === 'fsrs')"],
    ['Math.min(source.due, state.due)', 'Math.min(source.due, state.due || Infinity)'],
  ]) {
    assert.ok(source.includes(before));
    const changed = source.replace(before, after).replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
      (_, prefix, specifier, suffix) => `${prefix}${new URL(specifier, url).href}${suffix}`);
    const mutated = await import(`data:text/javascript;base64,${Buffer.from(changed).toString('base64')}`);
    assert.throws(() => assertMixedProjection(mutated.projectLearningProgress), assert.AssertionError);
  }
});
