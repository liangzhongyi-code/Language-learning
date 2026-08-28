/**
 * 日文單字題庫 · JLPT N2 第 6 批（稽核補收）。
 *
 * 來源：tanos.co.uk 系列的 JLPT 單字表，經 open-anki-jlpt-decks（MIT）整理。
 * 詳細出處與授權見專案根目錄的 CREDITS.md。
 *
 * 這八筆是把 N2 五批全部匯完後，拿來源清單逐字回頭稽核才發現漏掉的：
 * 生意気（第 4 批誤判成 生意気な 的異形一起排除），
 * 其餘七筆在來源排序上落在 若々しい 之後，分批取範圍時被切掉。
 * 測試只驗重複與格式、不驗遺漏，這種漏字只有稽核抓得到。
 *
 * 和服 的中文改成「日式服裝」：既有的 着物 已經佔用「和服」。
 */

/**
 * [中文, 日文, 假名讀音, 羅馬拼音, 詞性, 主題分類]
 * romaji 由 openspec/tools/kana-romaji.mjs 產生，不手打
 */
const rows = [
  ['自以為是', '生意気', 'なまいき', 'namaiki', 'other', 'emotion'],
  ['賠不是', '詫びる', 'わびる', 'wabiru', 'verb', 'communication'],
  ['日式服裝', '和服', 'わふく', 'wafuku', 'noun', 'clothing'],
  ['比想像中還', '割合に', 'わりあいに', 'wariaini', 'adverb', 'quantity'],
  ['除法', '割算', 'わりざん', 'warizan', 'noun', 'quantity'],
  ['意外地', '割と', 'わりと', 'warito', 'adverb', 'quantity'],
  ['折扣', '割引', 'わりびき', 'waribiki', 'noun', 'marketing'],
  ['連身裙', 'ワンピース', 'ワンピース', 'wanpiisu', 'noun', 'clothing'],
];

/**
 * 這一批的難度
 */
const LEVEL = 4;

/**
 * 這一批的起始流水號
 */
const START = 4998;

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
