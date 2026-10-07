import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLearningRecord } from '../assets/js/core/learning-schema.js';
import { LearningError } from '../assets/js/core/learning-errors.js';
import {
  ACHIEVEMENT_POLICY_VERSION, ACHIEVEMENTS, calendarKeyForEvent, applyReviewToCalendar,
  computeStreak, evaluateAchievements, markNotified, pendingNotifications,
} from '../assets/js/core/achievements.js';

const at = Date.parse;
const TPE = 'Asia/Taipei';

/**
 * 形狀與 reviewEvents 相同的真實提交事件。
 */
function reviewEvent({ reviewId = 'r1', answeredAt = at('2026-10-06T02:00:00Z'), correct = true, lang = 'en' } = {}) {
  return {
    reviewId, sessionId: 's1', planId: null, entryId: `e-${reviewId}`, sourceId: `${lang}-1`,
    skillKey: `${lang}-1:recognition:target2zh`, answeredAt, correct,
    assistance: { hintUsed: false, retry: false, replayCount: 0,
      context: { lang, source: 'vocab', ability: 'recognition', actualDirection: 'target2zh', reinforcement: false } },
    responseMs: null, questionMode: 'choice', scheduleEligible: false, schedulerVersion: 'leitner-v1',
    before: null, after: null,
  };
}
const day = (localDate, lang = 'en', reviewCount = 1, correctCount = reviewCount) =>
  ({ localDate, lang, reviewCount, correctCount });
const unlock = (achievementId, unlockedAt, notifiedAt = null) => ({ achievementId, unlockedAt, notifiedAt });
const isLearningError = (code) => (error) => error instanceof LearningError && error.code === code;

test('O19 成就政策版本為 1，成就 id 皆為安全 ASCII 且不重複', () => {
  assert.equal(ACHIEVEMENT_POLICY_VERSION, 1);
  const ids = ACHIEVEMENTS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of ACHIEVEMENTS) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.description, 'string');
  }
  for (const id of ['first-review', 'reviews-100', 'reviews-1000', 'streak-3', 'streak-7', 'streak-30', 'days-30', 'both-langs', 'accuracy-day']) {
    assert.ok(ids.includes(id), `缺少成就 ${id}`);
  }
  assert.ok(Object.isFrozen(ACHIEVEMENTS));
});

test('O19 只打開首頁、登入或看介紹卡沒有作答事件，不產生任何計數', () => {
  for (const notAnEvent of [null, undefined, { kind: 'page-open' }, { kind: 'login', at: 1 },
    { kind: 'introduced', sourceId: 'en-1', introducedAt: 1 }]) {
    assert.throws(() => applyReviewToCalendar({ calendar: null, event: notAnEvent, timeZone: TPE, alreadyApplied: false }),
      isLearningError('INVALID_DATA'));
  }
  assert.deepEqual(evaluateAchievements({ calendarRows: [], unlocked: [], now: 1, todayLocalDate: '2026-10-06' }), []);
  assert.deepEqual(computeStreak({ calendarRows: [], todayLocalDate: '2026-10-06' }),
    { current: 0, longest: 0, totalDays: 0, totalReviews: 0, totalCorrect: 0, lastStudyDate: null });
});

test('O19 真實提交事件計入固定學習時區的學習日，產出列通過 calendar schema', () => {
  const event = reviewEvent({ answeredAt: at('2026-10-05T16:30:00Z'), correct: false });
  assert.equal(calendarKeyForEvent({ event, timeZone: TPE }), '2026-10-06:en');
  assert.equal(calendarKeyForEvent({ event, timeZone: 'UTC' }), '2026-10-05:en');
  const first = applyReviewToCalendar({ calendar: null, event, timeZone: TPE, alreadyApplied: false });
  assert.equal(first.key, '2026-10-06:en');
  assert.deepEqual(first.row, day('2026-10-06', 'en', 1, 0));
  assert.deepEqual(first.change, { counted: true, reason: 'counted', reviewDelta: 1, correctDelta: 0 });
  assert.ok(validateLearningRecord('calendar', first.row).ok);
  const second = applyReviewToCalendar({ calendar: first.row, event: reviewEvent({ reviewId: 'r2', answeredAt: at('2026-10-06T15:59:59Z') }), timeZone: TPE, alreadyApplied: false });
  assert.deepEqual(second.row, day('2026-10-06', 'en', 2, 1));
  assert.ok(validateLearningRecord('calendar', second.row).ok);
  assert.deepEqual(first.row, day('2026-10-06', 'en', 1, 0), '不修改輸入列');
});

test('O19 已套用後的事件（含 before/after）同樣可計數，語言取自 assistance.context', () => {
  const applied = { ...reviewEvent({ lang: 'ja' }), scheduleEligible: true, before: { box: 1 }, after: { box: 2 } };
  const result = applyReviewToCalendar({ calendar: null, event: applied, timeZone: TPE, alreadyApplied: false });
  assert.equal(result.key, '2026-10-06:ja');
});

test('O19 重送同一 reviewId（alreadyApplied=true）不重複計數', () => {
  const event = reviewEvent();
  const row = day('2026-10-06', 'en', 5, 4);
  const replay = applyReviewToCalendar({ calendar: row, event, timeZone: TPE, alreadyApplied: true });
  assert.deepEqual(replay.row, row);
  assert.deepEqual(replay.change, { counted: false, reason: 'already-applied', reviewDelta: 0, correctDelta: 0 });
  assert.throws(() => applyReviewToCalendar({ calendar: row, event, timeZone: TPE }), isLearningError('INVALID_DATA'),
    'alreadyApplied 必須由 repository 明確判斷');
  assert.throws(() => applyReviewToCalendar({ calendar: row, event, timeZone: TPE, alreadyApplied: 'no' }), isLearningError('INVALID_DATA'));
});

test('O19 日曆列與事件學習日不一致或時區不合法時拒絕', () => {
  const event = reviewEvent();
  assert.throws(() => applyReviewToCalendar({ calendar: day('2026-10-05'), event, timeZone: TPE, alreadyApplied: false }), isLearningError('INVALID_DATA'));
  assert.throws(() => applyReviewToCalendar({ calendar: day('2026-10-06', 'ja'), event, timeZone: TPE, alreadyApplied: false }), isLearningError('INVALID_DATA'));
  assert.throws(() => applyReviewToCalendar({ calendar: null, event, timeZone: 'CST', alreadyApplied: false }), isLearningError('INVALID_DATA'));
  assert.throws(() => applyReviewToCalendar({ calendar: null, event, timeZone: '+08:00', alreadyApplied: false }), isLearningError('INVALID_DATA'));
});

test('O19 計算連續天數：兩種語言同日只算一天，昨天有學今天尚未學仍保留目前連續', () => {
  const rows = [day('2026-10-03'), day('2026-10-04', 'ja'), day('2026-10-04', 'en'), day('2026-10-05')];
  const today = computeStreak({ calendarRows: rows, todayLocalDate: '2026-10-05' });
  assert.equal(today.current, 3);
  assert.equal(today.longest, 3);
  assert.equal(today.totalDays, 3);
  assert.equal(today.totalReviews, 4);
  assert.equal(today.lastStudyDate, '2026-10-05');
  assert.equal(computeStreak({ calendarRows: rows, todayLocalDate: '2026-10-06' }).current, 3);
});

test('O19 斷簽只讓目前連續歸零，不抹除累計天數、題數或已解鎖成就', () => {
  const rows = [day('2026-09-01', 'en', 50, 40), day('2026-09-02', 'en', 30, 30), day('2026-09-03', 'en', 25, 20)];
  const broken = computeStreak({ calendarRows: rows, todayLocalDate: '2026-10-06' });
  assert.equal(broken.current, 0);
  assert.equal(broken.longest, 3);
  assert.equal(broken.totalDays, 3);
  assert.equal(broken.totalReviews, 105);
  assert.equal(broken.totalCorrect, 90);
  const unlocked = evaluateAchievements({ calendarRows: rows, unlocked: [], now: 100, todayLocalDate: '2026-10-06' });
  const ids = unlocked.map((row) => row.achievementId);
  assert.ok(ids.includes('streak-3'), '最長連續已達成，斷簽後仍可解鎖');
  assert.ok(ids.includes('reviews-100'));
  const later = evaluateAchievements({ calendarRows: rows, unlocked, now: 200, todayLocalDate: '2026-12-01' });
  assert.deepEqual(later, [], '斷簽後重算不收回也不重複解鎖');
});

test('O19 新解鎖列通過 achievementUnlocks schema，已解鎖不重複，markNotified 只標一次', () => {
  const rows = [day('2026-10-06', 'en', 1, 1)];
  const first = evaluateAchievements({ calendarRows: rows, unlocked: [], now: 1000, todayLocalDate: '2026-10-06' });
  assert.deepEqual(first, [unlock('first-review', 1000)]);
  for (const row of first) assert.ok(validateLearningRecord('achievementUnlocks', row).ok);
  assert.deepEqual(evaluateAchievements({ calendarRows: rows, unlocked: first, now: 2000, todayLocalDate: '2026-10-06' }), []);
  const notified = markNotified(first[0], 1500);
  assert.deepEqual(notified, unlock('first-review', 1000, 1500));
  assert.ok(validateLearningRecord('achievementUnlocks', notified).ok);
  assert.deepEqual(markNotified(notified, 9999), notified, '已通知者不改寫通知時間');
  assert.deepEqual(first[0], unlock('first-review', 1000), '不修改輸入');
});

test('O19 還原舊快照後重算：已通知的解鎖不重播，未通知者才待通知，不重複加分', () => {
  const snapshotCalendar = {
    '2026-09-01:en': day('2026-09-01', 'en', 10, 10),
    '2026-09-01:ja': day('2026-09-01', 'ja', 12, 11),
  };
  const snapshotUnlocked = {
    'first-review': unlock('first-review', 100, 150),
    'both-langs': unlock('both-langs', 120, null),
    'future-badge': unlock('future-badge', 130, 140),
  };
  const fresh = evaluateAchievements({ calendarRows: snapshotCalendar, unlocked: snapshotUnlocked, now: 5000, todayLocalDate: '2026-10-06' });
  assert.deepEqual(fresh, [unlock('accuracy-day', 5000)], '單日 22 題 21 對 ≥90%，其餘已解鎖不重複');
  const pending = pendingNotifications({ ...snapshotUnlocked, 'accuracy-day': fresh[0] });
  assert.deepEqual(pending.map((row) => row.achievementId), ['both-langs', 'accuracy-day']);
  assert.ok(!pending.some((row) => row.achievementId === 'first-review'), '已通知不重播');
  const again = evaluateAchievements({ calendarRows: snapshotCalendar, unlocked: { ...snapshotUnlocked, 'accuracy-day': fresh[0] }, now: 6000, todayLocalDate: '2026-10-06' });
  assert.deepEqual(again, [], '重複還原／重算不再加分');
});

test('O19 成就為純投影，日曆列順序不影響結果', () => {
  const rows = [];
  for (let i = 1; i <= 30; i += 1) rows.push(day(`2026-09-${String(i).padStart(2, '0')}`, i % 2 ? 'en' : 'ja', 40, 30));
  const forward = evaluateAchievements({ calendarRows: rows, unlocked: [], now: 1, todayLocalDate: '2026-09-30' });
  const backward = evaluateAchievements({ calendarRows: [...rows].reverse(), unlocked: [], now: 1, todayLocalDate: '2026-09-30' });
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.map((row) => row.achievementId),
    ['first-review', 'reviews-100', 'reviews-1000', 'streak-3', 'streak-7', 'streak-30', 'days-30', 'both-langs']);
});

test('O19 單日正確率成就須同日合計 ≥20 題且 ≥90%', () => {
  const ids = (rows) => evaluateAchievements({ calendarRows: rows, unlocked: [], now: 1, todayLocalDate: '2026-10-06' })
    .map((row) => row.achievementId);
  assert.ok(!ids([day('2026-10-06', 'en', 19, 19)]).includes('accuracy-day'));
  assert.ok(!ids([day('2026-10-06', 'en', 20, 17)]).includes('accuracy-day'));
  assert.ok(ids([day('2026-10-06', 'en', 20, 18)]).includes('accuracy-day'));
  assert.ok(ids([day('2026-10-06', 'en', 10, 9), day('2026-10-06', 'ja', 10, 9)]).includes('accuracy-day'));
});

test('O19 日曆或解鎖資料不合法時以 LearningError 拒絕', () => {
  assert.throws(() => computeStreak({ calendarRows: [day('2026-10-06', 'en', 1, 2)], todayLocalDate: '2026-10-06' }), isLearningError('INVALID_DATA'));
  assert.throws(() => computeStreak({ calendarRows: [day('2026-10-06'), day('2026-10-06')], todayLocalDate: '2026-10-06' }), isLearningError('INVALID_DATA'));
  assert.throws(() => computeStreak({ calendarRows: { 'wrong:key': day('2026-10-06') }, todayLocalDate: '2026-10-06' }), isLearningError('INVALID_DATA'));
  assert.throws(() => computeStreak({ calendarRows: [], todayLocalDate: '2026-02-30' }), isLearningError('INVALID_DATA'));
  assert.throws(() => evaluateAchievements({ calendarRows: [], unlocked: [{ achievementId: 'x' }], now: 1, todayLocalDate: '2026-10-06' }), isLearningError('INVALID_DATA'));
  assert.throws(() => evaluateAchievements({ calendarRows: [], unlocked: [], now: -1, todayLocalDate: '2026-10-06' }), isLearningError('INVALID_DATA'));
  assert.throws(() => markNotified(unlock('first-review', 1), Number.NaN), isLearningError('INVALID_DATA'));
});
