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

  /**
   * 重繪之後把焦點放回該去的地方。
   *
   * 這一整塊是 innerHTML 重建的，重繪會把當下聚焦的元素直接銷毀，
   * 焦點掉回 <body>。純鍵盤使用者選完檔案之後，剛冒出來的
   * 「確認匯入」按鈕不會被聚焦，他得從頁面最上方重新 Tab 過整條導覽列
   * 才回得到面板底部——匯入流程等於走不完。
   *
   * 只在焦點原本就在這個面板裡時才搶，否則使用者在別處打字會被拉走。
   */
  function refocus(selector, wasInside) {
    if (!wasInside) return;
    mount.querySelector(selector)?.focus();
  }

  const focusInside = () => mount.contains(document.activeElement);

  function draw(known) {
    /* 呼叫端剛讀過就不要再讀一次——collect() 要解析最大近 900KB 的紀錄 */
    const current = known ?? collect();
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
          <!--
            檔案輸入不能用 hidden 藏。
            hidden 等同 display:none，而 display:none 的元素不可聚焦——
            label 自己也不在 tab 順序裡，於是整個「選擇備份檔」按鍵盤完全按不到，
            換裝置時最關鍵的那個動作變成只有滑鼠能做（WCAG 2.1.1）。
            改成視覺上看不見但仍留在焦點順序裡，外層 label 只在鍵盤聚焦時畫焦點框。
          -->
          <label class="btn ghost sm file-btn">
            選擇備份檔
            <input type="file" accept="application/json,.json" data-file class="file-input">
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
      const wasInside = focusInside();
      pending = null;
      message = '';
      draw();
      refocus('[data-file]', wasInside);
    });
  }

  function doExport() {
    const now = Date.now();
    const current = collect();
    const json = JSON.stringify(exportPayload(current, now), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(now);
    a.click();
    /**
     * 延後一拍再釋放。
     * 緊接著 click() 同步 revoke 是有名的坑：舊版 Firefox 會直接取消下載
     * （bug 1282407，FF50 修掉），Chromium 至今仍有大 blob 被截斷的回報。
     * 這裡的檔案最大約 1MB，機率低但不是零，而下載失敗時使用者只會看到
     * 一句確定的「已匯出」。延後一個 tick 的成本是零，沒有理由賭。
     */
    setTimeout(() => URL.revokeObjectURL(url), 0);
    message = '已匯出。把這個檔案收好，之後在任何裝置上都能匯入回來。';
    pending = null;
    /* 剛剛才讀過，不必為了重畫再解析一次最大近 900KB 的紀錄 */
    draw(current);
  }

  async function pickFile(event) {
    const file = event.currentTarget.files?.[0];
    /* 讓同一個檔案再選一次也會觸發 change，否則取消後重選同一檔會沒反應 */
    event.currentTarget.value = '';
    if (!file) return;

    /* 焦點現在就在那顆選檔按鈕上（是它觸發了這個事件），重繪會把它銷毀 */
    const wasInside = focusInside();

    const fail = (why) => {
      pending = null;
      message = why;
      draw();
      /* 失敗時焦點回到選檔鍵，使用者可以直接再選一次 */
      refocus('[data-file]', wasInside);
    };

    let text;
    try {
      text = await file.text();
    } catch {
      fail('讀不到這個檔案。');
      return;
    }

    const result = parseBackup(text);
    if (!result.ok) {
      fail(result.errors.join(' '));
      return;
    }
    pending = result;
    message = '';
    draw();
    /* 成功時焦點推進到剛冒出來的確認鍵，這是流程的下一步 */
    refocus('[data-confirm]', wasInside);
  }

  function doImport() {
    if (!pending) return;
    const store = storage();
    const done = [];
    const failed = [];

    /**
     * 先確認真的寫得進去。
     * `store?.setItem?.()` 在 store 是 undefined 時會靜靜地什麼都不做然後回傳
     * undefined——於是每個區塊都被當成還原成功，畫面顯示「已還原：…」，
     * 而使用者可能就把備份檔刪了。停用 Cookie 的瀏覽器正好走這條路。
     */
    const writable = typeof store?.setItem === 'function';

    for (const section of SECTIONS) {
      const value = pending.data[section];
      if (value === undefined) continue;
      if (!writable) {
        failed.push(SECTION_LABEL[section]);
        continue;
      }
      try {
        store.setItem(SECTION_KEY[section], JSON.stringify(value));
        done.push(SECTION_LABEL[section]);
      } catch {
        failed.push(SECTION_LABEL[section]);
      }
    }

    const wasInside = focusInside();
    pending = null;
    message = !failed.length
      ? `已還原：${done.join('、')}。`
      : writable
        ? `已還原：${done.join('、') || '無'}。${failed.join('、')}寫入失敗，可能是儲存空間已滿。`
        : '這個瀏覽器不允許本站儲存資料（可能停用了 Cookie，或正在無痕模式），一筆都沒有還原。備份檔請先留著。';
    draw();
    /* 匯入完了，焦點回到匯出鍵——那是這個面板剩下唯一還有意義的動作 */
    refocus('[data-export]', wasInside);
  }

  draw();
}
