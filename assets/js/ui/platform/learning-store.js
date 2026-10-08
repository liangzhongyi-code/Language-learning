/**
 * 頁面使用的學習資料入口：就緒屏障、舊資料遷移、一致快照讀取與交易提交。
 * 所有學習寫入都經過這裡；偏好仍由 prefs.js 存 localStorage，不宣稱跨儲存原子性。
 */
import { createWebRepository, normalizeSnapshotQuery } from './web-repository.js';
import { applySession } from '../../core/stats.js';
import { recordSession } from '../../core/progress.js';
import { projectLearningProgress } from '../../core/learning-progress.js';
import { PORTABLE_STORES, portableFromRows } from '../../core/learning-snapshot.js';
import { exportLearningBackup } from '../../core/learning-backup.js';
import { isStudyTimeZone } from '../../core/study-zone.js';

/**
 * 只在第一次建立資料庫時採用裝置時區；之後固定使用 meta 內保存的學習時區。
 */
export function deviceTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isStudyTimeZone(zone)) return zone;
  } catch { /* 取不到裝置時區時用預設值 */ }
  return 'Asia/Taipei';
}

/**
 * 安全的交易 ID：前綴＋時間＋隨機碼，只含 learning-operations 接受的字元。
 */
export function newOperationId(prefix, now = Date.now(), cryptoApi = globalThis.crypto) {
  const bytes = new Uint8Array(6);
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const random = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${now.toString(36)}-${random}`;
}

/**
 * 錯誤碼轉成給使用者看的繁中說明；未知錯誤不顯示原始例外內容。
 */
export function storageMessage(error) {
  const known = {
    STORAGE_UNAVAILABLE: '這個瀏覽器無法提供本機學習儲存（可能是無痕模式或停用了網站資料）。',
    STORAGE_BLOCKED: '其他分頁正在使用舊版資料，請關閉其他分頁後重試。',
    STORAGE_QUOTA: '裝置空間不足，這次沒有保存，請先匯出備份。',
    UNSUPPORTED_SCHEMA: '學習資料由較新版程式建立或結構不正確，已停止寫入，請更新網頁，不要清除紀錄。',
    UNSUPPORTED_VERSION: '學習資料由較新版程式建立，請更新網頁，不要清除紀錄。',
    MIGRATION_INVALID: '舊版學習紀錄格式損壞，無法自動搬移；原資料仍保留在瀏覽器中。',
    MIGRATION_UNAVAILABLE: '無法讀取舊版學習紀錄，請允許網站儲存資料後重試。',
    REVISION_CONFLICT: '其他分頁剛更新了紀錄，請重試。',
    STALE_EPOCH: '紀錄已在其他分頁清除或還原，請重新整理頁面。',
  };
  return Object.prototype.hasOwnProperty.call(known, error?.code)
    ? known[error.code] : '紀錄保存未完成，原資料保持不變；請重試。';
}

/**
 * repository 與時間、舊來源皆可注入，供 Node 假 repository 與真瀏覽器共用同一份邏輯。
 */
export function createLearningStore({ repository, legacyStorage, now = Date.now }) {
  let readyPromise = null;
  const listeners = new Set();

  /**
   * 遷移只做一次；之後每次呼叫都重讀 meta，revision／epoch 不會停在第一次的快照。
   */
  async function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const meta = await repository.ready();
        if (meta.migrationStatus !== 'pending') return meta;
        return repository.migrateFromLegacy(legacyStorage);
      })();
      readyPromise.catch(() => { readyPromise = null; });
    }
    await readyPromise;
    return repository.ready();
  }

  async function read(stores) {
    await ready();
    return repository.readAll(stores);
  }

  async function querySnapshot(input) {
    const query = normalizeSnapshotQuery(input);
    await ready();
    return repository.querySnapshot(query);
  }

  /**
   * build(rows, meta) 回傳 changes；遇到其他分頁先寫入（REVISION_CONFLICT）時重讀重算。
   * 同一 operationId 在衝突重試間沿用：衝突代表前一次沒有落盤，不會產生重複收據。
   * query 為 bounded selector map；未指定時保留 stores/readAll，不能與自訂 load 併用。
   */
  async function commit({ stores, query: input, operationId, build, load, large = false }) {
    const query = input === undefined ? undefined : normalizeSnapshotQuery(input);
    if (query && load) throw Object.assign(new Error('查詢快照與自訂 load 不可同時指定。'), { code: 'INVALID_QUERY' });
    await ready();
    let operationEpoch;
    for (let attempt = 0; ; attempt++) {
      /**
       * 自訂 load 必須先取 meta 再讀資料：之後任何其他寫入都會提高 revision，
       * 提交時以 REVISION_CONFLICT 被擋下並重算，不會基於過期資料寫入。
       */
      const { meta, rows } = load
        ? await (async () => { const fresh = await repository.ready(); return { meta: fresh, rows: await load(repository, fresh) }; })()
        : query ? await repository.querySnapshot(query) : await repository.readAll(stores);
      /**
       * 同一操作的衝突重試只能沿用原 epoch；清除／還原發生在重讀前也不能復活舊意圖。
       */
      if (operationEpoch === undefined) operationEpoch = meta.dataEpoch;
      else if (meta.dataEpoch !== operationEpoch) {
        throw Object.assign(new Error('紀錄已在其他分頁清除或還原，請重新整理頁面。'), { code: 'STALE_EPOCH' });
      }
      const built = build(rows, meta);
      const changes = Array.isArray(built) ? built : built?.changes;
      if (!changes || !changes.length) return { revision: meta.revision, unchanged: true, value: built?.value };
      try {
        const result = await repository.commit({ operationId, epoch: meta.dataEpoch,
          expectedRevision: meta.revision, payload: { changes } }, { large });
        for (const listener of listeners) listener(result);
        return { ...result, value: built?.value };
      } catch (error) {
        if (error?.code !== 'REVISION_CONFLICT' || attempt >= 3) throw error;
      }
    }
  }

  /**
   * 舊版整局測驗入帳：統計加一局、逐題 Leitner 摘要，只寫被這局碰到的 key。
   */
  function recordQuizSession({ lang, source, session, summary, operationId, at = now() }) {
    return commit({
      stores: ['stats', 'progress'], operationId,
      build(rows) {
        const stats = applySession({ schemaVersion: 1, byScope: rows.stats }, lang, source, summary);
        const scope = `${lang}:${source}`;
        const changes = [{ store: 'stats', key: scope, value: stats.byScope[scope] }];
        const progress = recordSession({ schemaVersion: 1, items: rows.progress }, session, at);
        const touched = new Set((session.questions || []).map((q) => q?.sourceId).filter(Boolean));
        for (const id of touched) if (progress.items[id]) changes.push({ store: 'progress', key: id, value: progress.items[id] });
        return changes;
      },
    });
  }

  /**
   * 首頁與測驗設定的瞬時 v1 相容視圖；lang 限 ja/en，只查該語言三集合。
   * 無參數保留既有全語言測試 API；ready 遷移屏障與 FSRS 投影兩條路徑一致。
   * FSRS 的畢業／due 共用純投影，不回寫摘要，也不加入逐題提交路徑。
   */
  async function legacyView(lang) {
    if (lang !== undefined && !['ja', 'en'].includes(lang)) {
      throw Object.assign(new Error('不支援的學習語言。'), { code: 'INVALID_QUERY' });
    }
    const { meta, rows } = lang === undefined ? await read(['stats', 'progress', 'itemStates'])
      : await querySnapshot({ stats: { prefix: `${lang}:` }, progress: { prefix: `${lang}-` }, itemStates: { prefix: `${lang}-` } });
    return { meta, stats: { schemaVersion: 1, byScope: rows.stats },
      progress: projectLearningProgress({ progress: { schemaVersion: 1, items: rows.progress }, itemStates: rows.itemStates }) };
  }

  /**
   * 舊資料無法遷移時的退路：不讀也不刪舊 localStorage，改以空白紀錄開始。
   * 清除標記會擋住日後重新遷移，舊 key 仍留在瀏覽器可供手動救援。
   */
  async function startFresh() {
    const meta = await repository.ready();
    const result = await repository.clearLearning({ operationId: newOperationId('fresh', now()),
      epoch: meta.dataEpoch, expectedRevision: meta.revision });
    readyPromise = null;
    return result;
  }

  async function clearAll() {
    const meta = await ready();
    const fresh = await repository.ready();
    const result = await repository.clearLearning({ operationId: newOperationId('clear', now()),
      epoch: fresh.dataEpoch, expectedRevision: fresh.revision });
    for (const listener of listeners) listener(result);
    return { ...result, previousEpoch: meta.dataEpoch };
  }

  /**
   * 完整 v2 備份：一次唯讀交易取得所有可攜集合，驗證後才產生；偏好另由呼叫端附上。
   */
  async function exportBackup({ prefs } = {}) {
    const { meta, rows } = await read([...PORTABLE_STORES]);
    const data = portableFromRows(rows, meta);
    if (prefs && Object.keys(prefs).length) data.prefs = prefs;
    return exportLearningBackup(data, now());
  }

  async function restorePoints() {
    await ready();
    const rows = await repository.list('restorePoints', { limit: 10 });
    return rows.map(({ key, value }) => ({ key, createdAt: value.createdAt, reason: value.reason,
      counts: { progress: Object.keys(value.data?.progress?.items || {}).length,
        events: Object.keys(value.data?.learning?.reviewEvents || {}).length } }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async function revertToRestorePoint(restorePointKey) {
    const meta = await repository.ready();
    const result = await repository.restoreLearning({ operationId: newOperationId('revert', now()),
      epoch: meta.dataEpoch, expectedRevision: meta.revision, payload: { restorePointKey } }, { reason: 'before-revert' });
    for (const listener of listeners) listener(result);
    return result;
  }

  return {
    repository, ready, read, querySnapshot, commit, legacyView, recordQuizSession, clearAll, startFresh, exportBackup,
    restorePoints, revertToRestorePoint, now,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

let shared = null;

/**
 * 網站頁面共用的單例；第一次呼叫才開資料庫，靜態頁面不在模組載入時就寫入。
 */
export function getLearningStore() {
  if (!shared) {
    let legacyStorage;
    try { legacyStorage = window.localStorage; } catch { legacyStorage = undefined; }
    shared = createLearningStore({
      repository: createWebRepository({ timeZone: deviceTimeZone() }),
      legacyStorage,
    });
  }
  return shared;
}
