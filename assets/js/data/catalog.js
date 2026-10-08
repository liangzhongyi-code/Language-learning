/**
 * 按語言、級別與題源取得靜態資料。只有筆數索引同步載入，題庫皆為本機動態模組。
 * 已成功的請求共用；失敗移除本層 Promise，正式頁面重試另以新 document 清除模組失敗快取。
 * 完整讀取保留原 ID 順序，不宣稱移除 Promise 能清除瀏覽器的 module map。
 */
export { CATALOG_META } from './catalog/meta.js';

const modules = {
  en: {
    levels: [() => import('./catalog/en-words-1.js'), () => import('./catalog/en-words-2.js'),
      () => import('./catalog/en-words-3.js'), () => import('./catalog/en-words-4.js'), () => import('./catalog/en-words-5.js')],
    sentences: () => import('./catalog/en-sentences.js'), scenes: () => import('./catalog/en-scenes.js'), readings: () => import('./catalog/en-readings.js'),
  },
  ja: {
    levels: [() => import('./catalog/ja-words-1.js'), () => import('./catalog/ja-words-2.js'),
      () => import('./catalog/ja-words-3.js'), () => import('./catalog/ja-words-4.js'), () => import('./catalog/ja-words-5.js')],
    sentences: () => import('./catalog/ja-sentences.js'), scenes: () => import('./catalog/ja-scenes.js'), readings: () => import('./catalog/ja-readings.js'),
  },
};
const pending = new Map();
function language(lang) {
  if (!Object.prototype.hasOwnProperty.call(modules, lang)) throw new Error('不支援的題庫語言。');
  return modules[lang];
}
function cached(key, read) {
  if (!pending.has(key)) {
    const request = Promise.resolve().then(read);
    pending.set(key, request);
    request.catch(() => { if (pending.get(key) === request) pending.delete(key); });
  }
  return pending.get(key);
}
export async function loadWords(lang, { level = 'all' } = {}) {
  const data = language(lang);
  if (level !== 'all' && (!Number.isInteger(level) || level < 1 || level > 5)) throw new Error('題庫級別不正確。');
  const levels = level === 'all' ? [1, 2, 3, 4, 5] : [level];
  const rows = await Promise.all(levels.map(n => cached(`${lang}:words:${n}`, async () => (await data.levels[n - 1]()).words)));
  return rows.flat().sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop()));
}
export async function loadDataset(lang, source) {
  const data = language(lang);
  const fields = { words: ['words'], mixed: ['words', 'sentences'], sentences: ['sentences'], cloze: ['sentences'], scene: ['scenes'], reading: ['readings'] };
  if (!Object.prototype.hasOwnProperty.call(fields, source)) throw new Error('不支援的題型。');
  return Object.fromEntries(await Promise.all(fields[source].map(async field => [field, field === 'words'
    ? await loadWords(lang) : [...await cached(`${lang}:${field}`, async () => (await data[field]())[field])]])));
}
