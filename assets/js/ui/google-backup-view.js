/**
 * 首頁「Google 雲端備份（選用）」面板。
 *
 * Client ID 留空時只顯示尚未設定，不載入 Google SDK、不發任何請求，本機功能完全不受影響。
 * 設定後：按「連接」才授權（只要 drive.appdata 與 email）、每次備份建立一份新的不可變快照、
 * 從雲端還原只下載固定內容交給首頁備份面板的同一套預覽與確認流程，絕不直接寫入學習紀錄。
 * token 只在記憶體；切換帳號或斷線時清掉清單與來自雲端的預覽。
 */
import { GOOGLE_CONFIG } from '../config/google.js';
import { createGoogleWebAuth } from './platform/google-web-auth.js';
import { createGoogleDrive, newExportId } from './platform/google-drive.js';
import { loadPrefs } from './prefs.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error('script failed')); };
    document.head.appendChild(script);
  });
}

function formatTime(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '未知時間';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDeviceLabel() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone／iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return '瀏覽器';
}

/**
 * backupPanel 為 initLearningBackupPanel 的回傳值；還原一律交給它的 previewFrom。
 */
export function initGoogleBackupPanel(mount, backupPanel, { config = GOOGLE_CONFIG } = {}) {
  if (!mount) return;
  let snapshots = [];
  let nextPageToken = null;
  let busy = false;
  let message = '';
  let unknownUpload = null;
  let deviceLabel = defaultDeviceLabel();
  let lastGeneration = 0;

  const auth = createGoogleWebAuth({
    config, loadScript, getGoogle: () => window.google, fetch: (...args) => window.fetch(...args),
    onChange(state) {
      if (state.generation !== lastGeneration) {
        lastGeneration = state.generation;
        snapshots = [];
        nextPageToken = null;
        unknownUpload = null;
        backupPanel?.dismissPreview?.('google');
      }
      draw();
    },
  });
  const drive = createGoogleDrive({ auth, getRandomValues: (array) => crypto.getRandomValues(array) });

  function draw() {
    const state = auth.status();
    if (!state.configured) {
      mount.innerHTML = `<div class="card">
        <h3 class="backup-title">Google 雲端備份（選用）</h3>
        <p class="backup-note">尚未設定，這個網站目前不會連線到 Google，所有本機功能照常使用。
        設定方式見<a href="./help.html#google-backup">使用教學</a>（需要網站管理者在 Google Cloud 建立 OAuth 用戶端 ID）。</p>
      </div>`;
      return;
    }
    mount.innerHTML = `<div class="card">
      <h3 class="backup-title">Google 雲端備份（選用）</h3>
      <p class="backup-note">備份存在你 Google 雲端硬碟的應用程式專用區（看不到你的其他檔案）。每按一次就新增一份，不會覆蓋或刪除舊的；
        還原時先預覽再確認，會替換整組學習紀錄。雲端資料沒有額外加密。</p>
      ${state.connected ? `
        <p class="backup-now">已連接：<b>${esc(state.email)}</b></p>
        <div class="field-row">
          <label class="setting-label" for="device-label">這台裝置的名稱（只用來辨識備份）</label>
          <input id="device-label" class="text-input" data-device maxlength="40" value="${esc(deviceLabel)}">
        </div>
        <div class="backup-actions">
          <button class="btn sm" type="button" data-upload ${busy ? 'disabled' : ''}>備份到 Google</button>
          <button class="btn ghost sm" type="button" data-list ${busy ? 'disabled' : ''}>列出雲端備份</button>
          <button class="btn ghost sm" type="button" data-disconnect>中斷連接</button>
        </div>
        ${unknownUpload ? `<div class="notice"><b>上一次備份的結果無法確認。</b>可能已經建立、也可能沒有。重試時會先查詢同一份備份，不會盲目重送。
          <div class="actions"><button class="btn sm" type="button" data-retry-upload>確認／重試</button></div></div>` : ''}
        ${snapshots.length ? `<ul class="book-list">${snapshots.map((s) => `<li>
          <span class="book-name">${esc(formatTime(s.exportedAt ?? s.createdTime))}　${esc(s.deviceLabel || '未命名裝置')}<span class="hint">　資料版本 ${esc(s.schemaVersion ?? '?')}</span></span>
          <button class="btn ghost sm" type="button" data-restore="${esc(s.id)}" ${busy ? 'disabled' : ''}>預覽還原</button></li>`).join('')}</ul>
          ${nextPageToken ? '<div class="backup-actions"><button class="btn ghost sm" type="button" data-more>載入更多</button></div>' : ''}` : ''}`
        : `<div class="backup-actions"><button class="btn sm" type="button" data-connect ${busy ? 'disabled' : ''}>連接 Google 帳號</button></div>`}
      <p class="backup-msg" role="status" aria-live="polite" ${message ? '' : 'hidden'}>${esc(message)}</p>
    </div>`;
    const on = (selector, handler) => mount.querySelector(selector)?.addEventListener('click', handler);
    on('[data-connect]', connect);
    on('[data-disconnect]', () => { auth.disconnect(); message = '已中斷連接，這台裝置不再保留 Google 授權。'; draw(); });
    on('[data-upload]', () => upload());
    on('[data-retry-upload]', () => upload(unknownUpload));
    on('[data-list]', () => list(false));
    on('[data-more]', () => list(true));
    mount.querySelector('[data-device]')?.addEventListener('input', (event) => { deviceLabel = event.currentTarget.value; });
    mount.querySelectorAll('[data-restore]').forEach((node) => node.addEventListener('click', () => restore(node.dataset.restore)));
  }

  async function guarded(task) {
    if (busy) return;
    busy = true;
    draw();
    try { await task(); } catch (error) {
      message = error?.code === 'GOOGLE_STALE_SESSION' ? '帳號已切換或中斷，這次的結果已捨棄。' : (error?.message || '操作沒有完成，本機與雲端都沒有變動。');
    } finally {
      busy = false;
      draw();
    }
  }

  function connect() {
    return guarded(async () => {
      await auth.connect();
      message = '已連接。請確認上面顯示的是你要使用的帳號。';
    });
  }

  function upload(pending = null) {
    return guarded(async () => {
      const store = backupPanel?.store;
      if (!store) throw new Error('學習紀錄尚未就緒。');
      const allowed = new Set(['reducedEffects', 'grammarLines', 'keyboardSeen', 'hideKanji', 'quietMode',
        'voiceEnabled', 'effectsEnabled', 'hapticsEnabled', 'theme', 'palette', 'background', 'kanaMode', 'readingAskIn', 'kanjiMode']);
      const prefs = Object.fromEntries(Object.entries(loadPrefs()).filter(([key]) => allowed.has(key)));
      const payload = pending?.payload ?? await store.exportBackup({ prefs });
      const exportId = pending?.exportId ?? newExportId();
      const text = pending?.text ?? JSON.stringify(payload);
      const result = await drive.uploadSnapshot({ text, exportId, schemaVersion: 2, exportedAt: payload.exportedAt,
        deviceLabel, checkExisting: Boolean(pending) });
      if (result.status === 'unknown') {
        unknownUpload = { exportId, text, payload };
        message = '';
        return;
      }
      unknownUpload = null;
      message = result.status === 'exists' ? '這份備份先前已經建立成功，沒有重複上傳。' : `已備份到 Google（${formatTime(payload.exportedAt)}）。`;
    });
  }

  function list(more) {
    return guarded(async () => {
      const page = await drive.listSnapshots({ pageToken: more ? nextPageToken : undefined });
      snapshots = more ? [...snapshots, ...page.snapshots] : page.snapshots;
      nextPageToken = page.nextPageToken;
      message = snapshots.length ? '' : '雲端還沒有任何備份。';
    });
  }

  /**
   * 點選時先取得共用預覽世代，下載也在 readText 內；較新的檔案／代碼或取消能淘汰晚到結果。
   * 只有仍有效的預覽才顯示下載成功，確認仍使用共用面板已驗證的固定內容。
   */
  function restore(fileId) {
    return guarded(async () => {
      const preview = await backupPanel.previewFrom(async () => {
        const { text } = await drive.downloadSnapshot(fileId);
        return text;
      }, 'google');
      if (preview) message = '已下載，請在上方「學習紀錄」面板檢查預覽後再確認；目前還沒有變更任何資料。';
    });
  }

  draw();
}
