/**
 * 每日學習的交易操作：取得今日清單、準備題次（介紹新字並 claim 額度）、逐題提交、
 * 略過、自評已會與下一段。所有規則在 core 純函式；這裡只負責讀取、組裝 changes，
 * 並透過 learning-store 以 expectedRevision 一次提交，衝突時重讀重算。
 */
import { buildDailyPlan, revisePendingNew } from '../../core/daily-plan.js';
import { prepareEntry, skipEntry, queueReinforcement, resumeStudySession } from '../../core/study-session.js';
import { createReviewEvent } from '../../core/review-events.js';
import { resolveStudyDay, studyPlanKey } from '../../core/study-day.js';
import { normalizeDailyLevel } from '../../core/daily-plan.js';
import { setSelfAssessedKnown } from '../../core/learning-intents.js';
import { LearningError } from '../../core/learning-errors.js';
import { newOperationId } from './learning-store.js';
import { loadReviewContext, reviewChanges } from './review-commit.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const finished = (entry) => entry.status === 'completed' || entry.status === 'skipped';
const DAILY_STORES = ['dailyPlans', 'dailyLedger', 'itemStates', 'intents', 'progress', 'sessions'];

/**
 * 學習日政策沒有獨立集合：固定時區取 meta，latestDay 取已建立計畫的最大日期，
 * 時鐘倒退或改系統時區都不會另發一天額度。
 */
function studyDayOf(meta, plans, now) {
  let latestDay = null;
  for (const plan of Object.values(plans)) if (latestDay === null || plan.localDate > latestDay) latestDay = plan.localDate;
  return resolveStudyDay({ currentZone: meta.timeZone, pendingZone: null, latestDay }, now);
}

function plansOfLang(plans, lang) {
  return Object.fromEntries(Object.entries(plans).filter(([, plan]) => plan.lang === lang));
}

/**
 * words 為該語言完整題庫；level 使用題庫的 1–5（日文 1 = N5）。
 */
export function createDailyService({ store, lang, words, now = () => Date.now(), rng = Math.random }) {
  function planInputs(rows, meta, { level, newLimit, reviewLimit }) {
    const at = now();
    const day = studyDayOf(meta, plansOfLang(rows.dailyPlans, lang), at);
    const ledgerId = `${day.localDate}:${lang}`;
    return {
      words, lang, level, now: at, newLimit, reviewLimit,
      progress: { schemaVersion: 1, items: rows.progress },
      itemStates: rows.itemStates, intents: rows.intents,
      existingPlans: plansOfLang(rows.dailyPlans, lang),
      localDate: day.localDate, timeZone: day.timeZone,
      ledger: rows.dailyLedger[ledgerId] ?? null,
      studyDayState: { currentZone: meta.timeZone, pendingZone: null, latestDay: day.localDate },
    };
  }

  function result(plan, rows, summary) {
    const session = plan.sessionId ? rows.sessions[plan.sessionId] ?? null : null;
    return { plan, session, summary, next: resumeStudySession({ plan }) };
  }

  /**
   * 不寫入的預覽，供語言首頁的「今日」卡片顯示確定的工作量。
   */
  async function preview(settings) {
    const { meta, rows } = await store.read(DAILY_STORES);
    const built = buildDailyPlan(planInputs(rows, meta, settings));
    return { ...result(built.plan, rows, built.summary), saved: Boolean(rows.dailyPlans[built.plan.planId]) };
  }

  /**
   * 取得（必要時建立）今日清單。已存在則原樣回傳；只有每日新字上限改變時才重選未開始的新字槽位。
   */
  async function today(settings) {
    const committed = await store.commit({
      stores: DAILY_STORES, operationId: newOperationId('plan', now()),
      build(rows, meta) {
        const input = planInputs(rows, meta, settings);
        const built = buildDailyPlan(input);
        const exists = rows.dailyPlans[built.plan.planId];
        const ledgerSaved = input.ledger;
        if (exists && ledgerSaved && ledgerSaved.newLimit !== settings.newLimit && built.plan.status === 'active') {
          const session = exists.sessionId ? rows.sessions[exists.sessionId] ?? null : null;
          const revised = revisePendingNew({ ...input, plan: exists, session, ledger: { ...ledgerSaved, newLimit: settings.newLimit } });
          const changes = [
            { store: 'dailyPlans', key: revised.plan.planId, value: revised.plan },
            { store: 'dailyLedger', key: revised.ledger.ledgerId, value: revised.ledger },
          ];
          if (session && revised.session) changes.push({ store: 'sessions', key: revised.session.sessionId, value: revised.session });
          return { changes, value: { plan: revised.plan, session: revised.session } };
        }
        if (exists && ledgerSaved) return { changes: [], value: { plan: exists } };
        return {
          changes: [
            ...(exists ? [] : [{ store: 'dailyPlans', key: built.plan.planId, value: built.plan }]),
            { store: 'dailyLedger', key: built.ledger.ledgerId, value: built.ledger },
          ],
          value: { plan: exists ?? built.plan },
        };
      },
    });
    return preview(settings).then((view) => ({ ...view, revision: committed.revision }));
  }

  /**
   * 下一段：原段完成後，若仍有積欠到期題，以新的 planId 建立下一段（D05／D07）。
   */
  async function nextSegment(settings) {
    return store.commit({
      stores: DAILY_STORES, operationId: newOperationId('segment', now()),
      build(rows, meta) {
        const input = planInputs(rows, meta, settings);
        const level = normalizeDailyLevel(lang, settings.level);
        const base = studyPlanKey(input.localDate, lang, level);
        let n = 1;
        while (rows.dailyPlans[`${base}:${n}`]) n++;
        const built = buildDailyPlan({ ...input, nextSegment: true, planId: `${base}:${n}` });
        if (!built.plan.orderedEntries.length) return { changes: [], value: null };
        return { changes: [
          { store: 'dailyPlans', key: built.plan.planId, value: built.plan },
          { store: 'dailyLedger', key: built.ledger.ledgerId, value: built.ledger },
        ] };
      },
    });
  }

  async function loadPlanRows(repository, planId) {
    const plan = await repository.get('dailyPlans', planId);
    if (!plan) throw new LearningError('STALE_PLAN', '找不到這份清單，請重新整理。');
    const ledger = await repository.get('dailyLedger', `${plan.localDate}:${plan.lang}`);
    const session = plan.sessionId ? await repository.get('sessions', plan.sessionId) : null;
    return { plan, ledger, session };
  }

  /**
   * 準備題次：固定題面、建立 session；新字在這一步 claim 當日額度並記介紹時間。
   */
  async function prepare(planId, entryId) {
    const sessionId = newOperationId('session', now());
    const direction = 'target2zh';
    return store.commit({
      operationId: newOperationId('prepare', now()),
      async load(repository) {
        const base = await loadPlanRows(repository, planId);
        const entry = base.plan.orderedEntries.find((row) => row.entryId === entryId);
        const itemStates = entry?.skillKey ? { [entry.skillKey]: await repository.get('itemStates', entry.skillKey) } : {};
        const plans = await repository.getAllByIndex('dailyPlans', 'lang', lang);
        return { ...base, itemStates, plans };
      },
      build(rows, meta) {
        const entry = rows.plan.orderedEntries.find((row) => row.entryId === entryId);
        if (entry?.status === 'prepared') return { changes: [], value: { plan: rows.plan, session: rows.session } };
        const day = studyDayOf(meta, rows.plans, now());
        const prepared = prepareEntry({ plan: rows.plan, ledger: rows.ledger, session: rows.session, entryId, words,
          now: now(), sessionId, direction, rng, itemStates: rows.itemStates,
          studyDayState: { currentZone: meta.timeZone, pendingZone: null, latestDay: day.localDate } });
        return { changes: [
          { store: 'dailyPlans', key: prepared.plan.planId, value: prepared.plan },
          { store: 'dailyLedger', key: prepared.ledger.ledgerId, value: prepared.ledger },
          { store: 'sessions', key: prepared.session.sessionId, value: prepared.session },
        ], value: { plan: prepared.plan, session: prepared.session } };
      },
    });
  }

  /**
   * 逐題提交：事件、能力排程、逐題摘要、統計、清單、session、補強、意向與日曆同一交易。
   * reviewId 由呼叫端在第一次提交前產生，重試沿用，交易收據保證只入帳一次。
   */
  async function submit({ planId, entryId, answeredIndex, reviewId, hintUsed = false }) {
    const at = now();
    return store.commit({
      operationId: `submit-${reviewId}`,
      async load(repository) {
        const base = await loadPlanRows(repository, planId);
        const entry = base.plan.orderedEntries.find((row) => row.entryId === entryId);
        if (!entry || !base.session) return { ...base, entry };
        const context = await loadReviewContext(repository, { sourceId: entry.sourceId,
          sessionId: base.session.sessionId, statsKey: `${lang}:daily` });
        return { ...base, entry, context };
      },
      build(rows, meta) {
        const { plan, session, entry } = rows;
        if (!entry) throw new LearningError('ENTRY_CONFLICT', '找不到這個題次，請重新整理。');
        if (entry.status === 'completed') {
          if (entry.reviewId === reviewId) return { changes: [], value: { plan, session, replay: true } };
          throw new LearningError('ENTRY_CONFLICT', '這題已在其他分頁提交。');
        }
        if (entry.status !== 'prepared' || !session) throw new LearningError('ENTRY_CONFLICT', '題目尚未準備好，請重新整理。');
        const question = { ...clone(entry.questionSnapshot), answeredIndex };
        const event = createReviewEvent({ sessionId: session.sessionId, entryId, planId, question, lang, source: 'daily',
          answerContext: { submitted: true, hintUsed, reinforcement: entry.kind === 'reinforcement' }, now: at, reviewId });
        const { applied, changes: reviewed, unlocked } = reviewChanges({ event, context: rows.context, timeZone: meta.timeZone, now: at });
        let nextPlan = clone(plan);
        let nextSession = clone(session);
        const target = nextPlan.orderedEntries.find((row) => row.entryId === entryId);
        target.status = 'completed';
        target.reviewId = reviewId;
        target.skillKey = event.skillKey;
        nextSession.submittedReviewIds.push(reviewId);
        if (!applied.event.correct || hintUsed) {
          const queued = queueReinforcement({ plan: nextPlan, session: nextSession, entryId, correct: applied.event.correct, hintUsed });
          nextPlan = queued.plan;
          nextSession = queued.session;
        }
        const statsScope = { ...applied.statsScope };
        const done = nextPlan.orderedEntries.every(finished);
        if (done) {
          nextPlan.status = 'completed';
          if (nextSession.status !== 'completed') {
            nextSession.status = 'completed';
            nextSession.completedAt = Math.max(at, nextSession.createdAt);
            statsScope.sessions += 1;
          }
        }
        /**
         * 同一 reviewId 已提交時前面就以 replay 回傳，這裡一定是首次入帳。
         */
        const changes = [...reviewed,
          { store: 'stats', key: applied.scopeKey, value: statsScope },
          { store: 'dailyPlans', key: nextPlan.planId, value: nextPlan },
          { store: 'sessions', key: nextSession.sessionId, value: nextSession },
        ];
        return { changes, value: { plan: nextPlan, session: nextSession, event: applied.event, unlocked, sessionDone: done } };
      },
    });
  }

  /**
   * 今日略過：只接受未開始的新字，當日排除且補位，不退還已用額度（O03）。
   */
  async function skip(planId, entryId, settings) {
    return store.commit({
      stores: DAILY_STORES, operationId: newOperationId('skip', now()),
      build(rows, meta) {
        const plan = rows.dailyPlans[planId];
        const input = planInputs(rows, meta, settings);
        const session = plan.sessionId ? rows.sessions[plan.sessionId] ?? null : null;
        const ledger = rows.dailyLedger[`${plan.localDate}:${plan.lang}`];
        const next = skipEntry({ ...input, plan, session, ledger, entryId, now: now() });
        const changes = [
          { store: 'dailyPlans', key: next.plan.planId, value: next.plan },
          { store: 'dailyLedger', key: next.ledger.ledgerId, value: next.ledger },
        ];
        if (next.session) changes.push({ store: 'sessions', key: next.session.sessionId, value: next.session });
        return changes;
      },
    });
  }

  /**
   * 自評已會：標為未驗證並從今日未開始的新字移除、補位；不清除既有排程（O02）。
   */
  async function markKnown(planId, sourceId, settings) {
    return store.commit({
      stores: DAILY_STORES, operationId: newOperationId('known', now()),
      build(rows, meta) {
        const marked = setSelfAssessedKnown({ intent: rows.intents[sourceId] ?? null, sourceId, now: now() });
        const intents = { ...rows.intents, [sourceId]: marked.intent };
        const plan = rows.dailyPlans[planId];
        const input = { ...planInputs(rows, meta, settings), intents };
        const session = plan.sessionId ? rows.sessions[plan.sessionId] ?? null : null;
        const ledger = rows.dailyLedger[`${plan.localDate}:${plan.lang}`];
        const revised = revisePendingNew({ ...input, plan, session, ledger });
        const changes = [...marked.changes,
          { store: 'dailyPlans', key: revised.plan.planId, value: revised.plan },
          { store: 'dailyLedger', key: revised.ledger.ledgerId, value: revised.ledger }];
        if (revised.session) changes.push({ store: 'sessions', key: revised.session.sessionId, value: revised.session });
        return changes;
      },
    });
  }

  return { preview, today, nextSegment, prepare, submit, skip, markKnown };
}
