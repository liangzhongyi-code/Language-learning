/**
 * 同網域帳號與快照操作。登入只用普通連結；還原交由既有備份面板。
 */
import { createCloudApi } from './platform/cloud-api.js';
import { createCloudBaseline } from './platform/cloud-baseline.js';
import { createCloudSyncRunner } from './platform/cloud-sync-runner.js';
import { getLearningStore } from './platform/learning-store.js';

const authErrors = Object.freeze({
  DENIED: '你取消了 Google 授權，可以重新登入。',
  NOT_ALLOWED: '此帳號尚未開放雲端同步。',
  STATE_INVALID: '登入連結已失效，請重新登入。',
  EXCHANGE_FAILED: '登入未完成，請重試。',
});

export function cloudLoginHref({ pathname, search }) {
  return '/api/auth/start?returnTo=' + encodeURIComponent(pathname + search);
}

export function consumeCloudError(location, history) {
  if (!location.hash.startsWith('#cloud-error=')) return '';
  const code = location.hash.slice('#cloud-error='.length);
  history.replaceState(history.state, '', location.pathname + location.search);
  return Object.prototype.hasOwnProperty.call(authErrors, code) ? authErrors[code] : authErrors.EXCHANGE_FAILED;
}

const states = Object.freeze({
  idle: ['正在確認同步狀態…'],
  checking: ['正在確認同步狀態…'],
  synced: ['已同步'],
  pending: ['有變更待同步'],
  uploading: ['正在上傳學習紀錄…'],
  unsynced: ['尚未同步，稍後會自動再試。'],
  'cloud-newer': ['其他裝置有較新的紀錄。', 'cloud'],
  'cloud-available': ['雲端有學習紀錄。', 'cloud'],
  conflict: ['有衝突待處理。', 'cloud', 'local', 'later'],
  'ask-replace': ['也要用這台目前的紀錄更新雲端嗎？', 'yes', 'no'],
  'too-large': ['紀錄太大，無法同步；請改用備份檔。'],
  reauth: ['需要重新登入；本機紀錄仍保留。', 'login'],
  paused: ['雲端與本機不同步。', 'cloud', 'local'],
  applying: ['請確認或取消雲端紀錄預覽。'],
});

export function presentSyncState(state) {
  const [text, ...actions] = Object.prototype.hasOwnProperty.call(states, state.status)
    ? states[state.status] : [''];
  if (state.reason === 'account-changed') return { text: '此分頁的帳號已變更，請重新整理後繼續。', actions: ['reload'] };
  return { text: state.reason === 'forbidden' ? '此帳號尚未開放雲端同步。' : text,
    actions: state.deferred ? actions.filter((action) => action !== 'later') : actions };
}

let backupPanel = null;
export function attachCloudBackup(panel) { backupPanel = panel; }

const labels = {
  cloud: '用雲端的', local: '用這台的', later: '稍後再說',
  yes: '更新雲端', no: '先不要更新',
  reload: '重新整理',
};

/**
 * 只由通過網址閘門的導覽呼叫。失敗時保留本機學習功能。
 */
export async function mountCloudView(host, { root = './', api = createCloudApi(), store, baseline } = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const make = (tag, text, className) => {
    const el = doc.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const login = () => {
    const a = make('a', '用 Google 登入同步', 'btn ghost sm');
    a.href = cloudLoginHref(win.location);
    a.dataset.cloudLogin = '';
    return a;
  };
  const authNote = consumeCloudError(win.location, win.history);
  let account;
  try { account = await api.me(); } catch (error) {
    const retry = make('button', '再試一次', 'btn ghost sm');
    retry.type = 'button';
    const resume = () => {
      win.removeEventListener('online', resume);
      retry.disabled = true;
      void mountCloudView(host, { root, api, store, baseline }).catch(() => {
        host.textContent = '雲端暫時無法使用；仍可在本機學習。';
      });
    };
    retry.addEventListener('click', resume, { once: true });
    if (['NETWORK', 'SERVER', 'TIMEOUT'].includes(error?.code)) {
      win.addEventListener('online', resume, { once: true });
    }
    host.replaceChildren(login(), make('span', authNote || error?.message || '無法確認雲端登入狀態。'), retry);
    return;
  }
  if (!account) {
    host.replaceChildren(login());
    if (authNote) {
      const note = make('span', authNote);
      note.setAttribute('role', 'status');
      host.append(note);
    }
    return;
  }
  const cloudBaseline = baseline ?? createCloudBaseline();
  const learningStore = store ?? getLearningStore();
  const runner = createCloudSyncRunner({ api, store: learningStore, baseline: cloudBaseline,
    accountId: account.accountId, exportBackup: async () => {
      const { portablePrefs } = await import('./learning-backup-view.js');
      return learningStore.exportBackup({ prefs: portablePrefs() });
    } });
  const menu = make('details', '', 'cloud-menu');
  const summary = make('summary', '雲端同步');
  const panel = make('div', '', 'cloud-menu-panel card');
  const email = make('p', account.email);
  const note = make('p', authNote);
  const status = make('p');
  const choices = make('div', '', 'backup-actions');
  const controls = make('div', '', 'backup-actions');
  status.dataset.cloudStatus = '';
  status.setAttribute('role', 'status');
  note.setAttribute('role', 'status');
  menu.append(summary, panel);
  panel.append(email, status, note, choices, controls);
  const privacy = make('a', '隱私權說明', 'btn ghost sm');
  privacy.href = root + 'privacy.html';
  controls.append(privacy);
  if (account.role === 'owner' || account.role === 'admin') {
    const admin = make('a', '成員管理', 'btn ghost sm');
    admin.href = root + 'admin.html';
    controls.append(admin);
  }
  let busy = false;
  let ended = false;
  const setNote = (value) => { note.textContent = value; };
  const run = async (action) => {
    if (busy || ended) return;
    busy = true;
    setNote('');
    try { await action(); }
    catch (error) { setNote(error?.message || '無法完成雲端操作，請稍後再試。'); }
    finally { busy = false; }
  };
  function button(text, action, key) {
    const el = make('button', text, 'btn ghost sm');
    el.type = 'button';
    el.dataset.cloudAction = key;
    el.addEventListener('click', () => { void run(action); });
    return el;
  }
  async function finish(deleteAccount) {
    const prompt = deleteAccount
      ? '要刪除這個帳號在本站的雲端資料嗎？本機紀錄不會刪除。'
      : '要登出並停止自動同步嗎？本機紀錄會保留。';
    if (!win.confirm(prompt)) return;
    runner.stop();
    backupPanel?.dismissPreview('cloud');
    try {
      if (deleteAccount) await api.deleteAccount();
      else await api.logout();
    } catch (error) {
      if (deleteAccount || error?.code !== 'UNAUTHENTICATED') {
        throw new Error((error?.message || '操作未完成。') + ' 自動同步已停止；你可以重試，或重新整理後恢復。');
      }
    }
    ended = true;
    if (deleteAccount) cloudBaseline.clear(account.accountId);
    const result = make('span', deleteAccount ? '已刪除雲端資料。' : '已登出。');
    result.setAttribute('role', 'status');
    host.replaceChildren(login(), result);
  }
  controls.append(button('登出', () => finish(false), 'logout'),
    button('刪除我的雲端資料', () => finish(true), 'delete'));
  const actionFor = {
    async cloud() {
      if (!backupPanel) { win.location.assign(root + 'index.html#cloud-sync'); return; }
      let revision;
      const ready = await backupPanel.previewFrom(async () => {
        const result = await runner.downloadCloud();
        revision = result.revision;
        return result.text;
      }, 'cloud', {
        beforeConfirm: async () => {
          const current = await api.meta();
          if (current.revision !== revision) {
            throw Object.assign(new Error('雲端紀錄已更新，請重新預覽。'), { code: 'STALE_PREVIEW' });
          }
        },
        onApplied: (meta) => runner.recordCloudApplied({ ...meta, cloudRevision: revision }),
        onDismiss: () => { void runner.cancelCloudApply(); },
      });
      if (!ready) await runner.cancelCloudApply();
      doc.getElementById('backup')?.scrollIntoView({ block: 'start' });
      doc.querySelector('#backup [data-confirm]')?.focus();
    },
    async local() {
      if (win.confirm('要用這台目前的學習紀錄取代雲端紀錄嗎？')) await runner.resolveConflict('local');
    },
    later: () => runner.resolveConflict('later'),
    yes: () => runner.answerReplace(true),
    no: () => runner.answerReplace(false),
    reload: () => win.location.reload(),
  };
  host.replaceChildren(menu);
  if (win.location.hash === '#cloud-sync') menu.open = true;
  runner.subscribe((state) => {
    const display = presentSyncState(state);
    status.textContent = display.text;
    summary.textContent = display.text && state.status === 'synced' ? '雲端：已同步' : '雲端同步';
    if (state.status === 'reauth') backupPanel?.dismissPreview('cloud');
    choices.replaceChildren(...display.actions.map((key) => key === 'login' ? login() : button(labels[key], actionFor[key], key)));
  });
  await runner.start();
}
