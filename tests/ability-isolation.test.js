import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewEvent, applyReview } from '../assets/js/core/review-events.js';
import { initializeItemState } from '../assets/js/core/scheduler.js';

const NOW = Date.parse('2026-10-05T04:00:00Z');
const sourceId = 'ja-w-001';
const directions = ['target2zh', 'zh2target'];
const modes = ['choice', 'cloze', 'typing', 'listening', 'dictation', 'tiles', 'reorder', 'pos'];

function eventFor(mode, direction, now, id) {
  const question = { kind: mode, sourceId, direction };
  if (mode === 'choice') Object.assign(question, {
    options: [{ text: '甲' }, { text: '乙' }], correctIndex: 0, answeredIndex: 0,
  });
  if (mode === 'cloze') Object.assign(question, {
    submitted: true, blanks: [{ answer: '甲' }], filled: ['甲'],
  });
  return createReviewEvent({ question, lang: 'ja', source: 'words', now,
    sessionId: `session-${id}`, entryId: `entry-${id}`, reviewId: `review-${id}`,
    answerContext: { submitted: true, correct: true } });
}

test('全部 mode／雙方向組合：同能力續排，不同能力不得借用來源 box/due', () => {
  let checked = 0;
  for (const trainedMode of modes) for (const trainedDirection of directions) {
    let trained = null;
    for (let i = 0; i < 3; i += 1) {
      trained = applyReview({ event: eventFor(trainedMode, trainedDirection, trained?.itemState.due ?? NOW, `matrix-${i}`),
        previousState: trained?.itemState ?? null, sourceProgress: trained?.progress ?? null,
        ...(trained ? {} : { initialization: { kind: 'new' } }) });
    }
    const before = JSON.stringify(trained);
    for (const mode of modes) for (const direction of directions) {
      const event = eventFor(mode, direction, trained.itemState.due, 'matrix-next');
      const sameSkill = event.skillKey === trained.itemState.skillKey;
      const result = applyReview({ event, sourceProgress: trained.progress,
        ...(sameSkill ? { previousState: trained.itemState } : { initialization: { kind: 'new' } }) });
      assert.equal(result.itemState.schedulerState.box, sameSkill ? 5 : 2,
        `${trainedMode}/${trainedDirection} -> ${mode}/${direction}`);
      assert.equal(result.itemState.legacySummary, null);
      assert.equal(result.progress.n, 4);
      assert.equal(result.progress.w, 0);
      checked += 1;
    }
    assert.equal(JSON.stringify(trained), before);
  }
  assert.equal(checked, 256);
});

test('缺少明確初始化或使用舊 legacyProgress 參數一律拒絕，不默默重設或繼承', () => {
  const event = eventFor('typing', 'zh2target', NOW, 'missing');
  const progress = { n: 3, w: 0, box: 4, due: NOW + 1000 };
  const invalid = (fn) => assert.throws(fn, error => error.code === 'INVALID_DATA');
  for (const initialization of [undefined, null, {}, { kind: 'other' }, { kind: 'legacy' },
    { kind: 'legacy', progress: null }, { kind: 'new', progress }, { kind: 'new', legacyProgress: progress }]) {
    invalid(() => applyReview({ event, sourceProgress: progress, initialization }));
    invalid(() => initializeItemState({ sourceId, ability: 'production', direction: 'zh2target', initialization }));
  }
  invalid(() => applyReview({ event, legacyProgress: progress, initialization: { kind: 'new' } }));
  invalid(() => initializeItemState({ sourceId, ability: 'production', direction: 'zh2target',
    legacyProgress: progress, initialization: { kind: 'new' } }));
});

test('已有能力狀態不得同時傳初始化指令；保護既有 due/box 不被重設', () => {
  const first = applyReview({ event: eventFor('typing', 'zh2target', NOW, 'existing'), initialization: { kind: 'new' } });
  for (const initialization of [{ kind: 'new' }, { kind: 'legacy', progress: first.progress }]) {
    assert.throws(() => applyReview({ event: eventFor('typing', 'zh2target', NOW + 1, 'again'),
      previousState: first.itemState, sourceProgress: first.progress, initialization }), error => error.code === 'INVALID_DATA');
  }
});

test('其他能力尚未到期也不能阻擋首次新能力排程，累計錯誤／統計仍延續', () => {
  const sourceProgress = { n: 9, w: 3, box: 5, due: NOW + 35 * 86400000, last: NOW - 1 };
  const before = JSON.stringify(sourceProgress);
  const result = applyReview({ event: eventFor('typing', 'zh2target', NOW, 'future'), sourceProgress,
    statsScope: { answered: 15, correct: 9, sessions: 2 }, initialization: { kind: 'new' } });
  assert.equal(result.event.before.due, 0);
  assert.equal(result.event.scheduleEligible, true);
  assert.equal(result.itemState.schedulerState.box, 2);
  assert.equal(result.itemState.legacySummary, null);
  assert.equal(result.progress.n, 10);
  assert.equal(result.progress.w, 3);
  assert.deepEqual(result.statsScope, { answered: 16, correct: 10, sessions: 2 });
  assert.equal(JSON.stringify(sourceProgress), before);
});

test('真正舊摘要保留 due、所有次數及缺省欄位；不修改 caller 或省掉累計', () => {
  for (const direction of directions) for (const original of [
    { n: 7, w: 2 }, { n: 7, w: 2, box: 3, last: NOW - 1, due: NOW + 86400000 },
  ]) {
    const before = JSON.stringify(original);
    const initial = initializeItemState({ sourceId, ability: 'recognition', direction,
      initialization: { kind: 'legacy', progress: original } });
    assert.deepEqual(initial.legacySummary, original);
    assert.equal(initial.due, original.due ?? 0);
    const event = eventFor('choice', direction, NOW, 'legacy');
    const result = applyReview({ event, sourceProgress: original, initialization: { kind: 'legacy', progress: original } });
    assert.equal(result.progress.n, 8);
    assert.equal(result.progress.w, 2);
    assert.deepEqual(result.itemState.legacySummary, original);
    if (original.due) {
      assert.equal(result.itemState.due, original.due);
      assert.equal(result.itemState.schedulerName, 'legacy');
      assert.equal(result.event.scheduleEligible, false);
    } else {
      assert.equal(result.itemState.schedulerState.box, 2);
      assert.equal(result.event.scheduleEligible, true);
    }
    assert.equal(JSON.stringify(original), before);
    result.itemState.legacySummary.n = 900;
    assert.equal(original.n, 7);
    assert.throws(() => applyReview({ event, initialization: { kind: 'legacy', progress: original } }), error => error.code === 'INVALID_DATA');
    assert.throws(() => applyReview({ event, sourceProgress: { n: 1, w: 0 },
      initialization: { kind: 'legacy', progress: original } }), error => error.code === 'INVALID_DATA');
  }
});

for (const trainedDirection of directions) {
  for (const mode of modes) {
    for (const direction of directions) {
      if (mode === 'choice' && direction === trainedDirection) continue;
      test(`三次 recognition ${trainedDirection} 不應使首次 ${mode} ${direction} 直接熟練`, () => {
        let result = null;
        for (let i = 0; i < 3; i += 1) {
          result = applyReview({ event: eventFor('choice', trainedDirection, result?.itemState.due ?? NOW, `old-${i}`),
            previousState: result?.itemState ?? null, sourceProgress: result?.progress ?? null,
            ...(result ? {} : { initialization: { kind: 'new' } }) });
        }
        assert.equal(result.itemState.schedulerState.box, 4);
        const next = applyReview({ event: eventFor(mode, direction, result.itemState.due, 'new'),
          sourceProgress: result.progress, initialization: { kind: 'new' } });
        assert.equal(next.itemState.schedulerState.box, 2);
        assert.notEqual(next.itemState.learningStatus, 'mastered');
        assert.equal(next.progress.n, 4);
        assert.equal(next.progress.w, 0);
      });
    }
  }
}
