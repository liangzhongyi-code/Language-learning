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

import {
  listCategories,
  listLevels,
  filterWords,
  groupState,
  selectionSummary,
} from '../core/filter.js';
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
 * 一列可勾選的項目。
 * 用 label 包住 input，點文字也能勾，手機上才不必瞄準那個小方格。
 */
function optionRow(item, attr) {
  const title = item.desc ? ` title="${esc(item.desc)}"` : '';
  const count = item.count === undefined ? '' : `<span class="n">${item.count}</span>`;
  return `
    <label class="opt-check"${title}>
      <input type="checkbox" data-${esc(attr)}="${esc(item.key)}" checked>
      <span class="opt-label">${esc(item.label)}</span>
      ${count}
    </label>`;
}

/**
 * 收合式的多選篩選面板。
 *
 * 用 details/summary 而不是自刻收合：開合、鍵盤操作與螢幕閱讀器的
 * 展開狀態都由瀏覽器處理，不必自己維護 aria-expanded。
 *
 * groups 每一項若有 label 就多一個群組勾選格，勾它等於底下小項目全選；
 * 沒有 label 就攤平（等級只有五項，不需要分群）。
 */
function filterPanelHtml({ key, name, groups, note, attr }) {
  const body = groups
    .map((g) =>
      g.label
        ? `<div class="opt-group">
             <label class="opt-check is-group">
               <input type="checkbox" data-group="${esc(g.key)}" checked>
               <span class="opt-label">${esc(g.label)}</span>
             </label>
             <div class="opt-children">${g.items.map((i) => optionRow(i, attr)).join('')}</div>
           </div>`
        : `<div class="opt-children is-flat">${g.items.map((i) => optionRow(i, attr)).join('')}</div>`
    )
    .join('');

  return `
    <details class="filter" data-filter="${esc(key)}">
      <summary>
        <span class="filter-name">${esc(name)}</span>
        <span class="filter-state" data-state>全部</span>
      </summary>
      <div class="filter-body">
        <div class="filter-actions">
          <button type="button" class="link-btn" data-all>全選</button>
          <button type="button" class="link-btn" data-none>全部清除</button>
        </div>
        ${body}
        ${note ? `<p class="note-line">${esc(note)}</p>` : ''}
      </div>
    </details>`;
}

/**
 * 把分類清單依 CATEGORY_GROUPS 排成群組。
 * 沒歸到任何一組的收在最後的「其他」，不會憑空消失。
 */
function groupCategories(categories) {
  const byKey = new Map(categories.map((c) => [c.key, c]));
  const groups = CATEGORY_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.keys.map((k) => byKey.get(k)).filter(Boolean),
  })).filter((g) => g.items.length);

  const claimed = new Set(CATEGORY_GROUPS.flatMap((g) => g.keys));
  const rest = categories.filter((c) => !claimed.has(c.key));
  if (rest.length) groups.push({ key: 'other', label: '其他', items: rest });
  return groups;
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

  /* 等級只有一種時整個面板都不必出現，題庫剛匯入時會有這種階段 */
  const levelPanel =
    levels.length < 2
      ? ''
      : filterPanelHtml({
          key: 'level',
          name: SCALE_NAME[lang] || '等級',
          attr: 'level',
          note: SCALE_NOTE[lang],
          groups: [{ items: levels.map((l) => ({ key: String(l.level), label: l.label, count: l.count, desc: l.desc })) }],
        });

  mount.innerHTML = `
    <input class="field" type="search" placeholder="搜尋中文、英文或拼音…" aria-label="搜尋單字">
    <div class="filter-bar">
      ${levelPanel}
      ${filterPanelHtml({
        key: 'category',
        name: '主題',
        attr: 'category',
        groups: groupCategories(categories),
      })}
    </div>
    <p class="count-line"></p>
    <div class="word-list"></div>
    <div class="actions">
      <a class="btn" href="./quiz.html?source=words">開始單字測驗</a>
    </div>`;

  const input = mount.querySelector('[type="search"]');
  const countLine = mount.querySelector('.count-line');
  const list = mount.querySelector('.word-list');

  /**
   * 兩個篩選都是多選，預設全選——使用者是「取消不要的」而不是「一個一個挑」。
   *
   * 推導不出任何值時要退回 'all' 而不是留空陣列。
   * 空陣列在 filterWords 的語意是「一筆都不留」，
   * 而等級清單來自 levels.js 的靜態表，語言代碼對不上就會是空的，
   * 那時整頁單字會憑空消失，看起來像資料壞掉。
   */
  const state = {
    category: categories.length ? categories.map((c) => c.key) : 'all',
    level: levels.length ? levels.map((l) => String(l.level)) : 'all',
    query: '',
  };

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
   * 把面板目前的勾選狀況同步到 state、群組三態與標題摘要。
   *
   * 群組格子的 indeterminate 只能用 JS 設，寫不進 HTML，
   * 所以每次變動都要重算一遍，不能只在建立時設一次。
   */
  function syncPanel(panel, attr) {
    const boxes = [...panel.querySelectorAll(`[data-${attr}]`)];
    const selected = new Set(boxes.filter((b) => b.checked).map((b) => b.dataset[attr]));
    state[attr] = [...selected];

    for (const groupBox of panel.querySelectorAll('[data-group]')) {
      const childKeys = [...groupBox.closest('.opt-group').querySelectorAll(`[data-${attr}]`)]
        .map((b) => b.dataset[attr]);
      const st = groupState(childKeys, selected);
      groupBox.checked = st === 'all';
      groupBox.indeterminate = st === 'partial';
    }

    const labels = boxes
      .filter((b) => b.checked)
      .map((b) => b.closest('.opt-check').querySelector('.opt-label').textContent);
    panel.querySelector('[data-state]').textContent = selectionSummary(labels, boxes.length);
  }

  /**
   * 一個篩選面板的全部互動：勾選、群組連動、全選、全部清除。
   */
  function bindPanel(panel, attr) {
    if (!panel) return;

    panel.addEventListener('change', (event) => {
      const box = event.target;
      if (box.type !== 'checkbox') return;

      /* 群組格子帶動底下的小項目一起開關 */
      if (box.dataset.group !== undefined) {
        panel
          .querySelectorAll(`[data-${attr}]`)
          .forEach((child) => {
            if (box.closest('.opt-group').contains(child)) child.checked = box.checked;
          });
      }
      syncPanel(panel, attr);
      reset();
    });

    panel.addEventListener('click', (event) => {
      const selectAll = event.target.closest('[data-all]');
      if (!selectAll && !event.target.closest('[data-none]')) return;
      panel.querySelectorAll(`[data-${attr}]`).forEach((b) => {
        b.checked = Boolean(selectAll);
      });
      syncPanel(panel, attr);
      reset();
    });

    syncPanel(panel, attr);
  }

  bindPanel(mount.querySelector('[data-filter="level"]'), 'level');
  bindPanel(mount.querySelector('[data-filter="category"]'), 'category');

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
