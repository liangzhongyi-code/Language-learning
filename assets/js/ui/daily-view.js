/**
 * 每日學習頁：今日清單總覽 → 新字教學卡 → 作答 → 回饋，逐題保存、關掉可續答。
 *
 * 規則與交易都在 daily-service；這裡只負責畫面與按鍵。保存完成前不放行下一題，
 * 失敗時以同一個 reviewId 重試，同一題不會入帳兩次。
 */
import { awaitLearningStore } from './storage-gate.js';
import { createDailyService } from './platform/daily-service.js';
import { newOperationId, storageMessage } from './platform/learning-store.js';
import { resumeStudySession } from '../core/study-session.js';
import { levelsOf, levelLabel } from '../data/shared/levels.js';
import { ACHIEVEMENTS } from '../core/achievements.js';
import { loadPrefs, setPref } from './prefs.js';
import { applySpeechFallback, bindSpeakButtons } from './speech.js';
import { mountDailyPracticeQuestion } from './daily-practice-question.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NEW_LIMITS = [0, 5, 10, 20];
const REVIEW_LIMIT = 20;
const KIND_LABEL = { new: '新字', review: '複習', reinforcement: '補強' };
const STATUS_LABEL = { pending: '未開始', prepared: '進行中', completed: '完成', skipped: '略過' };

export function initDailyPage({ lang, words = [], wordProvider, practiceProvider, onDataRetry, mount, noticeHost }) {
  let byId = new Map(words.map((word) => [word.id, word]));
  const wordsByLevel = new Map();
  let learningStore = null;
  let loadGeneration = 0;
  let wordsLoading = false;
  let wordsError = false;
  const prefs = loadPrefs();
  const settings = {
    level: [1, 2, 3, 4, 5].includes(prefs[`daily.${lang}.level`]) ? prefs[`daily.${lang}.level`] : 1,
    newLimit: NEW_LIMITS.includes(prefs[`daily.${lang}.newLimit`]) ? prefs[`daily.${lang}.newLimit`] : 5,
    reviewLimit: REVIEW_LIMIT,
  };
  let service = null;
  let view = null;
  let phase = 'overview';
  let current = null;
  let answer = null;
  let saving = false;
  let message = '';
  let unlockedNotice = [];
  let practiceController = null;
  let prepareError = null;

  const status = document.createElement('p');
  status.className = 'backup-msg';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const shell = document.createElement('div');

  function say(text) {
    message = text;
    status.textContent = text;
    status.hidden = !text;
  }

  async function load() {
    const generation = ++loadGeneration;
    const requestedSettings = { ...settings };
    const level = requestedSettings.level;
    wordsLoading = true;
    wordsError = false;
    phase = 'overview';
    view = null;
    current = null;
    answer = null;
    say('正在載入今日清單…');
    render();
    try {
      let selectedWords = words;
      if (typeof wordProvider === 'function') {
        selectedWords = wordsByLevel.get(level);
        if (!selectedWords) {
          try {
            selectedWords = await wordProvider(level);
            if (!Array.isArray(selectedWords) || selectedWords.some((word) => word.level !== level)) {
              throw new Error('單字級別不符');
            }
          } catch (error) {
            if (generation !== loadGeneration) return;
            wordsError = true;
            throw error;
          }
          if (generation !== loadGeneration) return;
          wordsByLevel.set(level, selectedWords);
        }
      }
      if (generation !== loadGeneration) return;
      const selectedService = createDailyService({ store: learningStore, lang, words: selectedWords, practiceProvider });
      const selectedView = await selectedService.today(requestedSettings);
      if (generation !== loadGeneration) return;
      service = selectedService;
      byId = new Map(selectedWords.map((word) => [word.id, word]));
      view = selectedView;
      say('');
    } catch (error) {
      if (generation !== loadGeneration) return;
      say(wordsError ? '單字題庫載入失敗，請重試。' : `今日清單沒有建立：${storageMessage(error)}`);
      view = null;
    }
    wordsLoading = false;
    phase = 'overview';
    render();
  }

  function render() {
    if (practiceController) { practiceController.destroy(); practiceController = null; }
    if (phase === 'overview') renderOverview();
    else if (phase === 'teach') renderTeach();
    else if (phase === 'unavailable') renderUnavailable();
    else renderQuestion();
  }

  function entryWord(entry) {
    return byId.get(entry.sourceId) ?? entry.questionSnapshot ?? null;
  }

  function summaryLine(summary) {
    const parts = [];
    if (summary.reviewCount) parts.push(`待複習 <b>${summary.reviewCount}</b>`);
    if (summary.newCount) parts.push(`新字 <b>${summary.newCount}</b>`);
    parts.push(`已完成 <b>${summary.completedCount}</b>`);
    return parts.join('　·　');
  }

  function renderOverview() {
    const levels = levelsOf(lang);
    const chips = (name, options, currentValue) => options.map(([value, label]) =>
      `<button class="chip" type="button" data-set="${name}" data-value="${value}" aria-pressed="${String(value) === String(currentValue)}">${esc(label)}</button>`).join('');
    const plan = view?.plan;
    const summary = view?.summary;
    const next = view?.next;
    const entries = plan ? plan.orderedEntries.map((entry) => {
      const word = entryWord(entry);
      return `<li class="daily-item is-${entry.status}">
        <span class="daily-kind">${esc(KIND_LABEL[entry.kind])}</span>
        <span class="daily-word" lang="${lang}">${esc(word?.target ?? entry.sourceId)}</span>
        <span class="daily-status">${esc(STATUS_LABEL[entry.status])}</span>
      </li>`;
    }).join('') : '';
    const done = plan && (plan.status === 'completed' || !plan.orderedEntries.length);
    const backlog = summary && summary.remainingDue > 0;
    shell.innerHTML = `
      <div class="card">
        <div class="setting">
          <div class="setting-label">${lang === 'ja' ? 'JLPT 級別' : '程度'}</div>
          <div class="chips">${chips('level', levels.map((l) => [l.level, l.label]), settings.level)}</div>
        </div>
        <div class="setting">
          <div class="setting-label">每日新字</div>
          <div class="chips">${chips('newLimit', NEW_LIMITS.map((n) => [n, `${n} 個`]), settings.newLimit)}</div>
          <p class="setting-note">新字預設每天 5 個，所有級別共用同一個語言額度；換級別不會多發新字。這是產品預設值，不是科學最佳值。</p>
        </div>
        ${plan ? `
          <h2 class="daily-title">${esc(plan.localDate)}　${esc(levelLabel(lang, settings.level))}</h2>
          <p class="daily-summary">${summaryLine(summary)}${backlog ? `<br>另有 <b>${summary.remainingDue}</b> 個到期題排在下一段` : ''}${summary.remainingNewQuota === 0 && settings.newLimit > 0 ? '<br>今天的新字額度已用完。' : ''}</p>
          ${plan.orderedEntries.length ? `<ol class="daily-list">${entries}</ol>` : '<p class="hint">今天沒有到期題，也沒有可學的新字。</p>'}
          <div class="actions">
            ${!done && next?.entry ? `<button class="btn" type="button" data-continue>${summary.completedCount ? '繼續' : '開始今日學習'}</button>` : ''}
            ${done ? '<span class="feedback good">今日清單完成。</span>' : ''}
            ${done && backlog ? '<button class="btn ghost" type="button" data-next-segment>繼續複習下一段</button>' : ''}
          </div>` : `<p class="hint">${wordsLoading ? '正在載入今日清單…' : '還沒有今日清單。'}</p>${!wordsLoading ? '<button class="btn ghost" type="button" data-words-retry>重試載入</button>' : ''}`}
        ${unlockedNotice.length ? achievementHtml() : ''}
      </div>`;
    shell.querySelectorAll('[data-set]').forEach((button) => button.addEventListener('click', () => changeSetting(button)));
    shell.querySelector('[data-continue]')?.addEventListener('click', continueStudy);
    shell.querySelector('[data-next-segment]')?.addEventListener('click', nextSegment);
    shell.querySelector('[data-words-retry]')?.addEventListener('click', () => {
      if (wordsError && typeof onDataRetry === 'function') onDataRetry();
      else load();
    });
  }

  function achievementHtml() {
    const titles = unlockedNotice.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id);
    return `<div class="feedback good">解鎖成就：${titles.map(esc).join('、')}</div>`;
  }

  async function changeSetting(button) {
    const name = button.dataset.set;
    const value = Number(button.dataset.value);
    if (settings[name] === value || saving) return;
    settings[name] = value;
    setPref(`daily.${lang}.${name}`, value);
    await load();
  }

  async function nextSegment() {
    if (saving || wordsLoading || !view) return;
    saving = true;
    try {
      await service.nextSegment(settings, { expectedEpoch: view.dataEpoch });
      await load();
    } catch (error) {
      say(`沒有建立下一段：${storageMessage(error)}`);
    } finally { saving = false; }
  }

  function continueStudy() {
    if (saving || wordsLoading || !view) return;
    const next = resumeStudySession({ plan: view.plan });
    if (next.done) { phase = 'overview'; render(); return; }
    current = next.entry;
    answer = null;
    if (current.kind === 'new' && current.status === 'pending' && !current.questionSnapshot) {
      phase = 'teach';
      render();
      return;
    }
    startEntry();
  }

  function wordDetails(word) {
    if (!word) return '';
    const examples = Array.isArray(word.examples) ? word.examples : word.example ? [word.example] : [];
    return `
      <div class="prompt" lang="${lang}">${esc(word.target)}
        <button class="speak" type="button" data-speak="${esc(word.reading || word.target)}" data-speak-lang="${lang}" title="朗讀" aria-label="朗讀">🔊</button>
      </div>
      ${word.reading && word.reading !== word.target ? `<div class="prompt-sub" lang="${lang}">${esc(word.reading)}${word.romaji ? `　${esc(word.romaji)}` : ''}</div>` : ''}
      <div class="daily-meaning">${esc(word.zh)}</div>
      ${examples.length ? `<ul class="daily-examples">${examples.map((ex) => `<li lang="${lang}">${esc(typeof ex === 'string' ? ex : ex.target ?? '')}${ex?.zh ? `<br><span class="hint">${esc(ex.zh)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${word.note ? `<p class="setting-note">${esc(word.note)}</p>` : ''}`;
  }

  function renderTeach() {
    const word = entryWord(current);
    shell.innerHTML = `
      <div class="card">
        <div class="quiz-top"><span class="progress-text">新字介紹 · ${esc(view.plan.localDate)}</span></div>
        ${wordDetails(word)}
        <p class="setting-note">看過介紹不算學會；按「開始測驗」才會用掉今天的一個新字額度，答完才有作答紀錄。</p>
        <div class="actions">
          <button class="btn" type="button" data-start>開始測驗</button>
          <button class="btn ghost" type="button" data-skip>今天略過</button>
          <button class="btn ghost" type="button" data-known>我已經會了</button>
          <button class="btn ghost" type="button" data-back>回清單</button>
        </div>
      </div>`;
    shell.querySelector('[data-start]').addEventListener('click', startEntry);
    shell.querySelector('[data-skip]').addEventListener('click', () => adjust('skip'));
    shell.querySelector('[data-known]').addEventListener('click', () => adjust('known'));
    shell.querySelector('[data-back]').addEventListener('click', () => { if (!saving) { phase = 'overview'; render(); } });
    shell.querySelector('[data-start]').focus();
  }

  async function adjust(kind) {
    if (saving) return;
    const generation = loadGeneration;
    const selectedService = service;
    const requestedSettings = { ...settings };
    const selectedView = view;
    const selectedEntry = current;
    const isCurrent = () => generation === loadGeneration && service === selectedService;
    saving = true;
    try {
      const options = { expectedEpoch: selectedView.dataEpoch };
      if (kind === 'skip') await selectedService.skip(selectedView.plan.planId, selectedEntry.entryId, requestedSettings, options);
      else await selectedService.markKnown(selectedView.plan.planId, selectedEntry.sourceId, requestedSettings, options);
      const refreshed = await selectedService.today(requestedSettings, options);
      if (!isCurrent()) return;
      view = refreshed;
      say(kind === 'skip' ? '今天不再出現這個字，已換上下一個新字。' : '已標為「自評已會」（未經測驗驗證），不再當新字介紹；之後答錯會自動解除。');
      saving = false;
      continueStudy();
    } catch (error) {
      if (!isCurrent()) return;
      saving = false;
      say(`清單調整或刷新尚未確認，請回清單重新載入：${storageMessage(error)}`);
    }
  }

  async function startEntry() {
    if (saving) return;
    saving = true;
    prepareError = null;
    say('');
    try {
      const prepared = await service.prepare(view.plan.planId, current.entryId, { expectedEpoch: view.dataEpoch });
      const plan = prepared.value?.plan;
      if (plan) view = { ...view, plan, next: resumeStudySession({ plan }) };
      else view = await service.today(settings, { expectedEpoch: view.dataEpoch });
      current = view.plan.orderedEntries.find((row) => row.entryId === current.entryId);
      phase = 'question';
    } catch (error) {
      prepareError = error?.code;
      saving = false;
      if (['STALE_PLAN', 'STALE_EPOCH', 'ENTRY_CONFLICT'].includes(error?.code)) { await load(); return; }
      phase = 'unavailable';
      say('題次尚未開始，沒有作答入帳。');
    }
    saving = false;
    render();
  }

  function renderQuestion() {
    const q = current.questionSnapshot;
    if (q.practiceMode) { renderPracticeQuestion(); return; }
    const answered = answer?.saved === true;
    const chosen = answer?.answeredIndex ?? null;
    const position = view.plan.orderedEntries.findIndex((row) => row.entryId === current.entryId);
    const options = q.options.map((option, i) => {
      let cls = 'opt';
      let mark = '';
      if (answered && i === q.correctIndex) { cls += ' is-correct'; mark = '<span class="mark">正解</span>'; }
      else if (answered && i === chosen) { cls += ' is-wrong'; mark = '<span class="mark">你選的</span>'; }
      else if (!answered && i === chosen) cls += ' is-picked';
      return `<button class="${cls}" type="button" data-opt="${i}" ${answered || saving || chosen !== null ? 'disabled' : ''}
        lang="${q.optionLang === 'zh' ? 'zh-Hant' : lang}"><span class="key">${i + 1}</span>${esc(option.text)}${mark}</button>`;
    }).join('');
    const correct = answered && chosen === q.correctIndex;
    const feedback = !answered ? '' : correct
      ? '<div class="feedback good">答對了。</div>'
      : `<div class="feedback">正解是 <b>${esc(q.options[q.correctIndex].text)}</b>。這個字稍後會再出現一次補強。</div>`;
    const failed = answer && answer.error;
    shell.innerHTML = `
      <div class="card">
        <div class="quiz-top">
          <span class="progress-text">第 ${position + 1} / ${view.plan.orderedEntries.length} 項 · ${esc(KIND_LABEL[current.kind])}</span>
        </div>
        <div class="prompt" lang="${q.promptLang === 'zh' ? 'zh-Hant' : lang}">${esc(q.prompt)}
          ${q.promptLang !== 'zh' ? `<button class="speak" type="button" data-speak="${esc(q.speakText)}" data-speak-lang="${lang}" title="朗讀題目" aria-label="朗讀題目">🔊</button>` : ''}
        </div>
        ${lang === 'ja' && q.promptLang !== 'zh' && q.reading && q.reading !== q.prompt ? `<div class="prompt-sub" lang="ja">${esc(q.reading)}</div>` : ''}
        <div class="prompt-sub">選出正確的${q.optionLang === 'zh' ? '中文意思' : '說法'}<span class="kbd-hint">　·　可按鍵盤 1-4</span></div>
        <div class="opts">${options}</div>
        ${feedback}
        ${failed ? `<div class="notice"><b>這題還沒有保存。</b>${esc(answer.error)}
          <div class="actions"><button class="btn sm" type="button" data-retry>重試保存</button></div></div>` : ''}
        ${saving ? '<p class="hint">正在保存…</p>' : ''}
        <div class="actions">
          <button class="btn" type="button" data-next ${answered ? '' : 'disabled'}>下一項 →</button>
          <button class="btn ghost" type="button" data-back>回清單</button>
        </div>
      </div>
      ${unlockedNotice.length ? `<div class="card">${achievementHtml()}</div>` : ''}`;
    shell.querySelectorAll('[data-opt]').forEach((button) => button.addEventListener('click', () => choose(Number(button.dataset.opt))));
    shell.querySelector('[data-retry]')?.addEventListener('click', submitAnswer);
    shell.querySelector('[data-next]').addEventListener('click', nextEntry);
    shell.querySelector('[data-back]').addEventListener('click', () => { if (!saving) load(); });
    if (answered) shell.querySelector('[data-next]').focus();
    else if (failed) shell.querySelector('[data-retry]').focus();
    else shell.querySelector('[data-opt]')?.focus();
  }

  /**
   * 固定安全文案，不顯示原始例外。真正 import 故障需重新載入文件，避開 module 失敗快取。
   */
  function renderUnavailable() {
    const network = prepareError === 'PRACTICE_LOAD_FAILED';
    const unavailable = ['DAILY_PRACTICE_UNAVAILABLE', 'UNSUPPORTED'].includes(prepareError);
    const text = network ? '題庫載入失敗，可重新載入頁面重試。排程保留未完成。'
      : unavailable ? '尚無同級對應題型，排程保留未完成；不會改成辨認題或跨級補題。'
        : '題目尚未準備成功，排程保留未完成。請重試或回清單。';
    shell.innerHTML = `<div class="card"><p class="notice">${text}</p><div class="actions">
      <button class="btn" type="button" data-prepare-retry>${network ? '重新載入頁面重試' : '重試準備題目'}</button>
      <button class="btn ghost" type="button" data-back>回清單</button>
      <a class="btn ghost" href="practice.html">改練其他題型</a></div></div>`;
    shell.querySelector('[data-prepare-retry]').addEventListener('click', () => {
      if (saving) return;
      if (network) {
        if (typeof onDataRetry === 'function') onDataRetry();
        else window.location.reload();
      } else startEntry();
    });
    shell.querySelector('[data-back]').addEventListener('click', () => { if (!saving) load(); });
  }

  function renderPracticeQuestion() {
    const position = view.plan.orderedEntries.findIndex(row => row.entryId === current.entryId);
    shell.innerHTML = `<div class="card"><p class="progress-text">第 ${position + 1} / ${view.plan.orderedEntries.length} 項 · ${esc(KIND_LABEL[current.kind])}</p>
      <div data-practice-question></div><div class="actions">
      <button class="btn" type="button" data-next ${answer?.saved ? '' : 'disabled'}>下一項 →</button>
      <a class="btn ghost" href="practice.html" data-other-practice>改練其他題型</a></div></div>`;
    practiceController = mountDailyPracticeQuestion({ mount: shell.querySelector('[data-practice-question]'),
      question: current.questionSnapshot, lang, response: answer?.response ?? null,
      feedback: answer?.saved ? { saved: true, correct: answer.correct } : null,
      onSubmit: submitPracticeAnswer, onBack: () => { if (!saving) load(); } });
    shell.querySelector('[data-next]').addEventListener('click', nextEntry);
    shell.querySelector('[data-other-practice]').addEventListener('click', event => {
      if (saving) event.preventDefault();
      else practiceController?.destroy();
    });
  }

  /**
   * renderer 保留輸入／播放狀態，本層保留 reviewId 與 epoch；保存失敗不換題或顯示正解。
   */
  async function submitPracticeAnswer(response, { replayCount = 0, hintUsed = false } = {}) {
    if (saving) throw new Error('SAVE_IN_PROGRESS');
    if (!answer) answer = { response, replayCount, hintUsed, reviewId: newOperationId('rv'), expectedEpoch: view.dataEpoch, saved: false };
    if (answer.saved) return { saved: true, correct: answer.correct };
    saving = true;
    const otherPractice = shell.querySelector('[data-other-practice]');
    otherPractice.setAttribute('aria-disabled', 'true');
    otherPractice.removeAttribute('href');
    shell.querySelector('[data-next]').disabled = true;
    const generation = loadGeneration;
    const selectedEntry = current.entryId;
    try {
      const result = await service.submit({ planId: view.plan.planId, entryId: selectedEntry, ...answer });
      if (generation !== loadGeneration || selectedEntry !== current?.entryId) throw new Error('VIEW_CHANGED');
      const plan = result.value?.plan;
      if (plan) view = { ...view, plan, next: resumeStudySession({ plan }) };
      if (typeof result.value?.event?.correct !== 'boolean') throw new Error('SAVE_NOT_CONFIRMED');
      answer.correct = result.value.event.correct;
      answer.saved = true;
      unlockedNotice = (result.value?.unlocked || []).map(unlock => unlock.achievementId);
      shell.querySelector('[data-next]').disabled = false;
      say('已保存。');
      return { saved: true, correct: answer.correct };
    } catch (error) {
      if (['ENTRY_CONFLICT', 'STALE_EPOCH'].includes(error?.code)) {
        saving = false;
        await load();
      }
      throw error;
    } finally {
      saving = false;
      if (generation === loadGeneration && selectedEntry === current?.entryId) {
        otherPractice.removeAttribute('aria-disabled');
        otherPractice.setAttribute('href', 'practice.html');
      }
    }
  }

  function choose(index) {
    if (answer || saving) return;
    answer = { answeredIndex: index, reviewId: newOperationId('rv'), expectedEpoch: view.dataEpoch, saved: false, error: '' };
    submitAnswer();
  }

  async function submitAnswer() {
    if (!answer || saving) return;
    saving = true;
    answer.error = '';
    render();
    try {
      const result = await service.submit({ planId: view.plan.planId, entryId: current.entryId,
        answeredIndex: answer.answeredIndex, reviewId: answer.reviewId, expectedEpoch: answer.expectedEpoch });
      const plan = result.value?.plan;
      if (plan) view = { ...view, plan, next: resumeStudySession({ plan }) };
      unlockedNotice = (result.value?.unlocked || []).map((u) => u.achievementId);
      answer.saved = true;
      say('已保存。');
    } catch (error) {
      answer.error = storageMessage(error);
      if (error?.code === 'ENTRY_CONFLICT' || error?.code === 'STALE_EPOCH') {
        saving = false;
        say(`這題沒有保存：${storageMessage(error)}`);
        await load();
        return;
      }
    }
    saving = false;
    render();
  }

  function nextEntry() {
    if (!answer?.saved) return;
    unlockedNotice = [];
    say('');
    if (view.next.done) { load(); return; }
    continueStudy();
  }

  document.addEventListener('keydown', (event) => {
    if (phase !== 'question' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (current?.questionSnapshot?.practiceMode) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const digit = event.key >= '1' && event.key <= '4' ? Number(event.key) - 1 : -1;
    if (digit >= 0 && !answer && digit < current.questionSnapshot.options.length) {
      event.preventDefault();
      choose(digit);
    } else if (event.key === 'Enter' && answer?.saved && !event.target.closest?.('button, a[href]')) {
      event.preventDefault();
      nextEntry();
    }
  });

  applySpeechFallback(lang, noticeHost);
  awaitLearningStore(mount, async (store) => {
    mount.replaceChildren(shell, status);
    learningStore = store;
    bindSpeakButtons(shell, lang);
    await load();
  });
}
