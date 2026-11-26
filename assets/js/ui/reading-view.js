/**
 * 閱讀頁：日文短文逐句排開，每句可以朗讀、跟讀，漢字可以標假名、點來查意思。
 *
 * 朗讀一律唸手寫的假名讀音（data/ja/reading-kana.js），不把漢字原文丟給語音引擎——
 * 那正是閱讀題當初不給朗讀的原因：今日、十分 這種字，引擎常常唸成別的讀法。
 * 題目仍在測驗頁的「閱讀」題型；這一頁只負責讀懂與聽、唸。
 */

import { applySpeechFallback, bindSpeakButtons, SPEAK_ICON } from './speech.js';
import { bindShadow, shadowButtonHtml } from './shadow.js';
import { sentenceSegments, buildWordIndex, lookupWord, lookupKanji } from '../core/reading-lookup.js';
import { kanjiReadingSet } from '../core/kanji-quiz.js';
import { levelLabel } from '../data/shared/levels.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function sentenceHtml(sentence, index) {
  const body = sentenceSegments(sentence.text, sentence.ruby).map((seg) => (seg.reading
    ? `<button class="rd-word" type="button" data-lookup="${index}:${seg.at}" data-chunk="${esc(seg.text)}" data-chunk-reading="${esc(seg.reading)}"><ruby>${esc(seg.text)}<rt>${esc(seg.reading)}</rt></ruby></button>`
    : esc(seg.text))).join('');
  return `
    <li class="rd-sentence" data-sentence="${index}">
      <p class="rd-text" lang="ja">${body}</p>
      <div class="rd-tools">
        <button class="speak" type="button" data-speak="${esc(sentence.reading)}" data-speak-lang="ja" title="朗讀這一句" aria-label="朗讀這一句">${SPEAK_ICON}</button>
        ${shadowButtonHtml({ target: sentence.text, reading: sentence.reading })}
      </div>
    </li>`;
}

function lookupHtml({ chunk, reading, word, kanjiItems }) {
  const kanjiList = kanjiItems.map((k) =>
    `<li><b lang="ja">${esc(k.char)}</b>${k.char !== k.trad ? `（繁體 ${esc(k.trad)}）` : ''}　${esc(k.meaning)}　<span lang="ja">${esc(kanjiReadingSet(k))}</span></li>`).join('');
  return `
    <div class="rd-lookup" role="dialog" aria-label="查詞">
      <p class="rd-lookup-head"><b lang="ja">${esc(chunk)}</b>　在這句唸 <span lang="ja">${esc(reading)}</span>
        <button class="speak" type="button" data-speak="${esc(reading)}" data-speak-lang="ja" aria-label="朗讀">${SPEAK_ICON}</button>
        <button class="link-btn" type="button" data-lookup-close>關閉</button></p>
      ${word
        ? `<p>單字題庫：<b lang="ja">${esc(word.target)}</b>（<span lang="ja">${esc(word.reading)}</span>）${esc(word.zh)}${
          word.target !== chunk && /[ぁ-ゖ]$/.test(word.target) ? '<br><span class="setting-note">句子裡的是活用過的形，題庫列的是原形。</span>' : ''}</p>`
        : '<p class="setting-note">單字題庫裡沒有這個詞（人名、數量詞多半查不到）。</p>'}
      ${kanjiList ? `<p class="setting-label">漢字</p><ul class="rd-kanji">${kanjiList}</ul>` : ''}
    </div>`;
}

/**
 * 掛載閱讀頁。readingKana 缺某一篇時，那一篇照原文顯示、不提供逐句功能，而不是整頁壞掉。
 */
export function initReadingPage({ readings, readingKana, words = [], kanji = [], mount, noticeHost } = {}) {
  if (!mount) return;
  const passages = (readings || []).filter((r) => Array.isArray(readingKana?.[r.id]));
  const index = buildWordIndex(words);
  let current = null;
  /* 標假名不記進偏好：備份的偏好欄位是白名單，多一個鍵會讓舊版還原失敗；每次開頁預設標著 */
  let showRuby = true;

  const listHtml = () => `
    <div class="card kana-intro">
      <h2>怎麼用這一頁</h2>
      <ul>
        <li>每一句都能點朗讀鍵聽原句、點跟讀鍵練習發音；朗讀唸的是手寫的假名讀音，不會把漢字唸錯。</li>
        <li>點有底線的漢字詞，看它在這句怎麼唸、什麼意思。</li>
        <li>讀完可以到<a href="./quiz.html?source=reading">測驗頁的「閱讀」題型</a>回答這幾篇的題目。</li>
      </ul>
    </div>
    <ul class="rd-list">${passages.map((p) => `
      <li><button class="card rd-pick" type="button" data-passage="${esc(p.id)}">
        <span class="rd-title" lang="ja">${esc(p.title)}</span>
        <span class="setting-note">${esc(levelLabel('ja', p.level))} · ${readingKana[p.id].length} 句</span>
      </button></li>`).join('')}</ul>`;

  const lookupEmptyHtml = () => `
    <div class="card rd-lookup-empty">
      <p class="kanji-empty-title">點詞即查</p>
      <p class="setting-note">點選左側短文中有虛線底線的漢字詞，會在此即時顯示本句讀音、單字意思與漢字資訊。</p>
    </div>`;

  const passageHtml = (p) => `
    <div class="rd-bar">
      <button class="btn ghost" type="button" data-back>← 所有短文</button>
      <button class="chip" type="button" data-ruby aria-pressed="${showRuby}">標假名</button>
    </div>
    <div class="split-workspace rd-workspace">
      <div class="card rd-passage${showRuby ? '' : ' hide-ruby'}">
        <h2 lang="ja">${esc(p.title)}</h2>
        <ol class="rd-sentences">${readingKana[p.id].map(sentenceHtml).join('')}</ol>
        <details class="rd-translation"><summary>看中文翻譯</summary><p>${esc(p.translation)}</p></details>
      </div>
      <aside class="split-aside rd-aside" data-lookup-aside aria-label="查詞面板">${lookupEmptyHtml()}</aside>
    </div>`;

  const render = () => {
    mount.innerHTML = current ? passageHtml(current) : listHtml();
  };

  const closeLookup = () => {
    mount.querySelector('.rd-lookup')?.remove();
    const aside = mount.querySelector('[data-lookup-aside]');
    if (aside && !aside.querySelector('.rd-lookup')) aside.innerHTML = lookupEmptyHtml();
  };

  mount.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-passage]');
    if (pick) {
      current = passages.find((p) => p.id === pick.dataset.passage) || null;
      render();
      mount.scrollIntoView({ block: 'start' });
      return;
    }
    if (event.target.closest('[data-back]')) {
      current = null;
      render();
      return;
    }
    const ruby = event.target.closest('[data-ruby]');
    if (ruby) {
      showRuby = !showRuby;
      ruby.setAttribute('aria-pressed', String(showRuby));
      mount.querySelector('.rd-passage')?.classList.toggle('hide-ruby', !showRuby);
      return;
    }
    if (event.target.closest('[data-lookup-close]')) {
      closeLookup();
      return;
    }
    const word = event.target.closest('[data-lookup]');
    if (word) {
      const wasOpen = mount.querySelector('.rd-lookup')?.dataset.for === word.dataset.lookup;
      closeLookup();
      if (wasOpen) return;
      const [sentenceIndex, at] = word.dataset.lookup.split(':').map(Number);
      const sentence = readingKana[current.id][sentenceIndex];
      const chunk = word.dataset.chunk;
      const reading = word.dataset.chunkReading;
      const holder = document.createElement('div');
      holder.innerHTML = lookupHtml({ chunk, reading, word: lookupWord(index, sentence.text, at, chunk, reading), kanjiItems: lookupKanji(kanji, chunk) });
      const panel = holder.firstElementChild;
      panel.dataset.for = word.dataset.lookup;
      const aside = mount.querySelector('[data-lookup-aside]');
      if (aside && window.innerWidth >= 1024) {
        aside.replaceChildren(panel);
      } else {
        word.closest('.rd-sentence').querySelector('.rd-tools').insertAdjacentElement('afterend', panel);
      }
    }
  });

  render();
  applySpeechFallback('ja', noticeHost);
  bindSpeakButtons(mount, 'ja');
  bindShadow(mount, { lang: 'ja' });
}
