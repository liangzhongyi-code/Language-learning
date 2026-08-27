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
 * 群組核取方塊的三態。
 *
 * 大分類的勾選格子要反映底下小分類的狀態：全勾是打勾、全不勾是空白、
 * 勾一部分是橫槓（HTML 的 indeterminate）。這段邏輯與 DOM 無關，
 * 放在這裡才測得到——三態最容易寫錯的就是「一個都沒有」與
 * 「小分類清單是空的」這兩個邊界。
 *
 * childKeys 為空時回傳 'none'：沒有小分類可勾，就不該顯示成全選。
 */
export function groupState(childKeys, selected) {
  const keys = childKeys || [];
  if (!keys.length) return 'none';
  const on = keys.filter((k) => selected?.has?.(k)).length;
  if (on === 0) return 'none';
  return on === keys.length ? 'all' : 'partial';
}

/**
 * 篩選條件的摘要文字，給收合面板的標題列用。
 * 全選時只寫「全部」——這是預設狀態，列出四十個分類的名字沒有意義。
 * 選得少就直接列出名字，選得多就只報數量。
 */
export function selectionSummary(selectedLabels, totalCount, maxNames = 2) {
  const labels = selectedLabels || [];
  if (!labels.length) return '未選取';
  if (labels.length === totalCount) return '全部';
  if (labels.length <= maxNames) return labels.join('、');
  return `已選 ${labels.length} 項`;
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
 * 把篩選條件正規化成「允許的值集合」，回傳 null 代表這個條件不篩。
 *
 * 三種輸入要分清楚，因為語意完全不同：
 *   'all' / null / undefined → null，不套用這個條件
 *   單一值 'food'            → 只留這一個
 *   陣列 ['food', 'drink']   → 留這幾個
 *   空陣列 []                → 空集合，一筆都不留
 *
 * 最後一條特別重要：多選介面把所有項目都取消勾選時，
 * 使用者期待看到的是「沒有符合的單字」，不是「顯示全部」。
 *
 * 值一律轉成字串再比。等級在題庫裡是數字、從介面回來是字串，
 * 不統一型別會一筆都篩不到。
 */
function allowSet(value) {
  if (value === null || value === undefined || value === 'all' || value === '') return null;
  const list = Array.isArray(value) ? value : [value];
  return new Set(list.map(String));
}

/**
 * 依分類、等級與關鍵字篩選單字。三個條件同時生效（AND）。
 * category 與 level 都接受單一值或陣列，見 allowSet 的說明。
 */
export function filterWords(words, { category = 'all', level = 'all', query = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const cats = allowSet(category);
  const lvls = allowSet(level);

  return (words || []).filter((w) => {
    if (cats && !cats.has(String(w.category))) return false;
    if (lvls && !lvls.has(String(w.level))) return false;
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
