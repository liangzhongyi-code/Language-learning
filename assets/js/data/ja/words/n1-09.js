/**
 * 日文單字題庫 · JLPT N1 第 9 批（稽核補收）。
 *
 * 來源：tanos.co.uk 系列的 JLPT 單字表，經 open-anki-jlpt-decks（MIT）整理。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 這十二筆在來源清單上落在 非難 之後，分批取範圍時被切掉，
 * 是把 N1 八批全部匯完後拿來源逐字回頭稽核才發現的。
 * 測試只驗重複與格式、不驗遺漏，這種漏字只有稽核抓得到；
 * N2、N5、N4 也各有一批同樣成因的補收。
 */

/**
 * [中文, 日文, 假名讀音, 羅馬拼音, 詞性, 主題分類]
 * romaji 由 openspec/tools/kana-romaji.mjs 產生，不手打
 */
const rows = [
  ['日之丸國旗', '日の丸', 'ひのまる', 'hinomaru', 'noun', 'society'],
  ['火花', '火花', 'ひばな', 'hibana', 'noun', 'nature'],
  ['慘叫', '悲鳴', 'ひめい', 'himei', 'noun', 'communication'],
  ['揶揄調侃', '冷やかす', 'ひやかす', 'hiyakasu', 'verb', 'communication'],
  ['曬黑', '日焼け', 'ひやけ', 'hiyake', 'noun', 'health'],
  ['標語', '標語', 'ひょうご', 'hyougo', 'noun', 'media'],
  ['描寫', '描写', 'びょうしゃ', 'byousha', 'noun', 'media'],
  ['冷不防或許', 'ひょっと', 'ひょっと', 'hyotto', 'adverb', 'abstract'],
  ['傳單', 'びら', 'びら', 'bira', 'noun', 'marketing'],
  ['扁平的', '平たい', 'ひらたい', 'hiratai', 'adjective', 'quality'],
  ['最後一名', 'びり', 'びり', 'biri', 'noun', 'quantity'],
  ['所占比率', '比率', 'ひりつ', 'hiritsu', 'noun', 'quantity'],
];

/**
 * 這一批的難度
 */
const LEVEL = 5;

/**
 * 這一批的起始流水號
 */
const START = 7597;

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
