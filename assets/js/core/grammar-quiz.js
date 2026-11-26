/**
 * N5 文法點選擇題：一個文法點一筆學習紀錄，每次從它的幾道題裡抽一題。
 *
 * 排程的單位是「文法點」而不是「這一道題」：記住的是 〜たい 的用法，
 * 換一句例句再問一次才知道是真的會，還是背下了那一句。
 * 選項寫在資料裡（每題四個、只有一個說得通），不從別的文法點抽——
 * 文法題的干擾選項要是「初學者真的會填錯的那個」，隨機抽來的幾乎都一眼就能排除。
 */

import { shuffle } from './shuffle.js';

export const GRAMMAR_BLANK = '＿＿';

/**
 * 作答後的解說：文法點名稱、意思、接續，再加這一題為什麼
 */
export function grammarNote(point, quiz) {
  return `${point.title}：${point.meaning}（${point.form}）。${quiz.why}`;
}

/**
 * 產生一題文法選擇題。題目一律是看日文句子選填入的字，方向固定記成 target2zh。
 */
export function buildGrammarQuestion(point, { rng }) {
  const quizzes = point.quiz || [];
  if (!quizzes.length) throw new Error(`文法點 ${point.id} 沒有題目。`);
  const quiz = quizzes[Math.min(quizzes.length - 1, Math.floor(rng() * quizzes.length))];
  const options = shuffle(quiz.options.map((text) => ({ text, isCorrect: text === quiz.answer })), rng);
  return {
    kind: 'choice',
    sourceId: point.id,
    direction: 'target2zh',
    grammarTitle: point.title,
    grammarZh: quiz.zh,
    prompt: `${quiz.before}${GRAMMAR_BLANK}${quiz.after}`,
    promptLang: 'ja',
    optionLang: 'ja',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    speakText: quiz.reading,
    note: grammarNote(point, quiz),
    answeredIndex: null,
  };
}
