/**
 * 日文單字題庫 · JLPT N4 補收。
 *
 * 來源：tanos.co.uk 系列的 JLPT 單字表，經 open-anki-jlpt-decks（MIT）整理。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 三筆稽核才發現的漏字：
 *   ご覧になる、構う 兩筆來源的讀音欄是空的，掃描時被略過；
 *   回す 和 回る 被來源寫成「回る、回す」同一列，只收到 回る。
 */

/**
 * [中文, 日文, 假名讀音, 羅馬拼音, 詞性, 主題分類]
 * romaji 由 openspec/tools/kana-romaji.mjs 產生，不手打
 */
const rows = [
  ['您看', 'ご覧になる', 'ごらんになる', 'goranninaru', 'verb', 'communication'],
  ['在意介意', '構う', 'かまう', 'kamau', 'verb', 'emotion'],
  ['轉動', '回す', 'まわす', 'mawasu', 'verb', 'movement'],
];

/**
 * 這一批的難度
 */
const LEVEL = 2;

/**
 * 這一批的起始流水號
 */
const START = 5007;

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
