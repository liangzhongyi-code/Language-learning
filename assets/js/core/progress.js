/**
 * 逐題的學習紀錄：每一個題目你看過幾次、錯過幾次、下次什麼時候該再看到。
 *
 * 與 stats.js 的分工：
 *   stats 是「語言 × 題源」的三個計數器，用來回答「我練得怎麼樣」；
 *   這裡是「每一個字」的記錄，用來回答「我該練哪些」。
 *
 * 為什麼另開一把 localStorage 鑰匙而不是塞進 stats：
 * stats 不到 1KB，而且每次進語言首頁都會讀它來畫一個百分比；
 * 這一份記滿全站一萬多個項目會到七百多 KB。
 * 合在一起的話，畫一個百分比要先解析七百 KB 的 JSON。
 *
 * 順帶的好處是舊使用者不需要遷移——這是一把全新的鑰匙，讀不到就是空的。
 *
 * 儲存介面由參數注入，與 stats.js 同樣的理由：
 * 測試能塞假物件驗降級路徑，無痕模式與容量已滿也走同一條路被吃掉。
 */

import { isAnswered, isCorrect } from './quiz-engine.js';
import { nextBox, dueAfter, isDue } from './srs.js';

export const PROGRESS_KEY = 'lang-learn.progress.v1';

export const PROGRESS_SCHEMA_VERSION = 1;

export function emptyProgress() {
  return { schemaVersion: PROGRESS_SCHEMA_VERSION, items: {} };
}

/**
 * 一筆記錄的欄位刻意用單字母。
 * 一萬多筆的時候，鍵名本身就是可觀的體積——
 * 寫成 seen/wrong/lastAnsweredAt 會讓整包大將近一倍。
 *
 *   n  作答次數
 *   w  答錯次數
 *   box  Leitner 盒號
 *   last 上次作答的時間
 *   due  下次該出現的時間
 */
const emptyRecord = () => ({ n: 0, w: 0, box: 1, last: 0, due: 0 });

/**
 * 把讀進來的東西整理成可用的結構，不合格回傳 null。
 * loadProgress 與匯入都走這一條，規則只有一份。
 */
export function normalizeProgress(parsed) {
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== PROGRESS_SCHEMA_VERSION ||
    typeof parsed.items !== 'object' ||
    parsed.items === null ||
    Array.isArray(parsed.items)
  ) {
    return null;
  }
  return { schemaVersion: PROGRESS_SCHEMA_VERSION, items: { ...parsed.items } };
}

export function loadProgress(storage) {
  let raw;
  try {
    raw = storage?.getItem?.(PROGRESS_KEY);
  } catch {
    return emptyProgress();
  }
  if (!raw) return emptyProgress();

  try {
    return normalizeProgress(JSON.parse(raw)) || emptyProgress();
  } catch {
    return emptyProgress();
  }
}

/**
 * 寫入。失敗回傳 false，呼叫端可據此提示，但作答流程不受影響。
 */
export function saveProgress(storage, progress) {
  /**
   * 先確認真的有東西可以寫。
   * `storage?.setItem?.()` 在 storage 是 undefined 時會靜靜地什麼都不做然後回傳
   * undefined——於是這個函式回報 true，而使用者被告知紀錄保存成功、實際上沒有。
   * 停用 localStorage 的瀏覽器正好走這條路。
   */
  if (typeof storage?.setItem !== 'function') return false;
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(storage) {
  try {
    storage?.removeItem?.(PROGRESS_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把一局的作答結果併進紀錄，回傳新的物件（不就地改動來源）。
 *
 * 「這一題算不算作答完畢、算不算答對」一律問 quiz-engine，
 * 與 stats.js 同一條紀律——規則寫兩份遲早會分家。
 */
export function recordSession(progress, session, now) {
  const items = { ...(progress?.items || {}) };

  for (const q of session?.questions || []) {
    if (!q?.sourceId || !isAnswered(q)) continue;
    const ok = isCorrect(q);
    const prev = items[q.sourceId] || emptyRecord();
    const box = nextBox(prev.box, ok);
    items[q.sourceId] = {
      n: (prev.n || 0) + 1,
      w: (prev.w || 0) + (ok ? 0 : 1),
      box,
      last: now,
      due: dueAfter(box, now),
    };
  }

  return { schemaVersion: PROGRESS_SCHEMA_VERSION, items };
}

/**
 * id 的開頭就是語言代碼（ja-w-0001、en-s-029），不必另外存一份語言欄位
 */
const ofLang = (progress, lang) =>
  Object.entries(progress?.items || {}).filter(([id]) => id.startsWith(`${lang}-`));

/**
 * 最容易錯的題目 id，錯得最兇的排前面。
 *
 * 只收「至少錯過一次」的。沒錯過的東西放進易錯清單只會稀釋它，
 * 而這份清單的價值就在於它很短。
 *
 * 排序先看錯誤率再看絕對錯誤數：
 * 錯 1/1 與錯 8/10 的錯誤率一個是 100% 一個是 80%，
 * 但後者顯然比較該練——所以錯誤率相近時用次數決勝。
 */
export function weakest(progress, { lang, limit } = {}) {
  return ofLang(progress, lang)
    .filter(([, r]) => (r?.w || 0) > 0)
    .sort((a, b) => {
      const rateA = a[1].w / Math.max(a[1].n, 1);
      const rateB = b[1].w / Math.max(b[1].n, 1);
      if (rateB !== rateA) return rateB - rateA;
      if (b[1].w !== a[1].w) return b[1].w - a[1].w;
      /* 一樣錯的話先練久沒碰的 */
      return (a[1].last || 0) - (b[1].last || 0);
    })
    .slice(0, limit ?? Infinity)
    .map(([id]) => id);
}

/**
 * 今天（含以前）該複習的題目 id。
 * 沒作答過的不算——複習的定義是「複習學過的」，沒學過的屬於新題。
 */
export function dueIds(progress, lang, now) {
  return ofLang(progress, lang)
    .filter(([, r]) => isDue(r, now))
    .map(([id]) => id);
}

/**
 * 某個語言的紀錄摘要，給首頁用
 */
export function progressOfLang(progress, lang, now) {
  const entries = ofLang(progress, lang);
  return {
    tracked: entries.length,
    weak: entries.filter(([, r]) => (r?.w || 0) > 0).length,
    due: entries.filter(([, r]) => isDue(r, now)).length,
  };
}
