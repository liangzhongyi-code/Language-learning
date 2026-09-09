/**
 * 共用導覽列。
 *
 * 每個 HTML 不重複手抄導覽結構，一律由這裡在執行期注入。
 * 頁面只要在 <body> 上標好 data-lang 與 data-page 即可。
 *
 * 切換語言時會停在「相同功能」的頁面而不是跳回首頁——
 * 從英文單字頁切過去會到日文單字頁。靠 key 對應，不是靠檔名。
 */

import { loadPrefs, setPref, PREFS_IMPORTED_EVENT } from './prefs.js';

const THEME = { dark: 'dark', light: 'light' };

/**
 * 套用已保存的主題。模組載入時先做，導覽列出現前頁面就會用正確色票。
 */
function applySavedTheme() {
  const saved = loadPrefs().theme;
  document.documentElement.dataset.theme = saved === THEME.light ? THEME.light : THEME.dark;
  syncThemeButton();
}

applySavedTheme();
window.addEventListener(PREFS_IMPORTED_EVENT, applySavedTheme);

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
 * 主題按鈕顯示目前狀態；aria-pressed 固定代表「淺色模式是否開啟」。
 */
function themeToggleHtml() {
  const isLight = document.documentElement.dataset.theme === THEME.light;
  return `<button class="theme-toggle" type="button" data-theme-toggle
    aria-label="淺色模式" aria-pressed="${isLight}">
    <span data-theme-symbol aria-hidden="true">☀</span>
    <span data-theme-label>淺色模式</span>
  </button>`;
}

/**
 * 同步已存在的按鈕；匯入偏好時不重建導覽列也能立刻反映狀態。
 */
function syncThemeButton() {
  const button = document.querySelector('[data-theme-toggle]');
  if (!button) return;
  const isLight = document.documentElement.dataset.theme === THEME.light;
  button.setAttribute('aria-pressed', String(isLight));
  button.title = isLight ? '切換成深色模式' : '切換成淺色模式';
}

/**
 * 綁定全站共用的黑白模式切換，並把選擇寫進既有偏好設定備份。
 */
function bindThemeToggle() {
  const button = document.querySelector('[data-theme-toggle]');
  if (!button) return;

  button.addEventListener('click', () => {
    const root = document.documentElement;
    const isLight = root.dataset.theme !== THEME.light;
    root.dataset.theme = isLight ? THEME.light : THEME.dark;
    syncThemeButton();
    setPref('theme', root.dataset.theme);
  });

  syncThemeButton();
}

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
          ${themeToggleHtml()}
          <a class="lang-switch" href="../${other}/${otherPage.file}"
             title="切換到${esc(LANG_LABEL[other])}的同一個功能">${esc(LANG_LABEL[other])}</a>
          <a class="help-link" href="../help.html">使用教學</a>
        </div>
      </div>
    </header>`;

  document.body.insertAdjacentHTML('afterbegin', html);
  bindThemeToggle();
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
          ${themeToggleHtml()}
          <a class="help-link" href="./help.html"
             ${currentKey === 'help' ? 'aria-current="page"' : ''}>使用教學</a>
        </div>
      </div>
    </header>`;
  document.body.insertAdjacentHTML('afterbegin', html);
  bindThemeToggle();
}
