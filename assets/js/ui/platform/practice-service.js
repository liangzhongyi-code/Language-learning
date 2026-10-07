/**
 * 新題型練習的交易操作：建立一局（固定題序）、逐題判題與入帳、跳過無法播放的聽力題。
 * 判題在 core/practice-engine；無效作答（空白、重複片段）不產生事件，也不消耗題目。
 */
import { eligiblePractice, buildPracticeQuestion, judgePractice } from '../../core/practice-engine.js';
import { createReviewEvent } from '../../core/review-events.js';
import { shuffle } from '../../core/shuffle.js';
import { LearningError } from '../../core/learning-errors.js';
import { newOperationId } from './learning-store.js';
import { loadReviewContext, reviewChanges } from './review-commit.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
export const PRACTICE_ROUND = 10;

export function createPracticeService({ store, lang, items, now = () => Date.now(), rng = Math.random }) {
  /**
   * 資格判斷：同語言、同題型、同級別；指定單字簿時只用簿內的字，不拿全題庫補。
   */
  async function eligibility({ mode, level, bookId = null }) {
    let bookWordIds = null;
    if (bookId) {
      const { rows } = await store.read(['books']);
      const book = rows.books[bookId];
      if (!book) return { ok: false, reason: '找不到這本單字簿，可能已被刪除。', items: [] };
      bookWordIds = book.wordIds;
    }
    return eligiblePractice({ items, lang, mode, level, bookWordIds });
  }

  /**
   * 建立一局：題序與題面在開始時固定，session 先保存；題面在作答時才寫入 session。
   */
  async function start({ mode, level, bookId = null }) {
    const eligible = await eligibility({ mode, level, bookId });
    if (!eligible.ok) throw new LearningError('UNSUPPORTED', eligible.reason);
    const picked = shuffle([...eligible.items], rng).slice(0, PRACTICE_ROUND);
    const questions = picked.map((item) => buildPracticeQuestion(item, rng));
    const sessionId = newOperationId('practice', now());
    const session = { sessionId, lang, source: 'practice', mode, planId: null,
      orderedEntryIds: questions.map((_, i) => `${sessionId}:${i}`), submittedReviewIds: [], questionSnapshots: {},
      status: 'active', createdAt: now(), completedAt: null };
    await store.commit({ stores: ['sessions'], operationId: newOperationId('practice-start', now()),
      build: () => [{ store: 'sessions', key: sessionId, value: session }] });
    return { session, questions };
  }

  /**
   * 一題作答：判題有效才入帳。hintUsed 會讓排程視為 Again，不把有提示的作答當自由產出。
   */
  async function submit({ sessionId, index, question, response, reviewId, hintUsed = false, replayCount = 0 }) {
    const judged = judgePractice(question, response);
    if (!judged.valid) throw new LearningError('INVALID_ANSWER', judged.reason || '這次作答不成立。');
    const at = now();
    const entryId = `${sessionId}:${index}`;
    const committed = await store.commit({
      operationId: `practice-${reviewId}`,
      async load(repository) {
        const session = await repository.get('sessions', sessionId);
        if (!session) return { session: null };
        return { session, context: await loadReviewContext(repository, { sourceId: question.sourceId, sessionId, statsKey: `${lang}:practice` }) };
      },
      build(rows, meta) {
        if (!rows.session) throw new LearningError('STALE_PLAN', '這一局已不存在（可能已清除紀錄），請重新開始。');
        if (rows.session.submittedReviewIds.includes(reviewId)) return { changes: [], value: { replay: true } };
        if (!rows.session.orderedEntryIds.includes(entryId) || rows.session.questionSnapshots[entryId]) {
          throw new LearningError('ENTRY_CONFLICT', '這題已作答或已跳過。');
        }
        const event = createReviewEvent({ sessionId, entryId, planId: null, question, lang, source: 'practice',
          answerContext: { submitted: true, correct: judged.correct, hintUsed, retry: false, replayCount }, now: at, reviewId });
        const { applied, changes, unlocked } = reviewChanges({ event, context: rows.context, timeZone: meta.timeZone, now: at });
        const session = clone(rows.session);
        session.questionSnapshots[entryId] = clone(question);
        session.submittedReviewIds.push(reviewId);
        const statsScope = { ...applied.statsScope };
        const done = session.orderedEntryIds.every((id) => session.questionSnapshots[id]);
        if (done) {
          session.status = 'completed';
          session.completedAt = Math.max(at, session.createdAt);
          statsScope.sessions += 1;
        }
        changes.push({ store: 'stats', key: applied.scopeKey, value: statsScope }, { store: 'sessions', key: sessionId, value: session });
        return { changes, value: { correct: applied.event.correct, unlocked, done } };
      },
    });
    return { ...committed.value, judged };
  }

  /**
   * 聽力題播放失敗或使用者選擇不播放：從這一局移除該題，不計錯、不產生事件。
   */
  async function skip({ sessionId, index }) {
    const entryId = `${sessionId}:${index}`;
    return store.commit({
      stores: ['sessions', 'stats'], operationId: newOperationId('practice-skip', now()),
      build(rows) {
        const session = clone(rows.sessions[sessionId]);
        if (!session || !session.orderedEntryIds.includes(entryId) || session.questionSnapshots[entryId]) return [];
        session.orderedEntryIds = session.orderedEntryIds.filter((id) => id !== entryId);
        const changes = [];
        if (!session.orderedEntryIds.length) return [{ store: 'sessions', key: sessionId, delete: true }];
        if (session.orderedEntryIds.every((id) => session.questionSnapshots[id]) && session.status !== 'completed') {
          session.status = 'completed';
          session.completedAt = Math.max(now(), session.createdAt);
          const key = `${lang}:practice`;
          const prev = rows.stats[key] ?? { answered: 0, correct: 0, sessions: 0 };
          changes.push({ store: 'stats', key, value: { ...prev, sessions: prev.sessions + 1 } });
        }
        changes.push({ store: 'sessions', key: sessionId, value: session });
        return changes;
      },
    });
  }

  return { eligibility, start, submit, skip };
}
