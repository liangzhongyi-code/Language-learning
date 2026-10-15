/**
 * 文法句型頁的畫面層。
 *
 * 這一頁只做一件事：把中文與目標語言的語序差異畫出來。
 * 每個句子畫成上下兩排色塊，上排中文語序、下排目標語言語序，
 * 同一個語法角色用同一個顏色，被搬動的區塊另外標記。
 *
 * 排版與「哪一塊被搬動了」一律由 core/grammar-layout.js 決定，
 * 這裡不重算語序，只負責把資料變成 DOM，再把兩排之間的線畫起來。
 */

import { buildLayout } from '../core/grammar-layout.js';
import { listPatterns, filterSentences } from '../core/filter.js';
import { speakTextOf } from '../core/speech-text.js';
import { patternsOf } from '../data/shared/patterns.js';
import { applySpeechFallback, bindSpeakButtons } from './speech.js';
import { loadPrefs, setPref } from './prefs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 語言代碼對應的顯示名稱
 */
const LANG_LABEL = { en: '英文', ja: '日文' };

/**
 * HTML 逸出，避免題庫內容裡的角括號或引號破壞結構
 */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 節流成「最後一次呼叫之後才真的執行」，避免 resize 期間一直重畫
 */
function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

/**
 * 一個色塊的 HTML。
 * 下排的塊要能點來朗讀，所以掛上 data-speak 交給 speech.js 的委派處理；
 * 刻意用 div 而不是 button——裡面還有兩層 span，且巢狀按鈕在 .full-line 裡會出事。
 */
function blockHtml(block, { clickable, lang }) {
  const classes = ['blk', `r-${block.role}`];
  if (block.moved) classes.push('moved');
  if (block.isParticle) classes.push('particle');
  if (clickable) classes.push('clickable');

  const speakAttrs = clickable
    ? ` data-speak="${esc(block.text)}" data-speak-lang="${esc(lang)}"` +
      ` title="朗讀「${esc(block.text)}」" role="button" tabindex="0"`
    : '';

  return (
    `<div class="${classes.join(' ')}" data-k="${block.chunkIndex}"${speakAttrs}>` +
    `<span class="txt">${esc(block.text)}</span>` +
    `<span class="lbl">${esc(block.label)}</span>` +
    '</div>'
  );
}

/**
 * 一整張句型卡的 HTML
 */
function cardHtml(sentence, { lang, patternName }) {
  const { zhRow, targetRow } = buildLayout(sentence);
  const targetLabel = `${LANG_LABEL[lang] || lang}語序`;

  /* 日文朗讀整句要用假名讀音，直接唸漢字容易被唸成中文音或訓讀錯誤 */
  const fullSpeech = speakTextOf(sentence, lang);
  const readingHtml =
    lang === 'ja' && sentence.reading
      ? `<span class="word-reading">${esc(sentence.reading)}</span>`
      : '';

  return `
    <div class="card">
      <div class="gram">
        <div class="row-label">中文語序</div>
        <div class="row" data-row="zh">
          ${zhRow.map((b) => blockHtml(b, { clickable: false, lang })).join('')}
        </div>
        <div class="gap-mid"><svg aria-hidden="true"></svg></div>
        <div class="row" data-row="target">
          ${targetRow.map((b) => blockHtml(b, { clickable: true, lang })).join('')}
        </div>
        <div class="row-label">${esc(targetLabel)}</div>
      </div>
      <p class="note-line">${esc(sentence.note)}</p>
      <div class="full-line">
        <span>${esc(sentence.target)}</span>
        ${readingHtml}
        <button class="speak" type="button" data-speak="${esc(fullSpeech)}"
                data-speak-lang="${esc(lang)}" title="朗讀整句">🔊</button>
        <span class="meta">${esc(sentence.id)} · ${esc(patternName)}</span>
      </div>
    </div>`;
}

/**
 * 把一批卡片上下兩排 data-k 相同的區塊用貝茲曲線接起來。
 *
 * 座標一律用 getBoundingClientRect 現算：色塊會隨寬度換行，
 * 任何「記住上次算過的位置」都會在換行後失準。
 * 只畫呼叫端給的卡片（畫面附近那幾張）：一次量完全部 147 張會逼瀏覽器把整份清單排版，
 * 在手機上是上千毫秒的卡頓。回傳實際畫好的卡片。
 */
function drawLinks(cards) {
  /* 連接線關掉時 CSS 會把 svg 藏起來，這時算座標純屬浪費 */
  if (document.documentElement.classList.contains('no-lines')) return [];

  /**
   * 分兩階段跑：先把這批卡片的座標量完，再一次性動 DOM。
   * 「量一條、畫一條」交錯進行時，寫入 DOM 會讓下一次 getBoundingClientRect 被迫重新排版。
   */
  const plans = [];

  for (const card of cards) {
    const gram = card.querySelector('.gram');
    const gap = gram && gram.querySelector('.gap-mid');
    const svg = gap && gap.querySelector('svg');
    const zhRow = gram && gram.querySelector('.row[data-row="zh"]');
    const targetRow = gram && gram.querySelector('.row[data-row="target"]');
    if (!svg || !zhRow || !targetRow) continue;

    const box = gap.getBoundingClientRect();
    /* 卡片還沒有版面（例如被隱藏）時不畫，等下一次觸發 */
    if (!box.height) continue;

    const segments = [];
    zhRow.querySelectorAll('.blk').forEach((topBlock) => {
      const key = topBlock.dataset.k;
      const bottomBlock = targetRow.querySelector(`.blk[data-k="${key}"]`);
      /* 上排沒有的區塊（助詞）本來就不會走到這裡，這行是防呆 */
      if (!bottomBlock) return;

      const ra = topBlock.getBoundingClientRect();
      const rb = bottomBlock.getBoundingClientRect();

      segments.push({
        x1: ra.left + ra.width / 2 - box.left,
        x2: rb.left + rb.width / 2 - box.left,
        /*
         * y 也要現算。色塊在窄螢幕會換行，折到第二行的區塊離 .gap-mid 的
         * 上下緣有好幾十 px；若把端點寫死在 0 與 h，線就會懸在半空中，
         * 看起來像好幾條線都從同一塊長出來。svg 是 overflow: visible，
         * 所以端點超出 gap 範圍也畫得出來。
         */
        y1: ra.bottom - box.top,
        y2: rb.top - box.top,
        /*
         * 線的顏色跟著色塊走，才看得出是同一個角色：直接沿用色塊的角色 class，
         * 由 CSS 以 var(--blk) 上色。不再逐塊 getComputedStyle，切換配色時線也會跟著變。
         */
        role: [...topBlock.classList].find((name) => name.startsWith('r-')) || 'r-other',
        moved: topBlock.classList.contains('moved'),
      });
    });

    plans.push({ card, svg, segments });
  }

  /* 第二階段：量測全部結束，現在才動 DOM */
  for (const { svg, segments } of plans) {
    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      const path = document.createElementNS(SVG_NS, 'path');
      const mid = seg.y1 + (seg.y2 - seg.y1) / 2;
      path.setAttribute('d', `M${seg.x1},${seg.y1} C${seg.x1},${mid} ${seg.x2},${mid} ${seg.x2},${seg.y2}`);
      path.setAttribute('class', seg.moved ? `${seg.role} moved` : seg.role);
      frag.appendChild(path);
    }
    svg.textContent = '';
    svg.appendChild(frag);
  }
  return plans.map((plan) => plan.card);
}

/**
 * 只替畫面附近的卡片畫線。
 *
 * 卡片進入畫面附近才畫；版面變動（換寬度、字型載入、開關連接線）時只重畫目前看得到的，
 * 其餘卡片標成過期，捲到時再畫。沒有 IntersectionObserver 的舊瀏覽器退回全部重畫。
 */
function createLinkPainter() {
  const visible = new Set();
  const drawnAt = new WeakMap();
  let generation = 0;
  const paint = (cards) => {
    const stale = cards.filter((card) => drawnAt.get(card) !== generation);
    if (!stale.length || document.documentElement.classList.contains('no-lines')) return;
    drawLinks(stale).forEach((card) => drawnAt.set(card, generation));
  };
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      paint(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target));
    }, { rootMargin: '300px 0px' })
    : null;
  let all = [];
  return {
    /**
     * 清單重畫後換一批卡片觀察
     */
    track(cards) {
      all = cards;
      visible.clear();
      if (!observer) { generation += 1; paint(all); return; }
      observer.disconnect();
      cards.forEach((card) => observer.observe(card));
    },
    /**
     * 版面變了：全部標成過期，只立即重畫看得到的
     */
    invalidate() {
      generation += 1;
      paint(observer ? [...visible] : all);
    },
  };
}

/**
 * 句型篩選列的 HTML。第一顆固定是「全部」。
 */
function chipsHtml(patternList, total, activeId) {
  const chip = (id, name, count) =>
    `<button class="chip" type="button" data-pattern="${esc(id)}"` +
    ` aria-pressed="${id === activeId}">${esc(name)}<span class="n">${count}</span></button>`;

  return [chip('all', '全部', total), ...patternList.map((p) => chip(p.id, p.name, p.count))].join('');
}

/**
 * 建立文法頁。
 *
 * lang       'en' / 'ja'
 * sentences  該語言的句子題庫
 * mount      畫面掛載點
 * noticeHost 語音降級提示要插進去的容器
 */
export function initGrammarPage({ lang, sentences, mount, noticeHost }) {
  if (!mount) return;

  const all = sentences || [];
  const patternList = listPatterns(all, patternsOf(lang));
  const patternNames = new Map(patternsOf(lang).map((p) => [p.id, p.name]));

  /*
   * 偏好要在第一次繪製「之前」套用。
   * 晚一步套用的話會先畫出有線的版面再收掉，看起來像閃一下。
   */
  const linesOn = loadPrefs().grammarLines !== false;
  document.documentElement.classList.toggle('no-lines', !linesOn);

  let activeId = 'all';

  mount.innerHTML = `
    <div class="actions">
      <div class="chips" role="group" aria-label="句型篩選">${chipsHtml(patternList, all.length, activeId)}</div>
      <label class="toggle">
        <input type="checkbox" data-role="lines"${linesOn ? ' checked' : ''}>
        顯示連接線
      </label>
    </div>
    <p class="count-line" data-role="count"></p>
    <div class="gram-list" data-role="list"></div>
    <div class="actions">
      <a class="btn" href="./quiz.html?source=sentences">用這些句子做測驗</a>
    </div>`;

  const listHost = mount.querySelector('[data-role="list"]');
  const countHost = mount.querySelector('[data-role="count"]');
  const linesToggle = mount.querySelector('[data-role="lines"]');
  const painter = createLinkPainter();

  /**
   * 依目前的篩選重畫整份清單；連接線由 painter 在卡片進入畫面附近時補上
   */
  function render() {
    const shown = filterSentences(all, activeId);

    countHost.textContent =
      activeId === 'all'
        ? `共 ${all.length} 個句子`
        : `顯示 ${shown.length} 個句子（全部 ${all.length} 個）`;

    listHost.innerHTML = shown.length
      ? shown
          .map((s) => cardHtml(s, { lang, patternName: patternNames.get(s.patternId) || s.patternId }))
          .join('')
      : '<p class="empty">這個句型目前沒有例句。</p>';

    painter.track([...listHost.querySelectorAll('.card')]);
  }

  /* ── 篩選 ── */
  mount.querySelector('.chips').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    activeId = chip.dataset.pattern;
    mount
      .querySelectorAll('.chip')
      .forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.pattern === activeId)));
    render();
  });

  /* ── 連接線開關：.gap-mid 的高度會跟著變，所以切換後一定要重畫 ── */
  linesToggle.addEventListener('change', () => {
    const on = linesToggle.checked;
    document.documentElement.classList.toggle('no-lines', !on);
    setPref('grammarLines', on);
    painter.invalidate();
  });

  /* ── 鍵盤操作：色塊是 div，Enter / Space 要自己轉成點擊 ── */
  listHost.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const blk = event.target.closest('.blk.clickable');
    if (!blk) return;
    event.preventDefault();
    blk.click();
  });

  const redraw = debounce(() => painter.invalidate(), 120);

  /*
   * 重畫時機：色塊換行、字體換掉、視窗轉向，座標全都會變。
   * ResizeObserver 蓋掉「視窗沒變但容器變了」的情況（例如捲軸出現）。
   */
  window.addEventListener('resize', redraw);
  window.addEventListener('orientationchange', redraw);
  window.addEventListener('load', redraw);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(redraw).observe(mount);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(redraw).catch(() => {});
  }

  applySpeechFallback(lang, noticeHost);
  bindSpeakButtons(mount, lang);
  render();
}
