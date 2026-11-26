/**
 * 跟讀：先聽一次標準朗讀，自己唸一遍，再看辨識結果或聽自己的錄音對照。
 *
 * 兩種做法：
 *   辨識——瀏覽器的語音辨識把你說的轉成文字，跟原句比對、標出沒對上的字。
 *         Chrome 的辨識是把聲音送到 Google 處理，第一次用之前一定要先講清楚、讓使用者選。
 *   只錄音——錄音只存在這個分頁的記憶體裡，不上傳、不保存，重新整理就沒了。
 *
 * 選擇記在獨立的 localStorage 鍵，不放進偏好設定：
 * 偏好會進備份，而備份的偏好欄位是白名單，多一個欄位會讓舊版還原整段失敗；
 * 而且麥克風與辨識本來就是「這台裝置」的事，不該跟著備份搬到別台。
 *
 * 跟讀不寫學習紀錄：辨識結果受口音、環境音、辨識引擎影響太大，不能當作對錯。
 */

import { compareSpeech } from '../core/shadow-compare.js';
import { speak, cancel as cancelSpeech, SPEAK_ICON } from './speech.js';

const MIC_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/><path d="M8 22h8"/></svg>';
const PLAY_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
const STOP_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

const MODE_KEY = 'lang-learn.shadow.v1';
const MAX_RECORD_MS = 8000;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const Recognition = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null);
const canRecord = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

function loadMode() {
  try {
    const mode = JSON.parse(localStorage.getItem(MODE_KEY))?.mode;
    return ['recognize', 'record'].includes(mode) ? mode : null;
  } catch {
    return null;
  }
}

function saveMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, JSON.stringify({ mode }));
  } catch {
    /* 儲存被停用時只記在這一頁 */
  }
}

/**
 * 跟讀按鈕。target 是原文寫法、reading 是假名讀音；朗讀一律用 reading，避免語音引擎把漢字唸錯。
 */
export function shadowButtonHtml({ target = '', reading = '', label = '跟讀' } = {}) {
  return `<button class="shadow-btn" type="button" data-shadow data-shadow-target="${esc(target)}"
    data-shadow-reading="${esc(reading || target)}" aria-expanded="false" title="跟著唸一遍">${MIC_ICON}<span>${esc(label)}</span></button>`;
}

const VERDICT = {
  good: '跟原句幾乎一樣，辨識引擎聽得懂你說的。',
  close: '大致對了，標起來的字沒有被聽出來，再聽一次原句注意那幾個音。',
  retry: '辨識結果跟原句差很多，先多聽兩次原句再試。',
};

/**
 * 在 container 裡用事件委派掛上所有跟讀按鈕。同一時間只開一個面板。
 */
export function bindShadow(container, { lang = 'ja' } = {}) {
  if (!container || container.dataset.shadowBound) return;
  container.dataset.shadowBound = '1';
  let state = null;

  const stopAll = () => {
    if (!state) return;
    try { state.recognition?.abort(); } catch { /* 已經停了 */ }
    try { if (state.recorder?.state === 'recording') state.recorder.stop(); } catch { /* 已經停了 */ }
    state.stream?.getTracks().forEach((t) => t.stop());
    clearTimeout(state.timer);
    state.recognition = null;
    state.recorder = null;
    state.stream = null;
  };

  const close = () => {
    if (!state) return;
    stopAll();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.panel.remove();
    state.button.setAttribute('aria-expanded', 'false');
    state = null;
  };

  const panelHtml = (target, reading) => {
    const mode = loadMode();
    const recognizable = Boolean(Recognition());
    const recordable = canRecord();
    const effective = !recognizable ? 'record' : mode;
    const choose = recognizable && !mode
      ? `<div class="shadow-consent">
          <p class="setting-note">要用語音辨識幫你對照嗎？辨識由瀏覽器處理：Chrome 會把這一段聲音送到 Google 轉成文字。
            不想上傳的話選「只錄音」，錄音只留在這個分頁，不上傳也不保存。</p>
          <div class="actions">
            <button class="btn" type="button" data-shadow-mode="recognize">使用語音辨識</button>
            <button class="btn ghost" type="button" data-shadow-mode="record">只錄音</button>
          </div>
        </div>`
      : '';
    const unsupported = !recognizable && !recordable
      ? '<p class="setting-note">這個瀏覽器不能使用麥克風，只能先聽朗讀、自己唸出來對照。</p>'
      : '';
    return `
      <div class="shadow-line"><span lang="ja">${esc(target || reading)}</span>${target && reading && target !== reading ? `<span class="shadow-reading" lang="ja">${esc(reading)}</span>` : ''}</div>
      <div class="actions">
        <button class="btn ghost" type="button" data-shadow-play>${SPEAK_ICON}<span>聽一次</span></button>
        ${(effective || recordable) && !choose && (recognizable || recordable)
          ? `<button class="btn" type="button" data-shadow-rec>${MIC_ICON}<span>開始跟讀</span></button>` : ''}
        <button class="btn ghost" type="button" data-shadow-mine hidden>${PLAY_ICON}<span>聽我唸的</span></button>
      </div>
      ${choose}${unsupported}
      <p class="shadow-status setting-note" aria-live="polite">${!recognizable && recordable ? '這個瀏覽器沒有語音辨識，錄音後自己跟原句對照。' : ''}</p>
      <div class="shadow-result" aria-live="polite"></div>
      ${recognizable && mode ? `<p class="setting-note shadow-switch">目前：${mode === 'recognize' ? '語音辨識（Chrome 會送到 Google）' : '只錄音'}　<button class="link-btn" type="button" data-shadow-mode="${mode === 'recognize' ? 'record' : 'recognize'}">改成${mode === 'recognize' ? '只錄音' : '語音辨識'}</button></p>` : ''}`;
  };

  const open = (button) => {
    close();
    const target = button.dataset.shadowTarget || '';
    const reading = button.dataset.shadowReading || target;
    const panel = document.createElement('div');
    panel.className = 'shadow-panel';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', '跟讀');
    panel.innerHTML = panelHtml(target, reading);
    button.insertAdjacentElement('afterend', panel);
    button.setAttribute('aria-expanded', 'true');
    state = { button, panel, target, reading, audioUrl: null };
  };

  const status = (text) => {
    const node = state?.panel.querySelector('.shadow-status');
    if (node) node.textContent = text;
  };

  const showResult = (heard) => {
    const result = compareSpeech({ heard, target: state.target, reading: state.reading });
    const line = result.chars.map((c) => (c.ok ? esc(c.ch) : `<mark class="shadow-miss">${esc(c.ch)}</mark>`)).join('');
    state.panel.querySelector('.shadow-result').innerHTML = `
      <p class="shadow-verdict is-${result.verdict}">${esc(VERDICT[result.verdict])}</p>
      <p class="setting-note">辨識聽到：<span lang="ja">${esc(result.heard || '（沒有聽到內容）')}</span></p>
      <p class="setting-note">對照${result.reference === 'reading' ? '讀音' : '原句'}：<span lang="ja" class="shadow-compare">${line}</span></p>
      <p class="setting-note">辨識引擎會自動猜你想說的詞，聽得懂不等於發音標準；要抓細節，請聽自己的錄音跟原句比。</p>`;
  };

  const start = async () => {
    const mode = Recognition() ? loadMode() || 'record' : 'record';
    const rec = state.panel.querySelector('[data-shadow-rec]');
    stopAll();
    cancelSpeech();
    state.panel.querySelector('.shadow-result').innerHTML = '';
    if (rec) {
      rec.innerHTML = `${STOP_ICON}<span>停止</span>`;
      rec.dataset.recording = '1';
    }
    status('請開始唸……');
    const current = state;
    let finished = false;
    const finish = () => {
      if (finished || current !== state) return;
      finished = true;
      clearTimeout(current.timer);
      try { if (current.recorder?.state === 'recording') current.recorder.stop(); } catch { /* 已停 */ }
      if (rec) {
        rec.innerHTML = `${MIC_ICON}<span>再唸一次</span>`;
        delete rec.dataset.recording;
      }
    };

    if (canRecord()) {
      try {
        current.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        current.recorder = new MediaRecorder(current.stream);
        current.recorder.addEventListener('dataavailable', (e) => { if (e.data?.size) chunks.push(e.data); });
        current.recorder.addEventListener('stop', () => {
          current.stream?.getTracks().forEach((t) => t.stop());
          if (current !== state || !chunks.length) return;
          if (current.audioUrl) URL.revokeObjectURL(current.audioUrl);
          current.audioUrl = URL.createObjectURL(new Blob(chunks, { type: chunks[0].type || 'audio/webm' }));
          current.panel.querySelector('[data-shadow-mine]').hidden = false;
          if (mode === 'record') status('錄好了，按「聽我唸的」跟原句對照。');
        });
        current.recorder.start();
      } catch {
        if (mode === 'record') {
          status('沒辦法使用麥克風（可能被拒絕了），請在瀏覽器的網站設定允許麥克風。');
          finish();
          return;
        }
      }
    }

    if (mode === 'recognize') {
      const SR = Recognition();
      const recognition = new SR();
      current.recognition = recognition;
      recognition.lang = lang === 'ja' ? 'ja-JP' : 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;
      recognition.onresult = (event) => {
        const alternatives = [...(event.results?.[0] || [])].map((a) => a.transcript);
        status('');
        showResult(alternatives);
      };
      recognition.onerror = (event) => {
        const messages = {
          'not-allowed': '麥克風或語音辨識被拒絕了，請在瀏覽器的網站設定允許，或改成只錄音。',
          'service-not-allowed': '這個瀏覽器不允許使用語音辨識，請改成只錄音。',
          network: '連不上語音辨識服務，請檢查網路，或改成只錄音。',
          'no-speech': '沒有聽到聲音，靠近麥克風再試一次。',
          'audio-capture': '找不到麥克風。',
        };
        if (event.error !== 'aborted') status(messages[event.error] || '語音辨識失敗了，再試一次或改成只錄音。');
        finish();
      };
      recognition.onend = finish;
      try {
        recognition.start();
      } catch {
        status('語音辨識啟動失敗，再試一次或改成只錄音。');
        finish();
      }
    }
    current.timer = setTimeout(() => {
      try { current.recognition?.stop(); } catch { /* 已停 */ }
      finish();
    }, MAX_RECORD_MS);
    current.finish = finish;
  };

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-shadow]');
    if (button && container.contains(button)) {
      if (state?.button === button) close();
      else open(button);
      return;
    }
    if (!state || !state.panel.contains(event.target)) return;
    const mode = event.target.closest('[data-shadow-mode]');
    if (mode) {
      saveMode(mode.dataset.shadowMode);
      const { button: owner } = state;
      open(owner);
      return;
    }
    if (event.target.closest('[data-shadow-play]')) {
      speak(state.reading, lang);
      return;
    }
    const rec = event.target.closest('[data-shadow-rec]');
    if (rec) {
      if (rec.dataset.recording) {
        try { state.recognition?.stop(); } catch { /* 已停 */ }
        state.finish?.();
      } else start();
      return;
    }
    if (event.target.closest('[data-shadow-mine]') && state.audioUrl) {
      new Audio(state.audioUrl).play().catch(() => status('播放失敗。'));
    }
  });
}
