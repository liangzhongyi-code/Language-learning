/**
 * 語言首頁的統計摘要。
 *
 * 沒有紀錄時顯示引導文案而不是 0%——一個從沒玩過的人看到「正確率 0%」
 * 會以為自己很爛，那是資料呈現的錯，不是他的錯。
 */

import { loadStats, clearStats, statsOfLang } from '../core/stats.js';
import { loadProgress, clearProgress, progressOfLang, rawHasLang, PROGRESS_KEY } from '../core/progress.js';

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

  /* 這顆按鈕連逐題紀錄與複習排程一起清，標籤不能只寫「統計」 */
  const clearButton = '<button class="btn ghost sm" data-clear>清除紀錄</button>';

  const draw = () => {
    const store = storage();
    const s = statsOfLang(loadStats(store), lang);
    /**
     * 逐題紀錄要不要解析，先用字串比對決定。
     *
     * 有統計就一定讀（要畫到期數）。沒統計時只有一種情況需要讀：逐題紀錄裡
     * 還有這個語言的東西（統計壞掉、或清除只清了一半）——不讀就不知道有殘留，
     * 清除鍵也跟著早退消失，使用者連再試一次的地方都沒有。
     * 但只練過另一種語言的人，這把鑰匙可能有 900KB 而一筆都不是這個語言的；
     * 為了畫零行字去解析它是白付。rawHasLang 一次線性掃描就分得出來。
     */
    let raw = null;
    try {
      raw = store?.getItem?.(PROGRESS_KEY) ?? null;
    } catch {
      /* 讀不到就當沒有 */
    }
    const p =
      s.hasData || rawHasLang(raw, lang)
        ? progressOfLang(loadProgress(store), lang, Date.now())
        : { tracked: 0, weak: 0, due: 0 };

    if (!s.hasData) {
      mount.innerHTML = `
        <div class="stats">
          <span class="hint">還沒有${LANG_LABEL[lang]}的練習紀錄——開始第一局吧。</span>
          ${p.tracked ? `<div class="spacer"></div>${clearButton}` : ''}
        </div>
        ${
          /**
           * 措辭不能寫「沒清掉」——統計讀不到有非清除的成因：
           * 統計那一格壞掉（匯入半截檔、寫到一半配額滿）、或某一局 saveStats 失敗而
           * saveProgress 成功。這些人從沒按過清除，卻會被告知有東西「沒清掉」。
           * 只陳述事實：還有逐題紀錄在，複習排程照常運作。
           */
          p.tracked ? `<p class="stats-due">還有 <b>${p.tracked}</b> 筆逐題紀錄，複習排程照常。</p>` : ''
        }${noticeHtml()}`;
      bindClear(store);
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
        ${clearButton}
      </div>
      ${
        /**
         * 到期與易錯只在真的有東西時才出現。
         * 「今天有 0 個字到期」是一句沒有用的話，而且會讓人以為功能壞了。
         */
        p.due || p.weak ? `<p class="stats-due">${dueLine(p)}</p>` : ''
      }${noticeHtml()}`;
    bindClear(store);
  };

  function bindClear(store) {
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
        }刪不掉。再按一次「清除紀錄」試試。`;
      }
      /* 一律重繪，訊息由 draw 畫——不用 insertAdjacentHTML，連按幾次才不會疊出好幾行 */
      draw();
    });
  }

  draw();
}
