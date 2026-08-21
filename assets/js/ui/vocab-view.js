/**
 * 單字瀏覽頁的畫面組裝。
 *
 * 英日兩頁共用這一支，差異全部靠 lang 與傳入的題庫決定：
 *   - 英文的 reading / romaji 是 null，那兩個 span 整個不輸出，不留空元素
 *   - 日文朗讀一律送 reading（假名）而不是 target（漢字），
 *     漢字丟給語音引擎會被挑到別的讀法，例如「雨」唸成「う」
 *
 * 篩選與搜尋的邏輯一概不在這裡實作，全部交給 core/filter.js，
 * 這一層只負責把結果畫出來。
 */

import { listCategories, filterWords } from '../core/filter.js';
import { speakTextOf } from '../core/speech-text.js';
import { applySpeechFallback, bindSpeakButtons } from './speech.js';

/**
 * 詞性代碼對中文標籤。與 core/schema.js 的 POS_KEYS 對齊。
 */
const POS_LABEL = {
  noun: '名詞',
  verb: '動詞',
  adjective: '形容詞',
  adverb: '副詞',
  other: '其他',
};

/**
 * 搜尋輸入的去抖延遲（毫秒）。
 * 題庫只有 80 多筆，整份重畫本身很快，但逐字元重繪會讓輸入手感變黏。
 */
const DEBOUNCE_MS = 120;

/**
 * HTML 逸出，避免題庫內容裡的角括號或引號破壞結構
 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');


/**
 * 一張單字卡。
 *
 * .word 是 div 不是 button，所以裡面放朗讀按鈕不會形成巢狀按鈕。
 */
function wordCard(word, lang) {
  const reading = word.reading ? `<span class="word-reading">${esc(word.reading)}</span>` : '';
  const romaji = word.romaji ? `<span class="word-romaji">${esc(word.romaji)}</span>` : '';

  return `
    <div class="word">
      <div class="word-main">
        <div>
          <span class="word-target">${esc(word.target)}</span>${reading}${romaji}
        </div>
        <div class="word-zh">${esc(word.zh)}</div>
      </div>
      <div class="word-tags">
        <span class="tag">${esc(POS_LABEL[word.pos] || word.pos)}</span>
        <span class="tag">${esc(word.categoryLabel)}</span>
        <span class="tag">Lv${esc(word.level)}</span>
      </div>
      <button type="button" class="speak" data-speak="${esc(speakTextOf(word, lang))}"
              data-speak-lang="${esc(lang)}" title="朗讀">🔊</button>
    </div>`;
}

/**
 * 分類篩選膠囊。第一顆固定是「全部」，其餘由題庫推導，
 * 所以不會出現一個點下去是空清單的分類。
 */
function chipsHtml(categories, total) {
  const all = `<button type="button" class="chip" data-category="all" aria-pressed="true">全部<span class="n">${total}</span></button>`;
  const rest = categories
    .map(
      (c) =>
        `<button type="button" class="chip" data-category="${esc(c.key)}" aria-pressed="false">` +
        `${esc(c.label)}<span class="n">${c.count}</span></button>`
    )
    .join('');
  return all + rest;
}

/**
 * 初始化單字頁。
 *
 * mount 內部的結構由上而下是：搜尋框、分類膠囊、筆數行、單字清單、進測驗按鈕。
 * 只有筆數行與單字清單會重繪，其餘元素建立一次就固定住。
 */
export function initVocabPage({ lang, words, mount, noticeHost } = {}) {
  if (!mount) return;

  const all = words || [];
  const categories = listCategories(all);

  /* 先把分類的中文標籤併回每一筆，卡片渲染時就不必再查表 */
  const labelOf = new Map(categories.map((c) => [c.key, c.label]));
  const items = all.map((w) => ({ ...w, categoryLabel: labelOf.get(w.category) || w.category }));

  mount.innerHTML = `
    <input class="field" type="search" placeholder="搜尋中文、英文或拼音…" aria-label="搜尋單字">
    <div class="chips" role="group" aria-label="依主題篩選">${chipsHtml(categories, all.length)}</div>
    <p class="count-line"></p>
    <div class="word-list"></div>
    <div class="actions">
      <a class="btn" href="./quiz.html?source=words">開始單字測驗</a>
    </div>`;

  const input = mount.querySelector('.field');
  const chips = mount.querySelector('.chips');
  const countLine = mount.querySelector('.count-line');
  const list = mount.querySelector('.word-list');

  const state = { category: 'all', query: '' };

  /**
   * 依目前狀態重畫清單與筆數。
   * 筆數一律取自實際渲染的陣列長度，不另外算，才不會和畫面對不起來。
   */
  function render() {
    const shown = filterWords(items, state);
    countLine.textContent = `目前 ${shown.length} 筆`;
    list.innerHTML = shown.length
      ? shown.map((w) => wordCard(w, lang)).join('')
      : '<div class="empty">找不到符合的單字</div>';
  }

  /* 搜尋：加去抖，避免每敲一個字元就重畫整份清單 */
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = input.value;
      render();
    }, DEBOUNCE_MS);
  });

  /* 分類：用事件委派，膠囊只建立一次 */
  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip || !chips.contains(chip)) return;
    state.category = chip.dataset.category;
    chips.querySelectorAll('.chip').forEach((c) => {
      c.setAttribute('aria-pressed', String(c === chip));
    });
    render();
  });

  render();

  /* 朗讀用事件委派掛在 mount 上，清單重繪後新卡片照樣可點 */
  applySpeechFallback(lang, noticeHost);
  bindSpeakButtons(mount, lang);
}
