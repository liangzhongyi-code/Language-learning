/**
 * 可攜學習資料的嚴格、無副作用驗證器。完整驗證只用於遷移／匯入，
 * 逐題交易使用 validateLearningRecord，再由 repository 驗證被讀寫紀錄的關聯。
 */
import { LearningError } from './learning-errors.js';
import { isStudyTimeZone } from './study-zone.js';

export const LEARNING_SCHEMA_VERSION = 2;
export const LEARNING_META_VERSION = 2;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const lookup = (value, key) => key !== null && own(value, key) ? value[key] : undefined;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const child = (path, key) => `${path}[${JSON.stringify(key)}]`;
const issue = (errors, path, message, code = 'INVALID_DATA') => {
  if (errors.length < 100) errors.push({ code, path, message });
};
const result = (errors) => ({ ok: errors.length === 0, errors });

/**
 * 不透過 stringify 檢查，避免 getter/toJSON、非有限數值或 undefined 被悄悄轉換。
 * 允許一般與 null-prototype 物件；拒絕循環、稀疏陣列、symbol、隱藏欄位及危險鍵。
 * 深度上限 128，最多回傳 100 個錯誤；共享但非循環的子物件仍可合法序列化。
 */
export function validatePlainJson(value) {
  const errors = [];
  const ancestors = new WeakSet();
  function visit(node, path, depth) {
    if (errors.length >= 100) return;
    if (depth > 128) return issue(errors, path, 'JSON 巢狀深度超過 128。');
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) issue(errors, path, '數值必須有限。');
      return;
    }
    if (typeof node !== 'object') return issue(errors, path, '只能包含 plain JSON 值。');
    if (ancestors.has(node)) return issue(errors, path, 'JSON 不可循環引用。');
    const array = Array.isArray(node);
    const prototype = Object.getPrototypeOf(node);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      return issue(errors, path, '不可使用自訂原型或非 JSON 物件。');
    }
    const descriptors = Object.getOwnPropertyDescriptors(node);
    const keys = Reflect.ownKeys(descriptors);
    if (array && keys.length !== node.length + 1) issue(errors, path, '陣列不可有空洞或額外欄位。');
    ancestors.add(node);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') { issue(errors, path, '不接受 symbol key。'); continue; }
      const at = child(path, key);
      if (forbidden.has(key)) { issue(errors, at, '拒絕原型污染 key。'); continue; }
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length)) {
        issue(errors, at, '陣列只能包含索引欄位。'); continue;
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !own(descriptor, 'value')) {
        issue(errors, at, '拒絕 accessor 或不可列舉欄位。'); continue;
      }
      visit(descriptor.value, at, depth + 1);
    }
    ancestors.delete(node);
  }
  try { visit(value, '$', 0); } catch { issue(errors, '$', '無法安全讀取 JSON 結構。'); }
  return result(errors);
}

const rule = (predicate, message) => (value, path, errors) => {
  if (!predicate(value)) issue(errors, path, message);
};
const count = rule((v) => Number.isSafeInteger(v) && v >= 0, '必須是非負安全整數。');
const timestamp = rule((v) => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000, '必須是有效的非負毫秒時間。');
const bool = rule((v) => typeof v === 'boolean', '必須是布林值。');
const text = (max, min = 0) => rule((v) => typeof v === 'string' && [...v].length >= min && [...v].length <= max, `文字長度必須介於 ${min} 至 ${max}。`);
const id = rule((v) => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v) && !forbidden.has(v), '必須是安全的非空 ID（最多 256 字元）。');
const transactionId = rule((v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(v) && !forbidden.has(v), '交易 ID 必須是 1 至 128 字元的 ASCII 識別字。');
const payloadHash = rule((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), 'payloadHash 必須是 64 碼小寫 SHA-256。');
const choice = (...values) => rule((v) => values.includes(v), `必須是已支援的值：${values.join('、')}。`);
const lang = choice('en', 'ja');
const nullable = (check) => (v, p, e) => { if (v !== null) check(v, p, e); };
const version = (expected) => (v, p, e) => {
  if (v !== expected) issue(e, p, `僅支援版本 ${expected}。`, 'UNSUPPORTED_VERSION');
};
const date = rule((v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [year, month, day] = v.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}, '必須是有效 YYYY-MM-DD 日期。');
const zone = rule(isStudyTimeZone, '必須是受支援的 IANA 時區。');

function shape(required, optional = {}) {
  return (v, p, e) => {
    if (!object(v)) return issue(e, p, '必須是物件。');
    for (const [key, check] of Object.entries(required)) {
      if (!own(v, key)) issue(e, child(p, key), '缺少必要欄位。');
      else check(v[key], child(p, key), e);
    }
    for (const key of Object.keys(v)) {
      if (own(required, key)) continue;
      if (own(optional, key)) optional[key](v[key], child(p, key), e);
      else issue(e, child(p, key), '不接受未知欄位。');
    }
  };
}

function list(check, max = Infinity, uniqueKey = null) {
  return (v, p, e) => {
    if (!Array.isArray(v)) return issue(e, p, '必須是陣列。');
    if (v.length > max) issue(e, p, `項目不可超過 ${max}。`);
    const seen = new Set();
    v.forEach((item, i) => {
      check(item, `${p}[${i}]`, e);
      if (uniqueKey !== null) {
        const key = uniqueKey === '' ? item : item?.[uniqueKey];
        if (seen.has(key)) issue(e, `${p}[${i}]`, 'ID 不可重複。');
        seen.add(key);
      }
    });
  };
}
const ids = list(id, Infinity, '');

function map(check, identity = null, max = Infinity) {
  return (v, p, e) => {
    if (!object(v)) return issue(e, p, '集合必須是 ID-keyed 物件。');
    if (Object.keys(v).length > max) issue(e, p, `集合不可超過 ${max} 筆。`);
    for (const [key, item] of Object.entries(v)) {
      const at = child(p, key);
      id(key, at, e);
      check(item, at, e);
      if (identity && item?.[identity] !== key) issue(e, at, `集合 key 必須等於 ${identity}。`);
    }
  };
}
const withRules = (check, extra) => (v, p, e) => {
  if (e.length >= 100) return;
  const before = e.length;
  check(v, p, e);
  if (e.length === before) extra(v, p, e);
};
const jsonObject = rule(object, '必須是 plain JSON 物件。');
const box = rule((v) => Number.isInteger(v) && v >= 1 && v <= 5, 'Leitner box 必須介於 1 至 5。');
const legacyRecord = withRules(shape({ n: count, w: count }, { box, last: timestamp, due: timestamp }), (v, p, e) => {
  if (v.w > v.n) issue(e, p, '錯誤次數不可大於作答次數。');
});
const statsRecord = withRules(shape({ answered: count, correct: count, sessions: count }), (v, p, e) => {
  if (v.correct > v.answered) issue(e, p, '答對次數不可大於作答次數。');
});
const meta = shape({ schemaVersion: version(LEARNING_META_VERSION), revision: count, dataEpoch: transactionId,
  migrationStatus: choice('pending', 'complete', 'cleared'), historyStartedAt: timestamp,
  schedulerPolicyVersion: version(1), timeZone: zone });
const itemState = withRules(shape({ skillKey: id, sourceId: id,
  ability: choice('recognition', 'production', 'listening-recognition', 'listening-production', 'assembly', 'grammar'),
  direction: id, legacySummary: nullable(legacyRecord), schedulerName: choice('legacy', 'leitner', 'fsrs'),
  schedulerVersion: id, schedulerState: nullable(jsonObject), due: timestamp,
  lastEligibleReviewAt: nullable(timestamp), learningStatus: choice('introduced', 'learning', 'review', 'mastered') }), (v, p, e) => {
  if (v.schedulerName === 'legacy' && (v.legacySummary === null || v.schedulerState !== null)) {
    issue(e, p, 'legacy 排程須保留摘要且尚無新排程狀態。');
  }
  if (v.schedulerName !== 'legacy' && v.schedulerState === null) issue(e, p, '啟用的排程必須有狀態。');
  if (v.schedulerName === 'leitner' && v.schedulerState !== null) shape({ box })(v.schedulerState, child(p, 'schedulerState'), e);
});
const assistance = shape({ hintUsed: bool, retry: bool, replayCount: count }, { kanjiMode: choice('show', 'ruby', 'kana'), context: jsonObject });
const reviewEvent = shape({ reviewId: id, sessionId: id, planId: nullable(id), entryId: id,
  sourceId: id, skillKey: id, answeredAt: timestamp, correct: bool, assistance,
  responseMs: nullable(count), questionMode: id, scheduleEligible: bool, schedulerVersion: id,
  before: nullable(jsonObject), after: nullable(jsonObject) });
const snapshot = withRules(jsonObject, (v, p, e) => id(v.sourceId, child(p, 'sourceId'), e));
const entry = withRules(shape({ entryId: id, sourceId: id, skillKey: nullable(id),
  kind: choice('new', 'review', 'reinforcement'), status: choice('pending', 'prepared', 'completed', 'skipped'),
  questionSnapshot: nullable(snapshot), reviewId: nullable(id), introducedAt: nullable(timestamp) }), (v, p, e) => {
  if ((v.status === 'completed') !== (v.reviewId !== null)) issue(e, p, '已完成項目必須且只能具有 reviewId。');
  if (['prepared', 'completed'].includes(v.status) && v.questionSnapshot === null) issue(e, p, '已開始項目必須有保存的題面。');
  if (v.questionSnapshot && v.questionSnapshot.sourceId !== v.sourceId) issue(e, p, '題面 sourceId 與項目不一致。');
});
const dailyPlan = withRules(shape({ planId: id, sessionId: nullable(id), localDate: date, timeZone: zone, lang,
  level: id, policyVersion: version(1), orderedEntries: list(entry, Infinity, 'entryId'),
  quotaSnapshot: shape({ newLimit: count, reviewLimit: count }), generatedAt: timestamp,
  status: choice('active', 'completed') }), (v, p, e) => {
  if (v.status === 'completed' && v.orderedEntries.some((item) => !['completed', 'skipped'].includes(item.status))) issue(e, p, '完成計畫仍有未完成項目。');
  if (v.sessionId === null && v.orderedEntries.some((item) => ['prepared', 'completed'].includes(item.status))) issue(e, p, '已開始作答的計畫必須具有 session。');
});
const dailyLedger = withRules(shape({ ledgerId: id, localDate: date, timeZone: zone, lang,
  startedSourceIds: ids, excludedSourceIds: ids, newLimit: count, updatedAt: timestamp }), (v, p, e) => {
  if (v.ledgerId !== `${v.localDate}:${v.lang}`) issue(e, p, '日帳本 ID 必須是日期:語言。');
});
const session = withRules(shape({ sessionId: id, lang, source: id, mode: id, planId: nullable(id),
  orderedEntryIds: ids, submittedReviewIds: ids, questionSnapshots: map(snapshot),
  status: choice('active', 'completed'), createdAt: timestamp, completedAt: nullable(timestamp) }), (v, p, e) => {
  if (v.orderedEntryIds.length === 0) issue(e, p, '不可建立零題 session。');
  if ((v.status === 'completed') !== (v.completedAt !== null)) issue(e, p, '完成狀態與時間不一致。');
  if (v.completedAt !== null && v.completedAt < v.createdAt) issue(e, p, '完成時間不可早於建立時間。');
  const entryIds = new Set(v.orderedEntryIds);
  for (const key of Object.keys(v.questionSnapshots)) if (!entryIds.has(key)) issue(e, child(p, 'questionSnapshots'), '題面沒有對應的 entry。');
});
const operation = shape({ operationId: transactionId, epoch: transactionId, payloadHash,
  result: withRules(jsonObject, (v, p, e) => count(v.revision, child(p, 'revision'), e)) });
const book = withRules(shape({ bookId: id, name: text(60, 1), system: bool, wordIds: list(id, 15000, ''),
  revision: count, createdAt: timestamp, updatedAt: timestamp }), (v, p, e) => {
  if (v.system !== (v.bookId === 'favorites')) issue(e, p, 'favorites 是唯一固定系統簿。');
  if (!v.name.trim()) issue(e, p, '單字簿名稱不可全為空白。');
});
const note = shape({ wordId: id, text: text(2000), updatedAt: timestamp, revision: count });
const intent = shape({ sourceId: id, wantToLearn: bool, selfAssessedKnown: bool, updatedAt: timestamp });
const unlock = shape({ achievementId: id, unlockedAt: timestamp, notifiedAt: nullable(timestamp) });
const calendar = withRules(shape({ localDate: date, lang, reviewCount: count, correctCount: count }), (v, p, e) => {
  if (v.correctCount > v.reviewCount) issue(e, p, '答對次數不可大於作答次數。');
});
const reminder = shape({ enabled: bool, localTime: rule((v) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v), '提醒時間須為 HH:mm。'), timeZone: zone, generation: count });

const records = Object.freeze({ meta, itemStates: itemState, reviewEvents: reviewEvent,
  dailyPlans: dailyPlan, dailyLedger, sessions: session, operations: operation,
  books: book, notes: note, intents: intent, achievementUnlocks: unlock, calendar, reminderPreferences: reminder });

function validate(value, check) {
  const plain = validatePlainJson(value);
  if (!plain.ok) return plain;
  const errors = [];
  check(value, '$', errors);
  return result(errors);
}

/**
 * 驗證 v1 統計，保留既有累計，不從歷史重算或修正。
 */
export function validateStats(value) {
  return validate(value, shape({ schemaVersion: version(1), byScope: map(statsRecord) }));
}

/**
 * 驗證 v1 進度；舊資料可缺 box/last/due，缺少的欄位絕不補值。
 */
export function validateProgress(value) {
  return validate(value, shape({ schemaVersion: version(1), items: map(legacyRecord) }));
}

/**
 * 單筆形狀驗證不讀全庫，也不驗跨集合外鍵；交易層須檢查涉及紀錄的關聯。
 */
export function validateLearningRecord(collection, value) {
  if (!own(records, collection)) return { ok: false, errors: [{ code: 'INVALID_DATA', path: '$', message: '未知的學習集合。' }] };
  return validate(value, records[collection]);
}

const learning = shape({ schemaVersion: version(LEARNING_SCHEMA_VERSION), meta,
  itemStates: map(itemState, 'skillKey'), reviewEvents: map(reviewEvent, 'reviewId'),
  dailyPlans: map(dailyPlan, 'planId'), dailyLedger: map(dailyLedger, 'ledgerId'),
  sessions: map(session, 'sessionId'), operations: map(operation, 'operationId'),
  library: shape({ books: map(book, 'bookId', 100), notes: map(note, 'wordId') }),
  intents: map(intent, 'sourceId'),
  achievements: shape({ policyVersion: version(1), unlocked: map(unlock, 'achievementId'), calendar: map(calendar) }),
  reminderPreferences: reminder });

/**
 * 比對已通過 plain JSON 驗證的題面：物件鍵順序無關，陣列題序與每個值必須相同。
 * 不以 stringify 比較，避免等價 JSON 只因欄位順序不同而無法匯入。
 */
function sameSnapshot(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => own(right, key) && sameSnapshot(left[key], right[key]));
}

/**
 * 在形狀已通過後建立暫時索引；完整匯入為 O(紀錄＋entry) 而非逐事件掃描全部 session。
 */
function relationships(value, errors) {
  const { itemStates, reviewEvents, sessions, dailyPlans, dailyLedger, meta: metadata } = value;
  const fail = (path, message) => issue(errors, path, message);
  const plans = new Map();
  const sessionEntries = new Map();
  const sessionReviews = new Map();
  const ledgerSources = new Map(Object.entries(dailyLedger).map(([key, row]) => [key, new Set(row.startedSourceIds)]));
  if (!own(value.library.books, 'favorites')) fail('$.library.books', '缺少固定收藏簿。');
  for (const [key, row] of Object.entries(value.achievements.calendar)) {
    if (key !== `${row.localDate}:${row.lang}`) fail(child('$.achievements.calendar', key), '日曆 key 與日期／語言不一致。');
  }
  for (const [key, row] of Object.entries(sessions)) {
    sessionEntries.set(key, new Set(row.orderedEntryIds));
    sessionReviews.set(key, new Set(row.submittedReviewIds));
  }
  for (const [key, plan] of Object.entries(dailyPlans)) {
    const p = child('$.dailyPlans', key);
    const linked = lookup(sessions, plan.sessionId);
    const entries = new Map(plan.orderedEntries.map((item) => [item.entryId, item]));
    plans.set(key, entries);
    if (plan.sessionId !== null && (!linked || linked.planId !== key || linked.lang !== plan.lang)) fail(p, '計畫與 session 的雙向引用不一致。');
    if (linked && (linked.orderedEntryIds.length !== plan.orderedEntries.length || linked.orderedEntryIds.some((entryId, i) => entryId !== plan.orderedEntries[i]?.entryId))) fail(p, '計畫與 session 的固定題序不一致。');
    const ledgerKey = `${plan.localDate}:${plan.lang}`;
    const ledger = lookup(dailyLedger, ledgerKey);
    if (!ledger || ledger.timeZone !== plan.timeZone) fail(p, '計畫缺少相同日界的語言帳本。');
    for (const item of plan.orderedEntries) {
      const saved = linked && lookup(linked.questionSnapshots, item.entryId);
      if (linked && (['prepared', 'completed'].includes(item.status) || saved !== undefined)
        && !sameSnapshot(saved, item.questionSnapshot)) {
        fail(child(child('$.sessions', plan.sessionId), 'questionSnapshots'), 'session 與計畫的保存題面不一致。');
      }
      if (item.skillKey !== null && (!own(itemStates, item.skillKey) || itemStates[item.skillKey].sourceId !== item.sourceId)) fail(p, '項目引用不存在或不同 sourceId 的能力。');
      if (item.kind === 'new' && item.introducedAt !== null && ledger && !ledgerSources.get(ledgerKey).has(item.sourceId)) fail(p, '已介紹新字尚未列入日配額。');
      if (item.reviewId !== null) {
        const event = lookup(reviewEvents, item.reviewId);
        if (!event || event.planId !== key || event.entryId !== item.entryId || event.sourceId !== item.sourceId || event.skillKey !== item.skillKey) fail(p, '已完成項目的事件引用不一致。');
      }
    }
  }
  const completedEntries = new Set();
  for (const [key, event] of Object.entries(reviewEvents)) {
    const p = child('$.reviewEvents', key);
    const linked = lookup(sessions, event.sessionId);
    const state = lookup(itemStates, event.skillKey);
    if (!state || state.sourceId !== event.sourceId) fail(p, '事件引用不存在或不同 sourceId 的能力。');
    if (!linked || !sessionReviews.get(event.sessionId).has(key) || !sessionEntries.get(event.sessionId).has(event.entryId)) fail(p, '事件不在 session 的已提交題次內。');
    if (linked && linked.planId !== event.planId) fail(p, '事件與 session 的 planId 不一致。');
    if (linked && lookup(linked.questionSnapshots, event.entryId)?.sourceId !== event.sourceId) fail(p, '事件缺少相符的保存題面。');
    if (event.planId !== null) {
      const item = plans.get(event.planId)?.get(event.entryId);
      if (!item || item.reviewId !== key || dailyPlans[event.planId].sessionId !== event.sessionId) fail(p, '事件與計畫項目的雙向引用不一致。');
    }
    const pair = JSON.stringify([event.sessionId, event.entryId]);
    if (completedEntries.has(pair)) fail(p, '同一題次不可提交兩個事件。');
    completedEntries.add(pair);
  }
  for (const [key, row] of Object.entries(sessions)) {
    const p = child('$.sessions', key);
    if (row.planId !== null && lookup(dailyPlans, row.planId)?.sessionId !== key) fail(p, 'session 引用不存在或不相符的計畫。');
    for (const reviewId of row.submittedReviewIds) if (lookup(reviewEvents, reviewId)?.sessionId !== key) fail(p, 'session 引用不存在或他局的事件。');
    if (row.status === 'completed') {
      const planEntries = row.planId === null ? null : plans.get(row.planId);
      for (const entryId of row.orderedEntryIds) {
        if (!completedEntries.has(JSON.stringify([key, entryId])) && planEntries?.get(entryId)?.status !== 'skipped') fail(p, '完成 session 仍有未提交題次。');
      }
    }
  }
  for (const [key, receipt] of Object.entries(value.operations)) {
    if (receipt.epoch !== metadata.dataEpoch || receipt.result.revision > metadata.revision) fail(child('$.operations', key), '收據 epoch/revision 與目前資料不一致。');
  }
}

/**
 * 完整可攜 learning 驗證；不重播事件、不產生排程、不讀寫任何平台儲存。
 */
export function validateLearning(value) {
  const checked = validate(value, learning);
  if (!checked.ok) return checked;
  relationships(value, checked.errors);
  return result(checked.errors);
}

/**
 * 建立獨立空集合。now/timeZone 由呼叫端注入；repository 必須注入新 dataEpoch，
 * 預設 uninitialized 僅供遷移／匯入草稿，不能當作清除後的新世代。
 */
export function emptyLearning(options) {
  const checked = validate(options, shape({ now: timestamp, timeZone: zone }, { dataEpoch: transactionId }));
  if (!checked.ok) throw new LearningError('INVALID_DATA', '無法建立學習資料。', { errors: checked.errors });
  const { now, timeZone, dataEpoch = 'uninitialized' } = options;
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    meta: { schemaVersion: LEARNING_META_VERSION, revision: 0, dataEpoch, migrationStatus: 'pending', historyStartedAt: now, schedulerPolicyVersion: 1, timeZone },
    itemStates: {}, reviewEvents: {}, dailyPlans: {}, dailyLedger: {}, sessions: {}, operations: {},
    library: { books: { favorites: { bookId: 'favorites', name: '收藏', system: true, wordIds: [], revision: 0, createdAt: now, updatedAt: now } }, notes: {} },
    intents: {}, achievements: { policyVersion: 1, unlocked: {}, calendar: {} },
    reminderPreferences: { enabled: false, localTime: '20:00', timeZone, generation: 0 },
  };
}
