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

import { listCategories, listLevels, filterWords } from '../core/filter.js';
import { CATEGORY_GROUPS } from '../data/shared/categories.js';
import { levelLabel, SCALE_NAME, SCALE_NOTE } from '../data/shared/levels.js';
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
 * 逐字元重繪會讓輸入手感變黏，尤其題庫上千筆之後。
 */
const DEBOUNCE_MS = 120;

/**
 * 一次最多畫幾張卡。
 *
 * 匯入多益與日檢題庫後單一語言會有數千筆，
 * 全部塞進 innerHTML 會讓每次篩選都卡住主執行緒好幾百毫秒。
 * 超過上限就先畫這麼多，剩下的由使用者按鈕決定要不要展開。
 */
const PAGE_SIZE = 300;

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
        <span class="tag">${esc(word.levelLabel)}</span>
      </div>
      <button type="button" class="speak" data-speak="${esc(speakTextOf(word, lang))}"
              data-speak-lang="${esc(lang)}" title="朗讀">🔊</button>
    </div>`;
}

/**
 * 分類篩選膠囊。第一顆固定是「全部」，其餘由題庫推導，
 * 所以不會出現一個點下去是空清單的分類。
 */
function categorySelectHtml(categories, total) {
  const byKey = new Map(categories.map((c) => [c.key, c]));

  /* 依 CATEGORY_GROUPS 的順序分組，沒歸類到任何一組的收在最後 */
  const grouped = CATEGORY_GROUPS.map((g) => ({
    label: g.label,
    items: g.keys.map((k) => byKey.get(k)).filter(Boolean),
  })).filter((g) => g.items.length);

  const claimed = new Set(CATEGORY_GROUPS.flatMap((g) => g.keys));
  const rest = categories.filter((c) => !claimed.has(c.key));
  if (rest.length) grouped.push({ label: '其他', items: rest });

  const option = (c) =>
    `<option value="${esc(c.key)}">${esc(c.label)}（${c.count}）</option>`;

  const groups = grouped
    .map((g) => `<optgroup label="${esc(g.label)}">${g.items.map(option).join('')}</optgroup>`)
    .join('');

  return `
    <div class="select-wrap">
      <select class="field select" data-category-select aria-label="依主題篩選">
        <option value="all">全部主題（${total}）</option>
        ${groups}
      </select>
    </div>`;
}

/**
 * 等級篩選膠囊。
 *
 * 只有題庫實際涵蓋兩個以上等級時才輸出——題庫是分批匯入的，
 * 剛開始只有一個等級時多一排只能點「全部」的按鈕是純粹的噪音。
 */
function levelChipsHtml(levels, total, lang) {
  if (levels.length < 2) return '';
  const all = `<button type="button" class="chip" data-level="all" aria-pressed="true">全部<span class="n">${total}</span></button>`;
  const rest = levels
    .map(
      (l) =>
        `<button type="button" class="chip" data-level="${l.level}" aria-pressed="false" ` +
        `title="${esc(l.desc)}">${esc(l.label)}<span class="n">${l.count}</span></button>`
    )
    .join('');
  return `
    <div class="chips" role="group" aria-label="依${esc(SCALE_NAME[lang] || '等級')}篩選">${all}${rest}</div>
    <p class="note-line">${esc(SCALE_NOTE[lang] || '')}</p>`;
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
  const levels = listLevels(all, lang);

  /* 先把分類與等級的標籤併回每一筆，卡片渲染時就不必再查兩張表 */
  const labelOf = new Map(categories.map((c) => [c.key, c.label]));
  const items = all.map((w) => ({
    ...w,
    categoryLabel: labelOf.get(w.category) || w.category,
    levelLabel: levelLabel(lang, w.level),
  }));

  mount.innerHTML = `
    <input class="field" type="search" placeholder="搜尋中文、英文或拼音…" aria-label="搜尋單字">
    ${levelChipsHtml(levels, all.length, lang)}
    ${categorySelectHtml(categories, all.length)}
    <p class="count-line"></p>
    <div class="word-list"></div>
    <div class="actions">
      <a class="btn" href="./quiz.html?source=words">開始單字測驗</a>
    </div>`;

  const input = mount.querySelector('[type="search"]');
  const levelChips = mount.querySelector('[data-level]')?.closest('.chips') || null;
  const categorySelect = mount.querySelector('[data-category-select]');
  const countLine = mount.querySelector('.count-line');
  const list = mount.querySelector('.word-list');

  const state = { category: 'all', level: 'all', query: '' };

  /* 目前這一組篩選結果要畫幾筆。換篩選條件時歸零回 PAGE_SIZE */
  let limit = PAGE_SIZE;

  /**
   * 依目前狀態重畫清單與筆數。
   * 筆數一律取自實際篩選結果的長度，不另外算，才不會和畫面對不起來；
   * 超過上限時只畫前 limit 筆，並在清單尾端補一顆展開按鈕。
   */
  function render() {
    const shown = filterWords(items, state);

    if (!shown.length) {
      countLine.textContent = '目前 0 筆';
      list.innerHTML = '<div class="empty">找不到符合的單字</div>';
      return;
    }

    const visible = shown.slice(0, limit);
    const rest = shown.length - visible.length;

    countLine.textContent = rest
      ? `目前 ${shown.length} 筆，先顯示 ${visible.length} 筆`
      : `目前 ${shown.length} 筆`;

    list.innerHTML =
      visible.map((w) => wordCard(w, lang)).join('') +
      (rest
        ? `<div class="actions"><button type="button" class="btn" data-more>` +
          `再顯示 ${Math.min(rest, PAGE_SIZE)} 筆（還有 ${rest} 筆）</button></div>`
        : '');
  }

  /**
   * 換篩選條件時重畫並把展開狀態收回去。
   * 不收回的話，從「全部 4000 筆」切到某個分類會沿用上一次展開的巨大 limit，
   * 使用者會以為篩選沒作用。
   */
  function reset() {
    limit = PAGE_SIZE;
    render();
  }

  /* 搜尋：加去抖，避免每敲一個字元就重畫整份清單 */
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = input.value;
      reset();
    }, DEBOUNCE_MS);
  });

  /**
   * 膠囊列共用的點擊處理：同一列內只有一顆是按下狀態。
   * 分類與等級兩列的差別只有寫進 state 的哪個欄位，所以共用這一支。
   */
  function bindChips(row, field, attr) {
    if (!row) return;
    row.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip || !row.contains(chip)) return;
      state[field] = chip.dataset[attr];
      row.querySelectorAll('.chip').forEach((c) => {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      reset();
    });
  }

  bindChips(levelChips, 'level', 'level');

  categorySelect.addEventListener('change', () => {
    state.category = categorySelect.value;
    reset();
  });

  /* 展開更多：每按一次多畫一頁，事件委派掛在清單上，重繪後照樣有效 */
  list.addEventListener('click', (event) => {
    if (!event.target.closest('[data-more]')) return;
    limit += PAGE_SIZE;
    render();
  });

  render();

  /* 朗讀用事件委派掛在 mount 上，清單重繪後新卡片照樣可點 */
  applySpeechFallback(lang, noticeHost);
  bindSpeakButtons(mount, lang);
}
