/**
 * 雲端同步基準：這台裝置最後一次與雲端一致時的狀態，依帳號分開存在 localStorage。
 *
 * 結構：{ [accountId]: { cloudRevision, localRevision, localEpoch, origin: 'upload'|'cloud', paused, updatedAt } }
 * accountId 是伺服器回傳的 users.id，不存 email、cookie 或任何 token。
 * 這個 key 不在備份範圍內（C16）；讀到壞資料時一律當作沒有基準，不丟例外。
 */

export const CLOUD_BASELINE_KEY = 'lang-learn.cloud.v1';

const ORIGINS = new Set(['upload', 'cloud']);
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const isRevision = (value) => Number.isSafeInteger(value) && value >= 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validAccount(accountId) {
  return typeof accountId === 'string' && accountId.length > 0 && accountId.length <= 128 && !RESERVED.has(accountId);
}

/**
 * 只接受欄位齊全且型別正確的紀錄；paused 缺少時視為 false，updatedAt 缺少時視為 0。
 */
function normalize(record) {
  if (!isObject(record)) return null;
  const { cloudRevision, localRevision, localEpoch, origin } = record;
  if (!isRevision(cloudRevision) || !isRevision(localRevision)) return null;
  if (typeof localEpoch !== 'string' || !localEpoch || localEpoch.length > 128) return null;
  if (!ORIGINS.has(origin)) return null;
  if (record.paused !== undefined && typeof record.paused !== 'boolean') return null;
  const updatedAt = record.updatedAt === undefined ? 0 : record.updatedAt;
  if (!Number.isFinite(updatedAt) || updatedAt < 0) return null;
  return { cloudRevision, localRevision, localEpoch, origin, paused: record.paused === true, updatedAt };
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * 建立同步基準存取器；storage（getItem／setItem／removeItem）與時間可注入。
 */
export function createCloudBaseline({ storage = defaultStorage(), now = () => Date.now(), key = CLOUD_BASELINE_KEY } = {}) {
  /**
   * 讀出整份對照表；任何讀取或解析失敗都回傳空表。
   */
  function readAll() {
    try {
      const raw = storage?.getItem(key);
      if (typeof raw !== 'string') return {};
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(table) {
    try {
      if (!storage) return false;
      if (Object.keys(table).length) storage.setItem(key, JSON.stringify(table));
      else storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 重新組出只含合法紀錄的表，順便丟掉壞掉的帳號列。
   */
  function cleanTable() {
    const table = Object.create(null);
    for (const [accountId, record] of Object.entries(readAll())) {
      const value = validAccount(accountId) ? normalize(record) : null;
      if (value) table[accountId] = value;
    }
    return table;
  }

  function get(accountId) {
    if (!validAccount(accountId)) return null;
    const table = readAll();
    return Object.prototype.hasOwnProperty.call(table, accountId) ? normalize(table[accountId]) : null;
  }

  function set(accountId, record) {
    if (!validAccount(accountId)) return false;
    const value = normalize({ ...record, updatedAt: now() });
    if (!value) return false;
    const table = cleanTable();
    table[accountId] = value;
    return writeAll({ ...table });
  }

  return {
    /**
     * 取得某帳號的同步基準；沒有或壞掉時回傳 null。
     */
    get,
    /**
     * 整筆寫入某帳號的同步基準，updatedAt 一律以現在時間覆寫；成功回傳 true。
     */
    set,
    /**
     * 合併更新既有基準（例如只改 paused）；沒有既有基準時回傳 false。
     */
    update(accountId, patch) {
      const current = get(accountId);
      if (!current || !isObject(patch)) return false;
      return set(accountId, { ...current, ...patch });
    },
    /**
     * 移除某帳號的同步基準，其他帳號不受影響；失敗時安靜略過。
     */
    clear(accountId) {
      if (!validAccount(accountId)) return;
      const table = cleanTable();
      if (!(accountId in table)) return;
      delete table[accountId];
      writeAll({ ...table });
    },
  };
}
