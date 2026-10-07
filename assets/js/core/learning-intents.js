/**
 * 想學、自評已會的純狀態轉換。意向只影響每日計畫的「未開始新字」選擇，
 * 不寫 itemStates、不改 due、不碰日帳本；今日略過由 study-session.skipEntry 處理。
 * 回傳候選紀錄與 changes（store 固定為 intents），由 repository 同交易保存。
 */
import { LearningError } from './learning-errors.js';
import { validateLearningRecord } from './learning-schema.js';
import { isSafeId } from './library.js';

const fail = (code, message, details = {}) => { throw new LearningError(code, message, details); };
const clone = (value) => JSON.parse(JSON.stringify(value));

function checkNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_DATA', '時間必須是有效的非負毫秒數。');
}

function checkIntent(intent, sourceId) {
  if (intent === null) return;
  const result = validateLearningRecord('intents', intent);
  if (!result.ok) fail('INVALID_DATA', '學習意向資料不合法。', { errors: result.errors });
  if (sourceId !== undefined && intent.sourceId !== sourceId) fail('INVALID_DATA', '學習意向與單字不一致。');
}

/**
 * 共用轉換：與目前相同時不產生變更；兩個旗標都為 false 時刪除紀錄，避免累積空意向。
 * updatedAt 取 now 與舊值較大者，時鐘倒退時不讓紀錄時間倒退。
 */
function transition(intent, sourceId, patch, now) {
  checkNow(now);
  if (!isSafeId(sourceId)) fail('INVALID_DATA', '單字 ID 不是安全的 ID。');
  checkIntent(intent, sourceId);
  const current = { wantToLearn: intent?.wantToLearn ?? false, selfAssessedKnown: intent?.selfAssessedKnown ?? false };
  const flags = { ...current, ...patch };
  if (flags.wantToLearn === current.wantToLearn && flags.selfAssessedKnown === current.selfAssessedKnown) {
    return { intent: intent === null ? null : clone(intent), changes: [] };
  }
  if (!flags.wantToLearn && !flags.selfAssessedKnown) {
    return { intent: null, changes: [{ store: 'intents', key: sourceId, delete: true }] };
  }
  const next = { sourceId, wantToLearn: flags.wantToLearn, selfAssessedKnown: flags.selfAssessedKnown,
    updatedAt: Math.max(now, intent?.updatedAt ?? 0) };
  const result = validateLearningRecord('intents', next);
  if (!result.ok) fail('INVALID_DATA', '學習意向資料不合法。', { errors: result.errors });
  return { intent: next, changes: [{ store: 'intents', key: sourceId, value: clone(next) }] };
}

/**
 * 標記或取消想學；只提升未開始新字的順位，不增加每日額度、不擠掉到期複習。
 * 修改後若今日計畫已存在，呼叫端須以 revisePendingNew 重排未開始新字槽位。
 */
export function setWantToLearn({ intent = null, sourceId, value = true, now }) {
  if (typeof value !== 'boolean') fail('INVALID_DATA', 'value 必須是布林值。');
  return transition(intent, sourceId, { wantToLearn: value }, now);
}

/**
 * 自評已會：未經作答驗證，只讓此字不再被當成新字介紹；不清除既有 due 與歷史。
 */
export function setSelfAssessedKnown({ intent = null, sourceId, now }) {
  return transition(intent, sourceId, { selfAssessedKnown: true }, now);
}

/**
 * 撤回自評已會：恢復新字資格，其他意向（例如想學）保留。
 */
export function withdrawSelfAssessed({ intent = null, sourceId, now }) {
  return transition(intent, sourceId, { selfAssessedKnown: false }, now);
}

/**
 * 實際作答提交後呼叫：真正答錯時解除自評已會；答對或沒有自評時不變。
 * 必須與 review 事件同交易保存。sourceId 可選，提供時核對與意向一致。
 */
export function afterReview({ intent = null, sourceId, correct, now }) {
  if (typeof correct !== 'boolean') fail('INVALID_DATA', 'correct 必須是布林值。');
  checkNow(now);
  if (sourceId !== undefined && !isSafeId(sourceId)) fail('INVALID_DATA', '單字 ID 不是安全的 ID。');
  checkIntent(intent, sourceId);
  if (intent === null || correct || !intent.selfAssessedKnown) return { intent: intent === null ? null : clone(intent), changes: [] };
  return transition(intent, intent.sourceId, { selfAssessedKnown: false }, now);
}

/**
 * 供 UI 顯示：自評已會一律標示未驗證（verified: false）；沒有自評時 verified 為 null。
 */
export function describeIntent(intent) {
  checkIntent(intent ?? null);
  const selfAssessedKnown = intent?.selfAssessedKnown ?? false;
  return { wantToLearn: intent?.wantToLearn ?? false, selfAssessedKnown, verified: selfAssessedKnown ? false : null };
}
