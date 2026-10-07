/**
 * 每日學習與練習頁共用的「一題作答」交易組件：讀取這一題需要的有限列，
 * 計算事件、能力排程、累計、意向與日曆／成就的變更。呼叫端再把題次與 session 變更加入同一筆提交。
 */
import { applyReview } from '../../core/review-events.js';
import { afterReview } from '../../core/learning-intents.js';
import { applyReviewToCalendar, calendarKeyForEvent, evaluateAchievements } from '../../core/achievements.js';
import { calendarKey, unlockKey } from '../../core/learning-snapshot.js';

/**
 * 依索引讀取：同 session 的事件、同來源的能力、累計、統計範圍、意向與成就列，不讀整個歷史。
 */
export async function loadReviewContext(repository, { sourceId, sessionId, statsKey }) {
  const sessionEvents = Object.values(await repository.getAllByIndex('reviewEvents', 'sessionId', sessionId));
  const sourceStates = await repository.getAllByIndex('itemStates', 'sourceId', sourceId);
  const achievementRows = Object.fromEntries((await repository.list('achievements', { limit: 1000 })).map(({ key, value }) => [key, value]));
  return {
    sessionEvents, sourceStates, achievementRows,
    sourceProgress: (await repository.get('progress', sourceId)) ?? null,
    statsScope: (await repository.get('stats', statsKey)) ?? null,
    intent: (await repository.get('intents', sourceId)) ?? null,
  };
}

/**
 * 套用一筆尚未入帳的事件。第一次碰到某來源、且只有舊版摘要時，以 legacy 初始化保留原 n/w/box/due。
 * 回傳 changes（事件、能力、累計、統計、意向、日曆、新成就）與 applied 結果。
 */
export function reviewChanges({ event, context, timeZone, now }) {
  const previousState = context.sourceStates[event.skillKey] ?? null;
  let initialization;
  if (!previousState) {
    const legacy = context.sourceProgress && context.sourceProgress.n > 0 && Object.keys(context.sourceStates).length === 0;
    initialization = legacy ? { kind: 'legacy', progress: context.sourceProgress } : { kind: 'new' };
  }
  const applied = applyReview({ event, previousState, sourceProgress: context.sourceProgress, initialization,
    statsScope: context.statsScope, sessionEvents: context.sessionEvents });
  const changes = [
    { store: 'reviewEvents', key: event.reviewId, value: applied.event },
    { store: 'itemStates', key: applied.itemState.skillKey, value: applied.itemState },
    { store: 'progress', key: event.sourceId, value: applied.progress },
  ];
  changes.push(...afterReview({ intent: context.intent, sourceId: event.sourceId, correct: applied.event.correct, now }).changes);
  const calendarRows = {};
  const unlocked = {};
  for (const [key, value] of Object.entries(context.achievementRows)) {
    if (key.startsWith('calendar:')) calendarRows[key.slice(9)] = value;
    if (key.startsWith('unlock:')) unlocked[key.slice(7)] = value;
  }
  const dayKey = calendarKeyForEvent({ event, timeZone });
  const counted = applyReviewToCalendar({ calendar: calendarRows[dayKey] ?? null, event, timeZone, alreadyApplied: false });
  calendarRows[counted.key] = counted.row;
  changes.push({ store: 'achievements', key: calendarKey(counted.row.localDate, counted.row.lang), value: counted.row });
  const fresh = evaluateAchievements({ calendarRows, unlocked, now, todayLocalDate: counted.row.localDate });
  for (const unlock of fresh) changes.push({ store: 'achievements', key: unlockKey(unlock.achievementId), value: unlock });
  return { applied, changes, unlocked: fresh };
}
