/**
 * 網站學習資料的 IndexedDB 交易底座。只有完成事件才 resolve，不能把 put 成功
 * 誤當交易成功。正式 UI 尚須透過領域操作／migration 接入，不直接寫任意集合。
 */
import { canonicalJson, checkOperation, operationReceipt } from '../../core/learning-operations.js';
import { migrateLegacy } from '../../core/learning-migration.js';
import { emptyLearning, validateLearningRecord } from '../../core/learning-schema.js';

const DB_VERSION = 1;
const SCHEMA_VERSION = 2;
const COLLECTIONS = Object.freeze([
  'stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger',
  'sessions', 'operations', 'restorePoints', 'books', 'notes', 'intents',
  'achievements', 'reminders', 'outbox',
]);
const WRITABLE = new Set(COLLECTIONS.filter((name) => !['operations', 'restorePoints'].includes(name)));
const INDEXES = {
  itemStates: ['sourceId', 'skillKey', 'due'],
  reviewEvents: ['sourceId', 'skillKey', 'answeredAt', 'sessionId'],
  dailyPlans: ['localDate', 'lang'],
  dailyLedger: ['localDate', 'lang'],
  sessions: ['lang', 'status'],
  restorePoints: ['createdAt'],
};

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function storageFailure(error) {
  if (error?.code && typeof error.code === 'string') return error;
  if (error?.name === 'VersionError') {
    return failure('UNSUPPORTED_SCHEMA', '這份資料由較新版程式建立，請更新程式，不要清除紀錄。');
  }
  if (error?.name === 'QuotaExceededError') return failure('STORAGE_QUOTA', '裝置空間不足，這次沒有保存，請先備份。');
  return failure('STORAGE_ABORTED', '紀錄保存未完成，原資料保持不變；請重試。');
}

function validateMeta(meta) {
  const checked = validateLearningRecord('meta', meta);
  if (!checked.ok) {
    const code = meta?.schemaVersion === SCHEMA_VERSION &&
      checked.errors.some(error => error.code === 'UNSUPPORTED_VERSION')
      ? 'UNSUPPORTED_VERSION' : 'UNSUPPORTED_SCHEMA';
    throw failure(code, '學習資料版本或結構不正確，已停止寫入，請保留原資料。');
  }
  return meta;
}

/**
 * 同 DB version 也可能有錯誤結構；開放任何讀寫之前核對實際 store 與 index 定義。
 * 只讀結構，不重建／修寫損毀 DB；呼叫端可保留原資料進行救援。
 */
function validateDatabaseShape(db) {
  const names = ['meta', ...COLLECTIONS];
  const invalid = () => failure('UNSUPPORTED_SCHEMA', '學習資料集合或索引結構不正確，已停止讀寫，請保留原資料。');
  if (!names.every(name => db.objectStoreNames.contains(name))) throw invalid();
  const tx = db.transaction(names, 'readonly');
  for (const name of names) {
    const store = tx.objectStore(name);
    const indexes = INDEXES[name] || [];
    if (store.keyPath !== null || store.autoIncrement || store.indexNames.length !== indexes.length) throw invalid();
    for (const name of indexes) {
      if (!store.indexNames.contains(name)) throw invalid();
      const index = store.index(name);
      if (index.keyPath !== name || index.unique || index.multiEntry) throw invalid();
    }
  }
}

/**
 * now／crypto／IndexedDB 可注入供測試；正式頁面使用瀏覽器自己的實作。
 * beforeCommit 僅供故障注入，必須同步；所有非同步計算都在交易開始前完成。
 */
export function createWebRepository({
  name = 'lang-learn.learning',
  timeZone = 'Asia/Taipei',
  now = Date.now,
  indexedDB: database = globalThis.indexedDB,
  crypto: cryptoApi = globalThis.crypto,
  beforeCommit,
} = {}) {
  let connection;
  let opening;
  const requireCrypto = () => {
    if (typeof cryptoApi?.subtle?.digest !== 'function' || typeof cryptoApi?.getRandomValues !== 'function') {
      throw failure('STORAGE_UNAVAILABLE', '這個環境無法提供安全的本機學習儲存。');
    }
  };
  const epoch = () => {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolveReady, reject) => {
      requireCrypto();
      if (typeof database?.open !== 'function') {
        reject(failure('STORAGE_UNAVAILABLE', '這個環境無法提供安全的本機學習儲存。'));
        return;
      }
      let abandoned = false;
      const request = database.open(name, DB_VERSION);
      request.onblocked = () => {
        abandoned = true;
        reject(failure('STORAGE_BLOCKED', '其他頁面正在使用舊版資料，請關閉其他分頁後重試。'));
      };
      request.onupgradeneeded = (event) => {
        if (abandoned || event.oldVersion !== 0) { request.transaction.abort(); return; }
        const db = request.result;
        db.createObjectStore('meta').put({
          schemaVersion: SCHEMA_VERSION, revision: 0, dataEpoch: epoch(),
          migrationStatus: 'pending', historyStartedAt: now(),
          schedulerPolicyVersion: 1, timeZone,
        }, 'current');
        for (const name of COLLECTIONS) {
          const store = db.createObjectStore(name);
          for (const index of INDEXES[name] || []) store.createIndex(index, index);
        }
      };
      request.onerror = () => reject(storageFailure(request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        try { validateDatabaseShape(db); }
        catch (error) {
          db.close();
          reject(storageFailure(error));
          return;
        }
        connection = db;
        db.onversionchange = () => { db.close(); connection = undefined; opening = undefined; };
        resolveReady(db);
      };
    });
    opening.catch(() => { opening = undefined; });
    return opening;
  }

  async function get(store, key) {
    if (!['meta', ...COLLECTIONS].includes(store)) throw failure('INVALID_STORE', '不支援的資料集合。');
    const db = await open();
    return new Promise((resolveRead, reject) => {
      const tx = db.transaction(store, 'readonly');
      let value;
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolveRead(value);
      tx.onabort = () => reject(storageFailure(tx.error));
      tx.onerror = () => {};
    });
  }

  async function ready() { return validateMeta(await get('meta', 'current')); }

  /**
   * 先讀完成標記才碰舊來源；完成或清除後即使舊 key 還在，也絕不重新灌入。
   * 驗證在交易外準備，交易內再檢查狀態與版本，兩分頁同時首次啟動也只做一次。
   */
  async function migrateFromLegacy(storage) {
    const initial = await ready();
    if (initial.migrationStatus !== 'pending') return initial;
    let statsRaw;
    let progressRaw;
    try {
      if (typeof storage?.getItem !== 'function') throw new Error('missing storage');
      statsRaw = storage.getItem('lang-learn.stats.v1');
      progressRaw = storage.getItem('lang-learn.progress.v1');
    } catch {
      throw failure('MIGRATION_UNAVAILABLE', '無法讀取舊紀錄，已暫停遷移；請允許網站儲存後重試。');
    }
    const candidate = migrateLegacy({
      statsRaw, progressRaw, now: initial.historyStartedAt,
      timeZone: initial.timeZone, dataEpoch: initial.dataEpoch,
    });
    const db = await open();
    return new Promise((resolveMigration, reject) => {
      const tx = db.transaction(['meta', 'stats', 'progress', 'books', 'achievements', 'reminders'], 'readwrite');
      let next;
      let problem;
      tx.oncomplete = () => resolveMigration(next);
      tx.onabort = () => reject(problem || storageFailure(tx.error));
      tx.onerror = () => {};
      const request = tx.objectStore('meta').get('current');
      request.onsuccess = () => {
        try {
          const current = validateMeta(request.result);
          if (current.migrationStatus !== 'pending') { next = current; return; }
          if (current.revision !== initial.revision || current.revision !== 0 ||
              current.dataEpoch !== initial.dataEpoch) {
            throw failure('MIGRATION_CONFLICT', '舊資料遷移前已有其他更新，請重新載入後檢查。');
          }
          for (const [key, value] of Object.entries(candidate.stats.byScope)) tx.objectStore('stats').put(value, key);
          for (const [key, value] of Object.entries(candidate.progress.items)) tx.objectStore('progress').put(value, key);
          tx.objectStore('books').put(candidate.learning.library.books.favorites, 'favorites');
          tx.objectStore('achievements').put({ policyVersion: 1 }, 'policy');
          tx.objectStore('reminders').put(candidate.learning.reminderPreferences, 'preferences');
          next = { ...current, revision: current.revision + 1, migrationStatus: 'complete' };
          tx.objectStore('meta').put(next, 'current');
          if (beforeCommit) {
            const hook = beforeCommit();
            if (hook && typeof hook.then === 'function') throw new Error('beforeCommit must be synchronous');
          }
        } catch (error) {
          problem = storageFailure(error);
          tx.abort();
        }
      };
    });
  }

  /**
   * 每列提供 continuation: { indexKey, primaryKey }，原樣傳給下一頁的 after。
   * token 在 await 前快照；索引先定位到 indexKey，再直接跳 primaryKey，避免同值漏列／掃前頁。
   * token 僅代表排序位置，不代表跨交易快照；匯出一致性仍須由上層固定 revision。
   */
  async function list(store, { limit = 100, after, index } = {}) {
    if (!COLLECTIONS.includes(store) || !Number.isInteger(limit) || limit < 1 || limit > 1000 ||
        (index !== undefined && !(INDEXES[store] || []).includes(index))) {
      throw failure('INVALID_QUERY', '讀取資料的範圍不正確。');
    }
    let token;
    let range;
    if (after !== undefined) {
      try {
        if (!after || typeof after !== 'object' || Array.isArray(after) ||
            !Object.prototype.hasOwnProperty.call(after, 'indexKey') ||
            !Object.prototype.hasOwnProperty.call(after, 'primaryKey')) throw new Error('invalid token');
        /**
         * IDBKeyRange 會同步轉換並複製合法 IDB key；保留 Date、陣列及二進位排序語意。
         * 不依賴較新的 structuredClone，也不以 JSON 破壞 key 型別；無效 key 仍由 IDB 拒絕。
         */
        token = {
          indexKey: IDBKeyRange.only(after.indexKey).lower,
          primaryKey: IDBKeyRange.only(after.primaryKey).lower,
        };
        if (index === undefined && database.cmp(token.indexKey, token.primaryKey) !== 0) throw new Error('invalid primary token');
        range = IDBKeyRange.lowerBound(index === undefined ? token.primaryKey : token.indexKey, index === undefined);
      } catch {
        throw failure('INVALID_QUERY', '分頁續讀位置不正確，請重新讀取清單。');
      }
    }
    const db = await open();
    return new Promise((resolveRead, reject) => {
      const tx = db.transaction(store, 'readonly');
      const source = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
      const request = source.openCursor(range);
      const values = [];
      let problem;
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) return;
          if (token && index !== undefined && database.cmp(cursor.key, token.indexKey) === 0) {
            const compared = database.cmp(cursor.primaryKey, token.primaryKey);
            if (compared < 0) { cursor.continuePrimaryKey(token.indexKey, token.primaryKey); return; }
            if (compared === 0) { cursor.continue(); return; }
          }
          values.push({ key: cursor.primaryKey, value: cursor.value, indexKey: cursor.key,
            continuation: { indexKey: cursor.key, primaryKey: cursor.primaryKey } });
          if (values.length < limit) cursor.continue();
        } catch (error) {
          problem = storageFailure(error);
          tx.abort();
        }
      };
      tx.oncomplete = () => resolveRead(values);
      tx.onabort = () => reject(problem || storageFailure(tx.error));
      tx.onerror = () => {};
    });
  }

  async function transact(input, clear = false) {
    requireCrypto();
    /**
     * 複製並雜湊固定內容在 await 前後都不讀呼叫者可變物件。
     * 不能在 IndexedDB 活動交易內 await crypto，否則交易可能提前自動提交。
     */
    const operation = JSON.parse(canonicalJson(input));
    if (clear) operation.payload = { kind: 'clear-learning' };
    const payloadBytes = new TextEncoder().encode(canonicalJson(operation.payload));
    const digest = await cryptoApi.subtle.digest('SHA-256', payloadBytes);
    const payloadHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const changes = clear ? [] : operation.payload?.changes;
    if (!clear && (!Array.isArray(changes) || !changes.length || changes.length > 1000)) {
      throw failure('INVALID_OPERATION', '保存內容沒有合法的變更。');
    }
    for (const change of changes) {
      if (!WRITABLE.has(change?.store) || typeof change.key !== 'string' ||
          !change.key || change.key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(change.key) ||
          (change.delete !== true && !Object.prototype.hasOwnProperty.call(change, 'value'))) {
        throw failure('INVALID_OPERATION', '保存內容包含不支援的資料欄位。');
      }
    }
    const db = await open();
    return new Promise((resolveWrite, reject) => {
      const stores = clear ? ['meta', ...COLLECTIONS] : ['meta', 'operations', ...new Set(changes.map((change) => change.store))];
      const tx = db.transaction(stores, 'readwrite');
      let result;
      let problem;
      const abort = (error) => { problem = storageFailure(error); tx.abort(); };
      tx.onabort = () => reject(problem || storageFailure(tx.error));
      tx.onerror = () => {};
      tx.oncomplete = () => resolveWrite(result);
      const metaRequest = tx.objectStore('meta').get('current');
      metaRequest.onsuccess = () => {
        try {
          const meta = validateMeta(metaRequest.result);
          const receiptKey = operation.epoch + ':' + operation.operationId;
          const readReceipt = tx.objectStore('operations').get(receiptKey);
          readReceipt.onsuccess = () => {
            try {
              const decision = checkOperation({ meta, operation, payloadHash, receipt: readReceipt.result });
              if (decision.replay) { result = decision.result; return; }
              const next = { ...meta, revision: meta.revision + 1 };
              if (clear) {
                /**
                 * 固定收藏簿與預設政策屬合法空資料的一部分；與刪除一起提交，
                 * 不依靠 cleared 之後永遠不會再執行的舊資料遷移來補回。
                 */
                const empty = emptyLearning({ now: now(), timeZone: meta.timeZone, dataEpoch: epoch() });
                for (const store of COLLECTIONS) tx.objectStore(store).clear();
                next.dataEpoch = empty.meta.dataEpoch;
                next.migrationStatus = 'cleared';
                next.historyStartedAt = empty.meta.historyStartedAt;
                tx.objectStore('books').put(empty.library.books.favorites, 'favorites');
                tx.objectStore('achievements').put({ policyVersion: empty.achievements.policyVersion }, 'policy');
                tx.objectStore('reminders').put(empty.reminderPreferences, 'preferences');
              } else {
                for (const change of changes) {
                  const store = tx.objectStore(change.store);
                  if (change.delete === true) store.delete(change.key);
                  else store.put(change.value, change.key);
                }
              }
              const receipt = operationReceipt(operation, payloadHash, next.revision);
              tx.objectStore('meta').put(next, 'current');
              /**
               * 清除操作跨到新 epoch；舊 epoch 的收據只能回傳，不能寫回新世代。
               * 舊頁重送依既有 STALE_EPOCH 規則拒絕，不沿用跨世代收據。
               */
              if (!clear) tx.objectStore('operations').put(receipt, receiptKey);
              result = receipt.result;
              if (beforeCommit) {
                const hook = beforeCommit();
                if (hook && typeof hook.then === 'function') throw new Error('beforeCommit must be synchronous');
              }
            } catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      };
    });
  }

  return {
    ready, get, list, migrateFromLegacy,
    commit: (operation) => transact(operation),
    clearLearning: (operation) => transact(operation, true),
    close() {
      if (connection) connection.close();
      connection = undefined;
      opening = undefined;
    },
  };
}
