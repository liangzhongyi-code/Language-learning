/**
 * 網站學習資料的 IndexedDB 交易底座。只有完成事件才 resolve，不能把 put 成功
 * 誤當交易成功。正式 UI 經 learning-store 的就緒屏障與領域操作接入，不直接寫任意集合。
 */
import { canonicalJson, checkOperation, operationReceipt } from '../../core/learning-operations.js';
import { migrateLegacy } from '../../core/learning-migration.js';
import { emptyLearning, validateLearningRecord } from '../../core/learning-schema.js';
import { PORTABLE_STORES, portableFromRows, rowsFromPortable } from '../../core/learning-snapshot.js';

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

/**
 * 查詢契約只接受純 selector map；在 await 前複製，拒絕繼承屬性、accessor 與未知欄位。
 * prefix 固定語言邊界；key 僅接受非空字串或有限數字，不開放無範圍集合掃描。
 * memory repository 共用此驗證，不以替身模擬 IndexedDB 的交易一致性。
 */
export function normalizeSnapshotQuery(input) {
  const invalid = () => { throw failure('INVALID_QUERY', '讀取資料的範圍不正確。'); };
  function fields(value) {
    if (!value || typeof value !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' ||
        !descriptors[key].enumerable || !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) return invalid();
    return descriptors;
  }
  const query = {};
  for (const [store, descriptor] of Object.entries(fields(input))) {
    if (!COLLECTIONS.includes(store)) invalid();
    const selector = descriptor.value;
    const entries = Object.entries(fields(selector));
    const names = entries.map(([key]) => key).sort().join(',');
    const values = Object.fromEntries(entries.map(([key, value]) => [key, value.value]));
    if (names === 'prefix') {
      const allowed = store === 'stats' ? ['ja:', 'en:']
        : ['progress', 'itemStates', 'intents'].includes(store) ? ['ja-', 'en-'] : [];
      if (!allowed.includes(values.prefix)) invalid();
    } else if (names === 'key' || names === 'index,key') {
      if (!isSnapshotKey(values.key)) invalid();
      if (names === 'index,key' && (!(INDEXES[store] || []).includes(values.index) ||
          values.index === 'lang' && !['ja', 'en'].includes(values.key))) invalid();
    } else if (names === 'planRefs') {
      if (store !== 'sessions' || values.planRefs !== 'dailyPlans') invalid();
    } else invalid();
    query[store] = Object.freeze(values);
  }
  if (query.sessions?.planRefs && (query.dailyPlans?.index !== 'lang' ||
      !['ja', 'en'].includes(query.dailyPlans.key))) invalid();
  return Object.freeze(query);
}

function isSnapshotKey(key) {
  return typeof key === 'number' ? Number.isFinite(key)
    : typeof key === 'string' && key.length > 0 && key.length <= 256 &&
      !['__proto__', 'constructor', 'prototype'].includes(key);
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

  async function transact(input, clear = false, { large = false } = {}) {
    requireCrypto();
    /**
     * 複製並雜湊固定內容在 await 前後都不讀呼叫者可變物件。
     * 不能在 IndexedDB 活動交易內 await crypto，否則交易可能提前自動提交。
     * large 用於整批單字簿匯入與含完整題面快照的測驗保存：放寬筆數與大小上限，
     * 但仍是單一交易、全有全無，且不略過集合與資料驗證。
     */
    const maxBytes = large ? 24 * 1024 * 1024 : 1024 * 1024;
    const operation = JSON.parse(canonicalJson(input, { maxBytes }));
    if (clear) operation.payload = { kind: 'clear-learning' };
    const payloadBytes = new TextEncoder().encode(canonicalJson(operation.payload, { maxBytes }));
    const digest = await cryptoApi.subtle.digest('SHA-256', payloadBytes);
    const payloadHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const changes = clear ? [] : operation.payload?.changes;
    if (!clear && (!Array.isArray(changes) || !changes.length || changes.length > (large ? 60000 : 1000))) {
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

  /**
   * 同一個唯讀交易讀取多個集合，回傳 { 集合: { key: value } } 與 meta；
   * 完整備份、單字簿及未指定 bounded query 的讀取／提交使用此入口；
   * 語言統計與每日計畫改用 querySnapshot，在同交易內依範圍讀取。
   */
  async function readAll(stores) {
    if (!Array.isArray(stores) || stores.some((store) => !COLLECTIONS.includes(store))) {
      throw failure('INVALID_STORE', '不支援的資料集合。');
    }
    const db = await open();
    return new Promise((resolveRead, reject) => {
      const tx = db.transaction(['meta', ...stores], 'readonly');
      const rows = {};
      let meta;
      let problem;
      tx.oncomplete = () => resolveRead({ meta, rows });
      tx.onabort = () => reject(problem || storageFailure(tx.error));
      tx.onerror = () => {};
      const metaRequest = tx.objectStore('meta').get('current');
      metaRequest.onsuccess = () => {
        try { meta = validateMeta(metaRequest.result); }
        catch (error) { problem = storageFailure(error); tx.abort(); }
      };
      for (const store of stores) readStore(tx, store, (values) => { rows[store] = values; });
    });
  }

  /**
   * 回傳 { meta, rows }：meta、bounded ranges 與 plan.sessionId 引用皆在同一 readonly tx。
   * prefix 用下一個字元作排他上界，連 prefix + \uffff + suffix 都包含。
   * session get 在計畫 cursor 的同步 onsuccess 內排入；不 await、不跨 revision 拼資料。
   */
  async function querySnapshot(input) {
    const query = normalizeSnapshotQuery(input);
    const db = await open();
    return new Promise((resolveRead, reject) => {
      let tx;
      try { tx = db.transaction(['meta', ...Object.keys(query)], 'readonly'); }
      catch (error) { reject(storageFailure(error)); return; }
      const rows = Object.fromEntries(Object.keys(query).map(store => [store, {}]));
      let meta;
      let problem;
      const abort = error => { problem = storageFailure(error); tx.abort(); };
      const save = (store, key, value) => {
        Object.defineProperty(rows[store], key, { value, enumerable: true, configurable: true, writable: true });
      };
      tx.oncomplete = () => resolveRead({ meta, rows });
      tx.onabort = () => reject(problem || storageFailure(tx.error));
      tx.onerror = () => {};
      const requestedSessions = new Set();
      const enqueueSession = plan => {
        const key = plan?.sessionId;
        if (key === null || key === undefined || requestedSessions.has(key)) return;
        if (typeof key !== 'string' || !isSnapshotKey(key)) {
          throw failure('UNSUPPORTED_SCHEMA', '每日清單的 session 引用不合法，請保留原資料。');
        }
        requestedSessions.add(key);
        const request = tx.objectStore('sessions').get(key);
        request.onsuccess = () => {
          try { if (request.result !== undefined) save('sessions', key, request.result); }
          catch (error) { abort(error); }
        };
      };
      try {
        const metaRequest = tx.objectStore('meta').get('current');
        metaRequest.onsuccess = () => {
          try { meta = validateMeta(metaRequest.result); }
          catch (error) { abort(error); }
        };
        for (const [store, selector] of Object.entries(query)) {
          if (selector.planRefs) continue;
          const target = tx.objectStore(store);
          if (Object.prototype.hasOwnProperty.call(selector, 'key') && !selector.index) {
            const request = target.get(selector.key);
            request.onsuccess = () => {
              try { if (request.result !== undefined) save(store, selector.key, request.result); }
              catch (error) { abort(error); }
            };
          } else {
            const prefix = selector.prefix;
            const range = prefix !== undefined
              ? IDBKeyRange.bound(prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1), false, true)
              : IDBKeyRange.only(selector.key);
            const source = selector.index ? target.index(selector.index) : target;
            const request = source.openCursor(range);
            request.onsuccess = () => {
              try {
                const cursor = request.result;
                if (!cursor) return;
                save(store, cursor.primaryKey, cursor.value);
                if (store === 'dailyPlans' && query.sessions?.planRefs) enqueueSession(cursor.value);
                cursor.continue();
              } catch (error) { abort(error); }
            };
          }
        }
      } catch (error) { abort(error); }
    });
  }

  /**
   * 以索引精確查詢一組列（例如同一 session 的事件、同一來源的能力），不掃描整個集合。
   */
  async function getAllByIndex(store, index, key) {
    if (!COLLECTIONS.includes(store) || !(INDEXES[store] || []).includes(index)) {
      throw failure('INVALID_QUERY', '讀取資料的範圍不正確。');
    }
    const db = await open();
    return new Promise((resolveRead, reject) => {
      const tx = db.transaction(store, 'readonly');
      const source = tx.objectStore(store).index(index);
      let keys;
      let values;
      let range;
      try { range = IDBKeyRange.only(key); } catch { reject(failure('INVALID_QUERY', '查詢條件不正確。')); return; }
      const keysRequest = source.getAllKeys(range);
      keysRequest.onsuccess = () => { keys = keysRequest.result; };
      const valuesRequest = source.getAll(range);
      valuesRequest.onsuccess = () => { values = valuesRequest.result; };
      tx.oncomplete = () => resolveRead(Object.fromEntries(keys.map((primary, i) => [primary, values[i]])));
      tx.onabort = () => reject(storageFailure(tx.error));
      tx.onerror = () => {};
    });
  }

  function readStore(tx, store, done) {
    const keysRequest = tx.objectStore(store).getAllKeys();
    keysRequest.onsuccess = () => {
      const valuesRequest = tx.objectStore(store).getAll();
      valuesRequest.onsuccess = () => {
        const values = {};
        keysRequest.result.forEach((key, i) => { values[key] = valuesRequest.result[i]; });
        done(values);
      };
    };
  }

  /**
   * 整組替換學習群組：同交易保存目前資料為還原點（最多 3 份）、換新 epoch、寫入新列。
   * payload 為 { stats, progress, learning } 或 { restorePointKey }；驗證失敗整組不寫。
   * 舊 epoch 的收據與 outbox 一併清除，舊頁晚到的寫入會被 STALE_EPOCH 擋下。
   */
  async function restoreLearning(input, { reason = 'restore' } = {}) {
    requireCrypto();
    const maxBytes = 24 * 1024 * 1024;
    const operation = JSON.parse(canonicalJson(input, { maxBytes }));
    const payload = operation.payload || {};
    let incoming = null;
    if (!Object.prototype.hasOwnProperty.call(payload, 'restorePointKey')) {
      incoming = rowsFromPortable(payload);
    } else if (typeof payload.restorePointKey !== 'string' || !payload.restorePointKey.startsWith('rp:')) {
      throw failure('INVALID_OPERATION', '找不到指定的還原點。');
    }
    const payloadBytes = new TextEncoder().encode(canonicalJson(payload, { maxBytes }));
    const digest = await cryptoApi.subtle.digest('SHA-256', payloadBytes);
    const payloadHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const db = await open();
    return new Promise((resolveWrite, reject) => {
      const tx = db.transaction(['meta', ...COLLECTIONS], 'readwrite');
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
              const current = {};
              let pending = PORTABLE_STORES.length + 1;
              const finish = () => {
                if (--pending > 0) return;
                try { write(meta, current); } catch (error) { abort(error); }
              };
              for (const store of PORTABLE_STORES) readStore(tx, store, (values) => { current[store] = values; finish(); });
              readStore(tx, 'restorePoints', (values) => { current.restorePoints = values; finish(); });
            } catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      };
      function write(meta, current) {
        let rows = incoming;
        let nextTimeZone = payload.learning?.meta?.timeZone;
        let historyStartedAt = payload.learning?.meta?.historyStartedAt;
        if (!rows) {
          const point = current.restorePoints[payload.restorePointKey];
          if (!point?.data) throw failure('INVALID_OPERATION', '找不到指定的還原點。');
          rows = rowsFromPortable(point.data);
          nextTimeZone = point.data.learning.meta.timeZone;
          historyStartedAt = point.data.learning.meta.historyStartedAt;
        }
        const createdAt = now();
        const snapshot = portableFromRows(current, meta);
        for (const store of COLLECTIONS) {
          if (store !== 'restorePoints') tx.objectStore(store).clear();
        }
        for (const [store, values] of Object.entries(rows)) {
          const target = tx.objectStore(store);
          for (const [key, value] of Object.entries(values)) target.put(value, key);
        }
        const pointKey = `rp:${String(createdAt).padStart(16, '0')}:${epoch().slice(0, 8)}`;
        tx.objectStore('restorePoints').put({ createdAt, reason, data: snapshot }, pointKey);
        const kept = Object.keys(current.restorePoints).sort().reverse();
        for (const key of kept.slice(2)) tx.objectStore('restorePoints').delete(key);
        const next = { ...meta, revision: meta.revision + 1, dataEpoch: epoch(), migrationStatus: 'complete',
          timeZone: nextTimeZone ?? meta.timeZone, historyStartedAt: historyStartedAt ?? meta.historyStartedAt };
        validateMeta(next);
        tx.objectStore('meta').put(next, 'current');
        result = { revision: next.revision, dataEpoch: next.dataEpoch, restorePointKey: pointKey };
        if (beforeCommit) {
          const hook = beforeCommit();
          if (hook && typeof hook.then === 'function') throw new Error('beforeCommit must be synchronous');
        }
      }
    });
  }

  return {
    ready, get, list, readAll, querySnapshot, getAllByIndex, migrateFromLegacy, restoreLearning,
    commit: (operation, options) => transact(operation, false, options),
    clearLearning: (operation) => transact(operation, true),
    close() {
      if (connection) connection.close();
      connection = undefined;
      opening = undefined;
    },
  };
}
