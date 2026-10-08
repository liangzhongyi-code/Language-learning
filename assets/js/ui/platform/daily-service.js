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
import { validateStats } from '../../core/learning-schema.js';
import { buildDailyPracticeQuestion } from '../../core/daily-practice.js';
import { judgePractice } from '../../core/practice-engine.js';
import { newOperationId } from './learning-store.js';
import { loadReviewContext, reviewChanges } from './review-commit.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const finished = (entry) => entry.status === 'completed' || entry.status === 'skipped';
const dailyQuery = lang => ({
  dailyPlans: { index: 'lang', key: lang }, dailyLedger: { index: 'lang', key: lang },
  itemStates: { prefix: `${lang}-` }, intents: { prefix: `${lang}-` }, progress: { prefix: `${lang}-` },
  sessions: { planRefs: 'dailyPlans' },
});
const dailyWriteQuery = lang => ({ ...dailyQuery(lang), stats: { key: `${lang}:daily` } });

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
 * words 至少包含所選級別的完整同語言題庫；level 使用題庫的 1–5（日文 1 = N5）。
 */
export function createDailyService({ store, lang, words, practiceProvider = async () => [], now = () => Date.now(), rng = Math.random }) {
  let observedEpoch;

  /**
   * UI 將顯示題面時的 epoch 帶回，不能採用提交當下的新世代。
   * 未傳參數的服務呼叫沿用最後一次預覽；尚未讀取過的服務才以 ready 初始化。
   */
  async function mutationEpoch(expectedEpoch) {
    return expectedEpoch ?? observedEpoch ?? (await store.ready()).dataEpoch;
  }

  function assertEpoch(meta, expectedEpoch) {
    if (expectedEpoch !== undefined && meta.dataEpoch !== expectedEpoch) {
      throw new LearningError('STALE_EPOCH', '紀錄已清除或還原，請重新取得今日清單。');
    }
  }

  /**
   * 調整未開始槽位也可能完成一局；清單、session 與完成局數須同交易保存。
   * 以 session.status 去重，衝突重讀後不再重加局數；不重算已提交題數。
   */
  function revisedChanges(revised, rows, at) {
    const { plan, ledger } = revised;
    let session = revised.session;
    const changes = [
      { store: 'dailyPlans', key: plan.planId, value: plan },
      { store: 'dailyLedger', key: ledger.ledgerId, value: ledger },
    ];
    if (session && plan.status === 'completed' && session.status !== 'completed') {
      const key = `${lang}:daily`;
      const previous = rows.stats[key] ?? { answered: 0, correct: 0, sessions: 0 };
      const stats = { ...previous, sessions: previous.sessions + (session.submittedReviewIds.length ? 1 : 0) };
      if (!validateStats({ schemaVersion: 1, byScope: { [key]: stats } }).ok) {
        throw new LearningError('INVALID_DATA', '學習統計不合法或已超過安全數值範圍。');
      }
      session = { ...session, status: 'completed', completedAt: Math.max(at, session.createdAt) };
      changes.push({ store: 'stats', key, value: stats });
    }
    if (session) changes.push({ store: 'sessions', key: session.sessionId, value: session });
    return { changes, value: { plan, session } };
  }

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
    const { meta, rows } = await store.querySnapshot(dailyQuery(lang));
    const built = buildDailyPlan(planInputs(rows, meta, settings));
    observedEpoch = meta.dataEpoch;
    return { ...result(built.plan, rows, built.summary), dataEpoch: meta.dataEpoch,
      saved: Boolean(rows.dailyPlans[built.plan.planId]) };
  }

  /**
   * 取得（必要時建立）今日清單；不帶 expectedEpoch 代表明確重新載入目前世代。
   * 重開時依最新想學意向與額度重選未開始槽位；已準備題面不動。
   * 跨日複本已由另一清單完成時只略過搬移題次，不虛增作答／完成局數。
   */
  async function today(settings, { expectedEpoch } = {}) {
    const committed = await store.commit({
      query: dailyWriteQuery(lang), operationId: newOperationId('plan', now()),
      build(rows, meta) {
        assertEpoch(meta, expectedEpoch);
        const input = planInputs(rows, meta, settings);
        const built = buildDailyPlan(input);
        const exists = rows.dailyPlans[built.plan.planId];
        const ledgerSaved = input.ledger;
        if (exists && ledgerSaved && built.plan.status === 'active') {
          const session = exists.sessionId ? rows.sessions[exists.sessionId] ?? null : null;
          const plan = clone(exists);
          const completedElsewhere = new Set(Object.values(rows.dailyPlans).filter(other => other.planId !== plan.planId)
            .flatMap(other => other.orderedEntries.filter(entry => entry.status === 'completed').map(entry => entry.entryId)));
          for (const entry of plan.orderedEntries) {
            if (entry.kind === 'review' && !finished(entry) && completedElsewhere.has(entry.entryId)) entry.status = 'skipped';
          }
          const revised = revisePendingNew({ ...input, plan, session, ledger: { ...ledgerSaved, newLimit: settings.newLimit } });
          if (JSON.stringify(revised.plan) === JSON.stringify(exists) && ledgerSaved.newLimit === settings.newLimit) {
            return { changes: [], value: { plan: exists } };
          }
          return revisedChanges(revised, rows, input.now);
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
  async function nextSegment(settings, { expectedEpoch } = {}) {
    const epoch = await mutationEpoch(expectedEpoch);
    return store.commit({
      query: dailyQuery(lang), operationId: newOperationId('segment', now()),
      build(rows, meta) {
        assertEpoch(meta, epoch);
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
   * 只有缺少快照的非辨認能力才讀人工題庫；載入或配對失敗不寫入任何半成品。
   */
  async function prepare(planId, entryId, { expectedEpoch } = {}) {
    const epoch = await mutationEpoch(expectedEpoch);
    const sessionId = newOperationId('session', now());
    const direction = 'target2zh';
    let practiceItems;
    return store.commit({
      operationId: newOperationId('prepare', now()),
      async load(repository, meta) {
        assertEpoch(meta, epoch);
        const base = await loadPlanRows(repository, planId);
        const entry = base.plan.orderedEntries.find((row) => row.entryId === entryId);
        const itemStates = entry?.skillKey ? { [entry.skillKey]: await repository.get('itemStates', entry.skillKey) } : {};
        const state = entry?.skillKey ? itemStates[entry.skillKey] : null;
        let items;
        if (entry && !finished(entry) && entry.questionSnapshot === null && state && state.ability !== 'recognition') {
          try {
            practiceItems = practiceItems ?? Promise.resolve().then(() => practiceProvider());
            items = await practiceItems;
            if (!Array.isArray(items)) throw new Error('Invalid practice items');
          } catch {
            throw new LearningError('PRACTICE_LOAD_FAILED', '題庫載入失敗，請重試；排程仍保留未完成。');
          }
        }
        const plans = await repository.getAllByIndex('dailyPlans', 'lang', lang);
        return { ...base, itemStates, plans, items };
      },
      build(rows, meta) {
        assertEpoch(meta, epoch);
        const entry = rows.plan.orderedEntries.find((row) => row.entryId === entryId);
        let questionSnapshot;
        if (rows.items !== undefined) {
          try {
            questionSnapshot = buildDailyPracticeQuestion({ items: rows.items, entry, state: rows.itemStates[entry.skillKey],
              lang: rows.plan.lang, level: rows.plan.level, rng });
          } catch (error) {
            if (error?.code === 'UNSUPPORTED') throw new LearningError('DAILY_PRACTICE_UNAVAILABLE', '尚無同級對應題型，排程保留未完成。');
            throw error;
          }
        }
        const day = studyDayOf(meta, rows.plans, now());
        const prepared = prepareEntry({ plan: rows.plan, ledger: rows.ledger, session: rows.session, entryId, words,
          now: now(), sessionId, direction, rng, itemStates: rows.itemStates, questionSnapshot,
          studyDayState: { currentZone: meta.timeZone, pendingZone: null, latestDay: day.localDate } });
        if (entry?.status === 'prepared') return { changes: [], value: { plan: prepared.plan, session: prepared.session } };
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
   * reviewId 與 expectedEpoch 由題面所屬頁面保留；重試沿用，失效世代不能重新入帳。
   */
  async function submit({ planId, entryId, answeredIndex, response, reviewId, hintUsed = false, replayCount = 0, expectedEpoch }) {
    const at = now();
    const epoch = await mutationEpoch(expectedEpoch);
    return store.commit({
      operationId: `submit-${reviewId}`,
      async load(repository, meta) {
        assertEpoch(meta, epoch);
        const base = await loadPlanRows(repository, planId);
        const entry = base.plan.orderedEntries.find((row) => row.entryId === entryId);
        if (!entry || !base.session) return { ...base, entry };
        const context = await loadReviewContext(repository, { sourceId: entry.sourceId,
          sessionId: base.session.sessionId, statsKey: `${lang}:daily` });
        // entryId 跨日搬移不變；以 sourceId 索引找首次完成，並由全域 revision 保護判斷與寫入。
        const sourceEvents = await repository.getAllByIndex('reviewEvents', 'sourceId', entry.sourceId);
        return { ...base, entry, context, sourceEvents };
      },
      build(rows, meta) {
        assertEpoch(meta, epoch);
        const { plan, session, entry } = rows;
        if (!entry) throw new LearningError('ENTRY_CONFLICT', '找不到這個題次，請重新整理。');
        if (entry.status === 'completed') {
          if (entry.reviewId === reviewId) return { changes: [], value: { plan, session, replay: true,
            event: rows.context.sessionEvents.find(event => event.reviewId === reviewId) } };
          throw new LearningError('ENTRY_CONFLICT', '這題已在其他分頁提交。');
        }
        if (entry.status !== 'prepared' || !session) throw new LearningError('ENTRY_CONFLICT', '題目尚未準備好，請重新整理。');
        if (Object.values(rows.sourceEvents).some(event => event.assistance.context.source === 'daily' && event.entryId === entryId)) {
          throw new LearningError('ENTRY_CONFLICT', '這個題次已在另一份每日清單提交，請重新取得清單。');
        }
        const question = clone(entry.questionSnapshot);
        const answerContext = { submitted: true, hintUsed, replayCount, reinforcement: entry.kind === 'reinforcement' };
        if (question.practiceMode) {
          const judged = judgePractice(question, response);
          if (!judged.valid) throw new LearningError('INVALID_ANSWER', '這次作答不完整，沒有保存。');
          answerContext.correct = judged.correct;
        } else question.answeredIndex = answeredIndex;
        const event = createReviewEvent({ sessionId: session.sessionId, entryId, planId, question, lang, source: 'daily',
          answerContext, now: at, reviewId });
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
  async function skip(planId, entryId, settings, { expectedEpoch } = {}) {
    const epoch = await mutationEpoch(expectedEpoch);
    return store.commit({
      query: dailyWriteQuery(lang), operationId: newOperationId('skip', now()),
      build(rows, meta) {
        assertEpoch(meta, epoch);
        const plan = rows.dailyPlans[planId];
        const input = planInputs(rows, meta, settings);
        const session = plan.sessionId ? rows.sessions[plan.sessionId] ?? null : null;
        const ledger = rows.dailyLedger[`${plan.localDate}:${plan.lang}`];
        const next = skipEntry({ ...input, plan, session, ledger, entryId, now: now() });
        return revisedChanges(next, rows, input.now);
      },
    });
  }

  /**
   * 自評已會：標為未驗證並從今日未開始的新字移除、補位；不清除既有排程（O02）。
   */
  async function markKnown(planId, sourceId, settings, { expectedEpoch } = {}) {
    const epoch = await mutationEpoch(expectedEpoch);
    return store.commit({
      query: dailyWriteQuery(lang), operationId: newOperationId('known', now()),
      build(rows, meta) {
        assertEpoch(meta, epoch);
        const marked = setSelfAssessedKnown({ intent: rows.intents[sourceId] ?? null, sourceId, now: now() });
        const intents = { ...rows.intents, [sourceId]: marked.intent };
        const plan = rows.dailyPlans[planId];
        const input = { ...planInputs(rows, meta, settings), intents };
        const session = plan.sessionId ? rows.sessions[plan.sessionId] ?? null : null;
        const ledger = rows.dailyLedger[`${plan.localDate}:${plan.lang}`];
        const revised = revisePendingNew({ ...input, plan, session, ledger });
        const update = revisedChanges(revised, rows, input.now);
        return { ...update, changes: [...marked.changes, ...update.changes] };
      },
    });
  }

  return { preview, today, nextSegment, prepare, submit, skip, markKnown };
}
