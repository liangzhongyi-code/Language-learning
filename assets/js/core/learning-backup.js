/**
 * v2 完整學習備份；舊面板在接上交易 repository 前不採用此入口。
 */
import { BACKUP_FORMAT } from './backup.js';
import { BACKUP_JSON_MAX_BYTES } from './backup-limits.js';
import { emptyLearning, validatePlainJson, validateStats, validateProgress, validateLearning } from './learning-schema.js';
import { LearningError } from './learning-errors.js';

export const LEARNING_BACKUP_VERSION = 2;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const group = ['stats', 'progress', 'learning'];
const fields = new Set(['format', 'version', 'exportedAt', ...group, 'prefs']);
const boolPrefs = new Set(['reducedEffects', 'grammarLines', 'keyboardSeen', 'hideKanji', 'quietMode', 'voiceEnabled', 'effectsEnabled', 'hapticsEnabled']);
const textPrefs = new Set(['theme', 'palette', 'background', 'kanaMode', 'readingAskIn', 'kanjiMode']);
const validTime = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;
const failed = (message, code = 'INVALID_BACKUP') => ({
  ok: false, data: {}, counts: {}, exportedAt: null, errors: [message], warnings: [], legacyReplacement: false, code,
});

function validPrefs(prefs) {
  return object(prefs) && validatePlainJson(prefs).ok && Object.entries(prefs).every(([key, value]) =>
    boolPrefs.has(key) ? typeof value === 'boolean' : textPrefs.has(key) && typeof value === 'string' && value.length <= 80);
}

function summary(data) {
  const counts = {};
  if (data.stats) counts.stats = Object.keys(data.stats.byScope).length;
  if (data.progress) counts.progress = Object.keys(data.progress.items).length;
  if (data.prefs) counts.prefs = Object.keys(data.prefs).length;
  if (data.learning) {
    const l = data.learning;
    counts.learning = Object.keys(l.itemStates).length;
    counts.events = Object.keys(l.reviewEvents).length;
    counts.books = Object.keys(l.library.books).length;
    counts.notes = Object.keys(l.library.notes).length;
    counts.plans = Object.keys(l.dailyPlans).length;
  }
  return counts;
}

/**
 * 先限制 UTF-8 bytes 再解析。學習群組不可部分接受，偏好可以獨立救回。
 * v0/v1 必須由呼叫端提供固定 now/timeZone；舊進度原樣保留，不回推事件。
 */
export function parseLearningBackup(text, context) {
  if (typeof text !== 'string') return failed('這不是有效的 JSON 備份。');
  if (text.length > BACKUP_JSON_MAX_BYTES || new TextEncoder().encode(text).byteLength > BACKUP_JSON_MAX_BYTES) {
    return failed('備份資料超過 10 MiB 上限，沒有動任何資料。', 'BACKUP_SIZE_LIMIT');
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return failed('這不是有效的 JSON 備份。'); }
  if (!object(parsed) || parsed.format !== BACKUP_FORMAT || !validatePlainJson(parsed).ok ||
      Object.keys(parsed).some((key) => !fields.has(key))) return failed('這不是受支援的本站備份，沒有動任何資料。');
  if (!Number.isInteger(parsed.version) || parsed.version < 0 || parsed.version > LEARNING_BACKUP_VERSION) {
    return failed('備份版本不正確或比目前程式更新，請先更新程式。', 'UNSUPPORTED_VERSION');
  }
  if (own(parsed, 'exportedAt') && !validTime(parsed.exportedAt)) return failed('備份的匯出時間不正確。');
  const data = {};
  const errors = [];
  const warnings = [];
  let legacyReplacement = false;
  if (own(parsed, 'prefs')) {
    if (validPrefs(parsed.prefs)) data.prefs = clone(parsed.prefs);
    else errors.push('偏好設定含不支援或不合法的欄位，未接受這個區塊。');
  }
  if (group.some((key) => own(parsed, key))) {
    let candidate;
    if (parsed.version === 2) {
      candidate = Object.fromEntries(group.map((key) => [key, parsed[key]]));
    } else if (!own(parsed, 'learning')) {
      try {
        const learning = emptyLearning(context);
        learning.meta.migrationStatus = 'complete';
        candidate = {
          stats: own(parsed, 'stats') ? parsed.stats : { schemaVersion: 1, byScope: {} },
          progress: own(parsed, 'progress') ? parsed.progress : { schemaVersion: 1, items: {} }, learning,
        };
      } catch { errors.push('匯入舊備份需要有效的學習時間與時區。'); }
    }
    if (candidate && validateStats(candidate.stats).ok && validateProgress(candidate.progress).ok && validateLearning(candidate.learning).ok) {
      Object.assign(data, clone(candidate));
      // 收據只能用於本機交易；就算備份帶入也不跨裝置重播。
      data.learning.operations = {};
      legacyReplacement = parsed.version < 2;
      if (legacyReplacement) warnings.push('這是舊版備份：確認會替換全部學習資料，現有每日清單、筆記、單字簿與新題型歷程會由空資料取代，不會合併。');
    } else errors.push('學習群組必須包含完整且合法的統計、進度與學習資料，整組未接受。');
  }
  if (!Object.keys(data).length) errors.push('這份備份裡沒有任何可以還原的資料。');
  return { ok: Object.keys(data).length > 0, data, counts: summary(data), exportedAt: parsed.exportedAt ?? null,
    errors, warnings, legacyReplacement, version: parsed.version };
}

/**
 * 匯出必須完整且合法；不可利用匯入「偏好可單獨救回」的行為靜默丟棄學習資料。
 * 回傳獨立快照，排除本機收據；還原點、權限、token 等不在可攜結構中。
 */
export function exportLearningBackup(data, now) {
  if (!object(data) || !validatePlainJson(data).ok || !validTime(now) ||
      Object.keys(data).some((key) => ![...group, 'prefs'].includes(key))) {
    throw new LearningError('INVALID_BACKUP', '資料不合法，沒有產生備份。');
  }
  /**
   * 先驗證完整來源，不能藉由排除收據掩蓋非法欄位或損毀的關聯。
   * 收據只供本機交易重播，不應先序列化並占用可攜備份的大小限額。
   * 以新的淺層容器排除，再複製可攜內容，來源與其收據都保持不變。
   */
  if (own(data, 'learning') && !validateLearning(data.learning).ok) {
    throw new LearningError('INVALID_BACKUP', '備份資料不完整或不合法。');
  }
  const portable = own(data, 'learning') ? { ...data, learning: { ...data.learning, operations: {} } } : data;
  const payload = { format: BACKUP_FORMAT, version: 2, exportedAt: now, ...clone(portable) };
  const result = parseLearningBackup(JSON.stringify(payload));
  if (!result.ok || result.errors.length) throw new LearningError(result.code || 'INVALID_BACKUP', '備份資料不完整或不合法。');
  return { format: BACKUP_FORMAT, version: 2, exportedAt: now, ...result.data };
}
