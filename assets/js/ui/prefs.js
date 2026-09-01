/**
 * 小型的 UI 偏好設定（連接線開關、假名顯示模式…）。
 *
 * 與學習統計分開存，因為性質不同：統計是學習紀錄，
 * 這裡只是「上次把開關撥到哪」，壞掉重置也毫無損失。
 * 一樣要能承受 localStorage 被停用的情況。
 */

/* 匯出給備份面板用——它要知道偏好存在哪一格才倒得出來 */
export const PREFS_KEY = 'lang-learn.prefs.v1';

const DEFAULTS = {
  /* 文法頁的兩排連接線 */
  grammarLines: true,
  /* 假名表顯示模式：hiragana / katakana / both */
  kanaMode: 'both',
  /**
   * 閱讀題的問法與選項用哪一種語言：zh / target。
   * 這是「我要用哪種方式練」的長期偏好，不是一局裡的臨時設定，
   * 所以跟著偏好走而不是每次重開都回到預設。
   */
  readingAskIn: 'zh',
  /**
   * 測驗時日文漢字怎麼顯示：show / ruby / kana。
   *
   * 對母語是中文的人來說漢字會直接洩題——看到「寿司」不必會唸日文就知道答案。
   * ruby 是折衷：讀的是假名、漢字用小字標在上面，想不起來抬頭就看得到。
   * 跟出題方向一樣是「我要用哪種方式練」的長期選擇，所以記在偏好裡。
   *
   * 舊版存的是布林的 hideKanji，那個鍵會留在使用者的 localStorage 裡，
   * 由 quiz-view 的 storedKanjiMode() 讀成對應的模式。
   */
  kanjiMode: 'show',
  /**
   * 這台裝置上出現過實體鍵盤的按鍵。
   *
   * 觸控裝置預設把鍵盤快捷鍵的提示與數字徽章藏起來——手機沒有鍵盤，
   * 那些字只是雜訊。但「有沒有鍵盤」偵測不出來：接了藍芽鍵盤的平板
   * 在 CSS 眼裡仍然是 pointer: coarse，用 media query 猜會猜錯。
   * 所以不猜——等使用者真的按了鍵再把提示放出來，而且記住。
   */
  keyboardSeen: false,
};

/**
 * 把舊版存下來的形狀轉成現在的。
 *
 * 這件事一定要在合併預設值「之前」做。合併之後每一個鍵都有值了，
 * 分不出「使用者沒設定過」與「使用者選的剛好等於預設」——
 * 於是 kanjiMode 永遠讀到預設的 show，遷移那一行永遠不會執行。
 */
function migrate(stored) {
  /* 漢字顯示最早是布林的 hideKanji，加了「標在假名上」之後改成三選一 */
  if (stored.kanjiMode === undefined && stored.hideKanji !== undefined) {
    return { ...stored, kanjiMode: stored.hideKanji === true ? 'kana' : 'show' };
  }
  return stored;
}

/**
 * 讀取全部偏好。任何異常一律回到預設值。
 */
export function loadPrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
    return { ...DEFAULTS, ...migrate(parsed) };
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
