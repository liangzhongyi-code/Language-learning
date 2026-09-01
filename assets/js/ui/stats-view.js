/**
 * 語言首頁的統計摘要。
 *
 * 沒有紀錄時顯示引導文案而不是 0%——一個從沒玩過的人看到「正確率 0%」
 * 會以為自己很爛，那是資料呈現的錯，不是他的錯。
 */

import { loadStats, clearStats, statsOfLang } from '../core/stats.js';
import { loadProgress, clearProgress, progressOfLang } from '../core/progress.js';

const LANG_LABEL = { en: '英文', ja: '日文' };

/**
 * 取得 localStorage。被停用時回傳 undefined，
 * core/stats.js 的所有函式都能安全處理這種情況。
 */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * 畫出某個語言的累計統計，並掛上清除按鈕
 */
export function renderLangStats(mount, lang) {
  if (!mount) return;

  const draw = () => {
    const s = statsOfLang(loadStats(storage()), lang);
    const p = progressOfLang(loadProgress(storage()), lang, Date.now());

    if (!s.hasData) {
      mount.innerHTML = `
        <div class="stats">
          <span class="hint">還沒有${LANG_LABEL[lang]}的練習紀錄——開始第一局吧。</span>
        </div>`;
      return;
    }

    mount.innerHTML = `
      <div class="stats">
        <div>
          <div class="big">${s.accuracy}%</div>
          <div class="lbl">累計正確率</div>
        </div>
        <div>
          <div class="big">${s.sessions}</div>
          <div class="lbl">已完成局數</div>
        </div>
        <div>
          <div class="big">${s.correct} / ${s.answered}</div>
          <div class="lbl">答對 / 總題數</div>
        </div>
        <div class="spacer"></div>
        <button class="btn ghost sm" data-clear>清除統計</button>
      </div>
      ${
        /**
         * 到期與易錯只在真的有東西時才出現。
         * 「今天有 0 個字到期」是一句沒有用的話，而且會讓人以為功能壞了。
         */
        p.due || p.weak
          ? `<p class="stats-due">${[
              p.due ? `今天有 <b>${p.due}</b> 個題目該複習` : '',
              p.weak ? `累計 <b>${p.weak}</b> 個曾經答錯` : '',
            ]
              .filter(Boolean)
              .join('　·　')}——到測驗頁的「範圍」挑一個練。</p>`
          : ''
      }`;

    mount.querySelector('[data-clear]')?.addEventListener('click', () => {
      const ok = window.confirm(
        `確定要清除全部的練習統計嗎？\n\n這會一併清掉英文與日文的統計與逐題學習紀錄（含複習排程），而且無法復原。`
      );
      if (!ok) return;
      clearStats(storage());
      clearProgress(storage());
      draw();
    });
  };

  draw();
}
