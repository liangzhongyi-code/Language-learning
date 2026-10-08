/**
 * 導覽先顯示，頁面需要的模組與題庫才動態載入。資料失敗不阻斷外觀／換頁。
 * 沒有 top-level await，DOMContentLoaded 不必等完整題庫；既有保存就緒屏障由各 view 保留。
 */
import { renderNav, renderRootNav } from './nav.js';
import { loadPrefs } from './prefs.js';

const { lang, page } = document.body.dataset;
const mount = document.getElementById('app');
const noticeHost = document.getElementById('notice');
if (lang) renderNav();
else renderRootNav('home');

function fail() {
  const host = mount || document.getElementById('today') || document.getElementById('backup');
  if (!host) return;
  host.innerHTML = '<div class="notice" role="alert">頁面資料暫時無法載入；已保存的紀錄沒有刪除。<div class="actions"><button class="btn" type="button" data-load-retry>重新載入資料</button></div></div>';
  host.querySelector('[data-load-retry]').addEventListener('click', () => window.location.reload());
}

async function boot() {
  const args = { lang, mount, noticeHost };
  if (!lang) {
    const [{ initLearningBackupPanel }, { initGoogleBackupPanel }] = await Promise.all([
      import('./learning-backup-view.js'), import('./google-backup-view.js')]);
    const backup = initLearningBackupPanel(document.getElementById('backup'));
    initGoogleBackupPanel(document.getElementById('google-backup'), backup);
    return;
  }
  if (!['ja', 'en'].includes(lang)) throw new Error('不支援的語言。');
  if (page === 'home') {
    import('./stats-view.js').then(({ renderLangStats }) => renderLangStats(document.getElementById('stats'), lang))
      .catch(() => { document.getElementById('stats').textContent = '統計暫時無法載入，重新整理後重試；紀錄沒有刪除。'; });
  }
  const catalog = ['home', 'quiz', 'daily', 'vocab', 'grammar', 'library'].includes(page)
    ? await import('../data/catalog.js') : {};
  const { CATALOG_META, loadWords, loadDataset } = catalog;
  if (page === 'home') {
    const meta = CATALOG_META[lang];
    document.querySelector('[data-count="words"]').textContent = meta.words;
    document.querySelector('[data-count="sentences"]').textContent = meta.sentences;
    const pref = loadPrefs()[`daily.${lang}.level`];
    const level = [1, 2, 3, 4, 5].includes(pref) ? pref : 1;
    const [{ renderTodayCard }, words] = await Promise.all([
      import('./today-card.js'), loadWords(lang, { level })]);
    renderTodayCard(document.getElementById('today'), { lang, words });
  } else if (page === 'quiz') {
    const { initQuizPage } = await import('./quiz-view.js');
    initQuizPage({ ...args, words: [], sentences: [], scenes: [], readings: [],
      dataProvider: source => loadDataset(lang, source), dataMeta: CATALOG_META[lang],
      onDataRetry: source => {
        const url = new URL(window.location.href);
        url.searchParams.set('source', source);
        window.location.replace(url.href);
      } });
  } else if (page === 'daily') {
    const { initDailyPage } = await import('./daily-view.js');
    initDailyPage({ ...args, words: [], wordProvider: level => loadWords(lang, { level }),
      practiceProvider: async () => (await (lang === 'ja'
        ? import('../data/ja/practice.js') : import('../data/en/practice.js'))).practice,
      onDataRetry: () => window.location.reload() });
  } else if (page === 'vocab') {
    const [{ initVocabPage }, words] = await Promise.all([import('./vocab-view.js'), loadWords(lang)]);
    initVocabPage({ ...args, words });
  } else if (page === 'grammar') {
    const [{ initGrammarPage }, { sentences }] = await Promise.all([import('./grammar-view.js'), loadDataset(lang, 'sentences')]);
    initGrammarPage({ ...args, sentences });
  } else if (page === 'library') {
    const [{ initLibraryPage }, words] = await Promise.all([import('./library-view.js'), loadWords(lang)]);
    initLibraryPage({ ...args, words });
  } else if (page === 'history') {
    const { initHistoryPage } = await import('./history-view.js');
    initHistoryPage(args);
  } else if (page === 'practice') {
    const [{ initPracticePage }, data] = await Promise.all([
      import('./practice-view.js'),
      lang === 'ja' ? import('../data/ja/practice.js') : import('../data/en/practice.js')]);
    initPracticePage({ ...args, practice: data.practice });
  } else if (page === 'pron') {
    const view = await import('./kana-view.js');
    if (lang === 'ja') view.initKanaPage({ ...args, ...(await import('../data/ja/kana.js')) });
    else view.initAlphabetPage({ ...args, ...(await import('../data/en/alphabet.js')) });
  } else throw new Error('不支援的頁面。');
}
if (mount) mount.innerHTML = '<p class="hint" role="status">正在載入這個頁面需要的資料…</p>';
boot().catch(fail);
