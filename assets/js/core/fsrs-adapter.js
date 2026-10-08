/**
 * B 階段 FSRS 排程 adapter：使用鎖定版本 ts-fsrs 的預設參數，不訓練個人參數。
 * 關閉 fuzz 讓同樣輸入得到同樣結果（可重現、可測試）；關閉短期學習步驟，
 * 間隔以天為單位，與「每日清單」的粒度一致。只接受 Again／Good 兩種評分。
 */
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.js';
import { LearningError } from './learning-errors.js';
import { validateLearningRecord } from './learning-schema.js';

export const FSRS_VERSION = 'ts-fsrs-5.4.2-d1';
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: false }));
const MASTERED_STABILITY_DAYS = 90;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const invalid = (message) => { throw new LearningError('INVALID_DATA', message); };

/**
 * 在資格判定前驗證已持久化的 FSRS 狀態，未到期與補強也不能繞過版本或資料檢查。
 * d1 關閉短期步驟，因此已提交卡片只能是 Review，且不接受未知欄位。
 */
export function validateFsrsState(itemState, at) {
  const result = validateLearningRecord('itemStates', itemState);
  if (!result.ok) invalid('FSRS 能力狀態不合法。');
  if (!timestamp(at) || !timestamp(itemState.due)) invalid('FSRS 時間超出可表示範圍。');
  if (itemState.schedulerName !== 'fsrs') return;
  if (itemState.schedulerVersion !== FSRS_VERSION) {
    throw new LearningError('UNSUPPORTED_VERSION', '不支援這個 FSRS 排程版本，沒有改動。');
  }
  const s = itemState.schedulerState;
  const fields = ['stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'reps', 'lapses', 'learningSteps', 'state', 'lastReview'];
  if (!s || Object.keys(s).length !== fields.length || Object.keys(s).some((key) => !fields.includes(key))
    || !finite(s.stability) || s.stability <= 0 || !finite(s.difficulty) || s.difficulty < 1 || s.difficulty > 10
    || !count(s.elapsedDays) || !count(s.scheduledDays) || s.scheduledDays < 1
    || !count(s.reps) || s.reps < 1 || !count(s.lapses) || s.lapses >= s.reps
    || s.learningSteps !== 0 || s.state !== State.Review
    || !timestamp(s.lastReview) || s.lastReview > at || itemState.due < s.lastReview
    || itemState.lastEligibleReviewAt !== s.lastReview) {
    invalid('FSRS 記憶、計數或時間狀態不合法，沒有改動。');
  }
}

/**
 * 持久化的排程狀態只存有限數值與毫秒時間，不存 Date 物件。
 */
function toState(card) {
  return {
    stability: card.stability, difficulty: card.difficulty,
    elapsedDays: card.elapsed_days, scheduledDays: card.scheduled_days,
    reps: card.reps, lapses: card.lapses, learningSteps: card.learning_steps, state: card.state,
    lastReview: card.last_review ? card.last_review.getTime() : null,
  };
}

function toCard(itemState, at) {
  if (itemState.schedulerName !== 'fsrs') return createEmptyCard(new Date(at));
  const s = itemState.schedulerState;
  return {
    due: new Date(itemState.due), stability: s.stability, difficulty: s.difficulty,
    elapsed_days: s.elapsedDays, scheduled_days: s.scheduledDays, reps: s.reps, lapses: s.lapses,
    learning_steps: s.learningSteps, state: s.state,
    ...(s.lastReview === null ? {} : { last_review: new Date(s.lastReview) }),
  };
}

/**
 * 對一個能力做一次合格複習。舊版 Leitner／legacy 狀態在第一次真實複習時才轉成 FSRS，
 * 以全新卡片起算（不從累計次數偽造記憶狀態）；legacySummary 原樣保留。
 * 回傳要合併進 itemState 的欄位。
 */
export function scheduleFsrs({ previousState, rating, at }) {
  if (!['Again', 'Good'].includes(rating)) throw new LearningError('INVALID_DATA', 'FSRS 只接受 Again 或 Good。');
  validateFsrsState(previousState, at);
  const card = toCard(previousState, at);
  let next;
  try {
    next = scheduler.next(card, new Date(at), rating === 'Good' ? Rating.Good : Rating.Again).card;
  } catch {
    invalid('FSRS 無法計算這次複習，沒有改動。');
  }
  const learningStatus = next.state === State.Review
    ? (next.stability >= MASTERED_STABILITY_DAYS ? 'mastered' : 'review') : 'learning';
  const scheduled = {
    schedulerName: 'fsrs', schedulerVersion: FSRS_VERSION, schedulerState: toState(next),
    due: next.due.getTime(), lastEligibleReviewAt: at, learningStatus,
  };
  validateFsrsState({ ...previousState, ...scheduled }, at);
  return scheduled;
}
