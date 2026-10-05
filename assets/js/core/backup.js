/**
 * 學習紀錄的匯出與匯入。
 *
 * localStorage 活得比多數人以為的久——關瀏覽器、重開機都還在，
 * 真正會消失的是「清除網站資料」「無痕模式」「換一台裝置」這三件事。
 * 這一支就是為那三件事準備的：把紀錄倒成一個檔案，之後倒回來。
 *
 * 匯入前沿用共用的統計／進度驗證器，不等覆寫後才交給載入端降級成空資料。
 * 偏好只收現在支援的欄位與模式；壞區塊明確跳過，合法的舊資料原樣救回。
 */

import { validatePlainJson, validateStats, validateProgress } from './learning-schema.js';
import { BACKUP_JSON_MAX_BYTES } from './backup-limits.js';
import { PALETTES, BACKGROUNDS } from './appearance.js';

/**
 * 檔案的識別字串。
 * 沒有這個欄位就不是本站的備份——使用者很容易選錯檔案，
 * 而把一份陌生的 JSON 直接寫進 localStorage 會讓整個網站進入沒人預期的狀態。
 */
export const BACKUP_FORMAT = 'lang-learn.backup';

/**
 * 備份檔的格式版本。
 * 與各區塊自己的 schemaVersion 是兩回事：這個管的是外殼，那些管的是內容。
 */
export const BACKUP_VERSION = 1;

/**
 * 備份涵蓋的區塊，順序即畫面上的顯示順序
 */
export const SECTIONS = ['stats', 'progress', 'prefs'];

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const boolPrefs = new Set(['reducedEffects', 'grammarLines', 'keyboardSeen', 'hideKanji']);
const prefModes = {
  theme: ['dark', 'light'],
  palette: PALETTES.map(item => item.value),
  background: BACKGROUNDS.map(item => item.value),
  kanaMode: ['hiragana', 'katakana', 'both'],
  readingAskIn: ['zh', 'target'],
  kanjiMode: ['show', 'ruby', 'kana'],
};

function validPrefs(value) {
  return isPlainObject(value) && validatePlainJson(value).ok && Object.entries(value).every(([key, item]) =>
    boolPrefs.has(key) ? typeof item === 'boolean' : own(prefModes, key) && prefModes[key].includes(item));
}

/**
 * 先分段計算 UTF-8 上限，拒絕時不先配置整份超大 JSON 的編碼陣列。
 */
function withinSizeLimit(text) {
  if (text.length > BACKUP_JSON_MAX_BYTES) return false;
  const encoder = new TextEncoder();
  let total = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 8192, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--;
    total += encoder.encode(text.slice(start, end)).byteLength;
    if (total > BACKUP_JSON_MAX_BYTES) return false;
    start = end;
  }
  return true;
}

/**
 * 一個區塊裡有幾筆資料，給匯入前的預覽用。
 * 使用者要看的是「這個檔案裡有多少東西」，不是它的內部結構，
 * 所以三種區塊各自取那個對使用者有意義的數字。
 */
export function countOf(section, value) {
  if (!isPlainObject(value)) return 0;
  if (section === 'stats') return Object.keys(value.byScope || {}).length;
  if (section === 'progress') return Object.keys(value.items || {}).length;
  return Object.keys(value).length;
}

/**
 * 打包成要寫進檔案的物件。
 * now 由呼叫端傳入而不是在這裡取——與亂數同樣的理由，測試要能重現同一份輸出。
 */
export function exportPayload(data, now) {
  const payload = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now };
  for (const section of SECTIONS) {
    if (isPlainObject(data?.[section])) payload[section] = data[section];
  }
  return payload;
}

/**
 * 解析一份備份檔。
 *
 * 回傳 { ok, data, counts, exportedAt, errors }：
 * data 只包含通過檢查的區塊，errors 說明跳過了什麼。
 * 一個區塊壞掉不該讓整份備份作廢——統計壞了但學習紀錄是好的，
 * 那就把學習紀錄救回來，然後告訴使用者統計沒救回來。
 */
export function parseBackup(text) {
  if (typeof text !== 'string') {
    return { ok: false, data: {}, counts: {}, exportedAt: null, errors: ['這不是一個有效的 JSON 檔。'] };
  }
  if (!withinSizeLimit(text)) {
    return { ok: false, data: {}, counts: {}, exportedAt: null, errors: ['備份資料超過 10 MiB 上限，沒有動任何資料。'] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, data: {}, counts: {}, exportedAt: null, errors: ['這不是一個有效的 JSON 檔。'] };
  }

  if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      data: {},
      counts: {},
      exportedAt: null,
      errors: ['這不是本站的備份檔，沒有動任何資料。'],
    };
  }

  /**
   * 保留明確支援的 v0/v1，不把缺版本、字串或小數當成合法舊版。
   * 外殼不合法時整份拒絕，不能藉一個合法偏好區塊繞過版本檢查。
   */
  if (!Number.isInteger(parsed.version) || parsed.version < 0 || parsed.version > BACKUP_VERSION) {
    return {
      ok: false,
      data: {},
      counts: {},
      exportedAt: null,
      errors: [typeof parsed.version === 'number'
        ? `這份備份的格式版本不支援（v${parsed.version}），沒有動任何資料。`
        : '這份備份的格式版本不合法，沒有動任何資料。'],
    };
  }

  const data = {};
  const counts = {};
  const errors = [];
  for (const section of SECTIONS) {
    const value = parsed[section];
    if (value === undefined) continue;
    const valid = section === 'stats' ? validateStats(value).ok
      : section === 'progress' ? validateProgress(value).ok : validPrefs(value);
    if (!valid) {
      errors.push(`「${section}」的格式不對，這一項跳過。`);
      continue;
    }
    data[section] = value;
    counts[section] = countOf(section, value);
  }

  const found = Object.keys(data);
  if (!found.length) errors.push('這份備份裡沒有任何可以還原的資料。');

  return {
    ok: found.length > 0,
    data,
    counts,
    exportedAt: Number.isFinite(parsed.exportedAt) ? parsed.exportedAt : null,
    errors,
  };
}
