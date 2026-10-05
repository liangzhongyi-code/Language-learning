/**
 * 舊版 localStorage 的純轉換。驗證失败時保留來源並停止，不借用舊 loader 的
 * 「壞資料回空值」退路；累計數不推算不存在的作答時間／能力／FSRS 記憶狀態。
 */
import { emptyLearning, validateStats, validateProgress } from './learning-schema.js';
import { BACKUP_JSON_MAX_BYTES } from './backup-limits.js';

function invalid() {
  const error = new Error('舊學習紀錄無法安全遷移，原資料已保留；請先匯出或檢查備份。');
  error.code = 'MIGRATION_INVALID';
  return error;
}

function parse(raw, fallback, validate) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== 'string' || raw.length > BACKUP_JSON_MAX_BYTES ||
      new TextEncoder().encode(raw).byteLength > BACKUP_JSON_MAX_BYTES) throw invalid();
  let value;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!validate(value).ok) throw invalid();
  return value;
}

/**
 * 回傳候選資料而非「已遷移」；repository 必須把本結果與完成標記同交易落盤。
 * 偏好仍留網站 localStorage，不宣稱它與 IndexedDB 一起具備原子交易。
 */
export function migrateLegacy({ statsRaw, progressRaw, now, timeZone, dataEpoch }) {
  const stats = parse(statsRaw, { schemaVersion: 1, byScope: {} }, validateStats);
  const progress = parse(progressRaw, { schemaVersion: 1, items: {} }, validateProgress);
  const learning = emptyLearning({ now, timeZone, dataEpoch });
  learning.meta.migrationStatus = 'complete';
  return { stats, progress, learning };
}
