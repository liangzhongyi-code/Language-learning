/**
 * 固定每日計畫的純計算。所有回傳皆為候選值，須由 repository 同交易保存。
 */
import { studyDayKey, studyPlanKey, localStudyDate } from './study-day.js';
import { validateLearningRecord, validateProgress } from './learning-schema.js';
import { LearningError } from './learning-errors.js';
import { reviewIdentity } from './review-events.js';
import { skillKeyFor } from './scheduler.js';
import { isDue } from './srs.js';

const clone = value => JSON.parse(JSON.stringify(value));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finished = entry => entry.status === 'completed' || entry.status === 'skipped';
/**
 * 尚未提交的跨日題次還沒有 skillKey，但固定題面已有實際能力與方向。
 * 使用同一個能力身份去重，不能讓提交前的 legacy 身份在提交後繼續排入。
 * 舊 alias 僅在比較時正規化，不改寫固定快照。極簡快照使用原 entry 身份，
 * 不以來源推測能力；沒有題面與題次的舊摘要才使用 source 級 legacy 身份。
 */
function identity(entry, lang) {
  const canonicalDirection = direction => direction === `${lang}-zh` ? 'target2zh'
    : direction === `zh-${lang}` ? 'zh2target' : direction;
  if (entry.skillKey !== null) {
    const prefix = `${entry.sourceId}:`;
    const [ability, direction, extra] = entry.skillKey.startsWith(prefix) ? entry.skillKey.slice(prefix.length).split(':') : [];
    try {
      if (extra !== undefined) throw new Error('invalid key');
      return `skill:${skillKeyFor({ sourceId: entry.sourceId, ability, direction: canonicalDirection(direction) })}`;
    } catch { return `skill:${entry.skillKey}`; }
  }
  const question = entry.questionSnapshot;
  if (question?.kind && question?.direction) {
    // context 已驗完整純資料；身份解析只需要固定大小欄位，不重走每份歷史 options。
    const projection = {};
    for (const key of ['sourceId', 'kind', 'direction', 'ability', 'questionMode']) {
      if (question[key] !== undefined) projection[key] = question[key];
    }
    return `skill:${reviewIdentity({ question: projection }).skillKey}`;
  }
  if (question && entry.entryId) return `entry:${JSON.stringify([entry.sourceId, entry.entryId])}`;
  return `legacy:${entry.sourceId}`;
}
const invalid = message => { throw new LearningError('INVALID_DATA', message); };

function sameJson(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]));
}

function check(collection, row) {
  const result = validateLearningRecord(collection, row);
  if (!result.ok) throw new LearningError('INVALID_DATA', `每日資料不合法：${collection}`, { errors: result.errors });
}

/**
 * 修改固定題序前核對 session；呼叫端不能省略已建立的 session 或提交相異快照。
 */
export function assertPlanSession(plan, session) {
  if (plan.sessionId === null) {
    if (session !== null) invalid('未開始計畫不可附帶其他 session。');
    return;
  }
  if (session === null) invalid('已開始計畫必須提供 session。');
  check('sessions', session);
  if (session.sessionId !== plan.sessionId || session.planId !== plan.planId || session.lang !== plan.lang
    || session.orderedEntryIds.length !== plan.orderedEntries.length
    || session.orderedEntryIds.some((id, i) => id !== plan.orderedEntries[i].entryId)) invalid('session 與計畫的身份或固定題序不一致。');
  for (const entry of plan.orderedEntries) {
    const saved = session.questionSnapshots[entry.entryId];
    if ((['prepared', 'completed'].includes(entry.status) || saved !== undefined) && !sameJson(saved, entry.questionSnapshot)) invalid('session 與計畫的保存題面不一致。');
    if (entry.reviewId !== null && !session.submittedReviewIds.includes(entry.reviewId)) invalid('session 缺少已提交題次。');
  }
}

/**
 * 題庫 1–5 是由易至難；持久化日文使用 N5–N1，英文使用字串 1–5。
 */
export function normalizeDailyLevel(lang, level) {
  if (!['ja', 'en'].includes(lang)) invalid('不支援的學習語言。');
  if (lang === 'ja' && /^N[1-5]$/.test(String(level))) return level;
  if (!/^[1-5]$/.test(String(level))) invalid('不支援的學習級別。');
  return lang === 'ja' ? `N${6 - Number(level)}` : String(level);
}

/**
 * 目標與干擾詞都必須使用完整同語言、同級別池；不跨級遞補。
 */
export function dailyWordPool(words, lang, level) {
  if (!Array.isArray(words)) invalid('單字題庫必須是陣列。');
  const normalized = normalizeDailyLevel(lang, level);
  const seen = new Set();
  return words.filter(word => {
    if (!word || typeof word.id !== 'string') invalid('單字缺少穩定 ID。');
    if (!word.id.startsWith(`${lang}-`) || (word.lang !== undefined && word.lang !== lang)) return false;
    if (normalizeDailyLevel(lang, word.level) !== normalized) return false;
    if (seen.has(word.id)) invalid('同級題庫含重複單字 ID。');
    seen.add(word.id);
    return true;
  });
}

function context(options) {
  const { words, progress = { schemaVersion: 1, items: {} }, itemStates = {}, intents = {},
    existingPlans = {}, localDate, timeZone, lang, now, newLimit = 5, reviewLimit = 20 } = options;
  const level = normalizeDailyLevel(lang, options.level);
  const ledgerId = studyDayKey(localDate, lang);
  localStudyDate(now, timeZone);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(newLimit) || newLimit < 0
    || !Number.isSafeInteger(reviewLimit) || reviewLimit < 1) invalid('額度與時間必須是有效整數，複習段至少一題。');
  if (!validateProgress(progress).ok) invalid('舊進度不合法。');
  const maps = [[itemStates, 'itemStates', 'skillKey'], [intents, 'intents', 'sourceId'], [existingPlans, 'dailyPlans', 'planId']];
  for (const [map, collection, keyName] of maps) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) invalid('每日資料集合必須以 ID 為 key。');
    for (const [key, row] of Object.entries(map)) {
      check(collection, row);
      if (key !== row[keyName]) invalid('每日資料 key 與紀錄 ID 不符。');
    }
  }
  const plans = Object.values(existingPlans).filter(plan => plan.lang === lang);
  if (plans.some(plan => plan.localDate > localDate)) invalid('學習日不可倒退，請先使用 resolveStudyDay。');
  let ledger;
  if (options.ledger !== undefined && options.ledger !== null) {
    check('dailyLedger', options.ledger);
    if (options.ledger.ledgerId !== ledgerId || options.ledger.timeZone !== timeZone) invalid('日帳本的日期、語言或固定時區不符。');
    ledger = clone(options.ledger);
    ledger.newLimit = newLimit;
  } else {
    if (plans.some(plan => plan.localDate === localDate)) invalid('已有當日計畫，不能省略共用日帳本。');
    ledger = { ledgerId, localDate, timeZone, lang, startedSourceIds: [], excludedSourceIds: [], newLimit, updatedAt: now };
  }
  ledger.updatedAt = Math.max(now, ledger.updatedAt);
  const pool = dailyWordPool(words, lang, level);
  const known = new Set(Object.entries(progress.items).filter(([, row]) => row.n > 0).map(([id]) => id));
  for (const row of Object.values(itemStates)) known.add(row.sourceId);
  for (const plan of plans) for (const entry of plan.orderedEntries) {
    if (entry.introducedAt !== null || entry.status === 'completed') known.add(entry.sourceId);
    if (plan.localDate === localDate && entry.kind === 'new' && entry.introducedAt !== null
      && !ledger.startedSourceIds.includes(entry.sourceId)) invalid('已介紹的新字缺少共用日帳本 claim。');
  }
  return { ...options, pool, progress, itemStates, intents, plans, localDate, timeZone, lang, level, now, newLimit, reviewLimit, ledger, known };
}

function newWords(ctx) {
  const excluded = new Set([...ctx.ledger.startedSourceIds, ...ctx.ledger.excludedSourceIds]);
  return ctx.pool.filter(word => !ctx.known.has(word.id) && !excluded.has(word.id) && !ctx.intents[word.id]?.selfAssessedKnown)
    .sort((a, b) => Number(Boolean(ctx.intents[b.id]?.wantToLearn)) - Number(Boolean(ctx.intents[a.id]?.wantToLearn)) || compare(a.id, b.id));
}

function dueEntries(ctx) {
  const poolIds = new Set(ctx.pool.map(word => word.id));
  const keyOf = entry => identity(entry, ctx.lang);
  const done = new Set();
  for (const plan of ctx.plans.filter(plan => plan.localDate === ctx.localDate)) {
    for (const entry of plan.orderedEntries) if (entry.status === 'completed' && entry.kind !== 'reinforcement') {
      done.add(keyOf(entry));
      if (entry.skillKey === null && !keyOf(entry).startsWith('skill:')) done.add(`legacy:${entry.sourceId}`);
    }
  }
  const candidates = new Map();
  const add = row => { const key = keyOf(row); if (!done.has(key) && !candidates.has(key)) candidates.set(key, row); };
  const previous = ctx.plans.filter(plan => plan.localDate < ctx.localDate && plan.level === ctx.level)
    .sort((a, b) => compare(b.localDate, a.localDate) || b.generatedAt - a.generatedAt);
  const resolved = new Set();
  const resolvedLegacySources = new Set();
  for (const plan of previous) {
    for (const entry of plan.orderedEntries) if (entry.status === 'completed' && entry.kind !== 'reinforcement') {
      resolved.add(keyOf(entry));
      if (entry.skillKey === null && !keyOf(entry).startsWith('skill:')) resolvedLegacySources.add(entry.sourceId);
    }
    for (const entry of plan.orderedEntries) {
      if (!finished(entry) && !resolved.has(keyOf(entry))
        && !(keyOf(entry).startsWith('legacy:') && resolvedLegacySources.has(entry.sourceId))
        && (entry.kind === 'review' || entry.kind === 'new' && entry.introducedAt !== null)
        && (poolIds.has(entry.sourceId) || entry.questionSnapshot !== null)) {
        add({ ...entry, kind: 'review', due: -1, last: -1, carry: true });
      }
    }
  }
  const stateSources = new Set();
  for (const state of Object.values(ctx.itemStates)) {
    stateSources.add(state.sourceId);
    if (poolIds.has(state.sourceId) && state.due <= ctx.now) add({ sourceId: state.sourceId, skillKey: state.skillKey,
      due: state.due, last: state.lastEligibleReviewAt ?? state.legacySummary?.last ?? 0 });
  }
  for (const [sourceId, row] of Object.entries(ctx.progress.items)) {
    if (!stateSources.has(sourceId) && poolIds.has(sourceId) && row.n > 0 && isDue(row, ctx.now)) {
      add({ sourceId, skillKey: null, due: row.due ?? 0, last: row.last ?? 0 });
    }
  }
  return [...candidates.values()].sort((a, b) => a.due - b.due || a.last - b.last || compare(a.sourceId, b.sourceId) || compare(a.skillKey ?? '', b.skillKey ?? ''));
}

function makeEntry(planId, sourceId, kind, skillKey = null) {
  return { entryId: `${planId}:${kind}:${skillKey ?? sourceId}`, sourceId, skillKey, kind, status: 'pending', questionSnapshot: null, reviewId: null, introducedAt: null };
}

function summary(plan, ledger, due) {
  const present = new Set(plan.orderedEntries.filter(entry => !finished(entry)).map(entry => identity(entry, plan.lang)));
  return { dueCount: due.length, remainingDue: due.filter(row => !present.has(identity(row, plan.lang))).length,
    newCount: plan.orderedEntries.filter(entry => entry.kind === 'new' && !finished(entry)).length,
    reviewCount: plan.orderedEntries.filter(entry => entry.kind === 'review' && !finished(entry)).length,
    completedCount: plan.orderedEntries.filter(entry => entry.status === 'completed').length,
    remainingNewQuota: Math.max(0, ledger.newLimit - ledger.startedSourceIds.length), done: plan.status === 'completed' };
}

/**
 * 重開回傳既有固定段；nextSegment 必須明確為 true 且舊段已完成，planId 不能重用。
 * localDate/timeZone 應由 resolveStudyDay 取得；建立清單不 claim、不建立 session。
 */
export function buildDailyPlan(options) {
  const ctx = context(options);
  const due = dueEntries(ctx);
  const current = ctx.plans.filter(plan => plan.localDate === ctx.localDate && plan.level === ctx.level);
  if (current.some(plan => plan.timeZone !== ctx.timeZone)) invalid('已建立計畫的固定時區不可改寫。');
  const active = current.find(plan => plan.status === 'active');
  const selected = active ?? current.find(plan => plan.planId === options.planId) ?? current.slice().sort((a, b) => b.generatedAt - a.generatedAt)[0];
  if (selected && !options.nextSegment) return { plan: clone(selected), ledger: ctx.ledger, summary: summary(selected, ctx.ledger, due) };
  if (active && options.nextSegment) throw new LearningError('ENTRY_CONFLICT', '原段尚未完成，不能建立下一段。');
  const planId = options.planId ?? `${studyPlanKey(ctx.localDate, ctx.lang, ctx.level)}:1`;
  if (ctx.plans.some(plan => plan.planId === planId)) invalid('下一段必須使用新的 planId。');
  const selectedRows = due.length ? due.slice(0, ctx.reviewLimit) : newWords(ctx).slice(0, Math.max(0, ctx.newLimit - ctx.ledger.startedSourceIds.length));
  const orderedEntries = selectedRows.map(row => {
    const entry = makeEntry(planId, row.sourceId ?? row.id, due.length ? 'review' : 'new', row.skillKey ?? null);
    if (row.carry) {
      // 無法判定能力的舊快照保持原題次，避免每天製造新的未知身份；不推測已完成。
      if (identity(row, ctx.lang).startsWith('entry:')) entry.entryId = row.entryId;
      entry.questionSnapshot = clone(row.questionSnapshot);
      entry.introducedAt = row.introducedAt;
    }
    return entry;
  });
  const plan = { planId, sessionId: null, localDate: ctx.localDate, timeZone: ctx.timeZone, lang: ctx.lang, level: ctx.level,
    policyVersion: 1, orderedEntries, quotaSnapshot: { newLimit: ctx.newLimit, reviewLimit: ctx.reviewLimit }, generatedAt: ctx.now,
    status: orderedEntries.length ? 'active' : 'completed' };
  check('dailyPlans', plan);
  return { plan, ledger: ctx.ledger, summary: summary(plan, ctx.ledger, due) };
}

/**
 * 明確設定／意向操作只重選 pending 且未介紹的新字槽位；不新增目標、不碰已開始題面。
 * 有 session 時呼叫端須一併傳入，回傳順序／題面映射供同交易保存。
 */
export function revisePendingNew(options) {
  const { plan, session = null } = options;
  check('dailyPlans', plan);
  assertPlanSession(plan, session);
  const ctx = context({ ...options, ...plan, newLimit: options.newLimit ?? options.ledger.newLimit,
    reviewLimit: plan.quotaSnapshot.reviewLimit, now: options.now,
    existingPlans: { ...options.existingPlans, [plan.planId]: plan } });
  const next = clone(plan);
  const editable = entry => entry.kind === 'new' && entry.status === 'pending' && entry.introducedAt === null;
  const protectedSources = new Set(next.orderedEntries.filter(entry => !editable(entry)).map(entry => entry.sourceId));
  const available = newWords(ctx).filter(word => !protectedSources.has(word.id));
  let slots = Math.max(0, ctx.newLimit - ctx.ledger.startedSourceIds.length);
  let index = 0;
  const oldBySource = new Map(next.orderedEntries.filter(editable).map(entry => [entry.sourceId, entry]));
  next.orderedEntries = next.orderedEntries.flatMap(entry => {
    if (!editable(entry)) return [entry];
    if (slots-- <= 0 || index >= available.length) return [];
    const word = available[index++];
    return [oldBySource.get(word.id) ?? makeEntry(next.planId, word.id, 'new')];
  });
  next.quotaSnapshot.newLimit = ctx.newLimit;
  next.status = next.orderedEntries.every(finished) ? 'completed' : 'active';
  let nextSession = session === null ? null : clone(session);
  if (nextSession) {
    check('sessions', nextSession);
    if (nextSession.sessionId !== next.sessionId || nextSession.planId !== next.planId) invalid('session 與計畫不一致。');
    nextSession.orderedEntryIds = next.orderedEntries.map(entry => entry.entryId);
    nextSession.questionSnapshots = Object.fromEntries(next.orderedEntries.filter(entry => entry.questionSnapshot !== null).map(entry => [entry.entryId, clone(entry.questionSnapshot)]));
    if (!next.orderedEntries.length) { nextSession = null; next.sessionId = null; }
  }
  check('dailyPlans', next);
  return { plan: next, ledger: ctx.ledger, session: nextSession };
}
