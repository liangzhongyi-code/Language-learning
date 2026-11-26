/**
 * 漢字表頁：N5 常用漢字，日本寫法對照繁體、音讀與訓讀、單字題庫裡的例詞。
 *
 * 給繁體中文使用者看，所以重點放在兩件事：
 *   寫法跟繁體不一樣的字（学／學）要一眼看出來；
 *   讀音——字義多半猜得到，唸法猜不到。
 * 例詞的朗讀用假名讀音，單獨把漢字丟給語音引擎常會唸成別的讀法。
 */

import { applySpeechFallback, bindSpeakButtons, SPEAK_ICON } from './speech.js';
import { bindShadow, shadowButtonHtml } from './shadow.js';
import { KANJI_SCOPES, kanjiFilter, kanjiReadingSet } from '../core/kanji-quiz.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function introHtml(items) {
  const diff = items.filter((k) => k.char !== k.trad).length;
  return `
    <div class="card kana-intro">
      <h2>怎麼看這張表</h2>
      <ul>
        <li>日文的漢字大多跟繁體一樣，意思也接近；有 ${diff} 個字的日本寫法比較簡化（例如 学＝學），格子右上角會標出繁體。</li>
        <li>真正要背的是<b>讀音</b>。<b>音讀</b>（片假名）是當初跟著中文借來的唸法，多半用在兩個字以上的詞；<b>訓讀</b>（平假名）是日本原有的說法，多半是單獨一個字或後面接假名。</li>
        <li>同一個字在不同詞裡唸法會變，所以每個字都附上單字題庫裡的例詞，點朗讀鍵即可聽整個詞怎麼唸。</li>
      </ul>
      <div class="actions">
        <a class="btn" href="./quiz.html?source=kanji">練漢字讀音</a>
        <a class="btn ghost" href="./quiz.html?source=kanji&amp;scope=diff">只練寫法不同的</a>
      </div>
    </div>`;
}

function cardHtml(item) {
  const diff = item.char !== item.trad;
  return `<button class="kana kanji-cell${diff ? ' is-diff' : ''}" type="button" data-kanji="${esc(item.id)}" aria-label="${esc(`${item.char}，${item.meaning}`)}">
    <span class="glyph" lang="ja">${esc(item.char)}</span>
    ${diff ? `<span class="kanji-trad">${esc(item.trad)}</span>` : ''}
    <span class="example">${esc(item.meaning)}</span>
  </button>`;
}

function detailHtml(item) {
  const diff = item.char !== item.trad;
  const examples = (item.examples || []).map((e) => `
      <li class="kanji-example">
        <span lang="ja" class="kanji-word">${esc(e.word)}</span>
        <span lang="ja" class="kanji-word-reading">${esc(e.reading)}</span>
        <span class="kanji-word-zh">${esc(e.zh)}</span>
        <button class="speak" type="button" data-speak="${esc(e.reading)}" data-speak-lang="ja" title="朗讀" aria-label="朗讀 ${esc(e.word)}">${SPEAK_ICON}</button>
        ${shadowButtonHtml({ target: e.word, reading: e.reading })}
      </li>`).join('');
  return `
    <div class="card kanji-detail" data-kanji-detail="${esc(item.id)}">
      <div class="kanji-detail-head">
        <span class="kanji-big" lang="ja">${esc(item.char)}</span>
        <div>
          <p class="kanji-meaning">${esc(item.meaning)}</p>
          <p class="setting-note">${diff ? `繁體寫成 <b>${esc(item.trad)}</b>。${esc(item.diff)}` : '寫法和繁體相同。'}</p>
        </div>
        <button class="btn ghost kanji-close" type="button" data-kanji-close aria-label="關閉">✕</button>
      </div>
      <p class="kanji-readings" lang="ja">${esc(kanjiReadingSet(item))}</p>
      ${item.note ? `<p class="setting-note">${esc(item.note)}</p>` : ''}
      <p class="setting-label">例詞</p>
      <ul class="kanji-examples">${examples}</ul>
    </div>`;
}

/**
 * 掛載漢字表頁。範圍切換只重畫格子，展開的詳細資料跟著目前選的字走。
 */
export function initKanjiPage({ kanji, mount, noticeHost } = {}) {
  if (!mount) return;
  const items = kanji || [];
  let scope = 'all';
  let selected = null;

  const paint = () => {
    const list = kanjiFilter(items, { scope });
    mount.querySelector('[data-kanji-grid]').innerHTML = list.map(cardHtml).join('');
    mount.querySelector('[data-kanji-count]').textContent = `${list.length} 個字`;
    mount.querySelectorAll('[data-scope]').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.scope === scope)));
  };

  const emptyDetailHtml = () => `
    <div class="card kanji-empty">
      <p class="kanji-empty-title">點選左側漢字</p>
      <p class="setting-note">這裡會常駐顯示繁簡寫法對照、音讀與訓讀，以及例詞朗讀與跟讀工具，瀏覽時不必反覆捲動。</p>
    </div>`;

  const show = (id) => {
    selected = items.find((k) => k.id === id) || null;
    const host = mount.querySelector('[data-kanji-host]');
    host.innerHTML = selected ? detailHtml(selected) : emptyDetailHtml();
    mount.querySelectorAll('[data-kanji]').forEach((cell) => cell.setAttribute('aria-pressed', String(cell.dataset.kanji === id)));
    if (selected && window.innerWidth < 960) host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  mount.innerHTML = `${introHtml(items)}
    <div class="chips" role="group" aria-label="漢字範圍">${KANJI_SCOPES.map((s) =>
      `<button class="chip" type="button" data-scope="${s.key}" aria-pressed="${s.key === scope}">${esc(s.label)}</button>`).join('')}
      <span class="setting-note kanji-count" data-kanji-count></span></div>
    <div class="split-workspace kanji-workspace">
      <div class="kana-grid kanji-grid" data-kanji-grid></div>
      <aside class="split-aside" data-kanji-host aria-label="漢字詳情">${emptyDetailHtml()}</aside>
    </div>`;
  paint();

  mount.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-scope]');
    if (chip) {
      scope = chip.dataset.scope;
      paint();
      return;
    }
    if (event.target.closest('[data-kanji-close]')) {
      show(null);
      return;
    }
    const cell = event.target.closest('[data-kanji]');
    if (cell) show(selected?.id === cell.dataset.kanji ? null : cell.dataset.kanji);
  });

  applySpeechFallback('ja', noticeHost);
  bindSpeakButtons(mount, 'ja');
  bindShadow(mount, { lang: 'ja' });
}
