/**
 * 首頁「備份與還原」面板（v2 完整學習群組）。
 *
 * 帶走：下載檔案、複製代碼、系統分享；完整學習群組由一次唯讀交易取得，另帶可攜偏好。
 * 帶回：檔案、代碼（以及 Google 面板）共用同一個 restore controller——先深驗證、
 * 預覽內容與影響，確認還原學習群組時才以一次交易替換並保存還原點（最多三份）；
 * 偏好另行保存，純偏好還原不建立學習還原點。
 */
import { createRestoreController } from '../core/restore-controller.js';
import { encodeBackupCode, decodeBackupCode, codeSizeHint } from '../core/backup-code.js';
import { BACKUP_JSON_MAX_BYTES } from '../core/backup-limits.js';
import { FAVORITES_BOOK_ID } from '../core/library.js';
import { PORTABLE_STORES, REMINDER_KEY } from '../core/learning-snapshot.js';
import { normalizeAppearance } from '../core/appearance.js';
import { defaultFeedbackPrefs } from '../core/feedback-policy.js';
import { loadPrefs, savePrefs, migratePrefs, PREFS_IMPORTED_EVENT } from './prefs.js';
import { APPEARANCE_EVENT } from './appearance.js';
import { awaitLearningStore } from './storage-gate.js';
import { newOperationId, storageMessage } from './platform/learning-store.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const COUNT_LABEL = [
  ['stats', '測驗統計', '組'], ['progress', '逐題紀錄', '筆'], ['learning', '能力排程', '筆'],
  ['events', '作答歷程', '筆'], ['plans', '每日清單', '份'], ['books', '單字簿', '本'],
  ['notes', '筆記', '則'], ['prefs', '偏好設定', '項'], ['favorites', '收藏', '字'],
  ['intents', '學習意向', '筆'], ['changedPrefs', '自訂偏好', '項'], ['reminders', '提醒設定', '組'],
  ['sessions', '學習場次', '局'], ['ledger', '每日帳本', '份'],
  ['unlocks', '成就解鎖', '項'], ['calendar', '學習日曆', '筆'],
];

/**
 * 只以偏離預設的可攜偏好啟用匯出；外觀與回饋沿用各自的預設政策。
 * 其餘 UI 偏好對應 prefs.js 的預設值，hideKanji 已由 loadPrefs 遷移，不重複計數。
 */
const DEFAULT_PORTABLE_PREFS = { ...normalizeAppearance({}), ...defaultFeedbackPrefs(),
  grammarLines: true, keyboardSeen: false, kanaMode: 'both', readingAskIn: 'zh', kanjiMode: 'show' };

const REASON_LABEL = { restore: '匯入備份前', 'before-revert': '回到還原點前', google: 'Google 還原前' };

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '未知時間';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fileNameFor(now, ext = '.json') {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `lang-learn-備份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${ext}`;
}

function summaryOf(counts) {
  const parts = COUNT_LABEL.filter(([key]) => counts[key] !== undefined && counts[key] > 0)
    .map(([key, label, unit]) => `${label} ${counts[key]} ${unit}`);
  return parts.length ? parts.join('　·　') : '（空的）';
}

/**
 * 可攜偏好：只帶 learning-backup 白名單內的欄位，外觀等設定才能在別台裝置套用。
 */
function portablePrefs() {
  const allowed = new Set(['reducedEffects', 'grammarLines', 'keyboardSeen', 'hideKanji', 'quietMode',
    'voiceEnabled', 'effectsEnabled', 'hapticsEnabled', 'theme', 'palette', 'background', 'kanaMode',
    'readingAskIn', 'kanjiMode']);
  const prefs = loadPrefs();
  return Object.fromEntries(Object.entries(prefs).filter(([key, value]) => allowed.has(key)
    && (typeof value === 'boolean' || (typeof value === 'string' && value.length <= 80))));
}

function changedPreferenceCount() {
  return Object.entries(portablePrefs()).filter(([key, value]) => key !== 'hideKanji'
    && value !== DEFAULT_PORTABLE_PREFS[key]).length;
}

/**
 * 掛上面板；Google 面板透過回傳的 previewFrom(readText, source) 接入共用預覽流程。
 * 回傳 API 另含 dismissPreview(source)、refresh() 與唯讀 store getter。
 */
export function initLearningBackupPanel(mount) {
  if (!mount) return null;
  const shell = document.createElement('div');
  const status = document.createElement('p');
  status.className = 'backup-msg';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  mount.replaceChildren(shell, status);

  let store = null;
  let controller = null;
  let preview = null;
  let reading = false;
  let message = '';
  let codeText = '';
  let counts = {};
  let points = [];
  let generation = 0;
  let sharing = false;

  const focusInside = () => mount.contains(document.activeElement);
  const refocus = (selector, wasInside) => { if (wasInside) mount.querySelector(selector)?.focus(); };

  async function loadCounts() {
    try {
      const { meta, rows } = await store.read([...PORTABLE_STORES]);
      const reminder = rows.reminders[REMINDER_KEY];
      counts = { stats: Object.keys(rows.stats).length, progress: Object.keys(rows.progress).length,
        learning: Object.keys(rows.itemStates).length, plans: Object.keys(rows.dailyPlans).length,
        events: Object.keys(rows.reviewEvents).length, sessions: Object.keys(rows.sessions).length,
        ledger: Object.keys(rows.dailyLedger).length,
        unlocks: Object.keys(rows.achievements).filter((key) => key.startsWith('unlock:')).length,
        calendar: Object.keys(rows.achievements).filter((key) => key.startsWith('calendar:')).length,
        books: Object.keys(rows.books).length, notes: Object.keys(rows.notes).length,
        favorites: rows.books[FAVORITES_BOOK_ID]?.wordIds.length ?? 0,
        intents: Object.keys(rows.intents).length, changedPrefs: changedPreferenceCount(),
        reminders: reminder && (reminder.enabled || reminder.generation > 0
          || reminder.localTime !== '20:00' || reminder.timeZone !== meta.timeZone) ? 1 : 0 };
      points = await store.restorePoints();
    } catch (error) {
      message = storageMessage(error);
    }
  }

  function hasData() {
    // 預設空收藏簿不算使用者內容；政策列不計數，預設偏好／提醒也已在摘要取值時排除。
    return Object.entries(counts).some(([key, count]) => count > (key === 'books' ? 1 : 0));
  }

  /**
   * 首頁外觀切換及偏好重新載入後只更新摘要／匯出開關，不重建待確認的匯入選擇或輸入焦點。
   */
  function refreshPreferences() {
    if (!store || !mount.isConnected) return;
    counts.changedPrefs = changedPreferenceCount();
    const any = hasData();
    const summary = shell.querySelector('.backup-now');
    if (summary) summary.textContent = `目前：${any ? summaryOf(counts) : '還沒有任何紀錄'}`;
    for (const button of shell.querySelectorAll('[data-export], [data-copy-code]')) button.disabled = !any;
    const share = shell.querySelector('[data-share]');
    if (share) share.hidden = !any;
  }

  function canShareFile() {
    try {
      const probe = new File(['{}'], fileNameFor(0, '.txt'), { type: 'text/plain' });
      return typeof navigator?.canShare === 'function' && navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }

  function draw() {
    const any = hasData();
    shell.innerHTML = `
      <div class="card">
        <h3 class="backup-title">學習紀錄</h3>
        <p class="backup-note">
          紀錄存在這個瀏覽器裡，關掉視窗或重開機都還在。
          但<b>清除網站資料、無痕模式、換一台裝置或換一個瀏覽器</b>都會看不到——想留著就先帶走一份。
          備份包含統計、逐題紀錄、每日清單、作答歷程、單字簿與收藏、筆記、學習意向、提醒與偏好。
        </p>
        <p class="backup-now">目前：${any ? esc(summaryOf(counts)) : '還沒有任何紀錄'}</p>
        <div class="backup-actions">
          <button class="btn ghost sm" type="button" data-export ${any ? '' : 'disabled'}>下載檔案</button>
          <button class="btn ghost sm" type="button" data-copy-code ${any ? '' : 'disabled'}>複製代碼</button>
          ${canShareFile() ? `<button class="btn ghost sm" type="button" data-share ${any ? '' : 'hidden'}>分享…</button>` : ''}
          <label class="btn ghost sm file-btn">
            選擇備份檔
            <input type="file" accept="application/json,.json,text/plain,.txt" data-file class="file-input">
          </label>
        </div>
        <label class="backup-now" for="backup-code">代碼（複製到別台裝置貼上，或把別台的貼進來）</label>
        <textarea id="backup-code" class="backup-code" data-code rows="3" spellcheck="false" placeholder="langlearn…">${esc(codeText)}</textarea>
        <div class="backup-actions">
          <button class="btn ghost sm" type="button" data-read-code>讀取代碼</button>
        </div>
        ${preview ? previewHtml(preview) : reading
          ? '<div class="backup-actions"><button class="btn ghost sm" type="button" data-cancel>取消讀取</button></div>' : ''}
        ${points.length ? pointsHtml() : ''}
      </div>`;
    status.textContent = message;
    status.hidden = !message;
    bind();
  }

  function previewHtml(p) {
    return `<div class="backup-preview">
      <p><b>這份備份的內容</b>${p.source === 'google' ? '（來自 Google 雲端快照）' : ''}</p>
      <p class="backup-now">匯出於 ${esc(formatTime(p.exportedAt))}<br>${esc(summaryOf(p.counts))}</p>
      ${p.warnings.length ? `<p class="backup-warn">${p.warnings.map(esc).join('<br>')}</p>` : ''}
      ${p.errors.length ? `<p class="backup-warn">${p.errors.map(esc).join('<br>')}</p>` : ''}
      <fieldset class="backup-choose">
        <legend>要還原哪些</legend>
        ${p.canRestoreLearning ? '<label><input type="checkbox" data-pick="learning" checked> 學習紀錄（整組替換，不合併）</label>' : ''}
        ${p.canRestorePreferences ? '<label><input type="checkbox" data-pick="preferences" checked> 偏好設定</label>' : ''}
      </fieldset>
      <p class="backup-note">還原學習紀錄時會先把目前的紀錄存成還原點，之後可在下方回到確認前的狀態；只還原偏好不建立還原點。</p>
      <div class="backup-actions">
        <button class="btn sm" type="button" data-confirm>確認還原</button>
        <button class="btn ghost sm" type="button" data-cancel>取消</button>
      </div>
    </div>`;
  }

  function pointsHtml() {
    return `<div class="backup-points">
      <p><b>還原點</b>（最多保留三份，只存在這台裝置，不會被匯出）</p>
      <ul>${points.map((point) => `<li>
        ${esc(formatTime(point.createdAt))}　${esc(REASON_LABEL[point.reason] || '自動保存')}　逐題 ${point.counts.progress} 筆、歷程 ${point.counts.events} 筆
        <button class="btn ghost sm" type="button" data-revert="${esc(point.key)}">回到這裡</button>
      </li>`).join('')}</ul>
    </div>`;
  }

  function bind() {
    mount.querySelector('[data-export]')?.addEventListener('click', doExport);
    mount.querySelector('[data-share]')?.addEventListener('click', doShare);
    mount.querySelector('[data-copy-code]')?.addEventListener('click', doCopyCode);
    mount.querySelector('[data-read-code]')?.addEventListener('click', doReadCode);
    mount.querySelector('[data-code]')?.addEventListener('input', (event) => { codeText = event.currentTarget.value; });
    mount.querySelector('[data-file]')?.addEventListener('change', pickFile);
    const shown = generation;
    mount.querySelector('[data-confirm]')?.addEventListener('click', () => doConfirm(shown));
    mount.querySelector('[data-cancel]')?.addEventListener('click', () => {
      if (shown !== generation) return;
      const wasInside = focusInside();
      try { controller.cancel(); } catch (error) { message = error.message; draw(); return; }
      generation++;
      preview = null;
      reading = false;
      message = '';
      draw();
      refocus('[data-file]', wasInside);
    });
    for (const button of mount.querySelectorAll('[data-revert]')) {
      button.addEventListener('click', () => doRevert(button.getAttribute('data-revert')));
    }
  }

  async function buildPayload() {
    return store.exportBackup({ prefs: portablePrefs() });
  }

  async function doExport() {
    const wasInside = focusInside();
    const now = Date.now();
    try {
      const json = JSON.stringify(await buildPayload(), null, 2);
      const file = new File([json], fileNameFor(now), { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      message = '已下載。手機通常會進「下載」資料夾（iPhone 在「檔案」App 裡）。';
    } catch (error) {
      message = `沒有產生備份：${storageMessage(error)}`;
    }
    draw();
    refocus('[data-export]', wasInside);
  }

  async function doShare() {
    if (sharing) { message = '分享面板已經開著，先把它關掉。'; draw(); return; }
    sharing = true;
    const wasInside = focusInside();
    let stage = 'build';
    try {
      const json = JSON.stringify(await buildPayload(), null, 2);
      const file = new File([json], fileNameFor(Date.now(), '.txt'), { type: 'text/plain' });
      stage = 'share';
      await Promise.race([navigator.share({ files: [file], title: '語言學習的學習紀錄' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))]);
      message = '已交給系統分享面板。對方收到的檔案可以直接從這一頁匯入（無法確認對方是否收到）。';
    } catch (error) {
      if (error?.name === 'AbortError' || error?.message === 'timeout') return;
      message = stage === 'build' ? `沒有產生備份：${storageMessage(error)}` : '這台裝置沒辦法用分享送出，改用「下載檔案」試試。';
    } finally {
      sharing = false;
    }
    draw();
    refocus('[data-share]', wasInside);
  }

  async function doCopyCode() {
    const wasInside = focusInside();
    let code;
    try {
      code = await encodeBackupCode(await buildPayload());
    } catch (error) {
      message = error?.code === 'BACKUP_SIZE_LIMIT' ? `${error.message} 請改用「下載檔案」。` : `沒有產生代碼：${storageMessage(error)}`;
      draw();
      refocus('[data-copy-code]', wasInside);
      return;
    }
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch { /* 退回手動複製 */ }
    const { chars, chatFriendly } = codeSizeHint(code);
    const size = `約 ${chars.toLocaleString('zh-TW')} 字`;
    const boxBusy = preview !== null || reading;
    if (!boxBusy) codeText = code;
    message = copied
      ? chatFriendly ? `已複製到剪貼簿（${size}），可以直接貼進訊息。` : `已複製到剪貼簿（${size}）——太長，聊天軟體多半貼不進去；貼到備忘錄或郵件，或改用檔案。`
      : boxBusy ? '剪貼簿不給用，而框裡是等確認的代碼——先確認或取消，再複製一次。' : `剪貼簿不給用，請在下面的框裡全選後複製（${size}）。`;
    draw();
    if (!copied && !boxBusy) {
      const box = mount.querySelector('[data-code]');
      box?.focus();
      box?.select();
    } else refocus('[data-copy-code]', wasInside);
  }

  /**
   * 三種來源共用：開始新讀取立即撤下舊預覽；舊讀取晚到時由 controller 拋 STALE_PREVIEW 而忽略。
   */
  async function previewFrom(readText, source, focusSelector = '[data-confirm]') {
    const wasInside = focusInside();
    const mine = ++generation;
    preview = null;
    reading = true;
    message = '正在讀取備份，尚未變更任何紀錄。';
    draw();
    try {
      const result = await controller.preview(readText, { source });
      if (mine !== generation) return null;
      preview = result;
      message = '';
    } catch (error) {
      if (mine !== generation || error?.code === 'STALE_PREVIEW') return null;
      preview = null;
      message = error?.message || '讀不出這份備份，沒有動任何資料。';
    } finally {
      if (mine === generation) reading = false;
    }
    draw();
    refocus(preview ? focusSelector : '[data-file]', wasInside);
    return preview;
  }

  async function pickFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > BACKUP_JSON_MAX_BYTES) {
      generation++;
      preview = null;
      message = '備份資料超過 10 MiB 上限，沒有動任何資料。';
      draw();
      return;
    }
    await previewFrom(() => file.text(), 'file');
  }

  async function doReadCode() {
    const box = mount.querySelector('[data-code]');
    codeText = box ? box.value : codeText;
    const code = codeText;
    await previewFrom(async () => decodeBackupCode(code), 'code');
  }

  async function doConfirm(shown) {
    if (shown !== generation || !preview) return;
    const learning = mount.querySelector('[data-pick="learning"]')?.checked ?? false;
    const preferences = mount.querySelector('[data-pick="preferences"]')?.checked ?? false;
    const wasInside = focusInside();
    message = '正在保存，請不要關閉頁面…';
    draw();
    try {
      const result = await controller.confirm({ learning, preferences });
      generation++;
      preview = null;
      const parts = [];
      if (result.learningSaved) parts.push('學習紀錄');
      if (result.preferencesSaved) {
        parts.push('偏好設定');
        window.dispatchEvent(new Event(PREFS_IMPORTED_EVENT));
      }
      message = `已還原：${parts.join('、') || '無'}。${result.preferenceError || ''}${result.learningSaved ? '原本的紀錄已存成還原點。' : ''}`;
    } catch (error) {
      if (error?.code === 'STALE_PREVIEW') { generation++; preview = null; }
      message = error?.code === 'STALE_PREVIEW'
        ? '確認前紀錄已在其他分頁變動，這份預覽失效了；請重新選擇備份。'
        : `沒有還原任何學習紀錄：${storageMessage(error)}`;
    }
    await loadCounts();
    draw();
    refocus('[data-export]', wasInside);
  }

  async function doRevert(key) {
    const point = points.find((row) => row.key === key);
    if (!point) return;
    if (!window.confirm(`回到 ${formatTime(point.createdAt)} 的紀錄？目前的紀錄會先存成另一個還原點。`)) return;
    try {
      await store.revertToRestorePoint(key);
      message = `已回到 ${formatTime(point.createdAt)} 的紀錄。`;
    } catch (error) {
      message = `沒有變更：${storageMessage(error)}`;
    }
    await loadCounts();
    draw();
  }

  const api = {
    previewFrom: (readText, source) => previewFrom(readText, source),
    /**
     * 來源失效（例如 Google 切換帳號）時撤下該來源的預覽；確認中的交易不受影響。
     */
    dismissPreview(source) {
      if (!preview || preview.source !== source || !controller) return;
      try { controller.cancel(); } catch { return; }
      generation++;
      preview = null;
      message = '帳號已變更，來自雲端的預覽已撤下。';
      draw();
    },
    async refresh() { await loadCounts(); draw(); },
    get store() { return store; },
  };

  awaitLearningStore(shell, async (ready) => {
    store = ready;
    const meta = await store.ready();
    controller = createRestoreController({
      repository: store.repository,
      now: () => Date.now(),
      timeZone: () => meta.timeZone,
      nextOperationId: () => newOperationId('restore'),
      savePreferences: async (prefs) => savePrefs({ ...loadPrefs(), ...migratePrefs(prefs) }),
    });
    await loadCounts();
    draw();
  });
  window.addEventListener(APPEARANCE_EVENT, refreshPreferences);
  return api;
}
