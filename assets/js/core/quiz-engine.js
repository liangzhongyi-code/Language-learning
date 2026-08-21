/**
 * 測驗引擎：抽題、產生干擾選項、判定作答。
 *
 * 這裡是整個網站正確性最容易出事的地方——題目重複、選項只有三個、
 * 干擾選項剛好與正解同義——所以全部寫成無 DOM 的純函式，讓測試能完整覆蓋。
 * 亂數一律由參數注入，測試可用固定序列重現同一局。
 */

import { shuffle, sample } from './shuffle.js';
import { speakTextOf } from './speech-text.js';

/**
 * 一題需要一個正解加三個干擾選項
 */
const OPTIONS_PER_QUESTION = 4;
const DISTRACTORS_PER_QUESTION = OPTIONS_PER_QUESTION - 1;

/**
 * 出題方向對應的題面與選項欄位
 */
const DIRECTION_FIELDS = {
  zh2target: { prompt: 'zh', option: 'target' },
  target2zh: { prompt: 'target', option: 'zh' },
};

/**
 * 挑三個干擾選項。
 * 依「同 category → 同 level → 全域」三段遞補，讓干擾選項盡量與正解同一個
 * 語意範疇，題目才有鑑別度；但無論如何都要湊滿三個，湊不滿就是題庫太小，
 * 寧可拋錯也不回傳選項不足的瑕疵題。
 *
 * 顯示文字與正解相同的項目一律排除，否則會出現兩個都對的選項。
 */
export function pickDistractors(pool, correct, optionField, rng = Math.random) {
  const candidates = (pool || []).filter(
    (item) => item.id !== correct.id && item[optionField] !== correct[optionField]
  );

  if (candidates.length < DISTRACTORS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：可用的干擾選項只有 ${candidates.length} 筆，` +
        `每題需要 ${DISTRACTORS_PER_QUESTION} 個。請至少準備 ${OPTIONS_PER_QUESTION} 筆不重複的題目。`
    );
  }

  const tiers = [
    candidates.filter((c) => c.category === correct.category),
    candidates.filter((c) => c.category !== correct.category && c.level === correct.level),
    candidates,
  ];

  const picked = [];
  const takenIds = new Set();
  const takenTexts = new Set();

  for (const tier of tiers) {
    if (picked.length >= DISTRACTORS_PER_QUESTION) break;
    const fresh = tier.filter((c) => !takenIds.has(c.id) && !takenTexts.has(c[optionField]));
    for (const item of shuffle(fresh, rng)) {
      if (picked.length >= DISTRACTORS_PER_QUESTION) break;
      if (takenTexts.has(item[optionField])) continue;
      picked.push(item);
      takenIds.add(item.id);
      takenTexts.add(item[optionField]);
    }
  }

  if (picked.length < DISTRACTORS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：湊不出 ${DISTRACTORS_PER_QUESTION} 個文字相異的干擾選項（正解：${correct.id}）。`
    );
  }

  return picked;
}

/**
 * 依題源取出題庫。mixed 把單字與句子併在一起抽。
 * 設定畫面要顯示各題源的筆數，所以一併匯出——
 * 讓 UI 直接用這裡的定義，而不是自己再寫一份分支。
 */
export function poolOf(source, words, sentences) {
  if (source === 'words') return [...(words || [])];
  if (source === 'sentences') return [...(sentences || [])];
  return [...(words || []), ...(sentences || [])];
}

/**
 * 一局的作答進度百分比，0-100 的整數。
 * 已作答的當前題目算完成，這樣進度條在按下選項時就會前進。
 */
export function progressPercent(session) {
  const questions = session?.questions || [];
  if (!questions.length) return 0;
  const done = questions.filter((q) => q.answeredIndex !== null && q.answeredIndex !== undefined).length;
  return Math.round((done / questions.length) * 100);
}

/**
 * 產生一題
 */
function buildQuestion(item, pool, { lang, direction, rng }) {
  const fields = DIRECTION_FIELDS[direction];
  const distractors = pickDistractors(pool, item, fields.option, rng);

  const options = shuffle(
    [
      { text: item[fields.option], isCorrect: true },
      ...distractors.map((d) => ({ text: d[fields.option], isCorrect: false })),
    ],
    rng
  );

  return {
    sourceId: item.id,
    direction,
    prompt: item[fields.prompt],
    promptLang: direction === 'zh2target' ? 'zh' : lang,
    optionLang: direction === 'zh2target' ? lang : 'zh',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    /* 題面或正解要朗讀時用的目標語言文字 */
    speakText: speakTextOf(item, lang),
    /* 句子題才有語序說明，錯題檢討會顯示 */
    note: item.note ?? null,
    answeredIndex: null,
  };
}

/**
 * 組出一局測驗。
 * 題數超過題庫時取全部；題庫少於四筆時拋錯。
 */
export function buildSession({
  lang,
  words,
  sentences,
  source = 'words',
  direction = 'zh2target',
  count = 10,
  rng = Math.random,
}) {
  const pool = poolOf(source, words, sentences);

  if (pool.length < OPTIONS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：題源 ${source} 只有 ${pool.length} 筆，至少需要 ${OPTIONS_PER_QUESTION} 筆才能出題。`
    );
  }

  const picked = sample(pool, count, rng);
  const questions = picked.map((item) => {
    const dir = direction === 'mixed' ? (rng() < 0.5 ? 'zh2target' : 'target2zh') : direction;
    return buildQuestion(item, pool, { lang, direction: dir, rng });
  });

  return { lang, source, direction, questions, cursor: 0 };
}

/**
 * 提交一題的答案。
 * 已作答的題目不再變更，避免重複作答刷分。
 */
export function answer(session, questionIndex, optionIndex) {
  const q = session?.questions?.[questionIndex];
  if (!q) throw new Error(`題目索引超出範圍：${questionIndex}`);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) {
    throw new Error(`選項索引不合法：${optionIndex}`);
  }

  const alreadyAnswered = q.answeredIndex !== null;
  if (!alreadyAnswered) q.answeredIndex = optionIndex;

  return {
    correct: q.answeredIndex === q.correctIndex,
    correctIndex: q.correctIndex,
    correctText: q.options[q.correctIndex].text,
    chosenIndex: q.answeredIndex,
    alreadyAnswered,
  };
}
