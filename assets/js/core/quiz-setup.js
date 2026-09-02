/**
 * 設定畫面的決策：這一局出幾題、範圍那一排要顯示什麼。
 *
 * 這些判斷本來寫在 quiz-view 裡，而 ui 層碰 DOM、測不到——
 * 與 speech-text.js 當初被抽出來的理由完全相同：它是帶條件分支的計算，
 * 留在畫面層就只能靠人工點擊來驗。
 *
 * 而且這一小塊有前科：題數的夾限曾經把使用者選的「10 題」永久改寫成
 * 「全部」，切一次小範圍再切回來就變成一局 7608 題，而畫面上看起來像是
 * 他自己選的。那個 bug 從頭到尾沒有任何測試碰得到。
 */

/**
 * 這一局實際會出幾題。
 *
 * useAll 代表「使用者按過『全部』」，是他的選擇；
 * limit 是隨題源與範圍浮動的衍生值。兩者必須分開存——
 * 把浮動值寫回選擇，就再也分不出「他要全部」與
 * 「他要 10 題但當時只湊得出 6 題」。
 */
export function sessionCount({ useAll, count, limit }) {
  return useAll || count > limit ? limit : count;
}

/**
 * 題數那一排該亮哪一顆膠囊：'all' 或一個數字。
 *
 * 判斷條件必須與 sessionCount 完全相同，否則畫面顯示的題數
 * 與實際出的題數會分家——使用者看到「10 題」卻拿到 6 題。
 */
export function countChip({ useAll, count, limit }) {
  return useAll || count > limit ? 'all' : count;
}

/**
 * 範圍那一排的狀態。
 *
 *   sizes  目前題源 ∩ 各範圍有幾題（畫面上膠囊顯示的數字）
 *   totals 整個語言各範圍有幾題，跨題源（語言首頁顯示的數字）
 *
 * 兩者不同是刻意的，也是 stranded 存在的理由：首頁說「你有 5 個還沒練熟」，
 * 而測驗頁停在單字題源時可能一個都湊不滿。
 *
 * 回傳的 scope 可能與傳入的不同——選著的範圍出不了題時（換了題源、
 * 或剛好複習完）要退回 all，否則畫面會停在一個按了會拋錯的狀態。
 */
export function scopeState({ sizes, totals, scope, minPool }) {
  const choices = ['weak', 'due'].filter((s) => (sizes[s] || 0) >= minPool);
  const current = scope !== 'all' && !choices.includes(scope) ? 'all' : scope;

  /**
   * 有題目、但這個題源湊不滿一局的範圍。
   *
   * 逐個判斷而不是「兩個都出不了題才算」：只要有一個被卡住就該解釋，
   * 否則另一個湊得滿的時候，被卡住的那個完全沒有交代。
   */
  const stranded = ['weak', 'due'].filter(
    (s) => (totals[s] || 0) > 0 && (sizes[s] || 0) < minPool
  );

  return { choices, scope: current, stranded, limit: sizes[current] || 0 };
}

/**
 * 某個被卡住的範圍，卡住的原因是哪一種。
 *
 * 兩種原因給的建議完全相反，所以一定要分開：
 *   short    題目就在這個題源裡，只是還不夠多 → 再練幾局，換題型只會更少
 *   elsewhere 題目在別的題源裡 → 換題型才找得到
 *
 * 分不清楚的話，會叫一個「只錯過 3 個單字」的人去換題型，而他換過去是 0。
 */
export function strandedReason({ here, total }) {
  return here >= total ? 'short' : 'elsewhere';
}
