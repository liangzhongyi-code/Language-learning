/**
 * 學習儲存的就緒屏障畫面。資料就緒前只顯示載入狀態、不啟動任何寫入；
 * 失敗時給重試與救援選項，不拿空白預設值繼續覆寫原有紀錄。
 */
import { getLearningStore, storageMessage } from './platform/learning-store.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LEGACY_KEYS = ['lang-learn.stats.v1', 'lang-learn.progress.v1'];

/**
 * 把舊 localStorage 原文原樣下載，供遷移失敗時自行保存；不解析、不修改。
 */
function downloadLegacy() {
  const raw = {};
  try {
    for (const key of LEGACY_KEYS) raw[key] = window.localStorage.getItem(key);
  } catch { /* 讀不到就下載空內容並在畫面上說明 */ }
  const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'lang-learn-舊紀錄原始檔.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * 等待學習儲存就緒後呼叫 onReady(store)。mount 會先顯示載入中；
 * onSkip 存在時提供「先練習但不保存」，由呼叫端決定能否在不寫入的情況下使用。
 */
export async function awaitLearningStore(mount, onReady, { onSkip } = {}) {
  const store = getLearningStore();
  const attempt = async () => {
    if (mount) mount.innerHTML = '<p class="hint" role="status" aria-live="polite">正在讀取學習紀錄…</p>';
    try {
      await store.ready();
    } catch (error) {
      renderFailure(error);
      return;
    }
    await onReady(store);
  };
  function renderFailure(error) {
    if (!mount) return;
    const migration = error?.code === 'MIGRATION_INVALID';
    mount.innerHTML = `
      <div class="notice" role="alert">
        <b>學習紀錄目前無法讀取，沒有寫入任何資料。</b>
        <p>${esc(storageMessage(error))}</p>
        <div class="actions">
          <button class="btn sm" type="button" data-gate-retry>重試</button>
          ${migration ? '<button class="btn ghost sm" type="button" data-gate-download>下載舊紀錄原始檔</button>' : ''}
          ${migration ? '<button class="btn ghost sm" type="button" data-gate-fresh>保留舊資料不動，以空白紀錄開始</button>' : ''}
          ${onSkip ? '<button class="btn ghost sm" type="button" data-gate-skip>先練習（這次不保存）</button>' : ''}
        </div>
      </div>`;
    mount.querySelector('[data-gate-retry]').addEventListener('click', attempt);
    mount.querySelector('[data-gate-download]')?.addEventListener('click', downloadLegacy);
    mount.querySelector('[data-gate-fresh]')?.addEventListener('click', async () => {
      if (!window.confirm('舊紀錄會原樣留在瀏覽器裡（建議先下載原始檔），網站改用空白紀錄開始。確定嗎？')) return;
      try {
        await store.startFresh();
        await attempt();
      } catch (failure) { renderFailure(failure); }
    });
    mount.querySelector('[data-gate-skip]')?.addEventListener('click', () => onSkip());
    mount.querySelector('[data-gate-retry]').focus();
  }
  await attempt();
  return store;
}
