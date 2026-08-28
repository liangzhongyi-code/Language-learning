/**
 * 日文單字題庫 · JLPT N5 補收。
 *
 * 來源：tanos.co.uk 系列的 JLPT 單字表，經 open-anki-jlpt-decks（MIT）整理。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 來源把 キロ 拆成「キロ; キログラム」與「キロ; キロメートル」兩列，
 * 匯入時兩列都被當成合併寫法跳過，キロ 本身就整個漏掉了。
 * 同批的 じゃあ 不補：既有的 じゃ 已經是同一個詞。
 */

/**
 * [中文, 日文, 假名讀音, 羅馬拼音, 詞性, 主題分類]
 * romaji 由 openspec/tools/kana-romaji.mjs 產生，不手打
 */
const rows = [
  ['公斤公里', 'キロ', 'キロ', 'kiro', 'noun', 'quantity'],
];

/**
 * 這一批的難度
 */
const LEVEL = 1;

/**
 * 這一批的起始流水號
 */
const START = 5006;

export const words = rows.map(([zh, target, reading, romaji, pos, category], i) => ({
  id: `ja-w-${String(START + i).padStart(3, '0')}`,
  zh,
  target,
  reading,
  romaji,
  pos,
  category,
  level: LEVEL,
}));
