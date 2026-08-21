/**
 * 小型的 UI 偏好設定（連接線開關、假名顯示模式…）。
 *
 * 與學習統計分開存，因為性質不同：統計是學習紀錄，
 * 這裡只是「上次把開關撥到哪」，壞掉重置也毫無損失。
 * 一樣要能承受 localStorage 被停用的情況。
 */

const PREFS_KEY = 'lang-learn.prefs.v1';

const DEFAULTS = {
  /* 文法頁的兩排連接線 */
  grammarLines: true,
  /* 假名表顯示模式：hiragana / katakana / both */
  kanaMode: 'both',
};

/**
 * 讀取全部偏好。任何異常一律回到預設值。
 */
export function loadPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * 更新其中一項偏好，回傳更新後的完整偏好
 */
export function setPref(key, value) {
  const next = { ...loadPrefs(), [key]: value };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* 無痕模式或容量已滿：這次的偏好不保存，但畫面照常運作 */
  }
  return next;
}
