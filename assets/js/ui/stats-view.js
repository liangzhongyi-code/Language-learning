/**
 * 語言首頁的統計摘要。
 *
 * 沒有紀錄時顯示引導文案而不是 0%——一個從沒玩過的人看到「正確率 0%」
 * 會以為自己很爛，那是資料呈現的錯，不是他的錯。
 */

import { loadStats, clearStats, statsOfLang } from '../core/stats.js';

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
      </div>`;

    mount.querySelector('[data-clear]')?.addEventListener('click', () => {
      const ok = window.confirm(
        `確定要清除全部的練習統計嗎？\n\n這會一併清掉英文與日文的紀錄，而且無法復原。`
      );
      if (!ok) return;
      clearStats(storage());
      draw();
    });
  };

  draw();
}
