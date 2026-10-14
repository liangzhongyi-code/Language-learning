/**
 * 首頁、今日頁與測驗頁要讀哪一份題庫，取決於已存的今日級別或網址題源，HTML 寫不死。
 * tools/build-preload.mjs 把本檔內嵌到這三種頁面的 <head> 最前面（不以 src 載入，免多一次往返），
 * 讀到 HTML 當下就預載該題庫，與程式模組同時下載。單字、單字簿、文法頁的題庫固定，由工具直接寫成 <link>。
 * 判斷規則須與 page-boot／daily-view／quiz-view 一致；瀏覽器測試 module-preload 逐頁核對預載與實際讀取相同。
 * 猜錯只會多抓或少抓，頁面照常由 page-boot 載入，不影響正確性。
 */
(() => {
  const { lang, page, base } = document.currentScript.dataset;
  let prefs = {};
  try {
    prefs = JSON.parse(window.localStorage.getItem('lang-learn.prefs.v1')) || {};
  } catch {
    /* 儲存被停用或內容損壞時，各頁同樣回到預設級別 */
  }
  const level = [1, 2, 3, 4, 5].includes(prefs[`daily.${lang}.level`]) ? prefs[`daily.${lang}.level`] : 1;
  let files = [`${lang}-words-${level}`];
  if (page === 'quiz') {
    /* 與 quiz-view 相同：網址題源有效且這個語言有題才採用（英文沒有情境題），否則單字全庫 */
    const source = new URLSearchParams(window.location.search).get('source');
    const fields = { sentences: ['sentences'], cloze: ['sentences'], mixed: ['words', 'sentences'], reading: ['readings'],
      scene: lang === 'ja' ? ['scenes'] : ['words'] };
    const chosen = Object.prototype.hasOwnProperty.call(fields, source ?? '') ? fields[source] : ['words'];
    files = chosen.flatMap((field) => field === 'words' ? [1, 2, 3, 4, 5].map((n) => `${lang}-words-${n}`) : [`${lang}-${field}`]);
  }
  for (const name of files) {
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = new URL(`${base}${name}.js`, document.baseURI).href;
    document.head.appendChild(link);
  }
})();
