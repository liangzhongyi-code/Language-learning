/**
 * 難度分級。
 *
 * 兩種語言的分級刻度完全不同——英文是多益分數帶，日文是 JLPT 級別——
 * 但兩邊都剛好是五級，所以資料裡統一用 1–5 的整數，
 * 顯示成什麼字則由這張表決定。level 數字一律「1 最簡單、5 最難」。
 *
 * 英文的分數帶是依單字頻率排名推的估計值，不是官方對照表：
 * ETS 從未公布過任何官方單字表，也沒有「幾分該會哪些字」的對照。
 * 日文的級別直接來自來源資料，不是估計。
 */

/**
 * 各語言的分級定義，順序即由易到難
 */
export const LEVELS_BY_LANG = {
  en: [
    { level: 1, label: '≤400', desc: '最高頻的核心字，多益 400 分以下的基本盤' },
    { level: 2, label: '400–600', desc: '通用高頻字的第二段' },
    { level: 3, label: '600–800', desc: '通用高頻字的第三段' },
    { level: 4, label: '800–990', desc: '通用高頻字的尾段，開始出現低頻抽象詞' },
    { level: 5, label: '多益專屬', desc: '多益語料庫特有的商務與職場字，一般英語課本少見' },
  ],
  ja: [
    { level: 1, label: 'N5', desc: '日檢 N5，最基礎' },
    { level: 2, label: 'N4', desc: '日檢 N4' },
    { level: 3, label: 'N3', desc: '日檢 N3' },
    { level: 4, label: 'N2', desc: '日檢 N2' },
    { level: 5, label: 'N1', desc: '日檢 N1，最高級' },
  ],
};

/**
 * 允許的等級數值，供資料驗證用
 */
export const LEVELS = [1, 2, 3, 4, 5];

/**
 * 分級刻度的名稱，UI 標題用
 */
export const SCALE_NAME = { en: '多益分數帶', ja: 'JLPT 級別' };

/**
 * 分數帶是推估而非官方對照，UI 必須把這件事講清楚，
 * 不能讓人以為「背完 level 3 就有 800 分」。
 */
export const SCALE_NOTE = {
  en: '多益官方從未公布單字表，這裡的分數帶是依單字出現頻率推估的參考值。',
  ja: 'JLPT 官方自 2010 年改制後停止公布單字表，級別來自社群依舊版出題基準與教材整理的清單。',
};

/**
 * 取某語言某等級的短標籤。查不到就退回 Lv{n}，避免 UI 出現 undefined。
 */
export function levelLabel(lang, level) {
  const found = (LEVELS_BY_LANG[lang] || []).find((l) => l.level === level);
  return found ? found.label : `Lv${level}`;
}

/**
 * 取某語言的完整分級清單，未定義的語言回傳空陣列
 */
export function levelsOf(lang) {
  return LEVELS_BY_LANG[lang] || [];
}
