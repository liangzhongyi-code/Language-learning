/**
 * 學習紀錄雲端同步的判斷邏輯（純函式，不碰任何瀏覽器全域）。
 *
 * 輸入本機 meta、這台裝置對該帳號的同步基準、雲端 meta，輸出下一步動作；
 * 真正的上傳、下載、計時與鎖都由 ui/platform/cloud-sync-runner.js 負責。
 * 規則對應 openspec/changes/add-cloud-sync/specs/cloud-sync.md 的 C01～C10、C14。
 */

/**
 * decide() 可能回傳的全部動作。
 * upload：以 ifMatch 為基準上傳本機快照。
 * offer-cloud：提示套用雲端（reason 區分新裝置與雲端較新）。
 * conflict：兩邊都有變更，交給使用者選擇。
 * ask-replace：本機整組替換後，詢問是否用目前資料更新雲端（C08）。
 * confirm-upload：結果不明的上傳其實已成功（C10）。
 * paused：自動上傳已暫停。
 * none：無事可做。
 */
export const SYNC_ACTIONS = Object.freeze(['upload', 'offer-cloud', 'conflict', 'ask-replace', 'confirm-upload', 'paused', 'none']);

const ORIGINS = new Set(['upload', 'cloud']);
const isRevision = (value) => Number.isSafeInteger(value) && value >= 0;
const isEpoch = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_SYNC_INPUT' });
}

/**
 * 同步基準只有在欄位齊全、型別正確且屬於目前帳號時才採用；其餘一律當作沒有基準（C14）。
 */
function usableBaseline(baseline, accountId) {
  if (!isObject(baseline)) return null;
  if (baseline.accountId !== undefined && baseline.accountId !== accountId) return null;
  if (!isRevision(baseline.cloudRevision) || !isRevision(baseline.localRevision) || !isEpoch(baseline.localEpoch)) return null;
  if (baseline.origin !== undefined && !ORIGINS.has(baseline.origin)) return null;
  return baseline;
}

/**
 * 沒有可用基準時的第一次同步規則（C01～C03）。
 */
function firstSync(local, cloud) {
  if (cloud.revision === 0) {
    return local.empty ? { action: 'none', reason: 'both-empty' } : { action: 'upload', reason: 'first-upload', ifMatch: 0 };
  }
  return local.empty ? { action: 'offer-cloud', reason: 'new-device' } : { action: 'conflict', reason: 'first-login' };
}

/**
 * 依本機、同步基準與雲端 meta 決定下一步。
 *
 * 參數：
 * - accountId：目前登入的帳號 ID（伺服器的 users.id）；空值代表未登入。
 * - local：{ revision, dataEpoch, empty }，empty 表示本機學習群組沒有使用者資料。
 * - baseline：此帳號的同步基準 { accountId?, cloudRevision, localRevision, localEpoch, origin, paused }，可為 null。
 * - cloud：{ revision, uploadId }，沒有快照時 revision 為 0。
 * - paused：呼叫端額外要求暫停（選用）。
 * - pendingUpload：結果不明的上傳 { uploadId, ifMatch }（選用，C10）。
 *
 * 回傳 { action, reason, ifMatch?, cloudRevision? }；只有 upload 會帶 ifMatch。
 * 輸入格式錯誤時丟出 code 為 INVALID_SYNC_INPUT 的錯誤，不猜測動作。
 */
export function decide({ accountId, local, baseline = null, cloud, paused = false, pendingUpload = null } = {}) {
  if (typeof accountId !== 'string' || !accountId) return { action: 'none', reason: 'no-account' };
  if (!isObject(local) || !isRevision(local.revision) || !isEpoch(local.dataEpoch)) {
    throw invalid('本機學習資料的版本資訊不合法。');
  }
  if (!isObject(cloud) || !isRevision(cloud.revision)) throw invalid('雲端版本資訊不合法。');
  const current = { revision: local.revision, dataEpoch: local.dataEpoch, empty: local.empty === true };

  /**
   * C10：上一次上傳沒收到回應。雲端剛好前進一版且 uploadId 相符，就是這台送出的那一份。
   */
  if (isObject(pendingUpload) && isRevision(pendingUpload.ifMatch) && typeof pendingUpload.uploadId === 'string'
      && pendingUpload.uploadId && cloud.revision === pendingUpload.ifMatch + 1 && cloud.uploadId === pendingUpload.uploadId) {
    return { action: 'confirm-upload', reason: 'upload-confirmed', cloudRevision: cloud.revision };
  }

  const known = usableBaseline(baseline, accountId);
  if (paused === true || known?.paused === true) return { action: 'paused', reason: 'paused' };

  /**
   * 雲端比基準還舊，代表雲端資料已被刪除或重建；基準作廢，回到第一次同步的規則。
   */
  if (!known || cloud.revision < known.cloudRevision) return firstSync(current, cloud);

  const cloudNewer = cloud.revision > known.cloudRevision;
  /**
   * 整組替換只看 dataEpoch：套用雲端後 runner 會立刻把新 epoch 記進基準（origin 為 cloud），
   * 因此雲端造成的替換在這裡 epoch 相同，不會被誤判成 C08。
   */
  if (current.dataEpoch !== known.localEpoch) {
    return cloudNewer ? { action: 'conflict', reason: 'replaced-and-cloud-newer' } : { action: 'ask-replace', reason: 'local-replaced' };
  }
  const localChanged = current.revision > known.localRevision;
  if (cloudNewer) return localChanged ? { action: 'conflict', reason: 'both-changed' } : { action: 'offer-cloud', reason: 'cloud-newer' };
  if (localChanged) return { action: 'upload', reason: 'local-changed', ifMatch: known.cloudRevision };
  return { action: 'none', reason: 'in-sync' };
}

/**
 * 判斷本機學習群組是否沒有任何使用者資料（C02 的「本機是空的」）。
 * rows 是 learning-store read() 回傳的集合；預設的空收藏簿、成就政策列與提醒預設都不算資料。
 */
export function isLearningEmpty(rows) {
  const take = (store) => (isObject(rows) && isObject(rows[store]) ? rows[store] : {});
  for (const store of ['stats', 'progress', 'itemStates', 'reviewEvents', 'dailyPlans', 'dailyLedger', 'sessions', 'notes', 'intents']) {
    if (Object.keys(take(store)).length) return false;
  }
  for (const [key, book] of Object.entries(take('books'))) {
    if (key !== 'favorites') return false;
    if (Array.isArray(book?.wordIds) && book.wordIds.length) return false;
  }
  return Object.keys(take('achievements')).every((key) => key === 'policy');
}
