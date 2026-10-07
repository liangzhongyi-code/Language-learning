/**
 * 學習日曆與成就的純投影。只有真實提交的作答事件會計入日曆；成就由日曆累計重算，
 * 不依事件順序重放加分。回傳值只是候選紀錄，須由 repository 與作答同一交易保存。
 */
import { LearningError } from './learning-errors.js';
import { validateLearningRecord } from './learning-schema.js';
import { isStudyTimeZone } from './study-zone.js';
import { localStudyDate } from './study-day.js';

/**
 * 成就判定政策版本；調整門檻或新增成就時遞增，舊解鎖紀錄不因此收回。
 */
export const ACHIEVEMENT_POLICY_VERSION = 1;

const DAY_MS = 86400000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message, details) => { throw new LearningError('INVALID_DATA', message, details); };

/**
 * 成就定義清單；id 為安全 ASCII，test 只讀日曆投影出的累計指標。
 */
const DEFINITIONS = [
  { id: 'first-review', title: '第一題', description: '完成第一次真實作答。', test: (m) => m.totalReviews >= 1 },
  { id: 'reviews-100', title: '百題達成', description: '累計作答 100 題。', test: (m) => m.totalReviews >= 100 },
  { id: 'reviews-1000', title: '千題達成', description: '累計作答 1000 題。', test: (m) => m.totalReviews >= 1000 },
  { id: 'streak-3', title: '連續三天', description: '連續 3 個學習日都有作答。', test: (m) => m.longest >= 3 },
  { id: 'streak-7', title: '連續一週', description: '連續 7 個學習日都有作答。', test: (m) => m.longest >= 7 },
  { id: 'streak-30', title: '連續一個月', description: '連續 30 個學習日都有作答。', test: (m) => m.longest >= 30 },
  { id: 'days-30', title: '累計三十天', description: '累計 30 個學習日有作答（不必連續）。', test: (m) => m.totalDays >= 30 },
  { id: 'both-langs', title: '雙語學習', description: '英文與日文都練習過。', test: (m) => m.langs.size >= 2 },
  { id: 'accuracy-day', title: '精準的一天', description: '單日作答至少 20 題且正確率達 90%。', test: (m) => m.accurateDay },
];

/**
 * 對外公開的唯讀成就清單（不含判定函式）。
 */
export const ACHIEVEMENTS = Object.freeze(DEFINITIONS.map(({ id, title, description }) => Object.freeze({ id, title, description })));

/**
 * 以 learning-schema 單筆驗證紀錄，失敗時拋出 LearningError。
 */
function checkRecord(collection, value, message) {
  const checked = validateLearningRecord(collection, value);
  if (!checked.ok) invalid(message, { errors: checked.errors });
  return value;
}

function checkTimestamp(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) invalid(`${name} 必須是有效的非負毫秒時間。`);
  return value;
}

function checkZone(timeZone) {
  if (!isStudyTimeZone(timeZone)) invalid('學習時區必須是受支援的 IANA 名稱。');
  return timeZone;
}

function checkDate(value) {
  const checked = validateLearningRecord('calendar', { localDate: value, lang: 'en', reviewCount: 0, correctCount: 0 });
  if (!checked.ok) invalid('今天的學習日必須是有效 YYYY-MM-DD。');
  return value;
}

/**
 * 只接受形狀同 reviewEvents 的真實提交事件；頁面開啟、登入或介紹卡都沒有事件，不能計數。
 */
function checkEvent(event) {
  if (!object(event)) invalid('只有真實提交的作答事件才能計入學習日曆。');
  checkRecord('reviewEvents', event, '只有真實提交的作答事件才能計入學習日曆。');
  const lang = event.assistance.context?.lang;
  if (!['en', 'ja'].includes(lang)) invalid('作答事件缺少有效語言。');
  return lang;
}

/**
 * 依固定學習時區計算事件所屬的日曆 key（`${localDate}:${lang}`）。
 */
export function calendarKeyForEvent({ event, timeZone }) {
  const lang = checkEvent(event);
  checkZone(timeZone);
  let localDate;
  try {
    localDate = localStudyDate(event.answeredAt, timeZone);
  } catch {
    invalid('作答時間超出可計算的學習日範圍。');
  }
  return `${localDate}:${lang}`;
}

/**
 * 把一筆真實作答事件套到該日語言的日曆列。calendar 是同 key 的既有列或 null。
 * alreadyApplied 必須由 repository 依 reviewEvents 是否已存在明確判斷；
 * 為 true 時代表同一 reviewId 重送，原樣回傳、不重複計數。
 */
export function applyReviewToCalendar({ calendar, event, timeZone, alreadyApplied }) {
  const key = calendarKeyForEvent({ event, timeZone });
  if (typeof alreadyApplied !== 'boolean') invalid('alreadyApplied 必須由 repository 明確判斷並傳入布林值。');
  const [localDate, lang] = key.split(':');
  if (calendar !== null) {
    checkRecord('calendar', calendar, '日曆列不合法。');
    if (calendar.localDate !== localDate || calendar.lang !== lang) invalid('日曆列與事件所屬學習日或語言不一致。');
  }
  if (alreadyApplied) {
    return { key, row: calendar === null ? null : { ...calendar },
      change: { counted: false, reason: 'already-applied', reviewDelta: 0, correctDelta: 0 } };
  }
  const base = calendar ?? { localDate, lang, reviewCount: 0, correctCount: 0 };
  const correctDelta = event.correct ? 1 : 0;
  const row = { localDate, lang, reviewCount: base.reviewCount + 1, correctCount: base.correctCount + correctDelta };
  checkRecord('calendar', row, '學習日曆累計已超過安全數值範圍。');
  return { key, row, change: { counted: true, reason: 'counted', reviewDelta: 1, correctDelta } };
}

/**
 * 接受陣列或 repository 的 key → 列物件；驗證每列並拒絕重複的日期／語言。
 */
function calendarList(calendarRows) {
  let rows;
  if (Array.isArray(calendarRows)) rows = calendarRows;
  else if (object(calendarRows)) {
    rows = Object.entries(calendarRows).map(([key, row]) => {
      checkRecord('calendar', row, '日曆列不合法。');
      if (key !== `${row.localDate}:${row.lang}`) invalid('日曆 key 與日期／語言不一致。');
      return row;
    });
  } else invalid('日曆必須是陣列或 key 對應列的物件。');
  const seen = new Set();
  for (const row of rows) {
    checkRecord('calendar', row, '日曆列不合法。');
    const key = `${row.localDate}:${row.lang}`;
    if (seen.has(key)) invalid('日曆不可有重複的日期／語言。');
    seen.add(key);
  }
  return rows;
}

const dayNumber = (localDate) => Math.round(Date.parse(`${localDate}T00:00:00Z`) / DAY_MS);

/**
 * 從日曆投影出累計指標；同日多語言合併為一個學習日，作答 0 題的列不算學習日。
 */
function metrics(calendarRows, todayLocalDate) {
  const rows = calendarList(calendarRows);
  checkDate(todayLocalDate);
  const byDate = new Map();
  const langs = new Set();
  let totalReviews = 0;
  let totalCorrect = 0;
  for (const row of rows) {
    totalReviews += row.reviewCount;
    totalCorrect += row.correctCount;
    if (row.reviewCount === 0) continue;
    langs.add(row.lang);
    const sum = byDate.get(row.localDate) ?? { reviews: 0, correct: 0 };
    byDate.set(row.localDate, { reviews: sum.reviews + row.reviewCount, correct: sum.correct + row.correctCount });
  }
  const days = [...byDate.keys()].map(dayNumber).sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  days.forEach((value, i) => {
    run = i > 0 && value === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  const studied = new Set(days);
  const today = dayNumber(todayLocalDate);
  let cursor = studied.has(today) ? today : today - 1;
  let current = 0;
  while (studied.has(cursor)) { current += 1; cursor -= 1; }
  const lastStudyDate = byDate.size === 0 ? null : [...byDate.keys()].sort().at(-1);
  const accurateDay = [...byDate.values()].some((sum) => sum.reviews >= 20 && sum.correct * 10 >= sum.reviews * 9);
  return { current, longest, totalDays: byDate.size, totalReviews, totalCorrect, lastStudyDate, langs, accurateDay };
}

/**
 * 目前連續與最長連續學習日。今天尚未作答但昨天有學時，目前連續仍保留；
 * 斷簽只讓 current 歸零，累計天數、題數與最長連續都不受影響。
 */
export function computeStreak({ calendarRows, todayLocalDate }) {
  const m = metrics(calendarRows, todayLocalDate);
  return { current: m.current, longest: m.longest, totalDays: m.totalDays,
    totalReviews: m.totalReviews, totalCorrect: m.totalCorrect, lastStudyDate: m.lastStudyDate };
}

/**
 * 接受陣列或 achievementId → 列物件，回傳已解鎖 id 集合；未知 id（未來版本）保留不報錯。
 */
function unlockedMap(unlocked) {
  let rows;
  if (Array.isArray(unlocked)) rows = unlocked;
  else if (object(unlocked)) {
    rows = Object.entries(unlocked).map(([key, row]) => {
      checkRecord('achievementUnlocks', row, '成就解鎖紀錄不合法。');
      if (key !== row.achievementId) invalid('成就解鎖 key 必須等於 achievementId。');
      return row;
    });
  } else invalid('已解鎖成就必須是陣列或 key 對應列的物件。');
  const map = new Map();
  for (const row of rows) {
    checkRecord('achievementUnlocks', row, '成就解鎖紀錄不合法。');
    if (map.has(row.achievementId)) invalid('成就解鎖紀錄不可重複。');
    map.set(row.achievementId, row);
  }
  return map;
}

/**
 * 依日曆累計重算成就，只回傳尚未解鎖者的新列（unlockedAt=now、notifiedAt=null）。
 * 純投影：同一份日曆不論列順序、重算幾次結果都相同；從備份還原後已解鎖者不重複。
 */
export function evaluateAchievements({ calendarRows, unlocked, now, todayLocalDate }) {
  checkTimestamp(now, 'now');
  const m = metrics(calendarRows, todayLocalDate);
  const known = unlockedMap(unlocked);
  const fresh = [];
  for (const definition of DEFINITIONS) {
    if (known.has(definition.id) || !definition.test(m)) continue;
    fresh.push(checkRecord('achievementUnlocks', { achievementId: definition.id, unlockedAt: now, notifiedAt: null }, '成就解鎖紀錄不合法。'));
  }
  return fresh;
}

/**
 * 標記解鎖通知已展示；已有 notifiedAt 者原樣回傳，避免重播或改寫時間。
 */
export function markNotified(unlock, now) {
  checkRecord('achievementUnlocks', unlock, '成就解鎖紀錄不合法。');
  checkTimestamp(now, 'now');
  if (unlock.notifiedAt !== null) return { ...unlock };
  return { ...unlock, notifiedAt: now };
}

/**
 * 尚未展示通知的解鎖列，依解鎖時間與定義順序排序；已通知者（含備份還原帶回的）一律不重播。
 */
export function pendingNotifications(unlocked) {
  const order = new Map(DEFINITIONS.map((definition, i) => [definition.id, i]));
  const rank = (id) => order.get(id) ?? DEFINITIONS.length;
  return [...unlockedMap(unlocked).values()]
    .filter((row) => row.notifiedAt === null)
    .sort((a, b) => a.unlockedAt - b.unlockedAt || rank(a.achievementId) - rank(b.achievementId)
      || (a.achievementId < b.achievementId ? -1 : a.achievementId > b.achievementId ? 1 : 0))
    .map((row) => ({ ...row }));
}
