/**
 * 語言首頁的統計摘要。
 *
 * 沒有紀錄時顯示引導文案而不是 0%——一個從沒玩過的人看到「正確率 0%」
 * 會以為自己很爛，那是資料呈現的錯，不是他的錯。
 *
 * 資料來源是交易式學習儲存（IndexedDB）；就緒前只顯示載入狀態，
 * 讀取失敗交給 storage-gate 顯示救援選項，不畫出一個假的空白統計。
 */

import { statsOfLang } from '../core/stats.js';
import { progressOfLang } from '../core/progress.js';
import { awaitLearningStore } from './storage-gate.js';
import { storageMessage } from './platform/learning-store.js';

const LANG_LABEL = { en: '英文', ja: '日文' };

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

  /* 「清除紀錄」的結果訊息。由 draw 畫，重繪就自然只有一份 */
  let clearNotice = '';
  const noticeHtml = () => (clearNotice ? `<p class="stats-due" role="status">${clearNotice}</p>` : '');

  /* 這顆按鈕連逐題紀錄、複習排程、每日清單、單字簿與筆記一起清，標籤不能只寫「統計」 */
  const clearButton = '<button class="btn ghost sm" data-clear>清除紀錄</button>';

  async function draw(store) {
    let view;
    try {
      view = await store.legacyView(lang);
    } catch (error) {
      mount.innerHTML = `<p class="stats-due" role="alert">${storageMessage(error)}</p>`;
      return;
    }
    const s = statsOfLang(view.stats, lang);
    const p = progressOfLang(view.progress, lang, Date.now());

    if (!s.hasData) {
      mount.innerHTML = `
        <div class="stats">
          <span class="hint">還沒有${LANG_LABEL[lang]}的練習紀錄——開始第一局吧。</span>
          ${p.tracked ? `<div class="spacer"></div>${clearButton}` : ''}
        </div>
        ${p.tracked ? `<p class="stats-due">還有 <b>${p.tracked}</b> 筆逐題紀錄，複習排程照常。</p>` : ''}${noticeHtml()}`;
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
      ${p.due || p.weak ? `<p class="stats-due">${dueLine(p)}</p>` : ''}${noticeHtml()}`;
    bindClear(store);
  }

  function bindClear(store) {
    mount.querySelector('[data-clear]')?.addEventListener('click', async () => {
      const ok = window.confirm(
        '確定要清除全部的學習紀錄嗎？\n\n這會一併清掉英文與日文的統計、逐題紀錄與複習排程、每日清單、單字簿、筆記、成就與還原點，而且無法復原。外觀等偏好設定會保留。\n\n建議先到首頁的「備份」帶走一份。'
      );
      if (!ok) return;
      /**
       * 一次交易清除全部集合；失敗時原資料完整保留，不會出現只清一半的狀態。
       */
      try {
        await store.clearAll();
        clearNotice = '已清除全部學習紀錄。';
      } catch (error) {
        clearNotice = `沒有清除任何資料：${storageMessage(error)}`;
      }
      await draw(store);
    });
  }

  awaitLearningStore(mount, draw);
}
