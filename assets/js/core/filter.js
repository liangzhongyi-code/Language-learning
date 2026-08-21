/**
 * 單字與句型的篩選、搜尋。
 * 清單類的推導（有哪些分類、每個句型幾筆）也放在這裡，
 * 讓 UI 層只負責畫，不必自己算。
 */

import { categoryLabel } from '../data/shared/categories.js';

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
 * 依分類與關鍵字篩選單字。兩個條件同時生效。
 * category 為 'all' 或空值時不套用分類條件。
 */
export function filterWords(words, { category = 'all', query = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return (words || []).filter((w) => {
    if (category && category !== 'all' && w.category !== category) return false;
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
