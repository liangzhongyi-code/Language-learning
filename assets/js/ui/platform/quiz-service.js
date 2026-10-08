/**
 * 自由測驗的固定題面、逐題提交與續答。所有寫入經共用 learning store；
 * 題面、事件、能力、統計與 session 同交易更新，結果畫面不再整局重算。
 */
import { answer, isAnswered } from '../../core/quiz-engine.js';
import { createReviewEvent } from '../../core/review-events.js';
import { validateLearningRecord } from '../../core/learning-schema.js';
import { LearningError } from '../../core/learning-errors.js';
import { canonicalJson } from '../../core/learning-operations.js';
import { loadReviewContext, reviewChanges } from './review-commit.js';
import { newOperationId } from './learning-store.js';

const SOURCES = ['words', 'sentences', 'mixed', 'cloze', 'scene', 'reading'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message) => { throw new LearningError(code, message); };

export function createQuizService({ store, lang, now = Date.now }) {
  const epochs = new Map();

  function checked(session) {
    if (!session || session.lang !== lang || session.planId !== null || !SOURCES.includes(session.source)
      || !validateLearningRecord('sessions', session).ok) fail('INVALID_DATA', '找不到可續答的自由測驗。');
    const first = session.questionSnapshots[session.orderedEntryIds[0]];
    const settings = first?.quizSettings;
    if (!settings || !['zh2target', 'target2zh', 'mixed'].includes(settings.direction)
      || !['show', 'ruby', 'kana'].includes(settings.kanjiMode)
      || !(settings.level === null || (Number.isInteger(settings.level) && settings.level >= 1 && settings.level <= 5))) {
      fail('UNSUPPORTED', '這一局缺少完整設定，不能安全續答；原紀錄仍保留。');
    }
    const questions = session.orderedEntryIds.map((id) => {
      const q = session.questionSnapshots[id];
      if (!q || !['choice', 'cloze'].includes(q.kind) || !q.sourceId.startsWith(`${lang}-`)
        || !['zh2target', 'target2zh'].includes(q.direction)) fail('UNSUPPORTED', '保存的測驗題面不完整，原紀錄仍保留。');
      if (typeof q.prompt !== 'string' || (q.kind === 'choice'
        ? !Array.isArray(q.options) || q.options.length < 2 || q.options.some((o) => typeof o?.text !== 'string')
          || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length
          || !(q.answeredIndex === null || (Number.isInteger(q.answeredIndex) && q.answeredIndex >= 0 && q.answeredIndex < q.options.length))
        : !Array.isArray(q.bank) || !Array.isArray(q.blanks) || !q.blanks.length || !Array.isArray(q.segments)
          || q.blanks.some((b) => typeof b?.answer !== 'string')
          || (q.submitted === true && (!Array.isArray(q.filled) || q.filled.length !== q.blanks.length)))) {
        fail('UNSUPPORTED', '保存的測驗題面不完整，原紀錄仍保留。');
      }
      const out = clone(q);
      delete out.quizSettings;
      return out;
    });
    const unanswered = questions.findIndex((q) => !isAnswered(q));
    const answeredCount = questions.filter(isAnswered).length;
    if (answeredCount !== session.submittedReviewIds.length || (unanswered !== -1 && answeredCount !== unanswered)
      || (session.status === 'completed') !== (unanswered === -1)) fail('UNSUPPORTED', '保存的題序與作答紀錄不一致，原紀錄仍保留。');
    return { sessionId: session.sessionId, kanjiMode: settings.kanjiMode,
      quiz: { lang, source: session.source, direction: settings.direction, level: settings.level,
        questions, cursor: unanswered === -1 ? questions.length - 1 : unanswered }, done: unanswered === -1 };
  }

  /**
   * 建立前保存全部固定題面。尚未提交的填空輸入不寫入；開一局也不增加完成局數。
   * 新局不依賴舊 sessions，只讀交易 meta；仍經 store 的 revision 重試與 epoch 守衛。
   */
  async function start(quiz, { kanjiMode = 'show' } = {}) {
    if (quiz?.lang !== lang || !SOURCES.includes(quiz?.source) || !quiz.questions?.length
      || quiz.questions.some(isAnswered)) fail('INVALID_DATA', '只能建立尚未作答的測驗。');
    const at = now();
    const sessionId = newOperationId('quiz-session', at);
    const entries = quiz.questions.map((_, i) => `${sessionId}:${i}`);
    const snapshots = Object.fromEntries(entries.map((id, i) => [id, clone(quiz.questions[i])]));
    snapshots[entries[0]].quizSettings = { direction: quiz.direction, level: quiz.level ?? null, kanjiMode };
    const session = { sessionId, lang, source: quiz.source, mode: quiz.direction, planId: null,
      orderedEntryIds: entries, submittedReviewIds: [], questionSnapshots: snapshots,
      status: 'active', createdAt: at, completedAt: null };
    checked(session);
    const meta = await store.ready();
    await store.commit({ stores: [], operationId: newOperationId('quiz-start', at), large: true,
      build(rows, fresh) {
        if (fresh.dataEpoch !== meta.dataEpoch) fail('STALE_EPOCH', '紀錄已清除或還原，請重新開始。');
        return [{ store: 'sessions', key: sessionId, value: session }];
      } });
    epochs.set(sessionId, meta.dataEpoch);
    return checked(session);
  }

  async function resume(sessionId) {
    const { meta, rows } = await store.commit({ operationId: newOperationId('quiz-read', now()),
      load: async (repo, meta) => ({ meta, rows: { session: await repo.get('sessions', sessionId) } }),
      build: (loaded) => ({ changes: [], value: loaded }),
    }).then((result) => result.value);
    const result = checked(rows.session);
    epochs.set(sessionId, meta.dataEpoch);
    return result;
  }

  async function listActive() {
    await store.ready();
    const active = await store.repository.getAllByIndex('sessions', 'status', 'active');
    return Object.values(active).filter((s) => s.lang === lang && s.planId === null && SOURCES.includes(s.source))
      .sort((a, b) => b.createdAt - a.createdAt).map((s) => ({ sessionId: s.sessionId, source: s.source,
        createdAt: s.createdAt, total: s.orderedEntryIds.length, answered: s.submittedReviewIds.length }));
  }

  /**
   * 使用已保存題面判題，不接受外部替換選項。重送核對原題次、答案與漢字模式；
   * 同題另一個 reviewId 拒絕，清除／還原後舊頁不能重新提交。
   */
  async function submit({ sessionId, index, response, reviewId, answeredAt = now() }) {
    const epoch = epochs.get(sessionId);
    if (!epoch) fail('STALE_PLAN', '請先重新開啟這一局。');
    const responseSnapshot = clone(response);
    return store.commit({ operationId: `quiz-review-${reviewId}`, large: true,
      async load(repo) {
        const session = await repo.get('sessions', sessionId);
        if (!session || !Number.isInteger(index) || index < 0 || index >= session.orderedEntryIds.length) return { session };
        const question = session.questionSnapshots[session.orderedEntryIds[index]];
        return { session, context: await loadReviewContext(repo, { sourceId: question.sourceId, sessionId, statsKey: `${lang}:${session.source}` }) };
      },
      build(rows, meta) {
        if (meta.dataEpoch !== epoch) fail('STALE_EPOCH', '紀錄已清除或還原，請重新整理。');
        const round = checked(rows.session);
        if (!Number.isInteger(index) || index < 0 || index >= round.quiz.questions.length) fail('INVALID_DATA', '題號不合法。');
        const session = clone(rows.session);
        const entryId = session.orderedEntryIds[index];
        const q = round.quiz.questions[index];
        const original = clone(q);
        if (q.kind === 'cloze') { q.submitted = false; q.filled = null; }
        else q.answeredIndex = null;
        answer({ questions: [q] }, 0, responseSnapshot);
        const old = rows.context.sessionEvents.find((e) => e.reviewId === reviewId);
        if (old) {
          if (old.entryId !== entryId || old.answeredAt !== answeredAt || canonicalJson(q) !== canonicalJson(original)) fail('OPERATION_MISMATCH', '相同提交編號不能換成另一個答案或時間。');
          return { changes: [], value: { replay: true, done: session.status === 'completed' } };
        }
        if (isAnswered(original) || index !== round.quiz.cursor || session.status !== 'active') fail('ENTRY_CONFLICT', '這題已提交或尚未輪到。');
        const event = createReviewEvent({ sessionId, entryId, planId: null, question: q, lang, source: session.source,
          now: answeredAt, reviewId, answerContext: { submitted: true, kanjiMode: round.kanjiMode } });
        const { applied, changes } = reviewChanges({ event, context: rows.context, timeZone: meta.timeZone, now: answeredAt });
        session.questionSnapshots[entryId] = { ...q, ...(index === 0 ? { quizSettings: rows.session.questionSnapshots[entryId].quizSettings } : {}) };
        session.submittedReviewIds.push(reviewId);
        const done = session.orderedEntryIds.every((id) => isAnswered(session.questionSnapshots[id]));
        const stats = { ...applied.statsScope };
        if (done) { session.status = 'completed'; session.completedAt = Math.max(answeredAt, session.createdAt); stats.sessions += 1; }
        changes.push({ store: 'sessions', key: sessionId, value: session }, { store: 'stats', key: applied.scopeKey, value: stats });
        return { changes, value: { done, correct: applied.event.correct } };
      } });
  }

  return { start, resume, listActive, submit };
}
