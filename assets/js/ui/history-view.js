/**
 * 學習歷程頁：學習日曆、連續天數、成就，以及回饋（語音／音效／震動／安靜模式）與提醒設定。
 *
 * 日曆與成就只來自真實作答事件；打開這一頁不算學習。成就解鎖通知在這裡標記為已看過，
 * 從備份還原時不會重播已看過的通知。網頁版提醒只在頁面開著時有效，畫面會明說。
 */
import { awaitLearningStore } from './storage-gate.js';
import { newOperationId, storageMessage } from './platform/learning-store.js';
import { ACHIEVEMENTS, computeStreak, markNotified, pendingNotifications } from '../core/achievements.js';
import { reminderStatus, planReminderChange, nextFireTime } from '../core/reminders.js';
import { localStudyDate } from '../core/study-day.js';
import { unlockKey, REMINDER_KEY } from '../core/learning-snapshot.js';
import { feedbackPrefs, setFeedbackPref } from './feedback.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 86400000;

function permissionState() {
  if (typeof window === 'undefined' || typeof window.Notification !== 'function') return 'unsupported';
  return ['granted', 'denied', 'default'].includes(Notification.permission) ? Notification.permission : 'default';
}

export function initHistoryPage({ lang, mount }) {
  let store = null;
  let data = null;
  let timer = null;
  const shell = document.createElement('div');
  const status = document.createElement('p');
  status.className = 'backup-msg';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const say = (text) => { status.textContent = text; status.hidden = !text; };

  async function refresh() {
    try {
      const { meta, rows } = await store.read(['achievements', 'reminders', 'outbox']);
      const calendar = {};
      const unlocked = {};
      for (const [key, value] of Object.entries(rows.achievements)) {
        if (key.startsWith('calendar:')) calendar[key.slice(9)] = value;
        if (key.startsWith('unlock:')) unlocked[key.slice(7)] = value;
      }
      data = { meta, calendar, unlocked, reminder: rows.reminders[REMINDER_KEY], outbox: Object.values(rows.outbox) };
    } catch (error) {
      say(storageMessage(error));
      return;
    }
    render();
    await acknowledgeUnlocks();
    armReminder();
  }

  /**
   * 第一次在這裡看到新解鎖的成就時寫入 notifiedAt；之後重算或還原都不再當成新通知。
   */
  async function acknowledgeUnlocks() {
    const pending = pendingNotifications(data.unlocked);
    if (!pending.length) return;
    try {
      await store.commit({ stores: ['achievements'], operationId: newOperationId('ach-seen'), build(rows) {
        const now = Date.now();
        return pending.map((row) => rows.achievements[unlockKey(row.achievementId)])
          .filter((row) => row && row.notifiedAt === null)
          .map((row) => ({ store: 'achievements', key: unlockKey(row.achievementId), value: markNotified(row, now) }));
      } });
    } catch { /* 標記失敗只會讓下次再提示一次 */ }
  }

  function calendarHtml(today) {
    const cells = [];
    const [y, m, d] = today.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d);
    for (let i = 34; i >= 0; i--) {
      const date = new Date(base - i * DAY).toISOString().slice(0, 10);
      const row = data.calendar[`${date}:${lang}`];
      cells.push(`<div class="cal-cell${row ? ' is-active' : ''}" title="${esc(date)}${row ? `：${row.reviewCount} 題` : ''}">${row ? row.reviewCount : Number(date.slice(8))}</div>`);
    }
    return `<div class="cal-grid" role="img" aria-label="最近五週的${lang === 'ja' ? '日文' : '英文'}學習日曆">${cells.join('')}</div>`;
  }

  function render() {
    const today = localStudyDate(Date.now(), data.meta.timeZone);
    const langRows = Object.values(data.calendar).filter((row) => row.lang === lang);
    const streak = computeStreak({ calendarRows: langRows, todayLocalDate: today });
    const all = computeStreak({ calendarRows: Object.values(data.calendar), todayLocalDate: today });
    const prefs = feedbackPrefs();
    const reminder = data.reminder;
    const permission = permissionState();
    const reminderInfo = reminderStatus({ prefs: reminder, permission, platform: 'web', outboxRows: data.outbox });
    const toggle = (key, label, note) => `<label class="backup-choose" style="display:flex;gap:8px;align-items:center;min-height:44px">
      <input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}> ${esc(label)}<span class="hint">　${esc(note)}</span></label>`;
    shell.innerHTML = `
      <div class="card">
        <div class="stats">
          <div><div class="big">${streak.current}</div><div class="lbl">目前連續天數</div></div>
          <div><div class="big">${streak.longest}</div><div class="lbl">最長連續</div></div>
          <div><div class="big">${streak.totalDays}</div><div class="lbl">累計學習天數</div></div>
          <div><div class="big">${streak.totalReviews}</div><div class="lbl">累計作答題數</div></div>
        </div>
        <p class="setting-note">學習日依固定時區（${esc(data.meta.timeZone)}）計算。斷了連續天數不會抹掉累計與已解鎖的成就。</p>
        ${calendarHtml(today)}
      </div>
      <div class="card">
        <h2 class="backup-title">成就（英日文合計：${all.totalReviews} 題、${all.totalDays} 天）</h2>
        <ul class="badge-list">${ACHIEVEMENTS.map((a) => {
          const row = data.unlocked[a.id];
          return `<li class="${row ? 'is-unlocked' : ''}"><b>${row ? '🏅 ' : ''}${esc(a.title)}</b>${esc(a.description)}${row ? `<br><span class="hint">${esc(new Date(row.unlockedAt).toLocaleDateString('zh-TW'))} 解鎖${row.notifiedAt === null ? '（新）' : ''}</span>` : ''}</li>`;
        }).join('')}</ul>
      </div>
      <div class="card">
        <h2 class="backup-title">回饋設定</h2>
        ${toggle('voiceEnabled', '自動朗讀', '聽力題自動播放題目')}
        ${toggle('effectsEnabled', '音效', '答對／答錯的提示音')}
        ${toggle('hapticsEnabled', '震動', '裝置不支援時自動略過')}
        ${toggle('quietMode', '安靜模式', '停止音效、震動與自動朗讀；聽力題改為由你決定是否播放')}
        <p class="setting-note">這些設定只影響提示方式，不會改變判題與紀錄。</p>
      </div>
      <div class="card">
        <h2 class="backup-title">每日提醒</h2>
        <div class="field-row">
          <label class="backup-choose" style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="checkbox" data-reminder-enabled ${reminder.enabled ? 'checked' : ''}> 開啟提醒</label>
          <label class="setting-label" for="reminder-time">時間</label>
          <input id="reminder-time" class="text-input" type="time" data-reminder-time value="${esc(reminder.localTime)}" style="flex:0 0 140px">
          <button class="btn sm" type="button" data-reminder-save>保存提醒</button>
          ${permission === 'default' ? '<button class="btn ghost sm" type="button" data-permission>允許通知</button>' : ''}
        </div>
        <p class="setting-note">${esc(reminderInfo.message)}</p>
      </div>`;
    shell.querySelectorAll('[data-pref]').forEach((node) => node.addEventListener('change', () => {
      setFeedbackPref(node.dataset.pref, node.checked);
      say('已保存回饋設定。');
    }));
    shell.querySelector('[data-reminder-save]').addEventListener('click', saveReminder);
    shell.querySelector('[data-permission]')?.addEventListener('click', async () => {
      try { await Notification.requestPermission(); } catch { /* 被拒或不支援時狀態會反映在畫面上 */ }
      render();
      armReminder();
    });
  }

  async function saveReminder() {
    const enabled = shell.querySelector('[data-reminder-enabled]').checked;
    const localTime = shell.querySelector('[data-reminder-time]').value || '20:00';
    try {
      await store.commit({ stores: ['reminders', 'outbox'], operationId: newOperationId('reminder'), build(rows, meta) {
        const prefs = rows.reminders[REMINDER_KEY];
        const planned = planReminderChange({ prefs, nextPrefs: { enabled, localTime, timeZone: meta.timeZone },
          now: Date.now(), outboxId: newOperationId('outbox'), outboxRows: Object.values(rows.outbox) });
        if (!planned.changed) return [];
        const changes = [{ store: 'reminders', key: REMINDER_KEY, value: planned.prefs }];
        if (planned.outbox && !planned.deduped) changes.push({ store: 'outbox', key: planned.outbox.outboxId, value: planned.outbox });
        return changes;
      } });
      say('提醒設定已保存。');
    } catch (error) {
      say(`沒有保存：${storageMessage(error)}`);
    }
    await refresh();
  }

  /**
   * 網頁版只在頁面開著時以計時器提醒；不宣稱已交給系統排程。
   */
  function armReminder() {
    clearTimeout(timer);
    const reminder = data?.reminder;
    if (!reminder?.enabled || permissionState() !== 'granted') return;
    const at = nextFireTime({ localTime: reminder.localTime, timeZone: reminder.timeZone, now: Date.now() });
    const wait = at - Date.now();
    if (wait > 2147000000) return;
    timer = setTimeout(() => {
      try { new Notification('語言學習', { body: '今天的學習清單在等你。' }); } catch { /* 無法顯示就略過 */ }
      armReminder();
    }, wait);
  }

  awaitLearningStore(mount, async (ready) => {
    store = ready;
    mount.replaceChildren(shell, status);
    await refresh();
  });
}
