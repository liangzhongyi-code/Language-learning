/**
 * 單字與句型的篩選、搜尋。
 * 清單類的推導（有哪些分類、每個句型幾筆）也放在這裡，
 * 讓 UI 層只負責畫，不必自己算。
 */

import { categoryLabel } from '../data/shared/categories.js';
import { levelsOf } from '../data/shared/levels.js';

/**
 * 從題庫推導出實際存在的分類，帶中文標籤與筆數。
 * 刻意不列出題庫中沒有用到的分類，避免篩選按鈕點下去是空的。
 */
export function listCategories(words) {
  const counts = new Map();
  for (const w of words || []) {
    counts.set(w.category, (counts.get(w.category) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({
    key,
    label: categoryLabel(key),
    count,
  }));
}

/**
 * 從題庫推導出實際存在的等級，帶標籤與筆數，依由易到難排序。
 * 與 listCategories 一樣不列出沒有資料的等級，
 * 避免點下去是空清單——題庫是分批匯入的，中間會有一段時間某些等級還沒有東西。
 */
export function listLevels(words, lang) {
  const counts = new Map();
  for (const w of words || []) {
    counts.set(w.level, (counts.get(w.level) || 0) + 1);
  }
  return levelsOf(lang)
    .filter((l) => counts.has(l.level))
    .map((l) => ({ ...l, count: counts.get(l.level) }));
}

/**
 * 搜尋要比對的欄位。英文的 reading / romaji 是 null，一律跳過。
 */
const SEARCH_FIELDS = ['zh', 'target', 'reading', 'romaji'];

/**
 * 單筆是否符合關鍵字。大小寫不敏感，任一欄位命中即可。
 */
function matchesQuery(word, needle) {
  return SEARCH_FIELDS.some((field) => {
    const v = word[field];
    return typeof v === 'string' && v.toLowerCase().includes(needle);
  });
}

/**
 * 依分類、等級與關鍵字篩選單字。三個條件同時生效（AND）。
 * category 與 level 為 'all' 或空值時該條件不套用。
 *
 * level 從 UI 傳進來時是字串（來自 dataset），題庫裡是數字，
 * 所以一律轉成數字再比，不用 === 直接比對兩種型別。
 */
export function filterWords(words, { category = 'all', level = 'all', query = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const wantLevel = level === 'all' || level === '' || level === null ? null : Number(level);

  return (words || []).filter((w) => {
    if (category && category !== 'all' && w.category !== category) return false;
    if (wantLevel !== null && w.level !== wantLevel) return false;
    if (!needle) return true;
    return matchesQuery(w, needle);
  });
}

/**
 * 從句子題庫推導出有例句的句型，帶名稱與例句數。
 * 例句數為 0 的句型不回傳。
 */
export function listPatterns(sentences, patterns) {
  const counts = new Map();
  for (const s of sentences || []) {
    counts.set(s.patternId, (counts.get(s.patternId) || 0) + 1);
  }
  return (patterns || [])
    .filter((p) => counts.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, desc: p.desc, count: counts.get(p.id) }));
}

/**
 * 依句型篩選句子。'all' 或空值回傳全部。
 */
export function filterSentences(sentences, patternId = 'all') {
  if (!patternId || patternId === 'all') return [...(sentences || [])];
  return (sentences || []).filter((s) => s.patternId === patternId);
}
