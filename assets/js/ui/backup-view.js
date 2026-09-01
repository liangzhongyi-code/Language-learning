/**
 * 首頁的「學習紀錄」面板：把紀錄倒成檔案，或從檔案倒回來。
 *
 * 放在根目錄的首頁而不是某個語言底下，是因為紀錄本來就是跨語言的——
 * 掛在日文頁會讓人以為匯出的只有日文。
 *
 * 匯入不做「選了檔就直接蓋掉」。先解析、先把裡面有什麼攤在畫面上，
 * 使用者確認之後才寫入——覆蓋學習紀錄是不可逆的，
 * 而選錯檔案是最容易發生的操作失誤。
 */

import { STATS_KEY } from '../core/stats.js';
import { PROGRESS_KEY } from '../core/progress.js';
import { PREFS_KEY } from './prefs.js';
import { exportPayload, parseBackup, countOf, SECTIONS } from '../core/backup.js';

/**
 * 區塊名稱對應的 localStorage 鑰匙。
 * 這個對應只有畫面層知道——core/backup.js 認得備份檔的外殼，
 * 但不該知道東西存在瀏覽器的哪一格。
 */
const SECTION_KEY = {
  stats: STATS_KEY,
  progress: PROGRESS_KEY,
  prefs: PREFS_KEY,
};

const SECTION_LABEL = {
  stats: '測驗統計',
  progress: '學習紀錄',
  prefs: '偏好設定',
};

const SECTION_UNIT = {
  stats: '組',
  progress: '筆',
  prefs: '項',
};

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * 讀出目前存著的三個區塊。讀不到或壞掉的一律當成沒有，不讓匯出因此失敗。
 */
function collect() {
  const store = storage();
  const data = {};
  for (const section of SECTIONS) {
    try {
      const raw = store?.getItem?.(SECTION_KEY[section]);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') data[section] = parsed;
    } catch {
      /* 這一格壞了就不放進備份，其餘照常匯出 */
    }
  }
  return data;
}

/**
 * 檔名帶日期，一天備份好幾次時才分得出哪個是新的
 */
function fileNameFor(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `lang-learn-備份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '未知時間';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initBackupPanel(mount) {
  if (!mount) return;

  /* 解析完、等使用者確認的那一份。確認之前絕不寫入 */
  let pending = null;
  let message = '';

  function summaryOf(counts) {
    const parts = SECTIONS.filter((s) => counts[s] !== undefined).map(
      (s) => `${SECTION_LABEL[s]} ${counts[s]} ${SECTION_UNIT[s]}`
    );
    return parts.length ? parts.join('　·　') : '（空的）';
  }

  function draw() {
    const current = collect();
    const counts = {};
    for (const section of SECTIONS) {
      if (current[section]) counts[section] = countOf(section, current[section]);
    }
    const hasAny = Object.keys(counts).length > 0;

    mount.innerHTML = `
      <div class="card">
        <h3 class="backup-title">學習紀錄</h3>
        <p class="backup-note">
          紀錄存在這個瀏覽器裡，關掉視窗或重開機都還在。
          但<b>清除網站資料、無痕模式、換一台裝置或換一個瀏覽器</b>都會看不到——
          想留著就先匯出一份。
        </p>
        <p class="backup-now">目前：${hasAny ? esc(summaryOf(counts)) : '還沒有任何紀錄'}</p>

        <div class="backup-actions">
          <button class="btn ghost sm" type="button" data-export ${hasAny ? '' : 'disabled'}>匯出檔案</button>
          <label class="btn ghost sm file-btn">
            選擇備份檔
            <input type="file" accept="application/json,.json" data-file hidden>
          </label>
        </div>

        ${
          pending
            ? `<div class="backup-preview">
                 <p><b>這份備份的內容</b></p>
                 <p class="backup-now">匯出於 ${esc(formatTime(pending.exportedAt))}<br>${esc(
                   summaryOf(pending.counts)
                 )}</p>
                 ${
                   pending.errors.length
                     ? `<p class="backup-warn">${pending.errors.map(esc).join('<br>')}</p>`
                     : ''
                 }
                 <div class="backup-actions">
                   <button class="btn sm" type="button" data-confirm>確認匯入（會覆蓋現在的紀錄）</button>
                   <button class="btn ghost sm" type="button" data-cancel>取消</button>
                 </div>
               </div>`
            : ''
        }

        ${message ? `<p class="backup-msg">${esc(message)}</p>` : ''}
      </div>`;

    mount.querySelector('[data-export]')?.addEventListener('click', doExport);
    mount.querySelector('[data-file]')?.addEventListener('change', pickFile);
    mount.querySelector('[data-confirm]')?.addEventListener('click', doImport);
    mount.querySelector('[data-cancel]')?.addEventListener('click', () => {
      pending = null;
      message = '';
      draw();
    });
  }

  function doExport() {
    const now = Date.now();
    const json = JSON.stringify(exportPayload(collect(), now), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(now);
    a.click();
    /* 立刻釋放，否則這個 blob 會活到整頁關閉為止 */
    URL.revokeObjectURL(url);
    message = '已匯出。把這個檔案收好，之後在任何裝置上都能匯入回來。';
    pending = null;
    draw();
  }

  async function pickFile(event) {
    const file = event.currentTarget.files?.[0];
    /* 讓同一個檔案再選一次也會觸發 change，否則取消後重選同一檔會沒反應 */
    event.currentTarget.value = '';
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      pending = null;
      message = '讀不到這個檔案。';
      draw();
      return;
    }

    const result = parseBackup(text);
    if (!result.ok) {
      pending = null;
      message = result.errors.join(' ');
      draw();
      return;
    }
    pending = result;
    message = '';
    draw();
  }

  function doImport() {
    if (!pending) return;
    const store = storage();
    const done = [];
    const failed = [];

    for (const section of SECTIONS) {
      const value = pending.data[section];
      if (value === undefined) continue;
      try {
        store?.setItem?.(SECTION_KEY[section], JSON.stringify(value));
        done.push(SECTION_LABEL[section]);
      } catch {
        failed.push(SECTION_LABEL[section]);
      }
    }

    pending = null;
    message = failed.length
      ? `已還原：${done.join('、') || '無'}。${failed.join('、')}寫入失敗，可能是儲存空間已滿。`
      : `已還原：${done.join('、')}。`;
    draw();
  }

  draw();
}
