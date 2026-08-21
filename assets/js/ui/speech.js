/**
 * Web Speech API 的唯一出入口。
 *
 * 全站只有這個檔案可以碰 speechSynthesis。其他模組一律透過
 * speak / isSupported / hasVoiceFor 三個介面。
 *
 * 可用性在各平台差很多：日文語音在 Windows 需要另裝語言包，
 * 部分 Android 也沒有。所以做三段降級：
 *   1. API 與目標語音都在        → 正常朗讀
 *   2. API 在但找不到目標語音    → 仍然嘗試，並顯示一次性提示
 *   3. API 不存在                → 隱藏所有朗讀按鈕，其餘內容照常可讀
 */

/**
 * 語言代碼對應的 BCP-47 標籤
 */
const LANG_TAGS = { en: 'en-US', ja: 'ja-JP' };

let voices = [];
const readyCallbacks = [];

/**
 * 這個瀏覽器有沒有語音合成
 */
export function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * 重新抓語音清單。
 * Chrome 首次呼叫 getVoices() 常常回傳空陣列，要等 voiceschanged，
 * 所以這裡會被呼叫不只一次。
 */
function refreshVoices() {
  if (!isSupported()) return;
  voices = window.speechSynthesis.getVoices() || [];
  if (voices.length) {
    while (readyCallbacks.length) readyCallbacks.shift()();
  }
}

if (isSupported()) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

/**
 * 語音清單就緒後執行。已經就緒就立刻執行。
 * 清單一直是空的（有些平台如此）也會在逾時後執行，避免呼叫端卡住。
 */
export function onVoicesReady(callback) {
  if (!isSupported() || voices.length) {
    callback();
    return;
  }
  readyCallbacks.push(callback);
  setTimeout(() => {
    const i = readyCallbacks.indexOf(callback);
    if (i >= 0) {
      readyCallbacks.splice(i, 1);
      callback();
    }
  }, 1200);
}

/**
 * 有沒有指定語言的語音。lang 傳 'en' 或 'ja'。
 */
export function hasVoiceFor(lang) {
  if (!isSupported()) return false;
  return voices.some((v) => (v.lang || '').toLowerCase().startsWith(lang.toLowerCase()));
}

/**
 * 停止目前的朗讀
 */
export function cancel() {
  if (isSupported()) window.speechSynthesis.cancel();
}

/**
 * 朗讀一段文字。
 * 空字串是安全的空動作。連續呼叫會中斷前一段，不會兩段重疊。
 *
 * 傳入 el 時，朗讀期間會在該元素上掛 is-speaking，方便做視覺回饋。
 */
export function speak(text, lang, { el } = {}) {
  if (!isSupported()) return;
  const content = String(text || '').trim();
  if (!content) return;

  cancel();
  document.querySelectorAll('.is-speaking').forEach((n) => n.classList.remove('is-speaking'));

  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = LANG_TAGS[lang] || lang;
  const voice = voices.find((v) => (v.lang || '').toLowerCase().startsWith(lang.toLowerCase()));
  if (voice) utterance.voice = voice;
  utterance.rate = lang === 'ja' ? 0.9 : 0.95;

  if (el) {
    el.classList.add('is-speaking');
    const clear = () => el.classList.remove('is-speaking');
    utterance.addEventListener('end', clear);
    utterance.addEventListener('error', clear);
  }

  window.speechSynthesis.speak(utterance);
}

/**
 * 頁面載入時檢查語音能力並套用降級。
 *
 * 完全不支援 → 在 <html> 掛 no-speech，CSS 會把朗讀按鈕全部藏起來。
 * 支援但沒有該語言的語音 → 在指定容器插入一則提示，按鈕保留可點。
 */
export function applySpeechFallback(lang, noticeHost) {
  if (!isSupported()) {
    document.documentElement.classList.add('no-speech');
    if (noticeHost) {
      noticeHost.insertAdjacentHTML(
        'afterbegin',
        '<div class="notice"><b>此瀏覽器不支援語音朗讀。</b>字母、單字與句型內容仍可正常閱讀。</div>'
      );
    }
    return;
  }

  onVoicesReady(() => {
    if (hasVoiceFor(lang) || !noticeHost) return;
    const name = lang === 'ja' ? '日文' : '英文';
    noticeHost.insertAdjacentHTML(
      'afterbegin',
      `<div class="notice"><b>這台裝置可能沒有安裝${name}語音。</b>` +
        '朗讀按鈕仍可點，但可能沒有聲音——需要到系統設定安裝該語言的語音包。</div>'
    );
  });
}

/**
 * 把容器內所有 [data-speak] 元素接上朗讀。
 * data-speak 是要唸的文字，data-speak-lang 可覆寫語言。
 */
export function bindSpeakButtons(container, defaultLang) {
  container.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-speak]');
    if (!trigger || !container.contains(trigger)) return;
    event.preventDefault();
    event.stopPropagation();
    speak(trigger.dataset.speak, trigger.dataset.speakLang || defaultLang, { el: trigger });
  });
}
