/**
 * 在樣式表載入前套用已保存的主題，避免淺色使用者先看到一閃而過的深色頁面。
 */
(() => {
  let stored;
  try {
    stored = JSON.parse(window.localStorage.getItem('lang-learn.prefs.v1'));
  } catch {
    /* 儲存被停用或內容損壞時沿用安全的深色預設 */
  }
  const data = document.documentElement.dataset;
  data.theme = stored?.theme === 'light' ? 'light' : 'dark';
  data.palette = ['classic', 'midnight', 'forest', 'warm'].includes(stored?.palette) ? stored.palette : 'classic';
  data.background = ['plain', 'aurora', 'dust'].includes(stored?.background) ? stored.background : 'aurora';
  data.reducedEffects = String(stored?.reducedEffects === true);
})();
