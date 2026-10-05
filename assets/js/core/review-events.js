/**
 * 逐題真實事件與純增量 reducer。回傳只是候選值，event／itemState／progress／stats
 * 必須連同 session、plan、收據在同一 repository 交易保存，才代表提交成功。
 */
import { isCorrect } from './quiz-engine.js';
import { validatePlainJson, validateLearningRecord, validateProgress, validateStats } from './learning-schema.js';
import { LearningError } from './learning-errors.js';
import { initializeItemState, scheduleReview, skillKeyFor, LEITNER_VERSION } from './scheduler.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const invalid = (message) => { throw new LearningError('INVALID_DATA', message); };
const modes = Object.freeze({ choice: 'recognition', cloze: 'assembly', typing: 'production',
  listening: 'listening-recognition', dictation: 'listening-production', tiles: 'assembly', reorder: 'assembly', pos: 'grammar' });

function checkedEvent(event) {
  const result = validateLearningRecord('reviewEvents', event);
  if (!result.ok) throw new LearningError('INVALID_DATA', '作答事件不合法。', { errors: result.errors });
}

/**
 * 舊題庫的 level 等可省略 UI 欄位會明確帶 undefined，僅忽略這些頂層未定義欄位。
 * 拒絕 accessor／危險鍵／非 JSON 子值，不呼叫 getter；不把整份題面放進事件。
 */
function questionData(question) {
  if (!question || typeof question !== 'object' || Array.isArray(question)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(question))) invalid('缺少有效的題目。');
  const data = Object.create(null);
  for (const key of Reflect.ownKeys(question)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('題目含不安全的欄位。');
    const descriptor = Object.getOwnPropertyDescriptor(question, key);
    if (!own(descriptor, 'value') || !descriptor.enumerable) invalid('題目不可包含 accessor 或隱藏欄位。');
    if (descriptor.value !== undefined) data[key] = descriptor.value;
  }
  if (!validatePlainJson(data).ok) invalid('題目必須是有限的純資料。');
  return data;
}

/**
 * 題面能力與實際模式必須相符；choice 形狀可承載聽力／文法，不能默默降成辨認。
 * 舊方向別名只轉成既有 canonical key，不建立第二個能力，也不改寫原快照。
 */
function resolveIdentity(q, questionMode) {
  const choiceModes = { recognition: 'choice', 'listening-recognition': 'listening', grammar: 'pos' };
  const implied = q.kind === 'choice' && own(q, 'ability') ? choiceModes[q.ability] : q.kind;
  const mode = questionMode ?? q.questionMode ?? implied;
  if (!own(modes, mode)) invalid('未知的作答模式。');
  if (own(q, 'questionMode') && q.questionMode !== mode) invalid('指定模式與保存題面的模式不一致。');
  if (q.kind !== mode && !(q.kind === 'choice' && ['listening', 'pos'].includes(mode))) invalid('題目形狀與作答模式不一致。');
  if (own(q, 'ability') && q.ability !== modes[mode]) invalid('保存題面的能力與作答模式不一致。');
  const lang = typeof q.sourceId === 'string' ? q.sourceId.split('-')[0] : null;
  const direction = ['ja', 'en'].includes(lang) && q.direction === `${lang}-zh` ? 'target2zh'
    : ['ja', 'en'].includes(lang) && q.direction === `zh-${lang}` ? 'zh2target' : q.direction;
  const identity = { sourceId: q.sourceId, ability: modes[mode], direction };
  return { mode, identity: { ...identity, skillKey: skillKeyFor(identity) } };
}

/**
 * 選項題不因翻譯方向變成 production；候選字填空屬句子 assembly。
 * 未來輸入題的評分交由其純判題器，本模組只接收已確認的結果。
 */
export function reviewIdentity({ question, questionMode }) {
  const q = questionData(question);
  return resolveIdentity(q, questionMode).identity;
}

function correctness(q, answerContext) {
  let correct;
  if (q.kind === 'choice') {
    if (!Array.isArray(q.options) || q.options.length < 2
      || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length
      || !Number.isInteger(q.answeredIndex) || q.answeredIndex < 0 || q.answeredIndex >= q.options.length) invalid('選擇題尚未提交或選項索引不合法。');
    correct = isCorrect(q);
  } else if (q.kind === 'cloze') {
    if (q.submitted !== true || !Array.isArray(q.blanks) || q.blanks.length === 0
      || !Array.isArray(q.filled) || q.filled.length !== q.blanks.length
      || q.blanks.some((blank) => !blank || typeof blank.answer !== 'string' || blank.answer.length === 0)
      || q.filled.some((value) => typeof value !== 'string' || value.length === 0)) invalid('填空題尚未完整提交。');
    correct = isCorrect(q);
  } else {
    if (answerContext.submitted !== true || typeof answerContext.correct !== 'boolean') invalid('新題型必須提供純判題器的已提交結果。');
    correct = answerContext.correct;
  }
  if (own(answerContext, 'correct') && answerContext.correct !== correct) invalid('判題結果與題目作答不一致。');
  if (own(answerContext, 'submitted') && answerContext.submitted !== true) invalid('尚未提交的題目不能產生事件。');
  return correct;
}

/**
 * 建立待套用事件，reviewId／now 均由呼叫端提供並在重試時保持不變。
 * assistance.context 只保留能力／範圍／補強上下文，不保存尚未提交的輸入或整份題庫。
 */
export function createReviewEvent({ sessionId, entryId, planId = null, question, lang, source,
  answerContext = {}, now, reviewId, questionMode }) {
  const q = questionData(question);
  const { mode, identity } = resolveIdentity(q, questionMode);
  if (!['en', 'ja'].includes(lang) || typeof source !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(source)) invalid('作答的語言或題源不合法。');
  if (!answerContext || typeof answerContext !== 'object' || Array.isArray(answerContext) || !validatePlainJson(answerContext).ok) invalid('作答上下文必須是純資料。');
  const allowed = ['correct', 'submitted', 'hintUsed', 'retry', 'replayCount', 'responseMs', 'reinforcement', 'kanjiMode'];
  if (Object.keys(answerContext).some((key) => !allowed.includes(key))) invalid('作答上下文含未知欄位。');
  const { hintUsed = false, retry = false, replayCount = 0, responseMs = null, reinforcement = false, kanjiMode } = answerContext;
  if (typeof reinforcement !== 'boolean') invalid('補強旗標必須是布林值。');
  const assistance = { hintUsed, retry, replayCount,
    context: { lang, source, ability: identity.ability, actualDirection: identity.direction, reinforcement } };
  if (kanjiMode !== undefined) assistance.kanjiMode = kanjiMode;
  const event = { reviewId, sessionId, planId, entryId, sourceId: identity.sourceId, skillKey: identity.skillKey,
    answeredAt: now, correct: correctness(q, answerContext), assistance, responseMs, questionMode: mode,
    scheduleEligible: false, schedulerVersion: LEITNER_VERSION, before: null, after: null };
  checkedEvent(event);
  return event;
}

/**
 * 傳入單筆 source progress、scope stats 與能力狀態，不接全庫快照。
 * sourceProgress 只供累計；previousState 缺少時 initialization 必填，不能推測來源。
 * 真正遷移的摘要需用 { kind: 'legacy', progress: 原始摘要 } 明確提供，其他新能力
 * 使用 { kind: 'new' }；已有 previousState 時不可再初始化，也不覆蓋它的排程。
 * 正確次數記錄實際對錯；hint/retry 另外降排程為 Again，不把答對改寫成答錯。
 * 完成局數完全不動，completeSession 必須另行去重。
 */
export function applyReview({ event, previousState = null, sourceProgress = null, initialization,
  statsScope = null, sessionEvents = [], ...other }) {
  if (Object.keys(other).length) invalid('作答參數不合法；累計使用 sourceProgress，舊摘要必須明確指定 initialization。');
  if (previousState !== null && initialization !== undefined) invalid('已有能力狀態不能再次初始化。');
  checkedEvent(event);
  const context = event.assistance.context;
  if (!context || !['en', 'ja'].includes(context.lang) || typeof context.source !== 'string'
    || !/^[a-z][a-z-]{0,63}$/.test(context.source)
    || !own(modes, event.questionMode) || modes[event.questionMode] !== context.ability
    || event.skillKey !== skillKeyFor({ sourceId: event.sourceId, ability: context.ability, direction: context.actualDirection })) invalid('事件缺少相符的能力與統計範圍。');
  if (event.before !== null || event.after !== null || event.scheduleEligible !== false) invalid('已套用事件不可重新計數，請由 repository 先處理收據。');
  const scopeKey = `${context.lang}:${context.source}`;
  const previousProgress = sourceProgress === null ? { n: 0, w: 0 } : sourceProgress;
  const previousStats = statsScope === null ? { answered: 0, correct: 0, sessions: 0 } : statsScope;
  if (!validateProgress({ schemaVersion: 1, items: { [event.sourceId]: previousProgress } }).ok
    || !validateStats({ schemaVersion: 1, byScope: { [scopeKey]: previousStats } }).ok) invalid('原有進度或統計不合法。');
  const initial = previousState === null ? initializeItemState({ sourceId: event.sourceId,
    ability: context.ability, direction: context.actualDirection, initialization }) : previousState;
  if (previousState === null && initialization.kind === 'legacy' && (sourceProgress === null
    || sourceProgress.n < initial.legacySummary.n || sourceProgress.w < initial.legacySummary.w)) invalid('舊摘要初始化必須保留原有累計次數。');
  const scheduled = scheduleReview({ event, previousState: initial, sessionEvents });
  const progress = { ...clone(previousProgress), n: previousProgress.n + 1,
    w: previousProgress.w + (event.correct ? 0 : 1), last: event.answeredAt };
  if (scheduled.scheduleEligible) {
    progress.box = scheduled.itemState.schedulerState.box;
    progress.due = scheduled.itemState.due;
  }
  const nextStats = { answered: previousStats.answered + 1, correct: previousStats.correct + (event.correct ? 1 : 0), sessions: previousStats.sessions };
  if (!validateProgress({ schemaVersion: 1, items: { [event.sourceId]: progress } }).ok
    || !validateStats({ schemaVersion: 1, byScope: { [scopeKey]: nextStats } }).ok) invalid('學習累計已超過安全數值範圍。');
  const appliedEvent = { ...clone(event), scheduleEligible: scheduled.scheduleEligible,
    schedulerVersion: scheduled.itemState.schedulerVersion, before: clone(initial), after: clone(scheduled.itemState) };
  checkedEvent(appliedEvent);
  return { event: appliedEvent, itemState: scheduled.itemState, progress, statsScope: nextStats, scopeKey, rating: scheduled.rating };
}
