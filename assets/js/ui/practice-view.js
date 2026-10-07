/**
 * 新題型練習頁：拼寫、假名輸入、聽力、聽寫、拼組、句子重組、語境詞性。
 *
 * 題面的正解只存在 answerKey，畫面不渲染；聽寫的朗讀文字本身就是答案，只拿去播放、
 * 不放進任何文字、aria 或 title。每題判題有效才保存；播放失敗不計錯，可重試或跳過。
 */
import { awaitLearningStore } from './storage-gate.js';
import { createPracticeService } from './platform/practice-service.js';
import { newOperationId, storageMessage } from './platform/learning-store.js';
import { shouldSubmitOnEnter } from '../core/practice-answers.js';
import { levelsOf } from '../data/shared/levels.js';
import { ACHIEVEMENTS } from '../core/achievements.js';
import { applySpeechFallback, onVoicesReady, hasOfflineVoiceFor, speakChecked, cancel as cancelSpeech } from './speech.js';
import { answerFeedback, listeningDecision } from './feedback.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MODE_LABEL = {
  typing: '看中文拼寫', kana: '看漢字打假名', listening: '聽力選意思', dictation: '聽寫',
  tiles: '拼組', reorder: '句子重組', pos: '語境詞性',
};
const MODE_NOTE = {
  typing: '看中文打出外文。按「提示」會顯示第一個字，這題就不算無提示的自由產出。',
  kana: '看漢字詞打出平假名讀音；片假名會自動轉成平假名比對，但促音、長音、濁音的差別都要打對。',
  listening: '聽發音選中文意思。只使用裝置的離線語音；播放失敗不算錯。',
  dictation: '聽發音打出外文。只使用裝置的離線語音；播放失敗不算錯。',
  tiles: '點選片段拼出單字；相同的片段互換不影響對錯。',
  reorder: '點選片段排出句子；只接受人工核對過的合法語序。',
  pos: '判斷畫線的字在這一句裡的詞性——同一個字在不同句子可能不同。',
};
const LISTEN_MODES = ['listening', 'dictation'];
const TEXT_MODES = ['typing', 'kana', 'dictation'];

export function initPracticePage({ lang, practice, mount, noticeHost }) {
  const params = new URLSearchParams(window.location.search);
  const modes = Object.keys(MODE_LABEL).filter((mode) => lang === 'ja' || mode !== 'kana');
  const state = {
    mode: modes.includes(params.get('mode')) ? params.get('mode') : 'typing',
    level: 1,
    bookId: params.get('book') || null,
  };
  let service = null;
  let books = {};
  let offlineVoice = false;
  let eligibility = null;
  let round = null;
  let saving = false;

  const shell = document.createElement('div');
  const status = document.createElement('p');
  status.className = 'backup-msg';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const say = (text) => { status.textContent = text; status.hidden = !text; };

  async function refreshSetup() {
    try {
      books = (await service.repositoryBooks()) ?? {};
      eligibility = LISTEN_MODES.includes(state.mode) && !offlineVoice
        ? { ok: false, reason: `這台裝置沒有${lang === 'ja' ? '日文' : '英文'}的離線語音，聽力與聽寫暫時無法使用；其他題型照常。可到系統設定安裝語音包後重新整理。` }
        : await service.eligibility(state);
    } catch (error) {
      eligibility = { ok: false, reason: storageMessage(error) };
    }
    renderSetup();
  }

  function renderSetup() {
    cancelSpeech();
    const chip = (name, value, label, disabled = false) =>
      `<button class="chip" type="button" data-set="${name}" data-value="${esc(value)}" aria-pressed="${String(state[name]) === String(value)}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
    const bookOptions = Object.values(books).map((book) =>
      `<option value="${esc(book.bookId)}" ${state.bookId === book.bookId ? 'selected' : ''}>${esc(book.name)}（${book.wordIds.filter((id) => id.startsWith(`${lang}-`)).length} 字）</option>`).join('');
    shell.innerHTML = `
      <div class="card">
        <div class="setting">
          <span class="setting-label">題型</span>
          <div class="chips">${modes.map((mode) => chip('mode', mode, MODE_LABEL[mode])).join('')}</div>
          <p class="setting-note">${esc(MODE_NOTE[state.mode])}</p>
        </div>
        <div class="setting">
          <span class="setting-label">${lang === 'ja' ? 'JLPT 級別' : '程度'}</span>
          <div class="chips">${levelsOf(lang).map((l) => chip('level', l.level, l.label)).join('')}</div>
        </div>
        <div class="setting">
          <label class="setting-label" for="practice-book">範圍</label>
          <select id="practice-book" class="text-input" data-book>
            <option value="">全部題目</option>${bookOptions}
          </select>
          <p class="setting-note">選了單字簿就只練簿內的字；題目不夠時會說明原因，不會拿其他級別或全部題庫補。</p>
        </div>
        ${eligibility && !eligibility.ok ? `<div class="notice">${esc(eligibility.reason)}</div>` : ''}
        <div class="actions">
          <button class="btn" type="button" data-start ${eligibility?.ok ? '' : 'disabled'}>開始練習${eligibility?.ok ? `（${Math.min(10, eligibility.items.length)} 題）` : ''}</button>
        </div>
      </div>`;
    shell.querySelectorAll('[data-set]').forEach((button) => button.addEventListener('click', () => {
      const name = button.dataset.set;
      state[name] = name === 'level' ? Number(button.dataset.value) : button.dataset.value;
      refreshSetup();
    }));
    shell.querySelector('[data-book]').addEventListener('change', (event) => { state.bookId = event.currentTarget.value || null; refreshSetup(); });
    shell.querySelector('[data-start]').addEventListener('click', start);
  }

  async function start() {
    if (saving) return;
    saving = true;
    try {
      const started = await service.start(state);
      round = { ...started, index: 0, answers: [], results: [] };
      say('');
      newQuestion();
    } catch (error) {
      say(error?.message || storageMessage(error));
    } finally { saving = false; }
    if (round) renderQuestion();
  }

  function newQuestion() {
    round.current = { input: '', picked: [], selectedIndex: null, hintUsed: false, replayCount: 0, played: false,
      playError: '', saved: false, error: '', reviewId: newOperationId('pr'), correct: null, unlocked: [] };
  }

  const q = () => round.questions[round.index];

  function promptHtml(question) {
    if (question.practiceMode === 'pos') {
      const before = question.sentence.slice(0, question.position);
      const target = question.sentence.slice(question.position, question.position + question.targetWord.length);
      const after = question.sentence.slice(question.position + question.targetWord.length);
      return `<div class="prompt" lang="${lang}">${esc(before)}<u>${esc(target)}</u>${esc(after)}</div>
        <div class="prompt-sub">「${esc(question.targetWord)}」在這一句裡是什麼詞性？</div>`;
    }
    if (LISTEN_MODES.includes(question.practiceMode)) {
      return `<div class="prompt">${esc(question.prompt)}</div>
        <div class="actions"><button class="btn sm" type="button" data-play aria-label="播放題目語音">▶ 播放${round.current.replayCount ? `（已重播 ${round.current.replayCount} 次）` : ''}</button></div>`;
    }
    return `<div class="prompt" lang="${question.practiceMode === 'kana' ? lang : 'zh-Hant'}">${esc(question.prompt)}</div>`;
  }

  function answerAreaHtml(question, done) {
    const cur = round.current;
    if (TEXT_MODES.includes(question.practiceMode)) {
      return `<div class="field-row">
        <label class="setting-label" for="practice-input">${question.practiceMode === 'kana' ? '輸入平假名' : '輸入答案'}</label>
        <input id="practice-input" class="text-input" data-input lang="${lang}" autocomplete="off" autocapitalize="off" spellcheck="false" ${done ? 'disabled' : ''}>
        ${done ? '' : '<button class="btn sm" type="button" data-submit>提交</button>'}
        ${done || question.practiceMode !== 'typing' || cur.hintUsed ? '' : '<button class="btn ghost sm" type="button" data-hint>提示</button>'}
      </div>${cur.hintUsed && !done ? `<p class="setting-note">提示：第一個字是「${esc([...question.answerKey.accepted[0]][0])}」</p>` : ''}`;
    }
    if (['listening', 'pos'].includes(question.practiceMode)) {
      return `<div class="opts">${question.options.map((option, i) => {
        let cls = 'opt';
        let mark = '';
        if (done && i === question.answerKey.correctIndex) { cls += ' is-correct'; mark = '<span class="mark">正解</span>'; }
        else if (done && i === cur.selectedIndex) { cls += ' is-wrong'; mark = '<span class="mark">你選的</span>'; }
        return `<button class="${cls}" type="button" data-opt="${i}" ${done || saving ? 'disabled' : ''}><span class="key">${i + 1}</span>${esc(option)}${mark}</button>`;
      }).join('')}</div>`;
    }
    const pieces = question.practiceMode === 'tiles' ? question.fragments : question.chunks;
    const used = new Set(cur.picked);
    const byId = new Map(pieces.map((piece) => [piece.instanceId, piece]));
    return `
      <p class="setting-label">你的答案（點片段可移回）</p>
      <div class="tiles is-answer" data-answer-row lang="${lang}">${cur.picked.map((id) => `<button class="tile" type="button" data-unpick="${esc(id)}" ${done ? 'disabled' : ''}>${esc(byId.get(id).text)}</button>`).join('')}</div>
      <p class="setting-label">可用片段</p>
      <div class="tiles" lang="${lang}">${pieces.map((piece) => `<button class="tile" type="button" data-pick="${esc(piece.instanceId)}" ${done || used.has(piece.instanceId) ? 'disabled' : ''}>${esc(piece.text)}</button>`).join('')}</div>
      ${done ? '' : '<div class="actions"><button class="btn sm" type="button" data-submit>提交</button><button class="btn ghost sm" type="button" data-clear-pick>清除</button></div>'}`;
  }

  function resultHtml(question) {
    const cur = round.current;
    if (!cur.saved) return '';
    const key = question.answerKey;
    let answer = '';
    if (TEXT_MODES.includes(question.practiceMode)) answer = key.accepted.join(' ／ ');
    else if (question.practiceMode === 'tiles') answer = key.answer;
    else if (question.practiceMode === 'reorder') {
      const textByIndex = {};
      for (const [instanceId, index] of Object.entries(key.chunkIndexByInstance)) {
        textByIndex[index] = question.chunks.find((chunk) => chunk.instanceId === instanceId).text;
      }
      answer = key.legalOrders.map((order) => order.map((index) => textByIndex[index]).join(lang === 'en' ? ' ' : '')).join(' ／ ');
    }
    const titles = cur.unlocked.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id);
    return `<div class="feedback ${cur.correct ? 'good' : ''}">${cur.correct ? '答對了。' : '答錯了。'}${answer ? `可接受的答案：<b lang="${lang}">${esc(answer)}</b>` : ''}${cur.hintUsed ? '<br>這題用了提示，排程會當作需要再練。' : ''}</div>
      ${titles.length ? `<div class="feedback good">解鎖成就：${titles.map(esc).join('、')}</div>` : ''}`;
  }

  function renderQuestion() {
    const question = q();
    const cur = round.current;
    const done = cur.saved;
    shell.innerHTML = `
      <div class="card">
        <div class="quiz-top"><span class="progress-text">第 ${round.index + 1} / ${round.questions.length} 題 · ${esc(MODE_LABEL[question.practiceMode])}</span></div>
        ${promptHtml(question)}
        ${cur.playError ? `<div class="notice"><b>播放失敗，這題不計分。</b>${esc(cur.playError)}
          <div class="actions"><button class="btn sm" type="button" data-play>重試播放</button><button class="btn ghost sm" type="button" data-skip>跳過這題</button></div></div>` : ''}
        ${answerAreaHtml(question, done)}
        ${resultHtml(question)}
        ${cur.error ? `<div class="notice"><b>這題還沒有保存。</b>${esc(cur.error)}<div class="actions"><button class="btn sm" type="button" data-retry>重試保存</button></div></div>` : ''}
        ${saving ? '<p class="hint">正在保存…</p>' : ''}
        <div class="actions">
          <button class="btn" type="button" data-next ${done ? '' : 'disabled'}>${round.index === round.questions.length - 1 ? '看結果' : '下一題 →'}</button>
          <button class="btn ghost" type="button" data-quit>結束練習</button>
        </div>
      </div>`;
    const input = shell.querySelector('[data-input]');
    if (input) {
      input.value = cur.input;
      input.addEventListener('input', () => { cur.input = input.value; });
      input.addEventListener('keydown', (event) => {
        if (shouldSubmitOnEnter(event)) { event.preventDefault(); submit(); }
      });
    }
    const on = (selector, handler) => shell.querySelectorAll(selector).forEach((node) => node.addEventListener('click', () => handler(node)));
    on('[data-submit]', () => submit());
    on('[data-hint]', () => { cur.hintUsed = true; renderQuestion(); });
    on('[data-opt]', (node) => { cur.selectedIndex = Number(node.dataset.opt); submit(); });
    on('[data-pick]', (node) => { cur.picked.push(node.dataset.pick); renderQuestion(); });
    on('[data-unpick]', (node) => { cur.picked = cur.picked.filter((id) => id !== node.dataset.unpick); renderQuestion(); });
    on('[data-clear-pick]', () => { cur.picked = []; renderQuestion(); });
    on('[data-play]', () => play());
    on('[data-skip]', () => skip());
    on('[data-retry]', () => persist());
    on('[data-next]', () => next());
    on('[data-quit]', () => { round = null; refreshSetup(); });
    if (done) shell.querySelector('[data-next]').focus();
    else if (input) input.focus();
    if (LISTEN_MODES.includes(question.practiceMode) && !cur.played && !cur.playError && !done) autoplay();
  }

  function autoplay() {
    const decision = listeningDecision();
    if (decision.speak) play(false);
    else if (decision.needsUserChoice) say('安靜模式或朗讀已關閉：要聽這題請按「播放」，不想播放可以按「結束練習」或跳過，不會算錯。');
  }

  async function play(userInitiated = true) {
    const question = q();
    const cur = round.current;
    if (userInitiated && !listeningDecision({ userInitiated: true }).speak) {
      cur.playError = '這個瀏覽器不支援語音朗讀。';
      renderQuestion();
      return;
    }
    if (cur.played) cur.replayCount += 1;
    cur.played = true;
    cur.playError = '';
    try {
      await speakChecked(question.context ?? question.speakText, lang);
    } catch (error) {
      cur.playError = error?.code === 'SPEECH_NO_OFFLINE_VOICE' ? '找不到離線語音。' : '請稍後再試，或跳過這題。';
      renderQuestion();
    }
  }

  function response() {
    const question = q();
    const cur = round.current;
    if (TEXT_MODES.includes(question.practiceMode)) return { input: cur.input };
    if (['listening', 'pos'].includes(question.practiceMode)) return { selectedIndex: cur.selectedIndex };
    return { instanceIds: cur.picked };
  }

  async function submit() {
    const cur = round.current;
    if (cur.saved || saving) return;
    if (LISTEN_MODES.includes(q().practiceMode) && !cur.played) {
      say('請先播放題目語音再作答。');
      cur.selectedIndex = null;
      return;
    }
    await persist();
  }

  async function persist() {
    const cur = round.current;
    saving = true;
    cur.error = '';
    try {
      const result = await service.submit({ sessionId: round.session.sessionId, index: round.index, question: q(),
        response: response(), reviewId: cur.reviewId, hintUsed: cur.hintUsed, replayCount: cur.replayCount });
      cur.saved = true;
      cur.correct = result.replay ? cur.correct : result.correct;
      cur.unlocked = (result.unlocked || []).map((u) => u.achievementId);
      round.results[round.index] = cur.correct;
      answerFeedback(cur.correct);
      say('已保存。');
    } catch (error) {
      if (error?.code === 'INVALID_ANSWER') { say(error.message); cur.selectedIndex = null; }
      else cur.error = storageMessage(error);
    }
    saving = false;
    renderQuestion();
  }

  async function skip() {
    try {
      await service.skip({ sessionId: round.session.sessionId, index: round.index });
      round.results[round.index] = null;
      say('已跳過這題，不計分。');
      next(true);
    } catch (error) {
      say(`沒有跳過：${storageMessage(error)}`);
    }
  }

  function next(skipped = false) {
    if (!skipped && !round.current.saved) return;
    if (round.index < round.questions.length - 1) {
      round.index += 1;
      newQuestion();
      renderQuestion();
      return;
    }
    const answered = round.results.filter((r) => r !== null && r !== undefined);
    const correct = answered.filter(Boolean).length;
    shell.innerHTML = `
      <div class="card">
        <div class="score"><b>${correct} / ${answered.length}</b><span>${esc(MODE_LABEL[round.session.mode])}${answered.length < round.questions.length ? `　·　跳過 ${round.questions.length - answered.length} 題（不計分）` : ''}</span></div>
        <p class="hint">每一題已在作答時保存；能力紀錄依題型分開計算。</p>
        <div class="actions"><button class="btn" type="button" data-again>再練一次</button><a class="btn ghost" href="./index.html">回首頁</a></div>
      </div>`;
    round = null;
    shell.querySelector('[data-again]').addEventListener('click', refreshSetup);
  }

  document.addEventListener('keydown', (event) => {
    if (!round || round.current.saved || event.target.closest?.('input, textarea, select')) return;
    const question = q();
    if (!['listening', 'pos'].includes(question.practiceMode)) return;
    const digit = event.key >= '1' && event.key <= '9' ? Number(event.key) - 1 : -1;
    if (digit >= 0 && digit < question.options.length) {
      event.preventDefault();
      round.current.selectedIndex = digit;
      submit();
    }
  });

  applySpeechFallback(lang, noticeHost);
  awaitLearningStore(mount, async (store) => {
    mount.replaceChildren(shell, status);
    service = createPracticeService({ store, lang, items: practice });
    service.repositoryBooks = async () => (await store.read(['books'])).rows.books;
    onVoicesReady(() => {
      offlineVoice = hasOfflineVoiceFor(lang);
      refreshSetup();
    });
  });
}
