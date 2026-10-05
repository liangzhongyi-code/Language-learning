/**
 * 保存題面、介紹 claim 與續答的純狀態轉換，不提交 review 或變更長期排程。
 */
import { dailyWordPool, revisePendingNew, assertPlanSession } from './daily-plan.js';
import { pickDistractors } from './quiz-engine.js';
import { shuffle } from './shuffle.js';
import { validateLearningRecord, validatePlainJson } from './learning-schema.js';
import { speakTextOf } from './speech-text.js';
import { LearningError } from './learning-errors.js';
import { reviewIdentity } from './review-events.js';
import { localStudyDate, resolveStudyDay } from './study-day.js';

const clone = value => JSON.parse(JSON.stringify(value));
const finished = entry => entry.status === 'completed' || entry.status === 'skipped';
const fail = (code, message) => { throw new LearningError(code, message); };

function check(collection, value) {
  const result = validateLearningRecord(collection, value);
  if (!result.ok) throw new LearningError('INVALID_DATA', `每日資料不合法：${collection}`, { errors: result.errors });
}

/**
 * 新注入與保存題面使用同一能力守衛。完整 JSON 已由 schema／firstQuestion 驗過，
 * 此處只解析身份；資訊不足的舊快照保留原件，不替它猜測作答能力。
 */
function checkQuestionIdentity(question) {
  if (!question.kind || !question.direction) {
    fail('UNSUPPORTED', '這筆舊題面缺少作答模式或方向，無法安全續答；紀錄仍保留，沒有視為完成。');
  }
  const projection = {};
  for (const key of ['sourceId', 'kind', 'direction', 'ability', 'questionMode']) {
    if (question[key] !== undefined) projection[key] = question[key];
  }
  reviewIdentity({ question: projection });
}

function checkLedger(plan, ledger, now) {
  check('dailyPlans', plan);
  check('dailyLedger', ledger);
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_DATA', '時間必須是有效非負毫秒數。');
  if (ledger.ledgerId !== `${plan.localDate}:${plan.lang}` || ledger.timeZone !== plan.timeZone) fail('INVALID_DATA', '日帳本與計畫不一致。');
}

function findEntry(plan, entryId) {
  const entry = plan.orderedEntries.find(row => row.entryId === entryId);
  if (!entry) fail('ENTRY_CONFLICT', '找不到指定題次。');
  return entry;
}

function questionOf(entry, plan, words, direction, rng) {
  const pool = dailyWordPool(words, plan.lang, plan.level);
  const word = pool.find(row => row.id === entry.sourceId);
  if (!word) fail('INVALID_DATA', '單字已不在同級題庫，無法建立題面。');
  if (!['target2zh', 'zh2target'].includes(direction)) fail('INVALID_DATA', '每日辨認題的方向不合法。');
  const safeRng = () => {
    const value = rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) fail('INVALID_DATA', 'rng 必須回傳 0 到 1 之間的值。');
    return value;
  };
  const promptField = direction === 'target2zh' ? 'target' : 'zh';
  const optionField = direction === 'target2zh' ? 'zh' : 'target';
  const distractors = pickDistractors(pool, word, optionField, safeRng, null, promptField);
  const options = shuffle([word, ...distractors].map(row => ({ id: row.id, text: row[optionField],
    ruby: optionField === 'target' ? row.ruby ?? null : null, isCorrect: row.id === word.id })), safeRng);
  return { sourceId: entry.sourceId, kind: 'choice', direction, ability: 'recognition',
    prompt: word[promptField], promptLang: direction === 'target2zh' ? plan.lang : 'zh',
    level: word.level, promptRuby: promptField === 'target' ? word.ruby ?? null : null,
    optionLang: direction === 'target2zh' ? 'zh' : plan.lang,
    options, correctIndex: options.findIndex(option => option.isCorrect), answeredIndex: null,
    target: word.target, zh: word.zh, reading: word.reading ?? null, speakText: speakTextOf(word, plan.lang), note: word.note ?? null,
    reportContext: { source: 'words', sourceId: word.id, level: plan.level },
    ...(word.example !== undefined ? { example: word.example } : {}), ...(word.examples !== undefined ? { examples: word.examples } : {}) };
}

function canonicalDirection(direction, lang) {
  return direction === 'target2zh' ? `${lang}-zh` : direction === 'zh2target' ? `zh-${lang}` : direction;
}

function firstQuestion({ entry, plan, words, direction, rng, itemStates, questionSnapshot }) {
  let state = null;
  if (entry.skillKey !== null) {
    state = itemStates[entry.skillKey];
    check('itemStates', state);
    if (state.skillKey !== entry.skillKey || state.sourceId !== entry.sourceId) fail('INVALID_DATA', '能力與題次不一致。');
  }
  if (questionSnapshot !== undefined) {
    if (!validatePlainJson(questionSnapshot).ok || !questionSnapshot || questionSnapshot.sourceId !== entry.sourceId
      || typeof questionSnapshot.ability !== 'string' || typeof questionSnapshot.direction !== 'string') fail('INVALID_DATA', '指定題面缺少正確來源、能力或方向。');
    if (state && (questionSnapshot.ability !== state.ability || canonicalDirection(questionSnapshot.direction, plan.lang) !== canonicalDirection(state.direction, plan.lang))) fail('INVALID_DATA', '指定題面與待複習能力不同。');
    if (questionSnapshot.kind === 'choice') {
      const allowed = new Set(dailyWordPool(words, plan.lang, plan.level).map(word => word.id));
      if (!Array.isArray(questionSnapshot.options) || questionSnapshot.options.some(option => !allowed.has(option.id))) fail('INVALID_DATA', '指定題面的選項不在完整同級池。');
    }
    return clone(questionSnapshot);
  }
  if (state) {
    if (state.ability !== 'recognition') fail('UNSUPPORTED', '此能力必須提供匹配的固定題面，不能改成辨認題。');
    if (canonicalDirection(state.direction, plan.lang) === `${plan.lang}-zh`) direction = 'target2zh';
    else if (canonicalDirection(state.direction, plan.lang) === `zh-${plan.lang}`) direction = 'zh2target';
    else fail('UNSUPPORTED', '此能力方向必須提供匹配的固定題面。');
  }
  return clone(questionOf(entry, plan, words, direction, rng));
}

/**
 * 首次 prepare 原子候選：固定題面、建立 session、claim 新字；重送沿用題面且不再領額度。
 * rng 僅首次產生選項使用；不讀 Math.random、Date.now 或平台儲存。
 */
export function prepareEntry({ plan, ledger, session = null, entryId, words, now, sessionId,
  direction = 'target2zh', rng = () => 0.5, itemStates = {}, questionSnapshot, studyDayState }) {
  checkLedger(plan, ledger, now);
  assertPlanSession(plan, session);
  const next = clone(plan);
  const nextLedger = clone(ledger);
  const entry = findEntry(next, entryId);
  if (finished(entry)) fail('ENTRY_CONFLICT', '題次已完成或略過，不能重新開始。');
  if (entry.questionSnapshot !== null) {
    checkQuestionIdentity(entry.questionSnapshot);
  }
  let nextSession = session === null ? null : clone(session);
  if (nextSession) {
    check('sessions', nextSession);
    if (nextSession.planId !== next.planId || nextSession.sessionId !== next.sessionId) fail('ENTRY_CONFLICT', 'session 與計畫不一致。');
  } else if (next.sessionId !== null) fail('ENTRY_CONFLICT', '續答必須提供已保存的 session。');
  if (entry.status === 'prepared') {
    if (entry.kind === 'new' && !nextLedger.startedSourceIds.includes(entry.sourceId)) fail('INVALID_DATA', '已開始新字缺少日配額 claim。');
    return { plan: next, ledger: nextLedger, session: nextSession };
  }
  if (entry.kind === 'new') {
    // 只擋首次介紹的過期清單；已保存題面可續答，倒退時鐘沿用已建立日，不重領額度。
    let currentDate;
    try {
      // 有改區政策時必須沿用 resolveStudyDay 的單調日界，不能把尚未生效的 pendingZone 當新日。
      const day = studyDayState === undefined ? null : resolveStudyDay(studyDayState, now);
      if (day && day.timeZone !== plan.timeZone) fail('STALE_PLAN', '學習時區已更新，請重新取得今日清單。');
      currentDate = day ? day.localDate : localStudyDate(now, plan.timeZone);
    } catch (error) {
      if (error instanceof LearningError) throw error;
      fail('INVALID_DATA', '學習日政策或時間不合法，沒有領取新字額度。');
    }
    if (currentDate > plan.localDate) fail('STALE_PLAN', '學習日已更新，請重新取得今日清單再開始新字。');
    if (nextLedger.excludedSourceIds.includes(entry.sourceId)) fail('ENTRY_CONFLICT', '今日已略過此字，請重新取得清單。');
    if (nextLedger.startedSourceIds.includes(entry.sourceId)) fail('ENTRY_CONFLICT', '此字已由其他題次開始，請重新取得清單。');
    if (nextLedger.startedSourceIds.length >= nextLedger.newLimit) fail('QUOTA_EXCEEDED', '今日新字額度已用完。');
  }
  entry.questionSnapshot = entry.questionSnapshot ?? firstQuestion({ entry, plan: next, words, direction, rng, itemStates, questionSnapshot });
  checkQuestionIdentity(entry.questionSnapshot);
  entry.status = 'prepared';
  if (entry.kind === 'new') {
    entry.introducedAt = now;
    nextLedger.startedSourceIds.push(entry.sourceId);
    nextLedger.updatedAt = Math.max(now, nextLedger.updatedAt);
  }
  if (!nextSession) {
    next.sessionId = sessionId;
    nextSession = { sessionId, lang: next.lang, source: 'words', mode: 'choice', planId: next.planId,
      orderedEntryIds: next.orderedEntries.map(row => row.entryId), submittedReviewIds: [], questionSnapshots: {},
      status: 'active', createdAt: now, completedAt: null };
  }
  nextSession.questionSnapshots[entry.entryId] = clone(entry.questionSnapshot);
  check('sessions', nextSession);
  check('dailyPlans', next);
  return { plan: next, ledger: nextLedger, session: nextSession };
}

/**
 * 今日略過只接受未介紹新字；排除與替換清單一併回傳，不退還任何 claim。
 */
export function skipEntry(options) {
  const { plan, ledger, entryId, now } = options;
  checkLedger(plan, ledger, now);
  const entry = findEntry(plan, entryId);
  if (entry.kind !== 'new' || entry.status !== 'pending' || entry.introducedAt !== null) fail('ENTRY_CONFLICT', '只能略過尚未開始的新字。');
  const nextLedger = clone(ledger);
  if (!nextLedger.excludedSourceIds.includes(entry.sourceId)) nextLedger.excludedSourceIds.push(entry.sourceId);
  nextLedger.updatedAt = Math.max(now, nextLedger.updatedAt);
  return revisePendingNew({ ...options, ledger: nextLedger });
}

/**
 * 只接受已提交題次。每 sourceId 每段一次，兩個其他待答字後插入，不足則段尾。
 * 新題仍為 pending、reviewId 為 null；長期排程資格交給 review-events 依 kind 判斷。
 */
export function queueReinforcement({ plan, session = null, entryId, correct, hintUsed = false }) {
  check('dailyPlans', plan);
  assertPlanSession(plan, session);
  if (typeof correct !== 'boolean' || typeof hintUsed !== 'boolean') fail('INVALID_DATA', '補強判斷必須提供布林結果。');
  const next = clone(plan);
  const nextSession = session === null ? null : clone(session);
  const entry = findEntry(next, entryId);
  if (entry.status !== 'completed') fail('ENTRY_CONFLICT', '補強必須在實際提交完成後安排。');
  if (entry.kind === 'reinforcement' || correct && !hintUsed || next.orderedEntries.some(row => row.kind === 'reinforcement' && row.sourceId === entry.sourceId)) return { plan: next, session: nextSession };
  const reinforcement = { entryId: `${next.planId}:reinforcement:${entry.sourceId}`, sourceId: entry.sourceId, skillKey: entry.skillKey,
    kind: 'reinforcement', status: 'pending', questionSnapshot: clone(entry.questionSnapshot), reviewId: null, introducedAt: null };
  let insertion = next.orderedEntries.length;
  const otherSources = new Set();
  for (let i = next.orderedEntries.findIndex(row => row.entryId === entryId) + 1; i < next.orderedEntries.length; i++) {
    const other = next.orderedEntries[i];
    if (!finished(other) && other.sourceId !== entry.sourceId) otherSources.add(other.sourceId);
    if (otherSources.size >= 2) { insertion = i + 1; break; }
  }
  next.orderedEntries.splice(insertion, 0, reinforcement);
  next.status = 'active';
  if (nextSession) {
    check('sessions', nextSession);
    if (nextSession.planId !== next.planId || nextSession.sessionId !== next.sessionId) fail('ENTRY_CONFLICT', 'session 與計畫不一致。');
    nextSession.orderedEntryIds = next.orderedEntries.map(row => row.entryId);
    nextSession.questionSnapshots[reinforcement.entryId] = clone(reinforcement.questionSnapshot);
    nextSession.status = 'active';
    nextSession.completedAt = null;
  }
  check('dailyPlans', next);
  return { plan: next, session: nextSession };
}

/**
 * 只從已持久化的項目狀態找下一題；未提交的輸入不屬於這個契約。
 */
export function resumeStudySession({ plan }) {
  check('dailyPlans', plan);
  const index = plan.orderedEntries.findIndex(entry => !finished(entry));
  return { entry: index < 0 ? null : clone(plan.orderedEntries[index]), index, done: index < 0 };
}
