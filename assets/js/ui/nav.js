/**
 * 共用導覽列。
 *
 * 每個 HTML 不重複手抄導覽結構，一律由這裡在執行期注入。
 * 頁面只要在 <body> 上標好 data-lang 與 data-page 即可。
 *
 * 切換語言時會停在「相同功能」的頁面而不是跳回首頁——
 * 從英文單字頁切過去會到日文單字頁。靠 key 對應，不是靠檔名。
 */

/**
 * 每個語言的頁面清單。key 相同者互為對方語言的同功能頁。
 */
const PAGES = {
  en: [
    { key: 'home', file: 'index.html', label: '首頁' },
    { key: 'pron', file: 'alphabet.html', label: '字母發音' },
    { key: 'vocab', file: 'vocabulary.html', label: '單字' },
    { key: 'grammar', file: 'grammar.html', label: '文法' },
    { key: 'quiz', file: 'quiz.html', label: '測驗' },
  ],
  ja: [
    { key: 'home', file: 'index.html', label: '首頁' },
    /**
     * 入門手冊只有日文有。
     * 英文對中文使用者沒有「三套文字混著寫」這種需要先解釋的門檻——
     * 為了對稱硬生一頁英文版出來，內容會空得很明顯。
     * 切語言時 key 找不到對應會退回對方的首頁，這條路 renderNav 已經處理了。
     */
    { key: 'guide', file: 'guide.html', label: '入門' },
    { key: 'pron', file: 'kana.html', label: '五十音' },
    { key: 'vocab', file: 'vocabulary.html', label: '單字' },
    { key: 'grammar', file: 'grammar.html', label: '文法' },
    { key: 'quiz', file: 'quiz.html', label: '測驗' },
  ],
};

const LANG_LABEL = { en: '英文', ja: '日文' };

/**
 * HTML 逸出，避免資料裡的角括號破壞結構
 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 注入導覽列。
 * 全站一律相對路徑，才能部署在 GitHub Pages 的子路徑底下。
 */
export function renderNav() {
  const { lang, page } = document.body.dataset;
  if (!lang || !PAGES[lang]) return;

  const other = lang === 'en' ? 'ja' : 'en';
  const otherPage = PAGES[other].find((p) => p.key === page) || PAGES[other][0];

  const tabs = PAGES[lang]
    .map((p) => {
      const current = p.key === page ? ' aria-current="page"' : '';
      return `<a href="./${p.file}"${current}>${esc(p.label)}</a>`;
    })
    .join('');

  const html = `
    <header class="topbar">
      <div class="topbar-in">
        <a class="home" href="../index.html">語言學習</a>
        <nav class="tabs" aria-label="${esc(LANG_LABEL[lang])}學習項目">${tabs}</nav>
        <div class="topbar-right">
          <a class="lang-switch" href="../${other}/${otherPage.file}"
             title="切換到${esc(LANG_LABEL[other])}的同一個功能">${esc(LANG_LABEL[other])}</a>
          <a class="help-link" href="../help.html">使用教學</a>
        </div>
      </div>
    </header>`;

  document.body.insertAdjacentHTML('afterbegin', html);
}

/**
 * 根目錄頁面（index.html / help.html）用的簡化導覽列
 */
export function renderRootNav(currentKey) {
  const html = `
    <header class="topbar">
      <div class="topbar-in">
        <a class="home" href="./index.html">語言學習</a>
        <nav class="tabs" aria-label="語言">
          <a href="./en/index.html">英文</a>
          <a href="./ja/index.html">日文</a>
        </nav>
        <div class="topbar-right">
          <a class="help-link" href="./help.html"
             ${currentKey === 'help' ? 'aria-current="page"' : ''}>使用教學</a>
        </div>
      </div>
    </header>`;
  document.body.insertAdjacentHTML('afterbegin', html);
}
