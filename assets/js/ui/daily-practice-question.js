/**
 * 可嵌入每日頁的單一人工題控制器，不讀寫學習儲存或改動清單。
 * onSubmit(response, { replayCount }) 必須等原子保存完成才 resolve { saved:true, correct }；
 * reject 時鎖住原作答供重試，caller 必須沿用同一 reviewId。答題回饋不早於保存成功。
 */
import { judgePractice, PRACTICE_MODES } from '../core/practice-engine.js';
import { shouldSubmitOnEnter } from '../core/practice-answers.js';
import { speakChecked, cancel as cancelSpeech } from './speech.js';
import { listeningDecision } from './feedback.js';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const textModes = ['typing', 'kana', 'dictation'];
const listenModes = ['listening', 'dictation'];
const labels = { typing: '看中文拼寫', kana: '看漢字打假名', listening: '聽力選意思', dictation: '聽寫',
  tiles: '拼組', reorder: '句子重組', pos: '語境詞性' };
const savedFeedback = value => value && value.saved === true && typeof value.correct === 'boolean';

/**
 * feedback 僅用於重畫已保存作答，格式 { saved:true, correct:boolean }；response 為該筆答案。
 * update({ disabled, feedback }) 不換題；換題／離頁前呼叫 destroy，避免晚到回覆污染新題。
 * onBack 在離開本題前呼叫，預設回同目錄每日頁；播放中或失敗仍可返回，保存中暫鎖。
 * 聽力由使用者明確按播放，不自動朗讀；answerKey、context、speakText 不進答前 DOM。
 */
export function mountDailyPracticeQuestion({ mount, question, lang = question.lang, onSubmit,
  response = null, feedback = null, disabled = false, onBack = () => { window.location.href = './daily.html'; } }) {
  if (!mount || typeof onSubmit !== 'function' || !question || !own(PRACTICE_MODES, question.practiceMode)
    || !['en', 'ja'].includes(lang) || question.lang !== lang || typeof onBack !== 'function') throw new Error('每日人工題元件的參數不完整。');
  const q = clone(question);
  const mode = q.practiceMode;
  const listening = listenModes.includes(mode);
  const root = document.createElement('div');
  root.className = 'daily-practice-question';
  let alive = true;
  let pending = false;
  let playing = false;
  let played = false;
  let plays = 0;
  let error = '';
  let notice = '';
  let submitted = null;
  let result = savedFeedback(feedback) ? { saved: true, correct: feedback.correct } : null;
  let input = response && typeof response.input === 'string' ? response.input : '';
  let selectedIndex = response && Number.isInteger(response.selectedIndex) ? response.selectedIndex : null;
  let picked = response && Array.isArray(response.instanceIds) ? [...response.instanceIds] : [];
  let audioGeneration = 0;
  let focusRequest = null;
  /**
   * 常駐節點：live region 只換文字（重建節點不會被螢幕閱讀器播報）；
   * 輸入題的輸入框與提交鈕也常駐，重畫時保留草稿、焦點與選取範圍。
   */
  const head = document.createElement('div');
  const answerBox = document.createElement('div');
  const tail = document.createElement('div');
  const status = document.createElement('p');
  status.className = 'backup-msg';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(head, answerBox, tail, status);
  let field = null;
  let submitButton = null;
  if (textModes.includes(mode)) {
    answerBox.innerHTML = `<label class="setting-label">${mode === 'kana' ? '輸入平假名' : '輸入答案'}
      <input class="text-input" data-dp-input lang="${lang}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <button class="btn sm" type="button" data-dp-submit>提交</button>`;
    field = answerBox.querySelector('[data-dp-input]');
    submitButton = answerBox.querySelector('[data-dp-submit]');
    field.value = input;
    field.addEventListener('input', () => { if (!locked()) input = field.value; });
    field.addEventListener('keydown', event => {
      if (shouldSubmitOnEnter(event)) { event.preventDefault(); submit(); }
    });
    submitButton.addEventListener('click', submit);
  }
  mount.replaceChildren(root);

  const locked = () => !alive || disabled || pending || playing || Boolean(result) || Boolean(submitted);
  const pieces = () => mode === 'tiles' ? q.fragments : q.chunks;
  const draft = () => textModes.includes(mode) ? { input }
    : ['listening', 'pos'].includes(mode) ? { selectedIndex } : { instanceIds: [...picked] };

  function promptHtml() {
    if (listening) return `<div class="prompt">${mode === 'dictation' ? '聽語音輸入答案' : '聽語音選出中文意思'}</div>
      <button class="btn sm" type="button" data-dp-play aria-label="播放題目語音">▶ 播放${plays > 1 ? `（重播 ${plays - 1} 次）` : ''}</button>`;
    if (mode === 'pos') return `<div class="prompt" lang="${lang}">${esc(q.sentence.slice(0, q.position))}<u>${esc(q.sentence.slice(q.position, q.position + q.targetWord.length))}</u>${esc(q.sentence.slice(q.position + q.targetWord.length))}</div>
      <p class="prompt-sub">畫線的字在這一句裡是什麼詞性？</p>`;
    return `<div class="prompt" lang="${mode === 'kana' ? lang : 'zh-Hant'}">${esc(q.prompt)}</div>`;
  }

  function answerHtml() {
    if (['listening', 'pos'].includes(mode)) return `<div class="opts">${q.options.map((option, index) => {
      const correct = result && index === q.answerKey.correctIndex;
      const wrong = result && index === selectedIndex && !correct;
      return `<button class="opt${correct ? ' is-correct' : wrong ? ' is-wrong' : ''}" type="button" data-dp-option="${index}">
        <span class="key">${index + 1}</span>${esc(option)}${correct ? '<span class="mark">正解</span>' : ''}</button>`;
    }).join('')}</div>`;
    const byId = new Map(pieces().map(piece => [piece.instanceId, piece]));
    return `<p class="setting-label">你的答案（點片段可移回）</p><div class="tiles is-answer" lang="${lang}" data-dp-answer>
      ${picked.filter(id => byId.has(id)).map(id => `<button class="tile" type="button" data-dp-unpick="${esc(id)}">${esc(byId.get(id).text)}</button>`).join('')}</div>
      <p class="setting-label">可用片段</p><div class="tiles" lang="${lang}">${pieces().map(piece =>
        `<button class="tile" type="button" data-dp-pick="${esc(piece.instanceId)}" ${picked.includes(piece.instanceId) ? 'disabled' : ''}>${esc(piece.text)}</button>`).join('')}</div>
      <div class="actions"><button class="btn sm" type="button" data-dp-submit>提交</button><button class="btn ghost sm" type="button" data-dp-clear>清除</button></div>`;
  }

  function feedbackHtml() {
    if (!result) return '';
    let accepted = '';
    if (textModes.includes(mode)) accepted = q.answerKey.accepted.join(' ／ ');
    else if (mode === 'tiles') accepted = q.answerKey.answer;
    else if (mode === 'reorder') {
      const textByIndex = new Map(q.chunks.map(piece => [q.answerKey.chunkIndexByInstance[piece.instanceId], piece.text]));
      accepted = q.answerKey.legalOrders.map(order => order.map(index => textByIndex.get(index)).join(lang === 'en' ? ' ' : '')).join(' ／ ');
    }
    return `<div class="feedback${result.correct ? ' good' : ''}" data-dp-feedback>${result.correct ? '答對了。' : '答錯了。'}${accepted ? `可接受的答案：<b lang="${lang}">${esc(accepted)}</b>` : ''}</div>`;
  }

  /**
   * 重畫後的焦點：有明確要求（選片段、移回、清除、播放完成）就移過去；
   * 原本焦點在本題內、但節點被重建時，改放到同一個 data 屬性的節點。焦點在外面時一律不搶。
   */
  function restoreFocus(previous) {
    if (focusRequest) {
      const target = focusRequest();
      focusRequest = null;
      if (target && !target.disabled) { target.focus(); return; }
    }
    if (!previous || previous === document.body || previous.isConnected) return;
    const key = ['dpPick', 'dpUnpick', 'dpOption'].find(name => previous.dataset?.[name] !== undefined);
    const attr = key ? `[data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(previous.dataset[key])}"]` : null;
    const same = attr && root.querySelector(`${attr}:not([disabled])`);
    if (same) same.focus();
  }

  function render() {
    if (!alive) return;
    const active = document.activeElement;
    const previous = root.contains(active) ? active : null;
    head.innerHTML = `<p class="progress-text">${esc(labels[mode])}</p>${promptHtml()}`;
    if (!field) answerBox.innerHTML = answerHtml();
    tail.innerHTML = `${feedbackHtml()}
      ${error && submitted ? '<button class="btn sm" type="button" data-dp-retry>重試保存</button>' : ''}
      <button class="btn ghost sm" type="button" data-dp-back>回清單</button>`;
    const message = pending ? '正在保存…' : playing ? '正在播放…' : result ? '已保存。' : error || notice;
    if (status.textContent !== message) status.textContent = message;
    if (field && field.value !== input) field.value = input;
    const on = (scope, selector, handler) => scope.querySelectorAll(selector).forEach(node => node.addEventListener('click', () => handler(node)));
    if (!field) {
      on(answerBox, '[data-dp-submit]', submit);
      on(answerBox, '[data-dp-option]', node => { if (!locked()) { selectedIndex = Number(node.dataset.dpOption); submit(); } });
      on(answerBox, '[data-dp-pick]', node => {
        if (locked() || picked.includes(node.dataset.dpPick)) return;
        const order = pieces().map(piece => piece.instanceId);
        picked.push(node.dataset.dpPick);
        const from = order.indexOf(node.dataset.dpPick);
        focusRequest = () => {
          const free = order.filter(id => !picked.includes(id));
          const next = free.find(id => order.indexOf(id) > from) ?? free[0];
          return next ? answerBox.querySelector(`[data-dp-pick="${CSS.escape(next)}"]`) : answerBox.querySelector('[data-dp-submit]');
        };
        render();
      });
      on(answerBox, '[data-dp-unpick]', node => {
        if (locked()) return;
        const id = node.dataset.dpUnpick;
        picked = picked.filter(value => value !== id);
        focusRequest = () => answerBox.querySelector(`[data-dp-pick="${CSS.escape(id)}"]`);
        render();
      });
      on(answerBox, '[data-dp-clear]', () => {
        if (locked()) return;
        picked = [];
        focusRequest = () => answerBox.querySelector('[data-dp-pick]:not([disabled])');
        render();
      });
    }
    on(head, '[data-dp-play]', play);
    on(tail, '[data-dp-retry]', persist);
    on(tail, '[data-dp-back]', () => {
      if (!alive || disabled || pending) return;
      destroy();
      onBack();
    });
    root.querySelectorAll('button, input').forEach(node => {
      if (node.matches('[data-dp-back]')) node.disabled = disabled || pending;
      else if (node.matches('[data-dp-retry]')) node.disabled = disabled || pending || playing || Boolean(result);
      else node.disabled = locked() || (listening && !played && !node.matches('[data-dp-play], [data-dp-input]'))
        || (node.matches('[data-dp-pick]') && picked.includes(node.dataset.dpPick));
    });
    restoreFocus(previous);
  }

  async function play() {
    if (locked()) return;
    const generation = ++audioGeneration;
    playing = true;
    played = false;
    notice = '';
    render();
    try {
      if (!listeningDecision({ userInitiated: true }).speak) throw new Error('SPEECH_UNAVAILABLE');
      const outcome = await speakChecked(q.context ?? q.speakText, lang);
      if (!alive || generation !== audioGeneration) return;
      if (!outcome || outcome.ok !== true) throw new Error('SPEECH_INTERRUPTED');
      played = true;
      plays += 1;
      notice = '播放完成，可以作答。';
      const current = document.activeElement;
      if (!current || current === document.body || root.contains(current)) {
        focusRequest = () => field ?? answerBox.querySelector('[data-dp-option]:not([disabled])');
      }
    } catch {
      if (!alive || generation !== audioGeneration) return;
      played = false;
      notice = '播放未成功，這題不計分。請重試播放，或回清單；需要本機離線語音。';
    }
    if (!alive || generation !== audioGeneration) return;
    playing = false;
    render();
  }

  async function submit() {
    if (locked()) return;
    if (listening && !played) { notice = '請先成功播放題目語音再作答。'; render(); return; }
    const candidate = draft();
    let judged;
    try { judged = judgePractice(q, candidate); }
    catch { notice = '作答格式不正確，請重新輸入。'; render(); return; }
    if (!judged.valid) { notice = judged.reason; render(); return; }
    submitted = { response: clone(candidate), replayCount: Math.max(0, plays - 1) };
    await persist();
  }

  async function persist() {
    if (!alive || disabled || pending || playing || result || !submitted) return;
    pending = true;
    error = '';
    render();
    try {
      const saved = await onSubmit(clone(submitted.response), { replayCount: submitted.replayCount });
      if (!alive) return;
      if (!savedFeedback(saved)) throw new Error('SAVE_NOT_CONFIRMED');
      result = { saved: true, correct: saved.correct };
    } catch {
      if (!alive) return;
      error = '這題還沒有確認保存。請重試保存同一答案。';
    }
    if (!alive) return;
    pending = false;
    render();
  }

  root.addEventListener('keydown', event => {
    if (locked() || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.keyCode === 229
      || event.target.closest('input, textarea, select') || !['listening', 'pos'].includes(mode)) return;
    const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (index < 0 || index >= q.options.length) return;
    event.preventDefault();
    selectedIndex = index;
    submit();
  });
  function destroy() {
    if (!alive) return;
    alive = false;
    audioGeneration += 1;
    if (playing) cancelSpeech();
    root.remove();
  }
  render();
  return {
    update(next = {}) {
      if (!alive) return;
      if (own(next, 'disabled')) disabled = Boolean(next.disabled);
      if (savedFeedback(next.feedback)) { result = { saved: true, correct: next.feedback.correct }; error = ''; }
      render();
    },
    getState() {
      return { pending, playing, played, saved: Boolean(result), response: clone(submitted ? submitted.response : draft()),
        replayCount: submitted ? submitted.replayCount : Math.max(0, plays - 1) };
    },
    destroy,
  };
}
