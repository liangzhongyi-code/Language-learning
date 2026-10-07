/**
 * IndexedDB／SQLite 集合列與可攜學習群組（stats／progress／learning）之間的純轉換。
 * 不讀寫平台儲存；repository 讀出全部列後交給這裡組裝，還原時再拆回集合列。
 */
import { LEARNING_SCHEMA_VERSION, validateLearning, validateStats, validateProgress } from './learning-schema.js';
import { LearningError } from './learning-errors.js';

/**
 * 可攜群組會寫入的集合；operations、restorePoints、outbox 屬本機狀態，不跨裝置搬移。
 */
export const PORTABLE_STORES = Object.freeze([
  'stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger',
  'sessions', 'books', 'notes', 'intents', 'achievements', 'reminders',
]);

/**
 * achievements 集合同時保存政策、解鎖與日曆三種列，以 key 前綴區分。
 */
export const ACHIEVEMENT_POLICY_KEY = 'policy';
export const unlockKey = (achievementId) => `unlock:${achievementId}`;
export const calendarKey = (localDate, lang) => `calendar:${localDate}:${lang}`;
export const REMINDER_KEY = 'preferences';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * rows 為 { 集合名: { key: value } }；meta 為目前 repository meta。
 * 回傳的 learning.operations 一律為空，收據不進可攜資料。
 */
export function portableFromRows(rows, meta) {
  const take = (store) => (rows && own(rows, store) ? rows[store] : {});
  const achievements = { policyVersion: 1, unlocked: {}, calendar: {} };
  for (const [key, value] of Object.entries(take('achievements'))) {
    if (key === ACHIEVEMENT_POLICY_KEY) achievements.policyVersion = value.policyVersion;
    else if (key.startsWith('unlock:')) achievements.unlocked[key.slice(7)] = clone(value);
    else if (key.startsWith('calendar:')) achievements.calendar[key.slice(9)] = clone(value);
  }
  const reminders = take('reminders');
  const learning = {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    meta: clone(meta),
    itemStates: clone(take('itemStates')),
    reviewEvents: clone(take('reviewEvents')),
    dailyPlans: clone(take('dailyPlans')),
    dailyLedger: clone(take('dailyLedger')),
    sessions: clone(take('sessions')),
    operations: {},
    library: { books: clone(take('books')), notes: clone(take('notes')) },
    intents: clone(take('intents')),
    achievements,
    reminderPreferences: own(reminders, REMINDER_KEY)
      ? clone(reminders[REMINDER_KEY])
      : { enabled: false, localTime: '20:00', timeZone: meta.timeZone, generation: 0 },
  };
  return {
    stats: { schemaVersion: 1, byScope: clone(take('stats')) },
    progress: { schemaVersion: 1, items: clone(take('progress')) },
    learning,
  };
}

/**
 * 驗證完整群組後拆成集合列。任何一處不合法就整組拒絕，不寫半份。
 */
export function rowsFromPortable({ stats, progress, learning }) {
  if (!validateStats(stats).ok || !validateProgress(progress).ok || !validateLearning(learning).ok) {
    throw new LearningError('INVALID_BACKUP', '學習群組不完整或不合法，整組未寫入。');
  }
  const rows = Object.fromEntries(PORTABLE_STORES.map((store) => [store, {}]));
  Object.assign(rows.stats, clone(stats.byScope));
  Object.assign(rows.progress, clone(progress.items));
  for (const store of ['itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger', 'sessions', 'intents']) {
    Object.assign(rows[store], clone(learning[store]));
  }
  Object.assign(rows.books, clone(learning.library.books));
  Object.assign(rows.notes, clone(learning.library.notes));
  rows.achievements[ACHIEVEMENT_POLICY_KEY] = { policyVersion: learning.achievements.policyVersion };
  for (const [id, row] of Object.entries(learning.achievements.unlocked)) rows.achievements[unlockKey(id)] = clone(row);
  for (const row of Object.values(learning.achievements.calendar)) rows.achievements[calendarKey(row.localDate, row.lang)] = clone(row);
  rows.reminders[REMINDER_KEY] = clone(learning.reminderPreferences);
  return rows;
}
