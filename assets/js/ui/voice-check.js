/**
 * 語音診斷。
 *
 * 網站本身沒有夾帶任何音檔，發音完全靠作業系統或瀏覽器提供的語音。
 * 所以「按了沒聲音」有好幾種可能：瀏覽器不支援、裝置沒裝該語言的語音包、
 * 或是清單還沒載入完。這一塊把實際狀況攤開來，讓人不必用猜的。
 */

import { isSupported, listVoices, onVoicesChanged } from './speech.js';

/**
 * 要檢查的語言，順序即顯示順序
 */
const LANGS = [
  { code: 'en', label: '英文' },
  { code: 'ja', label: '日文' },
];

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 一筆語音的列
 */
function voiceRow(voice) {
  return `
    <div class="word">
      <div class="word-main">
        <div class="word-target">${esc(voice.name)}</div>
        <div class="word-zh">${esc(voice.lang)}</div>
      </div>
      <div class="word-tags">
        <span class="tag">${voice.localService ? '本機' : '需連網'}</span>
        ${voice.isDefault ? '<span class="tag">預設</span>' : ''}
      </div>
    </div>`;
}

/**
 * 某個語言的檢查結果摘要
 */
function langSummary(lang, voices) {
  const matched = voices.filter((v) => (v.lang || '').toLowerCase().startsWith(lang.code));
  if (matched.length === 0) {
    return `<div class="notice"><b>找不到${lang.label}語音。</b>
      這個網站的${lang.label}朗讀在這台裝置上會沒有聲音——需要先安裝語音包，步驟見下方。</div>`;
  }
  return `<p class="count-line">✅ ${lang.label}：找到 ${matched.length} 個語音（${matched
    .map((v) => esc(v.name))
    .join('、')}）</p>`;
}

/**
 * 把診斷結果畫進指定容器
 */
export function renderVoiceCheck(mount) {
  if (!mount) return;

  if (!isSupported()) {
    mount.innerHTML = `<div class="notice"><b>這個瀏覽器不支援語音合成。</b>
      所有朗讀按鈕都已經自動隱藏，字母、單字與句型的內容仍然完整可讀。
      換用近期版本的 Chrome、Edge 或 Safari 就會有。</div>`;
    return;
  }

  const draw = (voices) => {
    const summaries = LANGS.map((l) => langSummary(l, voices)).join('');

    if (voices.length === 0) {
      mount.innerHTML = `${summaries}
        <p class="count-line">目前抓不到任何語音。有些瀏覽器的語音清單是延遲載入的，
        稍等一兩秒或重新整理再看一次。</p>`;
      return;
    }

    const rows = voices
      .slice()
      .sort((a, b) => (a.lang || '').localeCompare(b.lang || ''))
      .map(voiceRow)
      .join('');

    mount.innerHTML = `
      ${summaries}
      <details class="kana-section">
        <summary>這台裝置的全部語音<span class="n">${voices.length} 個</span></summary>
        <div class="word-list">${rows}</div>
      </details>`;
  };

  /* 清單可能延遲送達，訂閱之後每次更新都重畫 */
  onVoicesChanged(draw);
}
