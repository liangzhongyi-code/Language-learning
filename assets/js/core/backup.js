/**
 * 學習紀錄的匯出與匯入。
 *
 * localStorage 活得比多數人以為的久——關瀏覽器、重開機都還在，
 * 真正會消失的是「清除網站資料」「無痕模式」「換一台裝置」這三件事。
 * 這一支就是為那三件事準備的：把紀錄倒成一個檔案，之後倒回來。
 *
 * 這裡刻意不做深度驗證。
 * 每一種資料的載入函式（loadStats、loadProgress、loadPrefs）本來就規定
 * 「壞資料一律安靜回到初始狀態」，把同一套規則在這裡再寫一份，
 * 只會多一個遲早與本尊分家的副本。所以匯入只確認兩件事：
 * 這是不是本站的備份檔、每個區塊是不是一個物件。剩下的交給載入端。
 *
 * 也因此這一支不 import 任何資料模組——它只認得備份檔的外殼，
 * 不認得裡面裝什麼。日後多一種要備份的資料，只要在 SECTIONS 加一個名字。
 */

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
   * 只擋比自己新的版本。
   * 舊版備份要能繼續匯入——備份的意義就是放很久之後還救得回來，
   * 網站更新一次就讓所有舊備份失效，等於沒有備份。
   */
  if (Number(parsed.version) > BACKUP_VERSION) {
    return {
      ok: false,
      data: {},
      counts: {},
      exportedAt: null,
      errors: [`這份備份是較新的格式（v${parsed.version}），這個版本的網站看不懂。`],
    };
  }

  const data = {};
  const counts = {};
  const errors = [];
  for (const section of SECTIONS) {
    const value = parsed[section];
    if (value === undefined) continue;
    if (!isPlainObject(value)) {
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
