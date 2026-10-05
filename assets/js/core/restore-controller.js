/**
 * 三種匯入來源共用的預覽與確認生命週期。
 */
import { parseLearningBackup } from './learning-backup.js';
import { LearningError } from './learning-errors.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * repository／讀檔／儲存偏好均由平台注入。預覽不外洩可變 payload，
 * 確認只使用第一次驗證的固定資料，不重新下載，也不偷用新的 revision。
 */
export function createRestoreController({ repository, now, timeZone, nextOperationId, savePreferences }) {
  let generation = 0;
  let pending = null;
  let confirming = null;
  const stale = () => new LearningError('STALE_PREVIEW', '這份預覽已失效，請重新選擇備份並確認。');
  function busy() {
    if (confirming) throw new LearningError('RESTORE_BUSY', '還原正在保存，請等待結果；此時無法取消已送出的交易。');
  }
  function current() { return pending ? copy(pending.public) : null; }

  async function preview(readText, { source = 'file' } = {}) {
    busy();
    const request = ++generation;
    pending = null;
    const meta = await repository.ready();
    if (request !== generation) throw stale();
    const text = await readText();
    if (request !== generation) throw stale();
    const result = parseLearningBackup(text, { now: now(), timeZone: timeZone() });
    if (!result.ok) throw new LearningError(result.code || 'INVALID_BACKUP', result.errors.join(' '));
    const operationId = nextOperationId();
    const visible = { previewId: operationId, source, counts: result.counts, errors: result.errors,
      warnings: result.warnings, legacyReplacement: result.legacyReplacement, exportedAt: result.exportedAt,
      canRestoreLearning: Boolean(result.data.learning), canRestorePreferences: Boolean(result.data.prefs) };
    pending = { data: result.data, public: visible, operationId, meta: copy(meta) };
    return current();
  }

  function confirm({ learning = true, preferences = true } = {}) {
    if (confirming) return confirming;
    if (!pending) return Promise.reject(new LearningError('NO_PREVIEW', '請先讀取並檢查備份預覽。'));
    const selected = pending;
    const restoreGroup = learning && Boolean(selected.data.learning);
    const restorePrefs = preferences && Boolean(selected.data.prefs);
    if (!restoreGroup && !restorePrefs) return Promise.reject(new LearningError('NO_SELECTION', '請選擇要還原的資料。'));
    confirming = (async () => {
      const actual = await repository.ready();
      if (actual.revision !== selected.meta.revision || actual.dataEpoch !== selected.meta.dataEpoch) throw stale();
      let committed = null;
      if (restoreGroup) {
        const { stats, progress, learning: learningData } = selected.data;
        committed = await repository.restoreLearning({
          operationId: selected.operationId, epoch: selected.meta.dataEpoch, expectedRevision: selected.meta.revision,
          payload: copy({ stats, progress, learning: learningData }),
        });
      }
      let preferencesSaved = false;
      if (restorePrefs) {
        try { preferencesSaved = (await savePreferences(copy(selected.data.prefs))) === true; } catch { /* 偏好失敗不回滾已完成的學習交易。 */ }
      }
      pending = null;
      return { learningSaved: restoreGroup, preferencesSaved, committed,
        preferenceError: restorePrefs && !preferencesSaved ? '學習交易結果不受影響，但偏好設定未能保存，請重試偏好匯入。' : null };
    })().finally(() => { confirming = null; });
    return confirming;
  }
  return { preview, confirm, current, cancel() { busy(); generation++; pending = null; } };
}
