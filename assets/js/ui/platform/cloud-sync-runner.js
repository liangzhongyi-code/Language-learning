/**
 * 雲端同步執行器：依 core/cloud-sync.decide() 的結果自動上傳，或把需要使用者決定的狀態交給畫面。
 *
 * - 開頁或回到頁面時檢查；本機變更 10 秒防抖，頁面隱藏時立刻上傳（C04）。
 * - 上傳內容是完整 v2 備份 JSON 經 gzip 串流壓縮，超過 8 MiB 立即停止且不重試（C11）。
 * - 失敗以 30 秒、1 分、2 分、5 分退避，之後每 5 分鐘；恢復連線或回到頁面立即再試（C09）。
 * - 上傳沒收到回應時，下一次先查 meta 確認是否其實已成功（C10）。
 * - 以 Web Locks 確保同一時間只有一個分頁在檢查與上傳（C15）。
 * - 時鐘、API、locks、頁面生命週期、壓縮與匯出全部可注入，供 node:test 驗證。
 *
 * 套用雲端紀錄一律由畫面走 previewFrom(readText, 'cloud')；本模組只負責下載文字與記錄套用後的同步基準。
 */
import { decide, isLearningEmpty } from '../../core/cloud-sync.js';
import { PORTABLE_STORES } from '../../core/learning-snapshot.js';
import { gzipText, SNAPSHOT_MAX_BYTES } from './cloud-api.js';

/**
 * 失敗後的重試間隔；用完後固定使用最後一個（每 5 分鐘）。
 */
export const RETRY_DELAYS_MS = Object.freeze([30000, 60000, 120000, 300000]);

/**
 * 本機最後一次寫入後等待多久才上傳。
 */
export const DEBOUNCE_MS = 10000;

/**
 * 跨分頁互斥用的 Web Lock 名稱。
 */
export const SYNC_LOCK_NAME = 'lang-learn.cloud-sync';

/**
 * 畫面可見的全部狀態：
 * idle 尚未啟動；checking 第一次檢查中；synced 已同步；pending 待上傳；uploading 上傳中；
 * unsynced 尚未同步（離線、逾時、5xx、429，已排重試）；cloud-newer 其他裝置有較新的紀錄（C05）；
 * cloud-available 雲端有紀錄、本機是空的（C02）；conflict 兩邊都有變更（C03、C06、409）；
 * ask-replace 本機整組替換後詢問是否更新雲端（C08）；too-large 紀錄太大（C11）；
 * reauth 需要重新登入（401；403 時 reason 為 forbidden）；paused 已暫停自動上傳；
 * applying 正在套用雲端紀錄；stopped 已停止（登出）。
 */
export const SYNC_STATUSES = Object.freeze(['idle', 'checking', 'synced', 'pending', 'uploading', 'unsynced', 'cloud-newer',
  'cloud-available', 'conflict', 'ask-replace', 'too-large', 'reauth', 'paused', 'applying', 'stopped']);

const isRevision = (value) => Number.isSafeInteger(value) && value >= 0;
const isEpoch = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;

const systemClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
});

function defaultLocks() {
  try {
    const locks = globalThis.navigator?.locks;
    return typeof locks?.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

function defaultUploadId() {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `u-${Date.now().toString(36)}-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 預設的頁面生命週期：visibilitychange 與 pagehide 判斷隱藏／回到頁面，online 判斷恢復連線。
 * 回傳解除監聽的函式；沒有 DOM 的環境直接略過。
 */
export function browserLifecycle({ visible, hidden, online }) {
  const doc = globalThis.document;
  const win = globalThis.window;
  if (!doc?.addEventListener || !win?.addEventListener) return () => {};
  const onVisibility = () => (doc.visibilityState === 'hidden' ? hidden() : visible());
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', hidden);
  win.addEventListener('online', online);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', hidden);
    win.removeEventListener('online', online);
  };
}

/**
 * 建立同步執行器。
 *
 * 必要依賴：
 * - api：cloud-api 的 { meta(), download(), upload(bytes, options) }。
 * - store：learning-store 的 { ready(), read(stores), onChange(listener) }。
 * - baseline：cloud-baseline 的 { get, set, update }。
 * - accountId：/api/me 回傳的帳號 ID。
 * - exportBackup：() => Promise<完整 v2 備份物件>（含可攜偏好，與首頁匯出相同）。
 *
 * 選用依賴：clock、locks（navigator.locks 介面）、lifecycle、compress、newUploadId、deviceLabel（字串或函式）、
 * isLocalEmpty、maxBytes、debounceMs、retryDelays、applyHoldMs。
 */
export function createCloudSyncRunner({
  api, store, baseline, accountId, exportBackup,
  clock = systemClock, locks = defaultLocks(), lifecycle = browserLifecycle, compress = gzipText,
  newUploadId = defaultUploadId, deviceLabel = '', isLocalEmpty,
  maxBytes = SNAPSHOT_MAX_BYTES, debounceMs = DEBOUNCE_MS, retryDelays = RETRY_DELAYS_MS, applyHoldMs = 10 * 60 * 1000,
} = {}) {
  if (typeof api?.meta !== 'function' || typeof api?.upload !== 'function' || typeof api?.download !== 'function'
      || typeof store?.ready !== 'function' || typeof store?.onChange !== 'function'
      || typeof baseline?.get !== 'function' || typeof baseline?.set !== 'function'
      || typeof exportBackup !== 'function' || typeof accountId !== 'string' || !accountId) {
    throw new TypeError('雲端同步執行器缺少必要的依賴。');
  }

  let state = Object.freeze({ status: 'idle', at: clock.now() });
  const listeners = new Set();
  let started = false;
  let stopped = false;
  let tail = Promise.resolve();
  let queuedCheck = null;
  let debounceTimer = null;
  let retryTimer = null;
  let holdTimer = null;
  let failures = 0;
  let notBefore = 0;
  let pendingUpload = null;
  let holding = false;
  let blocked = null;
  let knownEpoch = null;
  let lastDownloadRevision = null;
  let offStore = null;
  let detachLifecycle = null;

  function setState(next) {
    if (stopped && next.status !== 'stopped') return;
    state = Object.freeze({ ...next, at: clock.now() });
    for (const listener of [...listeners]) {
      try { listener({ ...state }); } catch { /* 畫面訂閱者的錯誤不影響同步 */ }
    }
  }

  function clearTimer(timer) {
    if (timer !== null) clock.clearTimeout(timer);
    return null;
  }

  function clearAllTimers() {
    debounceTimer = clearTimer(debounceTimer);
    retryTimer = clearTimer(retryTimer);
    holdTimer = clearTimer(holdTimer);
  }

  function scheduleDebounce() {
    if (stopped) return;
    debounceTimer = clearTimer(debounceTimer);
    debounceTimer = clock.setTimeout(() => { debounceTimer = null; check(); }, debounceMs);
  }

  function scheduleRetry(delay) {
    if (stopped) return;
    retryTimer = clearTimer(retryTimer);
    retryTimer = clock.setTimeout(() => { retryTimer = null; check(); }, Math.max(0, delay));
  }

  /**
   * 同一分頁內的工作一律排隊執行，避免同時發出兩個檢查或上傳。
   */
  function enqueue(task) {
    const run = tail.then(() => (stopped ? undefined : task()));
    tail = run.catch(() => {});
    return run;
  }

  /**
   * 跨分頁互斥：有 Web Locks 時在鎖內執行；沒有時只靠同分頁排隊。
   */
  function withLock(fn) {
    return locks ? locks.request(SYNC_LOCK_NAME, () => fn()) : fn();
  }

  async function localEmpty() {
    if (typeof isLocalEmpty === 'function') return isLocalEmpty();
    const { rows } = await store.read([...PORTABLE_STORES]);
    return isLearningEmpty(rows);
  }

  function label() {
    try { return typeof deviceLabel === 'function' ? String(deviceLabel() ?? '') : String(deviceLabel ?? ''); } catch { return ''; }
  }

  /**
   * 把 decide() 的非上傳結果轉成畫面狀態。
   */
  function applyDecision(decision, cloud) {
    const cloudRevision = cloud.revision;
    if (decision.action === 'none') {
      setState(debounceTimer !== null ? { status: 'pending', reason: 'local-changed', cloudRevision } : { status: 'synced', reason: decision.reason, cloudRevision });
    } else if (decision.action === 'offer-cloud') {
      setState({ status: decision.reason === 'new-device' ? 'cloud-available' : 'cloud-newer', reason: decision.reason, cloudRevision });
    } else if (decision.action === 'conflict') {
      const deferred = state.status === 'conflict' && state.deferred === true;
      setState({ status: 'conflict', reason: decision.reason, cloudRevision, deferred });
    } else if (decision.action === 'ask-replace') {
      setState({ status: 'ask-replace', reason: decision.reason, cloudRevision });
    } else {
      setState({ status: 'paused', reason: decision.reason, cloudRevision });
    }
  }

  /**
   * 匯出、壓縮並上傳。force 用於使用者明確選擇（C08 選是、用這台的），不再比對 epoch。
   * 回傳 'epoch-changed' 表示匯出期間本機被整組替換，需要重新判斷。
   */
  async function upload(ifMatch, local, force) {
    setState({ status: 'uploading', cloudRevision: ifMatch });
    const payload = await exportBackup();
    const exported = payload?.learning?.meta;
    const localRevision = isRevision(exported?.revision) ? exported.revision : local.revision;
    const localEpoch = isEpoch(exported?.dataEpoch) ? exported.dataEpoch : local.dataEpoch;
    if (!force && localEpoch !== local.dataEpoch) return 'epoch-changed';
    const bytes = await compress(JSON.stringify(payload), { maxBytes });
    const uploadId = newUploadId();
    pendingUpload = { uploadId, ifMatch, localRevision, localEpoch };
    let result;
    try {
      result = await api.upload(bytes, { ifMatch, uploadId, schemaVersion: isRevision(payload?.version) ? payload.version : 2, deviceLabel: label() });
    } catch (error) {
      if (!error?.outcomeUnknown) pendingUpload = null;
      throw error;
    }
    pendingUpload = null;
    baseline.set(accountId, { cloudRevision: result.revision, localRevision, localEpoch, origin: 'upload', paused: false });
    failures = 0;
    notBefore = 0;
    const after = await store.ready();
    knownEpoch = after.dataEpoch;
    if (after.dataEpoch === localEpoch && after.revision > localRevision) {
      scheduleDebounce();
      setState({ status: 'pending', reason: 'local-changed', cloudRevision: result.revision });
    } else {
      setState({ status: 'synced', reason: 'uploaded', cloudRevision: result.revision });
    }
    return 'done';
  }

  /**
   * 依錯誤碼決定狀態與是否重試；只有暫時性錯誤會排重試。
   */
  function handleError(error) {
    const code = typeof error?.code === 'string' ? error.code : 'ERROR';
    if (code === 'REVISION_MISMATCH') {
      pendingUpload = null;
      retryTimer = clearTimer(retryTimer);
      setState({ status: 'conflict', reason: 'revision-mismatch', cloudRevision: isRevision(error.current?.revision) ? error.current.revision : null, deferred: false });
      return;
    }
    if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') {
      blocked = 'reauth';
      clearAllTimers();
      setState({ status: 'reauth', reason: code === 'FORBIDDEN' ? 'forbidden' : 'unauthenticated' });
      return;
    }
    if (code === 'TOO_LARGE') {
      blocked = 'too-large';
      pendingUpload = null;
      debounceTimer = clearTimer(debounceTimer);
      retryTimer = clearTimer(retryTimer);
      setState({ status: 'too-large', reason: 'too-large', limitBytes: isRevision(error.limitBytes) ? error.limitBytes : maxBytes });
      return;
    }
    failures += 1;
    const backoff = retryDelays[Math.min(failures, retryDelays.length) - 1];
    const delay = code === 'RATE_LIMITED' && isRevision(error.retryAfterMs) ? error.retryAfterMs : backoff;
    if (code === 'RATE_LIMITED') notBefore = clock.now() + delay;
    debounceTimer = clearTimer(debounceTimer);
    scheduleRetry(delay);
    setState({ status: 'unsynced', reason: code, nextRetryAt: clock.now() + delay });
  }

  /**
   * 一次完整的檢查：查 meta、讀本機與基準、交給 decide()，必要時上傳。
   */
  async function runCheck() {
    if (stopped || holding || blocked) return;
    if (clock.now() < notBefore) { scheduleRetry(notBefore - clock.now()); return; }
    retryTimer = clearTimer(retryTimer);
    if (state.status === 'idle') setState({ status: 'checking' });
    try {
      await withLock(async () => {
        for (let round = 0; round < 3; round++) {
          if (stopped || holding) return;
          const cloud = await api.meta();
          const meta = await store.ready();
          knownEpoch = meta.dataEpoch;
          let known = baseline.get(accountId);
          const empty = !known || cloud.revision < known.cloudRevision ? await localEmpty() : false;
          const local = { revision: meta.revision, dataEpoch: meta.dataEpoch, empty };
          let decision = decide({ accountId, local, baseline: known, cloud, pendingUpload });
          if (decision.action === 'confirm-upload') {
            baseline.set(accountId, { cloudRevision: decision.cloudRevision, localRevision: pendingUpload.localRevision,
              localEpoch: pendingUpload.localEpoch, origin: 'upload', paused: false });
            pendingUpload = null;
            known = baseline.get(accountId);
            decision = decide({ accountId, local, baseline: known, cloud });
          }
          pendingUpload = null;
          if (decision.action === 'upload') {
            if (await upload(decision.ifMatch, local, false) === 'epoch-changed') continue;
          } else {
            applyDecision(decision, cloud);
          }
          break;
        }
      });
      failures = 0;
    } catch (error) {
      handleError(error);
    }
  }

  /**
   * 使用者明確要求的上傳（C08 選是、衝突時用這台的）；ifMatch 由 pickIfMatch 在鎖內決定。
   */
  function forcedUpload(pickIfMatch) {
    if (stopped) return Promise.resolve(getState());
    blocked = blocked === 'reauth' ? blocked : null;
    return enqueue(async () => {
      try {
        await withLock(async () => {
          const ifMatch = await pickIfMatch();
          const meta = await store.ready();
          knownEpoch = meta.dataEpoch;
          await upload(ifMatch, { revision: meta.revision, dataEpoch: meta.dataEpoch }, true);
        });
        failures = 0;
      } catch (error) {
        handleError(error);
      }
    }).then(() => getState());
  }

  function beginHold() {
    holding = true;
    debounceTimer = clearTimer(debounceTimer);
    retryTimer = clearTimer(retryTimer);
    holdTimer = clearTimer(holdTimer);
    holdTimer = clock.setTimeout(() => { holdTimer = null; holding = false; check(); }, applyHoldMs);
    setState({ status: 'applying', cloudRevision: state.cloudRevision ?? null });
  }

  function endHold() {
    holding = false;
    holdTimer = clearTimer(holdTimer);
  }

  function onLocalChange(change) {
    if (stopped || holding || blocked === 'reauth') return;
    const epochChanged = isEpoch(change?.dataEpoch) && knownEpoch !== null && change.dataEpoch !== knownEpoch;
    if (blocked === 'too-large') {
      if (epochChanged) { blocked = null; check(); }
      return;
    }
    if (epochChanged) {
      debounceTimer = clearTimer(debounceTimer);
      check();
      return;
    }
    if (state.status === 'unsynced') return;
    scheduleDebounce();
    if (state.status === 'synced') setState({ ...state, status: 'pending', reason: 'local-changed' });
  }

  const handlers = {
    visible() {
      if (stopped || holding || blocked) return;
      debounceTimer = clearTimer(debounceTimer);
      check();
    },
    hidden() {
      if (stopped || holding || blocked || debounceTimer === null) return;
      debounceTimer = clearTimer(debounceTimer);
      check();
    },
    online() {
      if (stopped || holding || blocked || state.status !== 'unsynced') return;
      check();
    },
  };

  /**
   * 排一次檢查；已有尚未開始的檢查就共用同一個。回傳完成後的狀態。
   */
  function check() {
    if (stopped) return Promise.resolve(getState());
    if (!queuedCheck) {
      queuedCheck = enqueue(() => { queuedCheck = null; return runCheck(); }).then(() => getState());
    }
    return queuedCheck;
  }

  function getState() {
    return { ...state };
  }

  return {
    /**
     * 開始同步：訂閱本機變更與頁面生命週期，並立刻檢查一次。回傳第一次檢查後的狀態。
     */
    start() {
      if (stopped) return Promise.resolve(getState());
      if (!started) {
        started = true;
        offStore = store.onChange(onLocalChange);
        detachLifecycle = lifecycle(handlers);
      }
      return check();
    },
    /**
     * 立刻檢查一次（例如畫面還原檔案或代碼之後）；被暫停、套用中或需要重新登入時不做事。
     */
    check,
    /**
     * 使用者要求再試：解除「太大」狀態後檢查一次。
     */
    retry() {
      if (blocked === 'too-large') blocked = null;
      notBefore = 0;
      return check();
    },
    /**
     * 停止同步（登出時）：清除計時器、解除監聽，之後不再發出任何請求或狀態。
     */
    stop() {
      if (stopped) return;
      clearAllTimers();
      try { offStore?.(); } catch { /* 已解除 */ }
      try { detachLifecycle?.(); } catch { /* 已解除 */ }
      setState({ status: 'stopped' });
      stopped = true;
      listeners.clear();
    },
    /**
     * 取得目前狀態的副本：{ status, reason?, cloudRevision?, nextRetryAt?, limitBytes?, deferred?, at }。
     */
    getState,
    /**
     * 訂閱狀態變化：立即以目前狀態呼叫一次，之後每次變化都呼叫；回傳取消訂閱的函式。
     */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      try { listener(getState()); } catch { /* 畫面訂閱者的錯誤不影響同步 */ }
      return () => listeners.delete(listener);
    },
    /**
     * 回答 C08 的詢問：true 以同步基準的雲端 revision 上傳目前資料；false 暫停自動上傳並記在基準。
     */
    async answerReplace(yes) {
      if (stopped) return getState();
      if (yes === true) {
        return forcedUpload(async () => {
          const known = baseline.get(accountId);
          return known ? known.cloudRevision : (await api.meta()).revision;
        });
      }
      baseline.update?.(accountId, { paused: true });
      debounceTimer = clearTimer(debounceTimer);
      setState({ status: 'paused', reason: 'declined-replace', cloudRevision: state.cloudRevision ?? null });
      return getState();
    },
    /**
     * 解決衝突或暫停：'local' 以目前雲端 revision 上傳這台的資料（覆蓋雲端）；
     * 'cloud' 進入套用中，畫面接著呼叫 downloadCloud() 走預覽與還原；'later' 維持衝突且不上傳。
     */
    async resolveConflict(choice) {
      if (stopped) return getState();
      if (choice === 'local') return forcedUpload(async () => (await api.meta()).revision);
      if (choice === 'cloud') { beginHold(); return getState(); }
      if (choice === 'later') {
        if (state.status === 'conflict') setState({ ...state, deferred: true });
        return getState();
      }
      throw new TypeError('未知的衝突選項。');
    },
    /**
     * 下載雲端快照：回傳 { text, revision }，text 交給 previewFrom 的 readText。
     * 呼叫後進入「套用中」，直到 recordCloudApplied() 或 cancelCloudApply()（最多 10 分鐘自動解除）。
     */
    async downloadCloud() {
      if (stopped) throw new TypeError('雲端同步已停止。');
      if (!holding) beginHold();
      try {
        const result = await api.download();
        lastDownloadRevision = result.revision;
        return result;
      } catch (error) {
        endHold();
        if (error?.code === 'UNAUTHENTICATED' || error?.code === 'FORBIDDEN') handleError(error);
        else check();
        throw error;
      }
    },
    /**
     * 套用雲端紀錄後記錄新的同步基準（origin 為 cloud），避免被誤判為整組替換（C08）。
     * revision、dataEpoch 是還原交易回傳的值；cloudRevision 省略時使用最近一次下載的雲端 revision。
     */
    recordCloudApplied({ revision, dataEpoch, cloudRevision = lastDownloadRevision } = {}) {
      if (!isRevision(revision) || !isEpoch(dataEpoch) || !isRevision(cloudRevision)) {
        return Promise.reject(new TypeError('套用雲端後的版本資訊不合法。'));
      }
      baseline.set(accountId, { cloudRevision, localRevision: revision, localEpoch: dataEpoch, origin: 'cloud', paused: false });
      pendingUpload = null;
      failures = 0;
      knownEpoch = dataEpoch;
      if (blocked === 'too-large') blocked = null;
      endHold();
      return check();
    },
    /**
     * 使用者取消套用雲端（或預覽失敗）：解除套用中並重新判斷；本機資料不變。
     */
    cancelCloudApply() {
      endHold();
      return check();
    },
    /**
     * 等目前排隊中的檢查與上傳全部結束（測試與畫面收尾用）。
     */
    async whenIdle() {
      for (;;) {
        const current = tail;
        await current;
        if (current === tail) return;
      }
    },
  };
}
