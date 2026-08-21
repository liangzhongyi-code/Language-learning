/**
 * 測驗頁。設定 → 作答 → 結果三個狀態在同一頁切換。
 *
 * 這一層刻意做得很薄：抽題、干擾選項、計分全部在 core/quiz-engine.js，
 * 統計在 core/stats.js。這裡只負責把資料畫出來、把點擊轉成函式呼叫。
 *
 * 一局的狀態只活在記憶體裡，不寫進 localStorage——重新整理就回到設定畫面。
 * 這是刻意的：允許中途離開再回來，正確率就失去意義了。
 */

import { buildSession, answer } from '../core/quiz-engine.js';
import { summarize, isComplete, applySession, loadStats, saveStats } from '../core/stats.js';
import { speak } from './speech.js';

const DIRECTION_LABEL = {
  zh2target: { en: '中翻英', ja: '中翻日' },
  target2zh: { en: '英翻中', ja: '日翻中' },
  mixed: { en: '混合', ja: '混合' },
};

const SOURCE_LABEL = { words: '單字', sentences: '句型', mixed: '單字 + 句型' };

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * localStorage 取用一律包起來，被停用時回傳 undefined
 */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function initQuizPage({ lang, words, sentences, mount, noticeHost }) {
  /**
   * 設定值。題源可由網址參數預選，供單字頁與文法頁的捷徑使用。
   */
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('source');
  const config = {
    source: ['words', 'sentences', 'mixed'].includes(requested) ? requested : 'words',
    direction: 'zh2target',
    count: 10,
  };

  let session = null;
  /* 統計只在進入結果畫面時寫入一次，避免重複累加 */
  let recorded = false;

  const poolSize = (source) =>
    source === 'words' ? words.length : source === 'sentences' ? sentences.length : words.length + sentences.length;

  /* ── 設定畫面 ─────────────────────────────────────────── */

  function renderSetup(errorMessage) {
    const chips = (name, options, current) =>
      options
        .map(
          ([value, label]) =>
            `<button class="chip" data-set="${name}" data-value="${value}" aria-pressed="${
              String(value) === String(current)
            }">${esc(label)}</button>`
        )
        .join('');

    const total = poolSize(config.source);

    mount.innerHTML = `
      <div class="card">
        <div class="setting">
          <label>題源</label>
          <div class="chips">${chips('source', [
            ['words', `單字（${words.length}）`],
            ['sentences', `句型（${sentences.length}）`],
            ['mixed', `混合（${words.length + sentences.length}）`],
          ], config.source)}</div>
        </div>

        <div class="setting">
          <label>出題方向</label>
          <div class="chips">${chips('direction', [
            ['zh2target', DIRECTION_LABEL.zh2target[lang]],
            ['target2zh', DIRECTION_LABEL.target2zh[lang]],
            ['mixed', '混合'],
          ], config.direction)}</div>
        </div>

        <div class="setting">
          <label>題數</label>
          <div class="chips">${chips('count', [
            [10, '10 題'],
            [20, '20 題'],
            [total, `全部（${total}）`],
          ], config.count)}</div>
        </div>

        ${errorMessage ? `<div class="notice"><b>無法開始：</b>${esc(errorMessage)}</div>` : ''}

        <div class="actions">
          <button class="btn" data-start>開始測驗</button>
        </div>
      </div>`;

    mount.querySelectorAll('[data-set]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const { set, value } = chip.dataset;
        config[set] = set === 'count' ? Number(value) : value;
        /* 換題源時題數上限會變，全部重畫最單純 */
        if (set === 'source') config.count = Math.min(config.count, poolSize(value));
        renderSetup();
      });
    });

    mount.querySelector('[data-start]').addEventListener('click', start);
  }

  function start() {
    try {
      session = buildSession({ lang, words, sentences, ...config });
      recorded = false;
      renderQuestion();
    } catch (error) {
      renderSetup(error.message);
    }
  }

  /* ── 作答畫面 ─────────────────────────────────────────── */

  function renderQuestion() {
    const index = session.cursor;
    const q = session.questions[index];
    const total = session.questions.length;
    const answered = q.answeredIndex !== null;
    const isLast = index === total - 1;

    /* 題面是目標語言時才提供朗讀；中翻外的題面是中文，沒有朗讀的意義 */
    const promptSpeak =
      q.direction === 'target2zh'
        ? `<button class="speak" data-speak-prompt title="朗讀題目">🔊</button>`
        : '';

    const options = q.options
      .map((option, i) => {
        let cls = 'opt';
        let mark = '';
        if (answered) {
          if (i === q.correctIndex) {
            cls += ' is-correct';
            mark = '<span class="mark">正解</span>';
          } else if (i === q.answeredIndex) {
            cls += ' is-wrong';
            mark = '<span class="mark">你選的</span>';
          }
        }
        const button = `<button class="${cls}" data-opt="${i}" ${answered ? 'disabled' : ''}>
            <span class="key">${i + 1}</span>${esc(option.text)}${mark}
          </button>`;

        /* 作答後在正解旁邊補一顆朗讀鍵，讓使用者聽正確的說法 */
        const needsSpeak = answered && i === q.correctIndex && q.optionLang !== 'zh';
        return needsSpeak
          ? `<div class="opt-row">${button}<button class="speak tall" data-speak-answer title="朗讀正解">🔊</button></div>`
          : button;
      })
      .join('');

    const feedback = !answered
      ? ''
      : q.answeredIndex === q.correctIndex
        ? `<div class="feedback good">答對了。${q.note ? esc(q.note) : ''}</div>`
        : `<div class="feedback">正解是 <b>${esc(q.options[q.correctIndex].text)}</b>。${
            q.note ? `<br>${esc(q.note)}` : ''
          }</div>`;

    mount.innerHTML = `
      <div class="card">
        <div class="quiz-top">
          <span class="progress-text">第 ${index + 1} / ${total} 題 · ${esc(
            DIRECTION_LABEL[q.direction][lang]
          )}</span>
          <span class="bar"><i style="width:${Math.round(((index + (answered ? 1 : 0)) / total) * 100)}%"></i></span>
        </div>

        <div class="prompt">${esc(q.prompt)}${promptSpeak}</div>
        <div class="prompt-sub">選出正確的${q.optionLang === 'zh' ? '中文意思' : '說法'}　·　可按鍵盤 1-4</div>

        <div class="opts">${options}</div>
        ${feedback}

        <div class="actions">
          <button class="btn" data-next ${answered ? '' : 'disabled'}>${isLast ? '看結果' : '下一題 →'}</button>
          <button class="btn ghost" data-quit>結束這局</button>
        </div>
      </div>`;

    mount.querySelectorAll('[data-opt]').forEach((button) => {
      button.addEventListener('click', () => choose(Number(button.dataset.opt)));
    });
    mount.querySelector('[data-speak-prompt]')?.addEventListener('click', (event) => {
      speak(q.speakText, lang, { el: event.currentTarget });
    });
    mount.querySelector('[data-speak-answer]')?.addEventListener('click', (event) => {
      speak(q.speakText, lang, { el: event.currentTarget });
    });
    mount.querySelector('[data-next]').addEventListener('click', next);
    mount.querySelector('[data-quit]').addEventListener('click', () => {
      session = null;
      renderSetup();
    });
  }

  function choose(optionIndex) {
    const q = session.questions[session.cursor];
    if (q.answeredIndex !== null) return;
    answer(session, session.cursor, optionIndex);
    renderQuestion();
  }

  function next() {
    const q = session.questions[session.cursor];
    if (q.answeredIndex === null) return;
    if (session.cursor < session.questions.length - 1) {
      session.cursor += 1;
      renderQuestion();
    } else {
      renderResult();
    }
  }

  /* ── 結果畫面 ─────────────────────────────────────────── */

  function renderResult() {
    const s = summarize(session);

    /* 只有完整跑完的一局才計入統計，而且只寫一次 */
    let saved = true;
    if (!recorded && isComplete(session)) {
      recorded = true;
      const store = storage();
      saved = saveStats(store, applySession(loadStats(store), lang, session.source, s));
    }

    const wrongItems = s.wrongList
      .map(
        (w) => `
        <div class="wrong">
          <div class="q">${esc(w.prompt)}${
            w.optionLang !== 'zh'
              ? `<button class="speak" data-speak="${esc(w.correctText)}" data-speak-lang="${lang}" title="朗讀正解">🔊</button>`
              : ''
          }</div>
          <div class="ans">
            <i class="no">✕ ${w.chosenText === null ? '（未作答）' : esc(w.chosenText)}</i>
            <i class="yes">✓ ${esc(w.correctText)}</i>
          </div>
          ${w.note ? `<div class="why">${esc(w.note)}</div>` : ''}
        </div>`
      )
      .join('');

    mount.innerHTML = `
      <div class="card">
        <div class="score">
          <b>${s.correct} / ${s.total}</b>
          <span>正確率 ${s.accuracy}%　·　${esc(SOURCE_LABEL[session.source])}</span>
        </div>

        ${
          s.wrongList.length === 0
            ? `<div class="feedback good" style="margin-top:18px">全部答對——這一組你已經很熟了，換個題源或加大題數試試。</div>`
            : `<div class="wrong-list">${wrongItems}</div>`
        }

        ${saved ? '' : '<div class="notice"><b>這次的成績無法保存。</b>瀏覽器的儲存空間被停用或已滿，測驗本身不受影響。</div>'}

        <div class="actions">
          <button class="btn" data-again>再玩一局</button>
          <a class="btn ghost" href="./index.html">回首頁</a>
        </div>
      </div>`;

    mount.querySelector('[data-again]').addEventListener('click', () => {
      session = null;
      renderSetup();
    });

    /* 錯題清單的朗讀鍵 */
    mount.querySelectorAll('[data-speak]').forEach((button) => {
      button.addEventListener('click', () => speak(button.dataset.speak, lang, { el: button }));
    });
  }

  /* ── 鍵盤操作 ─────────────────────────────────────────── */

  document.addEventListener('keydown', (event) => {
    if (!session) return;
    const q = session.questions[session.cursor];
    if (!q) return;

    if (event.key >= '1' && event.key <= '4') {
      const index = Number(event.key) - 1;
      if (index < q.options.length) {
        event.preventDefault();
        choose(index);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (q.answeredIndex !== null) {
        event.preventDefault();
        next();
      }
    }
  });

  renderSetup();
  return { noticeHost };
}
