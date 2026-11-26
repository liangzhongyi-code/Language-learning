/**
 * 發音頁的畫面組裝：英文字母卡與日文假名表。
 *
 * 兩頁共用同一組視覺元件（.kana-grid / .kana），差別只在格子內容與排法：
 *   - 英文：26 張卡，auto-fill 流式排列，卡上多一行 IPA 與可獨立朗讀的例字
 *   - 日文：五十音對照表，四個 <details> 區塊；格子由 kana-chart.js 產生，與測驗頁的小抄共用
 *
 * 朗讀全部交給 speech.js 的 bindSpeakButtons 事件委派處理。
 * 卡片本身也帶 data-speak，所以「點卡片唸單元、點例字喇叭唸例字」
 * 由同一個委派解決，不需要再掛第二個點擊監聽——多掛一個反而會讓
 * 同一次點擊被處理兩次（stopPropagation 擋不住同一節點上的其他監聽器）。
 */

import { applySpeechFallback, bindSpeakButtons } from './speech.js';
import { loadPrefs, setPref } from './prefs.js';
import { KANA_SECTIONS, kanaGridHtml } from './kana-chart.js';
import { KANA_SCRIPTS } from '../core/kana-quiz.js';
import { COMBO_RULES, kanaToRomaji } from '../core/kana-combo.js';

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
 * 假名顯示模式
 */
const MODES = [
  { key: 'hiragana', label: '平假名' },
  { key: 'katakana', label: '片假名' },
  { key: 'both', label: '平假名＋片假名' },
];

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
 * 給第一次看這張表的人的說明
 */
function introHtml() {
  return `
    <div class="card kana-intro">
      <h2>怎麼看這張表</h2>
      <ul>
        <li>日文的每個音有兩種寫法：<b>平假名</b>（左邊，<span lang="ja">あ</span>）和<b>片假名</b>（右邊，<span lang="ja">ア</span>），唸法一模一樣。下面的英文字母是<b>羅馬音</b>，也就是唸法。</li>
        <li>橫著看是同一行、同一個子音（か行：ka ki ku ke ko）；直著看是同一個母音（a 那一直排：a ka sa ta…）。</li>
        <li>點格子會唸給你聽。先背清音 46 個平假名，其他都是從它變出來的。</li>
      </ul>
      <p class="setting-label">看過一遍就來練選擇題</p>
      <div class="actions">${KANA_SCRIPTS.map((s, i) =>
        `<a class="btn${i ? ' ghost' : ''}" href="./quiz.html?source=kana&amp;script=${s.key}">練${esc(s.label)}</a>`).join('')}</div>
    </div>`;
}

/**
 * 組合讀法的例詞。羅馬音由 core 轉出，與題庫同一套規則，不在這裡手打。
 */
const COMBO_EXAMPLES = [
  { kana: 'きょう', kanji: '今日', zh: '今天', rule: 'youon' },
  { kana: 'でんしゃ', kanji: '電車', zh: '電車', rule: 'youon' },
  { kana: 'きって', kanji: '切手', zh: '郵票', rule: 'sokuon' },
  { kana: 'がっこう', kanji: '学校', zh: '學校', rule: 'sokuon' },
  { kana: 'せんせい', kanji: '先生', zh: '老師', rule: 'chouon' },
  { kana: 'おかあさん', kanji: 'お母さん', zh: '媽媽', rule: 'chouon' },
  { kana: 'コーヒー', kanji: '', zh: '咖啡', rule: 'chouon' },
];

/**
 * 「兩個假名放一起」與「漢字怎麼唸」的說明，放在對照表最後：
 * 表上一格一格的唸法背熟了，接下來會遇到的就是這兩件事。
 */
function comboHtml() {
  const cards = COMBO_EXAMPLES.map((e) =>
    `<button class="kana" type="button" data-speak="${esc(e.kana)}" data-speak-lang="ja">` +
    `<span class="glyph" lang="ja">${esc(e.kana)}</span>` +
    `<span class="romaji">${esc(kanaToRomaji(e.kana))}</span>` +
    `<span class="example">${e.kanji ? `${esc(e.kanji)}・` : ''}${esc(e.zh)}</span>` +
    '</button>').join('');
  return `
    <div class="card kana-intro kana-combo-intro">
      <h2>兩個假名放一起：組合讀法</h2>
      <p class="setting-note">一個一個唸的規則背熟之後，最容易卡住的是假名連在一起時，唸法會變。只有三條：</p>
      <ul class="combo-rules">${COMBO_RULES.map((r) => `<li><b>${esc(r.label)}</b>　${esc(r.note)}</li>`).join('')}</ul>
      <div class="combo-examples">${cards}</div>
      <h2>漢字又怎麼唸？</h2>
      <ul>
        <li>漢字沒有一張表可以查唸法。同一個字常有兩種以上的讀法：跟著中文借來的<b>音讀</b>，和日本原有的<b>訓讀</b>。例如 <span lang="ja">山</span> 單獨用唸 <span lang="ja">やま</span>，在 <span lang="ja">富士山</span> 裡唸 <span lang="ja">さん</span>。</li>
        <li>也有整個詞一起唸、拆不開的，例如 <span lang="ja">今日</span> 唸 <span lang="ja">きょう</span>。</li>
        <li>所以漢字的讀音要連同整個詞一起記。測驗頁「組合讀法」的「看漢字選讀音」就是在練這個；單字題也可以把漢字切成標假名。</li>
      </ul>
      <div class="actions">
        <a class="btn" href="./quiz.html?source=kana&amp;kind=combo">練組合讀法（進階）</a>
      </div>
    </div>`;
}

/**
 * 掛載五十音對照表頁。
 *
 * 四個區塊只建立一次，切換模式時僅重填格子內容，
 * 這樣 <details> 的展開／收合狀態不會被重繪洗掉。
 */
export function initKanaPage({ kana, mount, noticeHost } = {}) {
  if (!mount) return;

  const items = kana || [];
  const known = MODES.some((m) => m.key === loadPrefs().kanaMode);
  let mode = known ? loadPrefs().kanaMode : 'both';

  const sectionsHtml = KANA_SECTIONS.map((section, index) => {
    const count = items.filter((k) => k.type === section.type).length;
    return (
      `<details class="kana-section"${index === 0 ? ' open' : ''}>` +
      `<summary>${esc(section.label)}<span class="n">${count} 個</span></summary>` +
      `<p class="setting-note">${esc(section.note)}</p>` +
      `<div data-grid="${section.type}"></div>` +
      '</details>'
    );
  }).join('');

  mount.innerHTML = introHtml() + chipsHtml(mode) + sectionsHtml + comboHtml();

  /**
   * 依目前模式重填四個區塊的格子
   */
  const paint = () => {
    KANA_SECTIONS.forEach((section) => {
      const host = mount.querySelector(`[data-grid="${section.type}"]`);
      if (host) host.innerHTML = kanaGridHtml(section, items, mode);
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
