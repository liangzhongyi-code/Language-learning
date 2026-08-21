/**
 * 發音頁的畫面組裝：英文字母卡與日文假名表。
 *
 * 兩頁共用同一組視覺元件（.kana-grid / .kana），差別只在格子內容與排法：
 *   - 英文：26 張卡，auto-fill 流式排列，卡上多一行 IPA 與可獨立朗讀的例字
 *   - 日文：四個 <details> 區塊，每個區塊是固定欄數的假名表，缺的段位補空白格
 *
 * 朗讀全部交給 speech.js 的 bindSpeakButtons 事件委派處理。
 * 卡片本身也帶 data-speak，所以「點卡片唸單元、點例字喇叭唸例字」
 * 由同一個委派解決，不需要再掛第二個點擊監聽——多掛一個反而會讓
 * 同一次點擊被處理兩次（stopPropagation 擋不住同一節點上的其他監聽器）。
 */

import { applySpeechFallback, bindSpeakButtons } from './speech.js';
import { loadPrefs, setPref } from './prefs.js';

/**
 * HTML 逸出，避免資料裡的角括號或引號破壞結構
 */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ══════════════════════════════════════════════════════════
   英文字母頁
   ══════════════════════════════════════════════════════════ */

/**
 * 一張字母卡。
 *
 * .kana 本身是 <button>，所以例字的朗讀入口只能用 <span class="speak">，
 * 巢狀 <button> 是無效 HTML，瀏覽器會把結構拆開。
 */
function letterCardHtml(letter) {
  return (
    `<button class="kana" data-speak="${esc(letter.upper)}" data-speak-lang="en">` +
    `<div class="glyph">${esc(letter.upper)}<em>${esc(letter.lower)}</em></div>` +
    `<div class="ipa">${esc(letter.ipa)}</div>` +
    '<div class="ex-row">' +
    `<span class="example">${esc(letter.exampleWord)} ${esc(letter.exampleZh)}</span>` +
    `<span class="speak" data-speak="${esc(letter.exampleWord)}" data-speak-lang="en"` +
    ' title="朗讀例字" aria-label="朗讀例字">🔊</span>' +
    '</div>' +
    '</button>'
  );
}

/**
 * 掛載英文字母頁。
 *
 * letters 依大寫字母排序後輸出，不倚賴資料檔本身的順序。
 */
export function initAlphabetPage({ letters, mount, noticeHost } = {}) {
  if (!mount) return;

  const ordered = [...(letters || [])].sort((a, b) => a.upper.localeCompare(b.upper, 'en'));

  mount.innerHTML =
    '<div class="kana-grid letter-grid">' + ordered.map(letterCardHtml).join('') + '</div>';

  applySpeechFallback('en', noticeHost);
  bindSpeakButtons(mount, 'en');
}

/* ══════════════════════════════════════════════════════════
   日文假名頁
   ══════════════════════════════════════════════════════════ */

/**
 * 五段（清音／濁音／半濁音共用）
 */
const VOWEL_COLUMNS = ['a', 'i', 'u', 'e', 'o'];

/**
 * 拗音的三段
 */
const YOUON_COLUMNS = ['ya', 'yu', 'yo'];

/**
 * 四個區塊的行列定義。
 * rows 用資料檔的 row 欄位，columns 用 column 欄位，
 * 交集找不到資料的位置就是表格裡該留的空位。
 */
const SECTIONS = [
  {
    type: 'seion',
    label: '清音',
    rows: ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', 'ん'],
    columns: VOWEL_COLUMNS,
  },
  {
    type: 'dakuon',
    label: '濁音',
    rows: ['が', 'ざ', 'だ', 'ば'],
    columns: VOWEL_COLUMNS,
  },
  {
    type: 'handakuon',
    label: '半濁音',
    rows: ['ぱ'],
    columns: VOWEL_COLUMNS,
  },
  {
    type: 'youon',
    label: '拗音',
    rows: ['き', 'し', 'ち', 'に', 'ひ', 'み', 'り', 'ぎ', 'じ', 'び', 'ぴ'],
    columns: YOUON_COLUMNS,
  },
];

/**
 * 假名顯示模式
 */
const MODES = [
  { key: 'hiragana', label: '平假名' },
  { key: 'katakana', label: '片假名' },
  { key: 'both', label: '兩者並列' },
];

/**
 * 依模式決定 glyph 要顯示什麼。
 * both 模式把片假名放進 <em>，CSS 會把它縮小並淡化成附註。
 */
function glyphHtml(item, mode) {
  if (mode === 'hiragana') return esc(item.hiragana);
  if (mode === 'katakana') return esc(item.katakana);
  return `${esc(item.hiragana)}<em>${esc(item.katakana)}</em>`;
}

/**
 * 一格假名。item 為 null 代表這個段位沒有假名，
 * output 一個 .kana.blank 佔位格讓後面的格子不會往前遞補。
 *
 * 拗音的 hiragana／katakana 本來就是兩個字元，直接整串交給語音引擎，
 * 不會被拆成兩次朗讀。
 */
function kanaCellHtml(item, mode) {
  if (!item) return '<div class="kana blank"></div>';

  const speakText = mode === 'katakana' ? item.katakana : item.hiragana;
  const sub = item.seionSource ? `<div class="sub">← ${esc(item.seionSource)}</div>` : '';

  return (
    `<button class="kana" data-speak="${esc(speakText)}" data-speak-lang="ja">` +
    `<div class="glyph">${glyphHtml(item, mode)}</div>` +
    `<div class="romaji">${esc(item.romaji)}</div>` +
    sub +
    `<div class="example">${esc(item.exampleWord)} ${esc(item.exampleZh)}</div>` +
    '</button>'
  );
}

/**
 * 產生一個區塊的所有格子。
 * 每一行固定輸出 columns.length 格，缺的補空白格，表格才會真的對齊成格狀。
 */
function sectionGridHtml(section, items, mode) {
  return section.rows
    .map((row) => {
      const cells = section.columns
        .map((column) => {
          const item = items.find(
            (k) => k.type === section.type && k.row === row && k.column === column
          );
          return kanaCellHtml(item || null, mode);
        })
        .join('');
      return `<div class="kana-row">${cells}</div>`;
    })
    .join('');
}

/**
 * 模式切換列
 */
function chipsHtml(mode) {
  const chips = MODES.map(
    (m) =>
      `<button class="chip" data-mode="${m.key}" aria-pressed="${m.key === mode}">` +
      `${esc(m.label)}</button>`
  ).join('');
  return `<div class="chips" role="group" aria-label="假名顯示模式">${chips}</div>`;
}

/**
 * 掛載日文假名頁。
 *
 * 四個區塊只建立一次，切換模式時僅重填格子內容，
 * 這樣 <details> 的展開／收合狀態不會被重繪洗掉。
 */
export function initKanaPage({ kana, mount, noticeHost } = {}) {
  if (!mount) return;

  const items = kana || [];
  const known = MODES.some((m) => m.key === loadPrefs().kanaMode);
  let mode = known ? loadPrefs().kanaMode : 'both';

  const sectionsHtml = SECTIONS.map((section, index) => {
    const count = items.filter((k) => k.type === section.type).length;
    const columns = section.columns.length;
    return (
      `<details class="kana-section"${index === 0 ? ' open' : ''}>` +
      `<summary>${esc(section.label)}<span class="n">${count} 個</span></summary>` +
      `<div class="kana-grid" data-section="${section.type}"` +
      ` style="grid-template-columns:repeat(${columns},minmax(0,1fr))"></div>` +
      '</details>'
    );
  }).join('');

  mount.innerHTML = chipsHtml(mode) + sectionsHtml;

  /**
   * 依目前模式重填四個區塊的格子
   */
  const paint = () => {
    SECTIONS.forEach((section) => {
      const grid = mount.querySelector(`.kana-grid[data-section="${section.type}"]`);
      if (grid) grid.innerHTML = sectionGridHtml(section, items, mode);
    });
  };

  paint();

  mount.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip[data-mode]');
    if (!chip || !mount.contains(chip)) return;

    mode = chip.dataset.mode;
    setPref('kanaMode', mode);
    mount
      .querySelectorAll('.chip[data-mode]')
      .forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.mode === mode)));
    paint();
  });

  applySpeechFallback('ja', noticeHost);
  bindSpeakButtons(mount, 'ja');
}
