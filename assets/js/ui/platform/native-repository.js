/**
 * APP（Tauri）用的學習資料 repository：介面與 web-repository 完全相同，實際儲存在原生 SQLite。
 * 交易、epoch／revision 與收據核對都在 Rust 端同一個交易內完成；這裡只做與網站相同的輸入整理，
 * 並把可攜資料的驗證與轉換（核心模組）留在 JS，避免兩套規則分家。
 * 舊版 APP 存在 WebView IndexedDB 的資料，於第一次開啟時整組匯入，原 IndexedDB 保留不刪。
 */
import { canonicalJson } from '../../core/learning-operations.js';
import { migrateLegacy } from '../../core/learning-migration.js';
import { emptyLearning, validateLearningRecord } from '../../core/learning-schema.js';
import { PORTABLE_STORES, portableFromRows, rowsFromPortable, ACHIEVEMENT_POLICY_KEY, REMINDER_KEY } from '../../core/learning-snapshot.js';
import { createWebRepository, normalizeSnapshotQuery } from './web-repository.js';

const SCHEMA_VERSION = 2;
const COLLECTIONS = Object.freeze([
  'stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger',
  'sessions', 'operations', 'restorePoints', 'books', 'notes', 'intents',
  'achievements', 'reminders', 'outbox',
]);
const WRITABLE = new Set(COLLECTIONS.filter((name) => name !== 'operations' && name !== 'restorePoints'));
const LEGACY_DB = 'lang-learn.learning';

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Rust 端錯誤序列化為 { code, message }；其他型態（例如 IPC 失敗）轉成可重試的保存失敗。
 */
function nativeFailure(raw) {
  if (raw && typeof raw === 'object' && typeof raw.code === 'string') return failure(raw.code, String(raw.message || ''));
  return failure('STORAGE_ABORTED', '紀錄保存未完成，原資料保持不變；請重試。');
}

function validateMeta(meta) {
  const checked = validateLearningRecord('meta', meta);
  if (!checked.ok) {
    const code = meta && meta.schemaVersion === SCHEMA_VERSION &&
      checked.errors.some((error) => error.code === 'UNSUPPORTED_VERSION') ? 'UNSUPPORTED_VERSION' : 'UNSUPPORTED_SCHEMA';
    throw failure(code, '學習資料版本或結構不正確，已停止寫入，請保留原資料。');
  }
  return meta;
}

/**
 * 是否在提供原生命令的 APP 內；網站一律回 false，繼續使用 IndexedDB。
 */
export function nativeInvoke(scope = globalThis) {
  const invoke = scope && scope.__TAURI__ && scope.__TAURI__.core && scope.__TAURI__.core.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

export function createNativeRepository({
  invoke = nativeInvoke(),
  timeZone = 'Asia/Taipei',
  now = Date.now,
  crypto: cryptoApi = globalThis.crypto,
  indexedDB: database = globalThis.indexedDB,
} = {}) {
  if (typeof invoke !== 'function') throw failure('STORAGE_UNAVAILABLE', '這個環境無法提供原生學習儲存。');
  let opening = null;
  const epoch = () => {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const call = async (command, args) => {
    try { return await invoke(command, args); } catch (error) { throw nativeFailure(error); }
  };

  function open() {
    if (!opening) {
      opening = call('storage_open', { init: { dataEpoch: epoch(), timeZone, now: now() } });
      opening.catch(() => { opening = null; });
    }
    return opening;
  }

  async function get(store, key) {
    if (store !== 'meta' && !COLLECTIONS.includes(store)) throw failure('INVALID_STORE', '不支援的資料集合。');
    await open();
    const value = await call('storage_get', { store, key: String(key) });
    if (store === 'restorePoints' && value) return webPoint(value);
    return value === null ? undefined : value;
  }

  async function ready() { return validateMeta(await get('meta', 'current')); }

  async function readAll(stores) {
    if (!Array.isArray(stores) || stores.some((store) => !COLLECTIONS.includes(store))) {
      throw failure('INVALID_STORE', '不支援的資料集合。');
    }
    await open();
    const result = await call('storage_read_all', { stores });
    validateMeta(result.meta);
    if (result.rows.restorePoints) {
      for (const key of Object.keys(result.rows.restorePoints)) result.rows.restorePoints[key] = webPoint(result.rows.restorePoints[key]);
    }
    return result;
  }

  async function querySnapshot(input) {
    const query = normalizeSnapshotQuery(input);
    await open();
    const result = await call('storage_query', { query: JSON.parse(JSON.stringify(query)) });
    validateMeta(result.meta);
    return result;
  }

  async function getAllByIndex(store, index, key) {
    if (!COLLECTIONS.includes(store)) throw failure('INVALID_QUERY', '讀取資料的範圍不正確。');
    await open();
    return call('storage_by_index', { store, index, key });
  }

  async function list(store, { limit = 100, after, index } = {}) {
    if (!COLLECTIONS.includes(store) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw failure('INVALID_QUERY', '讀取資料的範圍不正確。');
    }
    await open();
    const rows = await call('storage_list', { store, limit, index: index === undefined ? null : index, after: after === undefined ? null : after });
    return store === 'restorePoints' ? rows.map((row) => ({ ...row, value: webPoint(row.value) })) : rows;
  }

  /**
   * 原生還原點保存原始集合列；對外轉成與網站相同的 { createdAt, reason, data: 可攜群組 }。
   */
  function webPoint(value) {
    if (!value || value.format !== 'native-rows-1') return value;
    return { createdAt: value.createdAt, reason: value.reason, data: portableFromRows(value.rows, value.meta) };
  }

  function checkChanges(changes, large) {
    if (!Array.isArray(changes) || !changes.length || changes.length > (large ? 60000 : 1000)) {
      throw failure('INVALID_OPERATION', '保存內容沒有合法的變更。');
    }
    for (const change of changes) {
      if (!change || !WRITABLE.has(change.store) || typeof change.key !== 'string' || !change.key ||
          change.key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(change.key) ||
          (change.delete !== true && !Object.prototype.hasOwnProperty.call(change, 'value'))) {
        throw failure('INVALID_OPERATION', '保存內容包含不支援的資料欄位。');
      }
    }
  }

  const operationOf = (operation) => ({ operationId: operation.operationId, epoch: operation.epoch,
    expectedRevision: operation.expectedRevision });

  /**
   * 與網站相同：先固定 canonical JSON，再交給 Rust 計算雜湊與執行交易。
   */
  async function commit(input, { large = false } = {}) {
    const maxBytes = large ? 24 * 1024 * 1024 : 1024 * 1024;
    const operation = JSON.parse(canonicalJson(input, { maxBytes }));
    checkChanges(operation.payload && operation.payload.changes, large);
    const payload = canonicalJson(operation.payload, { maxBytes });
    await open();
    return call('storage_commit', { operation: operationOf(operation), payload, large });
  }

  async function clearLearning(input) {
    const operation = JSON.parse(canonicalJson(input));
    const meta = await ready();
    const freshEpoch = epoch();
    const at = now();
    const empty = emptyLearning({ now: at, timeZone: meta.timeZone, dataEpoch: freshEpoch });
    const fresh = {
      books: { favorites: empty.library.books.favorites },
      achievements: { [ACHIEVEMENT_POLICY_KEY]: { policyVersion: empty.achievements.policyVersion } },
      reminders: { [REMINDER_KEY]: empty.reminderPreferences },
    };
    return call('storage_clear', { operation: operationOf(operation), payload: canonicalJson({ kind: 'clear-learning' }),
      freshEpoch, historyStartedAt: empty.meta.historyStartedAt, fresh });
  }

  async function restoreLearning(input, { reason = 'restore' } = {}) {
    const maxBytes = 24 * 1024 * 1024;
    const operation = JSON.parse(canonicalJson(input, { maxBytes }));
    const payload = operation.payload || {};
    let rows;
    let nextTimeZone;
    let historyStartedAt;
    let consumePoint = null;
    await open();
    if (Object.prototype.hasOwnProperty.call(payload, 'restorePointKey')) {
      if (typeof payload.restorePointKey !== 'string' || payload.restorePointKey.indexOf('rp:') !== 0) {
        throw failure('INVALID_OPERATION', '找不到指定的還原點。');
      }
      const point = await call('storage_get', { store: 'restorePoints', key: payload.restorePointKey });
      if (!point || point.format !== 'native-rows-1') throw failure('INVALID_OPERATION', '找不到指定的還原點。');
      const portable = portableFromRows(point.rows, point.meta);
      rows = rowsFromPortable(portable);
      nextTimeZone = point.meta.timeZone;
      historyStartedAt = point.meta.historyStartedAt;
      consumePoint = payload.restorePointKey;
    } else {
      rows = rowsFromPortable(payload);
      nextTimeZone = payload.learning.meta.timeZone;
      historyStartedAt = payload.learning.meta.historyStartedAt;
    }
    const createdAt = now();
    return call('storage_restore', {
      operation: operationOf(operation), payload: canonicalJson(payload, { maxBytes }),
      input: { rows, nextEpoch: epoch(), timeZone: nextTimeZone, historyStartedAt,
        pointKey: `rp:${String(createdAt).padStart(16, '0')}:${epoch().slice(0, 8)}`, createdAt, reason, consumePoint },
    });
  }

  /**
   * 第一次開啟時的遷移來源，依序：舊版 APP 的 WebView IndexedDB（整組學習資料）→ 網站時代的
   * localStorage 統計／進度。來源資料不合法時停止並保留原資料，不以空資料覆蓋。
   */
  async function migrateFromLegacy(storage) {
    const initial = await ready();
    if (initial.migrationStatus !== 'pending') return initial;
    const previous = await previousWebviewData();
    if (previous) {
      return call('storage_migrate', { expectedEpoch: initial.dataEpoch, rows: previous.rows, overrides: previous.overrides });
    }
    let statsRaw;
    let progressRaw;
    try {
      if (!storage || typeof storage.getItem !== 'function') throw new Error('missing storage');
      statsRaw = storage.getItem('lang-learn.stats.v1');
      progressRaw = storage.getItem('lang-learn.progress.v1');
    } catch {
      throw failure('MIGRATION_UNAVAILABLE', '無法讀取舊紀錄，已暫停遷移；請重試。');
    }
    const candidate = migrateLegacy({ statsRaw, progressRaw, now: initial.historyStartedAt,
      timeZone: initial.timeZone, dataEpoch: initial.dataEpoch });
    const rows = {
      stats: candidate.stats.byScope,
      progress: candidate.progress.items,
      books: { favorites: candidate.learning.library.books.favorites },
      achievements: { [ACHIEVEMENT_POLICY_KEY]: { policyVersion: 1 } },
      reminders: { [REMINDER_KEY]: candidate.learning.reminderPreferences },
    };
    return call('storage_migrate', { expectedEpoch: initial.dataEpoch, rows, overrides: {} });
  }

  async function previousWebviewData() {
    if (!database || typeof database.databases !== 'function') return null;
    let names;
    try { names = (await database.databases()).map((info) => info.name); } catch { return null; }
    if (names.indexOf(LEGACY_DB) < 0) return null;
    const web = createWebRepository({ name: LEGACY_DB, timeZone, now, indexedDB: database, crypto: cryptoApi });
    try {
      const meta = await web.ready();
      if (meta.migrationStatus === 'pending') return null;
      const { meta: snapshotMeta, rows } = await web.readAll([...PORTABLE_STORES]);
      let validated;
      try { validated = rowsFromPortable(portableFromRows(rows, snapshotMeta)); }
      catch { throw failure('MIGRATION_INVALID', '舊版 APP 的學習紀錄無法安全搬移，原資料已保留。'); }
      return { rows: validated, overrides: { timeZone: snapshotMeta.timeZone, historyStartedAt: snapshotMeta.historyStartedAt } };
    } finally {
      web.close();
    }
  }

  return {
    kind: 'native-sqlite',
    ready, get, list, readAll, querySnapshot, getAllByIndex, migrateFromLegacy, restoreLearning, commit, clearLearning,
    close() { opening = null; },
  };
}
