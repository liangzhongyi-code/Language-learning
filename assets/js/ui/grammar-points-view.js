/**
 * 文法頁上方的 N5 文法點：意思、接法、白話說明、例句（可朗讀、跟讀）。
 *
 * 整區收合成一列放在句型拆解上方，網址帶 #points 時自動展開（測驗頁、首頁的連結都帶它）；
 * 每個文法點也各自收合——三十幾個全攤開會把下面的句型拆解推到看不到，
 * 句型卡片的連接線只替畫面附近的卡片畫，被推出畫面就要捲下去才看得到。
 * 練習在測驗頁的「文法」題型，一個文法點一筆學習紀錄，選「今天該複習」就是排程到期的。
 * 例句朗讀用假名讀音，不把漢字原文丟給語音引擎。
 */

import { applySpeechFallback, bindSpeakButtons, SPEAK_ICON } from './speech.js';
import { bindShadow, shadowButtonHtml } from './shadow.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function pointHtml(point) {
  const examples = (point.examples || []).map((e) => `
      <li class="gp-example">
        <p lang="ja" class="gp-target">${esc(e.target)}</p>
        <p class="setting-note"><span lang="ja">${esc(e.reading)}</span>　${esc(e.zh)}</p>
        <div class="gp-tools">
          <button class="speak" type="button" data-speak="${esc(e.reading)}" data-speak-lang="ja" title="朗讀例句" aria-label="朗讀例句">${SPEAK_ICON}</button>
          ${shadowButtonHtml({ target: e.target, reading: e.reading })}
        </div>
      </li>`).join('');
  return `
    <details class="kana-section gp-point" data-point="${esc(point.id)}">
      <summary><span lang="ja">${esc(point.title)}</span><span class="n">${esc(point.meaning)}</span></summary>
      <p class="gp-form"><b>接法</b>　${esc(point.form)}</p>
      <p>${esc(point.explain)}</p>
      <ul class="gp-examples">${examples}</ul>
    </details>`;
}

/**
 * 掛載文法點區塊
 */
export function initGrammarPoints({ grammarPoints, mount, noticeHost } = {}) {
  if (!mount) return;
  const points = grammarPoints || [];
  const open = typeof location !== 'undefined' && location.hash === '#points';
  mount.innerHTML = `
    <details class="kana-section gp-wrap" id="points"${open ? ' open' : ''}>
      <summary>N5 文法點<span class="n">${points.length} 個 · 意思、接法、例句</span></summary>
      <p class="setting-note">點開看意思、接法和例句；例句可以朗讀、跟讀。看過幾個就去練，答過的文法點會排進複習，到期時在測驗頁選「今天該複習」。</p>
      <div class="actions"><a class="btn" href="./quiz.html?source=grammar">練文法</a></div>
      ${points.map(pointHtml).join('')}
    </details>`;
  if (open) mount.scrollIntoView({ block: 'start' });
  applySpeechFallback('ja', noticeHost);
  bindSpeakButtons(mount, 'ja');
  bindShadow(mount, { lang: 'ja' });
}
