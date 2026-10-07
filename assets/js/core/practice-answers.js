/**
 * 輸入題（看中文打外文、看漢字打假名、聽寫）的純判題工具。
 * 只做「不改變答案意義」的正規化，比對對象一律是人工核對的白名單；
 * 不做模糊比對、不算編輯距離，拼錯一個字母或少一個促音就是錯。
 */
import { LearningError } from './learning-errors.js';

const invalid = (message) => { throw new LearningError('INVALID_DATA', message); };

/**
 * 彎撇號（手機智慧標點會自動換成這些）統一成 ASCII 撇號。
 * 只換字形、不刪除，所以 don't 與 dont 依舊不同。
 */
const APOSTROPHES = /[‘’ʼ]/g;

/**
 * 英文正規化：NFKC、去頭尾空白、連續空白折成一個；caseSensitive 為 false 才轉小寫。
 * 重音、標點與縮寫撇號都保留，café 不等於 cafe。
 */
export function normalizeEnglish(text, { caseSensitive = false } = {}) {
  if (typeof text !== 'string') invalid('英文輸入必須是字串。');
  const folded = text.normalize('NFKC').replace(APOSTROPHES, "'").trim().replace(/\s+/g, ' ');
  return caseSensitive ? folded : folded.toLowerCase();
}

/**
 * 假名正規化：NFKC（半形片假名轉全形）、去頭尾空白、片假名轉平假名。
 * 只平移 ァ（U+30A1）到 ヶ（U+30F6），長音「ー」不在範圍內所以原樣保留；
 * 促音、拗音小字、濁音／半濁音、じ／ぢ、ず／づ 都是不同碼位，不會被合併。
 */
export function normalizeKana(text) {
  if (typeof text !== 'string') invalid('日文輸入必須是字串。');
  return text.normalize('NFKC').trim()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/**
 * 依白名單判斷輸入題。英文用 normalizeEnglish，日文用 normalizeKana；
 * 日文白名單中的漢字寫法經同一套正規化（等同 NFKC 後原樣比對），因此漢字與假名都能接受。
 * policy 目前只有 'exact'，預留給日後的判題政策，未知值直接拒絕而不是默默放寬。
 */
export function judgeTyping({ input, accepted, lang, caseSensitive = false, policy = 'exact' }) {
  if (policy !== 'exact') throw new LearningError('UNSUPPORTED', '不支援的判題政策。');
  if (!['en', 'ja'].includes(lang)) invalid('不支援的作答語言。');
  if (typeof input !== 'string') invalid('作答內容必須是字串。');
  if (!Array.isArray(accepted) || accepted.length === 0
    || accepted.some((answer) => typeof answer !== 'string' || answer.trim().length === 0)) invalid('可接受答案必須是非空白名單。');
  const normalize = lang === 'en' ? (text) => normalizeEnglish(text, { caseSensitive }) : normalizeKana;
  const normalized = normalize(input);
  if (normalized.length === 0) return { correct: false, empty: true, normalized, matched: null };
  const matched = accepted.find((answer) => normalize(answer) === normalized) ?? null;
  return { correct: matched !== null, empty: false, normalized, matched };
}

/**
 * 鍵盤事件是否應該送出答案。IME 組字中（isComposing 或 keyCode 229）按 Enter
 * 只是確定候選字，不能當成送出；其他按鍵一律不送出。
 */
export function shouldSubmitOnEnter(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.isComposing === true || event.keyCode === 229) return false;
  return event.key === 'Enter';
}
