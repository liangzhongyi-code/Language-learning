/**
 * 語言首頁的「今日學習」卡片：只計算預覽、不建立清單，進入每日頁才實際保存。
 */
import { awaitLearningStore } from './storage-gate.js';
import { createDailyService } from './platform/daily-service.js';
import { storageMessage } from './platform/learning-store.js';
import { loadPrefs } from './prefs.js';
import { levelLabel } from '../data/shared/levels.js';

export function renderTodayCard(mount, { lang, words }) {
  if (!mount) return;
  const prefs = loadPrefs();
  const settings = {
    level: [1, 2, 3, 4, 5].includes(prefs[`daily.${lang}.level`]) ? prefs[`daily.${lang}.level`] : 1,
    newLimit: [0, 5, 10, 20].includes(prefs[`daily.${lang}.newLimit`]) ? prefs[`daily.${lang}.newLimit`] : 5,
    reviewLimit: 20,
  };
  awaitLearningStore(mount, async (store) => {
    try {
      const view = await createDailyService({ store, lang, words }).preview(settings);
      const s = view.summary;
      const done = view.plan.status === 'completed';
      const parts = [];
      if (s.reviewCount) parts.push(`待複習 <b>${s.reviewCount}</b>`);
      if (s.newCount) parts.push(`新字 <b>${s.newCount}</b>`);
      if (s.completedCount) parts.push(`已完成 <b>${s.completedCount}</b>`);
      mount.innerHTML = `
        <div class="card today-card">
          <div class="stats">
            <div>
              <div class="lbl">今日學習 · ${levelLabel(lang, settings.level)}</div>
              <p class="daily-summary">${done ? '今天的清單已完成。' : parts.join('　·　') || '今天沒有待辦。'}${s.remainingDue ? `　另有 <b>${s.remainingDue}</b> 個到期題排在下一段` : ''}</p>
            </div>
            <div class="spacer"></div>
            <a class="btn sm" href="./daily.html">${done ? '查看今日' : s.completedCount ? '繼續今日學習' : '開始今日學習'}</a>
          </div>
        </div>`;
    } catch (error) {
      mount.innerHTML = `<p class="stats-due" role="alert">今日清單暫時無法計算：${storageMessage(error)}</p>`;
    }
  });
}
