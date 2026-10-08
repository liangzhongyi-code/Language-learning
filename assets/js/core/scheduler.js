/**
 * 純排程 adapter，同時支援舊 Leitner 與 FSRS；時間、狀態與事件由呼叫端注入。
 * 網站提交採用 FSRS；保留 Leitner 預設供舊呼叫相容，這裡不自行讀取儲存或全部歷史。
 */
import { nextBox, dueAfter, GRADUATED_BOX } from './srs.js';
import { validatePlainJson, validateLearningRecord, validateProgress } from './learning-schema.js';
import { LearningError } from './learning-errors.js';
import { skillKeyFor } from './learning-identity.js';
import { scheduleFsrs, validateFsrsState } from './fsrs-adapter.js';
export { skillKeyFor } from './learning-identity.js';

export const LEITNER_VERSION = 'leitner-a1';
const clone = (value) => JSON.parse(JSON.stringify(value));
const invalid = (message) => { throw new LearningError('INVALID_DATA', message); };

function checked(collection, value) {
  const result = validateLearningRecord(collection, value);
  if (!result.ok) throw new LearningError('INVALID_DATA', `學習紀錄不合法：${collection}。`, { errors: result.errors });
}

/**
 * 分數政策只使用實際對錯／提示／重試；播放次数與耗時不臆測 Hard 或 Easy。
 */
export function reviewRating(event) {
  checked('reviewEvents', event);
  return event.correct && !event.assistance.hintUsed && !event.assistance.retry ? 'Good' : 'Again';
}

/**
 * 只建立被實際操作的那一個維度，不掃描全庫、不造 review、不搬其他維度熟練度。
 * legacySummary 完整保存原 n/w/box/last/due；舊資料缺 due 時僅候選卡視為立即到期。
 * initialization 必填：new 是新能力；legacy 的 progress 必須是遷移保留的原始摘要，
 * 不可傳作答後的來源累計。刻意不提供預設或舊參數別名，避免把不同能力接在一起。
 */
export function initializeItemState({ sourceId, ability, direction, initialization, ...other }) {
  const skillKey = skillKeyFor({ sourceId, ability, direction });
  if (Object.keys(other).length || !initialization || !validatePlainJson(initialization).ok
    || !['new', 'legacy'].includes(initialization.kind)) invalid('必須明確指定新能力或原始舊摘要，不能使用累計進度初始化。');
  const allowed = initialization.kind === 'new' ? ['kind'] : ['kind', 'progress'];
  if (Object.keys(initialization).some((key) => !allowed.includes(key))) invalid('能力初始化含不適用的欄位。');
  const legacyProgress = initialization.kind === 'legacy' ? initialization.progress : null;
  if (initialization.kind === 'legacy' && (!legacyProgress
    || !validateProgress({ schemaVersion: 1, items: { [sourceId]: legacyProgress } }).ok)) invalid('原有逐題進度不合法。');
  const itemState = {
    skillKey, sourceId, ability, direction,
    legacySummary: legacyProgress === null ? null : clone(legacyProgress),
    schedulerName: legacyProgress === null ? 'leitner' : 'legacy',
    schedulerVersion: legacyProgress === null ? LEITNER_VERSION : 'legacy-v1',
    schedulerState: legacyProgress === null ? { box: 1 } : null,
    due: legacyProgress?.due ?? 0,
    lastEligibleReviewAt: null,
    learningStatus: legacyProgress === null ? 'introduced' : 'review',
  };
  checked('itemStates', itemState);
  return itemState;
}

/**
 * sessionEvents 必須來自同交易所讀的當局已存事件，可包含其他能力；只對本能力套政策。
 * 同局 Good 最多升階一次、Again 最多重設一次；明確補強一律不改長期排程。
 * 重送收據應由 repository 先處理，這裡拒絕再次對同題次計數。
 * policy：'leitner'（相容預設）或 'fsrs'（網站提交使用）。資格規則兩者相同，只有間隔計算不同；
 * 舊 Leitner／legacy 狀態在第一次合格複習時才轉成 FSRS，不全庫重排。
 */
export function scheduleReview({ event, previousState, sessionEvents = [], policy = 'leitner' }) {
  checked('reviewEvents', event);
  checked('itemStates', previousState);
  if (!['leitner', 'fsrs'].includes(policy)) invalid('未知的排程政策。');
  const context = event.assistance.context;
  if (!context || previousState.skillKey !== event.skillKey || previousState.sourceId !== event.sourceId
    || previousState.ability !== context.ability || previousState.direction !== context.actualDirection
    || event.skillKey !== skillKeyFor({ sourceId: event.sourceId, ability: context.ability, direction: context.actualDirection })) invalid('事件與能力狀態不一致。');
  if (previousState.schedulerName === 'fsrs' && policy !== 'fsrs') throw new LearningError('UNSUPPORTED', 'FSRS 狀態必須交由對應 adapter，不能改回 Leitner。');
  if (policy === 'fsrs') validateFsrsState(previousState, event.answeredAt);
  if (previousState.schedulerName === 'leitner' && previousState.schedulerVersion !== LEITNER_VERSION) throw new LearningError('UNSUPPORTED_VERSION', '不支援這個 Leitner 排程版本。');
  if (!Array.isArray(sessionEvents)) invalid('當局已存事件必須是陣列。');
  const relevant = [];
  const seen = new Set();
  for (const old of sessionEvents) {
    checked('reviewEvents', old);
    if (old.sessionId !== event.sessionId || seen.has(old.reviewId)) invalid('当局事件含其他 session 或重複 ID。');
    seen.add(old.reviewId);
    if (old.reviewId === event.reviewId || old.entryId === event.entryId) throw new LearningError('ENTRY_CONFLICT', '這個題次已提交，請由 repository 回傳原收據。');
    if (old.skillKey === event.skillKey) relevant.push(old);
  }
  if (typeof context.reinforcement !== 'boolean') invalid('事件缺少明確的補強狀態。');
  const rating = reviewRating(event);
  const resetAlready = relevant.some((old) => old.scheduleEligible && reviewRating(old) === 'Again');
  const reviewedAlready = relevant.some((old) => old.scheduleEligible);
  const scheduleEligible = !context.reinforcement && (rating === 'Again'
    ? !resetAlready
    : !reviewedAlready && previousState.due <= event.answeredAt);
  const itemState = clone(previousState);
  if (scheduleEligible && policy === 'fsrs') {
    Object.assign(itemState, scheduleFsrs({ previousState, rating, at: event.answeredAt }));
  } else if (scheduleEligible) {
    const previousBox = previousState.schedulerName === 'legacy'
      ? previousState.legacySummary.box ?? 1 : previousState.schedulerState.box;
    const box = nextBox(previousBox, rating === 'Good');
    itemState.schedulerName = 'leitner';
    itemState.schedulerVersion = LEITNER_VERSION;
    itemState.schedulerState = { box };
    itemState.due = dueAfter(box, event.answeredAt);
    itemState.lastEligibleReviewAt = event.answeredAt;
    itemState.learningStatus = box >= GRADUATED_BOX ? 'mastered' : rating === 'Again' ? 'learning' : 'review';
  }
  checked('itemStates', itemState);
  return { itemState, scheduleEligible, rating };
}
