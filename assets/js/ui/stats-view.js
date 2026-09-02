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
 * 「今天該複習幾題」那一行。
 *
 * 措辭只說「可以只練這些」，不說「到測驗頁的範圍挑一個練」。
 * 這裡的數字是跨題源加總的（3 個單字 + 2 個句型 = 5），
 * 而測驗頁的那一排是單一題源交集、還要湊得滿一局才會出現——
 * 承諾它一定在，使用者會照著去找一個不存在的按鈕。
 */
function dueLine(p) {
  const parts = [
    p.due ? `今天有 <b>${p.due}</b> 個題目該複習` : '',
    p.weak ? `<b>${p.weak}</b> 個還沒練熟` : '',
  ].filter(Boolean);
  return `${parts.join('　·　')}。測驗頁的「範圍」可以只練這些。`;
}

/**
 * 畫出某個語言的累計統計，並掛上清除按鈕
 */
export function renderLangStats(mount, lang) {
  if (!mount) return;

  /* 「清除紀錄」失敗時要說的話。由 draw 畫，重繪就自然只有一份 */
  let clearNotice = '';
  const noticeHtml = () => (clearNotice ? `<p class="stats-due">${clearNotice}</p>` : '');

  const draw = () => {
    const store = storage();
    const s = statsOfLang(loadStats(store), lang);

    if (!s.hasData) {
      mount.innerHTML = `
        <div class="stats">
          <span class="hint">還沒有${LANG_LABEL[lang]}的練習紀錄——開始第一局吧。</span>
        </div>${noticeHtml()}`;
      return;
    }

    /**
     * 逐題紀錄在確定有統計之後才讀。
     * 它是一個最大近 900KB 的 JSON.parse，而沒練過的人根本用不到它——
     * 早退在前面就把這個成本完全省掉。
     */
    const p = progressOfLang(loadProgress(store), lang, Date.now());

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
        <!-- 這顆按鈕連逐題紀錄與複習排程一起清，標籤不能只寫「統計」 -->
        <button class="btn ghost sm" data-clear>清除紀錄</button>
      </div>
      ${
        /**
         * 到期與易錯只在真的有東西時才出現。
         * 「今天有 0 個字到期」是一句沒有用的話，而且會讓人以為功能壞了。
         */
        p.due || p.weak ? `<p class="stats-due">${dueLine(p)}</p>` : ''
      }${noticeHtml()}`;

    mount.querySelector('[data-clear]')?.addEventListener('click', () => {
      const ok = window.confirm(
        `確定要清除全部的練習統計嗎？\n\n這會一併清掉英文與日文的統計與逐題學習紀錄（含複習排程），而且無法復原。`
      );
      if (!ok) return;
      /**
       * 兩個都要嘗試，不能短路。
       * 用 `||` 短路的話，第一個成功、第二個失敗時統計已經沒了、逐題紀錄還在，
       * 而畫面只說一句籠統的「清不掉」——使用者以為什麼都沒動，其實動了一半。
       * 分開記結果，訊息才能講出到底剩下什麼。
       */
      const statsGone = clearStats(store);
      const progressGone = clearProgress(store);
      if (statsGone && progressGone) {
        clearNotice = '';
      } else if (!statsGone && !progressGone) {
        clearNotice = '清不掉——這個瀏覽器不允許本站儲存資料。';
      } else {
        clearNotice = `只清掉了${statsGone ? '統計' : '逐題紀錄'}，${
          statsGone ? '逐題紀錄' : '統計'
        }刪不掉。重新整理再試一次。`;
      }
      /* 一律重繪，訊息由 draw 畫——不用 insertAdjacentHTML，連按幾次才不會疊出好幾行 */
      draw();
    });
  };

  draw();
}
