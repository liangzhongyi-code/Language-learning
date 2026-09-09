/**
 * 在樣式表載入前套用已保存的主題，避免淺色使用者先看到一閃而過的深色頁面。
 */
(() => {
  let theme = 'dark';
  try {
    const stored = JSON.parse(window.localStorage.getItem('lang-learn.prefs.v1'));
    if (stored?.theme === 'light') theme = 'light';
  } catch {
    /* 儲存被停用或內容損壞時沿用安全的深色預設 */
  }
  document.documentElement.dataset.theme = theme;
})();
