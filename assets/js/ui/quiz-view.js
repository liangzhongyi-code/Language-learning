/**
 * 測驗頁。設定 → 作答 → 結果三個狀態在同一頁切換。
 *
 * 這一層刻意做得很薄：抽題、干擾選項、計分全部在 core/quiz-engine.js，
 * 統計在 core/stats.js。這裡只負責把資料畫出來、把點擊轉成函式呼叫。
 *
 * 一局的狀態只活在記憶體裡，不寫進 localStorage——重新整理就回到設定畫面。
 * 這是刻意的：允許中途離開再回來，正確率就失去意義了。
 */

import {
  buildSession,
  answer,
  poolOf,
  progressPercent,
  isAnswered,
  hasKanaVersion,
  KANJI_MODES,
  MIN_POOL,
} from '../core/quiz-engine.js';
import { summarize, isComplete, applySession, loadStats, saveStats } from '../core/stats.js';
import { loadProgress, saveProgress, recordSession, weakest, dueIds } from '../core/progress.js';
import { sessionCount, countChip, scopeState, strandedReason } from '../core/quiz-setup.js';
import { applySpeechFallback, bindSpeakButtons } from './speech.js';
import { loadPrefs, setPref } from './prefs.js';

const DIRECTION_LABEL = {
  zh2target: { en: '中翻英', ja: '中翻日' },
  target2zh: { en: '英翻中', ja: '日翻中' },
  mixed: { en: '混合', ja: '混合' },
};

const SOURCE_LABEL = { words: '單字', sentences: '句型', mixed: '單字 + 句型', cloze: '填空', scene: '情境', reading: '閱讀' };

/**
 * 會受「出題方向」影響的題型。
 * 其餘題型的題面與選項語言是固定的，選了方向也不會有任何變化。
 */
const DIRECTIONAL_SOURCES = ['words', 'sentences', 'mixed'];

/**
 * 換不成假名的題源，各自的原因。
 * 那排按鈕收起來之後還是要交代一句，否則使用者只會看到「我明明選了卻還是漢字」。
 */
const NO_KANA_REASON = {
  scene: '四個選項是連場合一起寫死的，沒有假名版',
  reading: '整篇短文沒有假名版',
};

/**
 * 出題範圍。
 *
 * 這一排不是新題型，而是套在題型上的篩子——「易錯的填空題」是成立的組合。
 * 做成獨立的一排而不是多兩顆題型膠囊，就是為了讓它跟題型自由組合。
 */
const SCOPE_LABEL = { all: '全部', weak: '只練易錯', due: '今天該複習' };

/* 膠囊上的標籤是動作（「只練易錯」），寫進句子裡要換成名詞 */
const SCOPE_NOUN = { weak: '還沒練熟的題目', due: '今天該複習的題目' };

/**
 * 某個範圍在這個題源湊不滿一局時的說明。
 *
 * 兩種原因要分開講，給的建議完全相反：
 *   題目確實在這個題源裡、只是還不夠多 → 再練幾局，換題型只會更少；
 *   題目在別的題源裡 → 換題型才找得到。
 * 分不清楚的話會叫一個「只錯過 3 個單字」的人去換題型，換過去是 0。
 *
 * 每個範圍各報自己的交集數，不能用一個數字描述兩個——
 * 易錯有 3 題、到期有 0 題時，共用一個數字會把 3 安在到期頭上。
 */
function strandedNote(stranded, idsByScope, scopeSizes, sourceLabel) {
  const lines = stranded.map((s) => {
    const total = idsByScope[s]?.length || 0;
    const here = scopeSizes[s] || 0;
    const noun = esc(SCOPE_NOUN[s]);
    return strandedReason({ here, total }) === 'short'
      ? `你有 ${total} 個${noun}，還不夠出一局（至少要 ${MIN_POOL} 題），再練幾局就會出現。`
      : `你有 ${total} 個${noun}，但只有 ${here} 個在${esc(sourceLabel)}裡，不夠出一局（至少要 ${MIN_POOL} 題）。換個題型看看。`;
  });
  return `<p class="setting-note">${lines.join('<br>')}</p>`;
}

const SCOPE_NOTE = {
  all: '',
  weak: '只出你錯過、而且還沒練熟的題目，錯得最兇的優先。連續答對三次就會離開這份清單，再錯又會回來。干擾選項仍然從完整題庫抽，不會因為範圍變小就變好猜。',
  due: '照間隔重複排程，只出今天（含之前）到期的題目。答對會拉長下次出現的間隔，答錯則打回隔天。',
};

const KANJI_MODE_LABEL = {
  show: '照常顯示',
  ruby: '標在假名上',
  kana: '只顯示假名',
};

const KANJI_MODE_NOTE = {
  show: '日文平常的寫法。漢字看得懂的話，這一局其實是在考漢字而不是日文。',
  ruby: '讀的是下面那行假名，漢字用小字標在上面——想不起來怎麼唸時抬頭就看得到。要真的考自己就用「只顯示假名」。',
  kana: '題目與選項一律用假名，考的是「這個詞怎麼唸」。本來就沒有漢字的詞（コーヒー）維持原樣。',
};

/**
 * 讀出存起來的漢字模式。舊版布林值的轉換在 prefs.js 就做掉了，
 * 這裡只擋「存進去的字串根本不是三種之一」。
 */
function storedKanjiMode() {
  const mode = loadPrefs().kanjiMode;
  return KANJI_MODES.includes(mode) ? mode : 'show';
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 把「讀假名、漢字標在上面」畫出來。
 *
 * pairs 是 core 給的 [{ text, ruby }]，沒有這份資料就退回純文字，
 * 所以三種漢字模式共用同一條繪製路徑，畫面層不必各自判斷模式。
 * ruby 為空的段落一律不套 <ruby>——助詞與片假名沒有漢字可標，
 * 全部包起來只會讓每一段都多撐出一行標註的高度。
 *
 * 整串一定要包在單一元素裡。.opt 與 .prompt 都是帶 gap 的 flex 容器，
 * 直接吐出好幾個 <ruby> 的話，每一塊都會變成獨立的 flex item 被 gap 推開，
 * 一句話會散成「わたし　は　のみます」。
 */
function rubyHtml(pairs, fallback) {
  if (!Array.isArray(pairs) || !pairs.length) return esc(fallback);
  if (!pairs.some((p) => p.ruby)) return esc(pairs.map((p) => p.text).join(''));
  const inner = pairs
    .map((p) => (p.ruby ? `<ruby>${esc(p.text)}<rt>${esc(p.ruby)}</rt></ruby>` : esc(p.text)))
    .join('');
  return `<span class="rb">${inner}</span>`;
}

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

export function initQuizPage({ lang, words, sentences, scenes = [], readings = [], mount, noticeHost }) {
  /**
   * 設定值。題源可由網址參數預選，供單字頁與文法頁的捷徑使用。
   */
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('source');
  const config = {
    /**
     * 先放 words，真正的採用在下面——要等 poolSize 定義好才問得到題庫。
     * 光比對名稱不夠：英文沒有情境題，`?source=scene` 會讓題型那一排
     * 沒有任何一顆膠囊是選取狀態，使用者看不出這局會考什麼，
     * 按了開始才跳出一句帶內部代號的「題源 scene 只有 0 筆」。
     */
    source: 'words',
    direction: 'zh2target',
    count: 10,
    /**
     * 閱讀題的問法與選項語言。
     * 存在偏好設定裡而不是只活在這一局——「我要用哪種方式練」是長期選擇，
     * 每次重開都回到預設會很煩。
     */
    readingAskIn: loadPrefs().readingAskIn === 'target' ? 'target' : 'zh',
    /**
     * 漢字怎麼顯示。只有日文有意義——英文沒有漢字可藏，
     * 所以這排按鈕在英文的測驗頁不出現，值也永遠是 show。
     */
    kanjiMode: lang === 'ja' ? storedKanjiMode() : 'show',
    /**
     * 出題範圍：all / weak / due。
     * 不記進偏好——「今天該複習」是當下的狀態不是長期選擇，
     * 記住它會讓人下次打開時莫名其妙只剩三題可出。
     */
    scope: 'all',
    /**
     * 使用者是不是選了「全部」。
     * 只記數字不行——換題源之後舊的總數會變成一個沒有任何膠囊對應的幽靈值，
     * 畫面上看不出這局到底會出幾題。記住「他要的是全部」才能跟著新題源走。
     */
    useAll: false,
  };

  let session = null;
  /* 統計只在進入結果畫面時寫入一次，避免重複累加 */
  let recorded = false;
  /* 統計寫入失敗要一直提示到離開結果畫面，不能只在第一次渲染時顯示 */
  let saveFailed = false;
  /* 目前所在的畫面，鍵盤快捷鍵只在作答時生效 */
  let phase = 'setup';
  /* 閱讀短文的展開狀態，以 passageId 為鍵。重繪要靠它才不會把使用者的操作蓋掉 */
  let passageOpen = {};

  /**
   * 鍵盤提示與數字徽章的顯示。
   *
   * 觸控裝置預設藏起來——手機沒有鍵盤，「可按鍵盤 1-4」只是雜訊。
   * 但不能只靠 media query 決定：接了藍芽鍵盤的平板在 CSS 眼裡仍然是
   * pointer: coarse，那樣會把提示藏給真正用得到的人看不到。
   *
   * 所以不猜有沒有鍵盤，等它自己出現——按下任何一個鍵就把提示放出來並記住。
   * 這一頁沒有任何文字輸入框，所以觸控裝置上的 keydown 只可能來自實體鍵盤。
   */
  const KEYBOARD_CLASS = 'has-keyboard';
  let keyboardSeen = loadPrefs().keyboardSeen === true;
  if (keyboardSeen) document.documentElement.classList.add(KEYBOARD_CLASS);

  function noticeKeyboard(event) {
    if (keyboardSeen) return;
    /* 單獨的修飾鍵不算——它們可能來自輔具或系統，不代表有一整組鍵盤 */
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
    keyboardSeen = true;
    document.documentElement.classList.add(KEYBOARD_CLASS);
    setPref('keyboardSeen', true);
  }

  /**
   * 題源筆數一律問 core，避免設定畫面顯示的數字與實際出題的池子分家。
   *
   * 題庫在這一頁的生命週期裡不會變，所以只算一次。
   * poolOf 每次呼叫都複製一份陣列（單字 7608 筆、混合 7755 筆），
   * 而設定畫面光是畫題型那一排就要問五次，每點一顆膠囊重畫一次。
   */
  const poolSizeCache = new Map();
  function poolSize(source) {
    if (!poolSizeCache.has(source)) {
      poolSizeCache.set(source, poolOf(source, words, sentences, scenes, readings).length);
    }
    return poolSizeCache.get(source);
  }

  /**
   * 某個範圍涵蓋哪些題目 id，全部則是 null。
   *
   * progress 由呼叫端傳進來，讓一次重畫只讀一次學習紀錄——
   * 那是一個最大近 900KB 的 JSON.parse，同一個 tick 內讀三次沒有意義。
   * 但也不做跨 tick 的快取：上一局剛答完的結果要立刻反映在
   * 「今天該複習（N）」上面，快取住的話使用者會看到一個過期的數字。
   */
  function scopeIdsFrom(progress, scope) {
    if (scope === 'all') return null;
    return scope === 'weak' ? weakest(progress, { lang }) : dueIds(progress, lang, Date.now());
  }

  const scopeIds = (scope) =>
    scope === 'all' ? null : scopeIdsFrom(loadProgress(storage()), scope);

  /* 目前題源 ∩ 某個範圍有幾題 */
  function sizeWithin(source, ids) {
    if (!ids) return poolSize(source);
    const set = new Set(ids);
    return poolOf(source, words, sentences, scenes, readings).filter((item) => set.has(item.id)).length;
  }

  /* 題數與範圍的判斷全部在 core，這裡只是把 config 餵進去 */
  const countWithin = (limit) => sessionCount({ ...config, limit });
  const countChipOf = (limit) => countChip({ ...config, limit });

  /**
   * 網址指定的題源，要這個語言真的出得出題才採用。
   * 問 poolSize 而不是查白名單，同時解決「名稱有沒有效」與
   * 「這個語言有沒有這份題庫」兩件事——後者是白名單永遠答不了的。
   */
  /**
   * 用 Object.hasOwn 而不是 `SOURCE_LABEL[requested]` 的真值判斷。
   *
   * 後者會吃到繼承來的屬性：`?source=toString` 查到 Object.prototype.toString
   * 這個函式，真值成立；接著 poolOf 認不得這個名字、落到預設分支回傳
   * words + sentences（7755 筆，遠超過門檻），於是 config.source 被設成
   * 'toString'——題型那一排沒有任何膠囊選取、實際卻照混合出題，
   * 而畫面上每個 SOURCE_LABEL[config.source] 都會印出一段函式原始碼。
   * 這正是下面那段註解說要擋掉的失敗模式，只是換一個入口進來。
   */
  if (Object.hasOwn(SOURCE_LABEL, requested ?? '') && poolSize(requested) >= MIN_POOL) {
    config.source = requested;
  }

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

    /**
     * 三個範圍各自涵蓋目前這個題源的幾題。
     * 學習紀錄只讀一次、題庫只取一次——兩者都是這一頁最貴的操作。
     */
    const progress = loadProgress(storage());
    const pool = poolOf(config.source, words, sentences, scenes, readings);
    const idsByScope = {
      all: null,
      weak: scopeIdsFrom(progress, 'weak'),
      due: scopeIdsFrom(progress, 'due'),
    };
    const sizeOf = (scope) => {
      const ids = idsByScope[scope];
      if (!ids) return pool.length;
      const set = new Set(ids);
      return pool.filter((item) => set.has(item.id)).length;
    };
    const scopeSizes = { all: pool.length, weak: sizeOf('weak'), due: sizeOf('due') };

    /**
     * 哪幾顆膠囊該出現、選著的那顆還算不算數、哪些範圍被卡住——
     * 判斷全部在 core/quiz-setup.js，這裡只負責把數字餵進去再畫出來。
     */
    const {
      choices: scopeChoices,
      scope,
      stranded,
      limit: total,
    } = scopeState({
      sizes: scopeSizes,
      totals: { weak: idsByScope.weak?.length || 0, due: idsByScope.due?.length || 0 },
      scope: config.scope,
      minPool: MIN_POOL,
    });
    config.scope = scope;

    mount.innerHTML = `
      <div class="card">
        <div class="setting">
          <label>題型</label>
          <div class="chips">${chips('source', [
            ['words', `單字（${poolSize('words')}）`],
            ['sentences', `句型（${poolSize('sentences')}）`],
            ['mixed', `混合（${poolSize('mixed')}）`],
            ['cloze', `填空（${poolSize('cloze')}）`],
            /**
             * 情境題只有日文有資料——自稱與敬語體系是日文特有的，
             * 英文沒有對應的東西可考。沒有資料時整顆膠囊不出現，
             * 而不是出現一顆按了會說「題庫不足」的死按鈕。
             */
            ...(scenes.length ? [['scene', `情境（${scenes.length}）`]] : []),
            /* 閱讀題顯示的是題數不是篇數——使用者選的是這一局要作答幾題 */
            ...(readings.length ? [['reading', `閱讀（${poolSize('reading')}）`]] : []),
          ], config.source)}</div>
        </div>

        ${
          /**
           * 只有單字、句型、混合三種題型吃「出題方向」。
           *
           * 填空題一律看中文填目標語言、情境題一律看中文場合選目標語言說法、
           * 閱讀題的語言由下面那個開關決定——這三種選了方向也不會有任何變化。
           * 留著一組按了沒反應的設定，比直接收起來更容易讓人以為是壞掉了。
           */
          !DIRECTIONAL_SOURCES.includes(config.source)
            ? ''
            : `<div class="setting">
          <label>出題方向</label>
          <div class="chips">${chips(
            'direction',
            [
              ['zh2target', DIRECTION_LABEL.zh2target[lang]],
              ['target2zh', DIRECTION_LABEL.target2zh[lang]],
              ['mixed', '混合'],
            ],
            config.direction
          )}</div>
        </div>`
        }

        ${
          /**
           * 隱藏漢字：日文限定，而且只有換得掉的題源才給開關。
           *
           * 情境題的四個選項與閱讀題的短文都沒有假名版，
           * 開了也不會有任何變化——與其擺一顆按了沒反應的按鈕，
           * 不如收起來，另外用一行字說明為什麼這一局仍然是漢字。
           */
          lang !== 'ja'
            ? ''
            : hasKanaVersion(config.source)
              ? `<div class="setting">
          <label>漢字</label>
          <div class="chips">${chips(
            'kanjiMode',
            KANJI_MODES.map((mode) => [mode, KANJI_MODE_LABEL[mode]]),
            config.kanjiMode
          )}</div>
          <p class="setting-note">${KANJI_MODE_NOTE[config.kanjiMode]}</p>
        </div>`
              : config.kanjiMode !== 'show'
                ? `<p class="setting-note">「${esc(KANJI_MODE_LABEL[config.kanjiMode])}」對${esc(
                    SOURCE_LABEL[config.source]
                  )}題無效——${NO_KANA_REASON[config.source]}，這一局仍然會出現漢字。</p>`
                : ''
        }

        ${
          /**
           * 閱讀題專屬的開關，只在選了閱讀題時出現。
           * 兩種模式差很多：中文版純粹測「讀懂了沒」，
           * 目標語言版連題目都要先讀懂，接近 JLPT 讀解的實戰形式。
           */
          config.source === 'reading'
            ? `<div class="setting">
          <label>問法與選項的語言</label>
          <div class="chips">${chips(
            'readingAskIn',
            [
              ['zh', '中文（測讀懂了沒）'],
              ['target', `${lang === 'ja' ? '日文' : '英文'}（全外語，接近實戰）`],
            ],
            config.readingAskIn
          )}</div>
          <p class="setting-note">${
            config.readingAskIn === 'target'
              ? '題目與選項都是外語，連題目都要先讀懂——答錯時分不出是短文沒讀懂還是題目沒讀懂。'
              : '短文是外語、題目與選項是中文，答錯就是短文沒讀懂，原因很單純。'
          }</p>
        </div>`
            : ''
        }

        ${
          /**
           * 出題範圍。沒有任何範圍出得出題就整排收起來——
           * 第一次來的人還沒有學習紀錄，給他兩顆永遠按不下去的按鈕沒有意義。
           * 練過幾局之後它自己會出現。
           */
          scopeChoices.length
            ? `<div class="setting">
          <label>範圍</label>
          <div class="chips">${chips(
            'scope',
            [['all', `${SCOPE_LABEL.all}（${scopeSizes.all}）`]].concat(
              scopeChoices.map((s) => [s, `${SCOPE_LABEL[s]}（${scopeSizes[s]}）`])
            ),
            config.scope
          )}</div>
          ${SCOPE_NOTE[config.scope] ? `<p class="setting-note">${SCOPE_NOTE[config.scope]}</p>` : ''}
          ${stranded.length ? strandedNote(stranded, idsByScope, scopeSizes, SOURCE_LABEL[config.source]) : ''}
        </div>`
            : stranded.length
              ? strandedNote(stranded, idsByScope, scopeSizes, SOURCE_LABEL[config.source])
              : ''
        }

        <div class="setting">
          <label>題數</label>
          <div class="chips">${chips('count', [
            [10, '10 題'],
            [20, '20 題'],
            ['all', `全部（${total}）`],
          ], countChipOf(total))}</div>
        </div>

        ${errorMessage ? `<div class="notice"><b>無法開始：</b>${esc(errorMessage)}</div>` : ''}

        <div class="actions">
          <button class="btn" type="button" data-start>開始測驗</button>
        </div>
      </div>`;

    mount.querySelectorAll('[data-set]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const { set, value } = chip.dataset;

        if (set === 'count') {
          config.useAll = value === 'all';
          if (!config.useAll) config.count = Number(value);
        } else if (set === 'kanjiMode') {
          config.kanjiMode = value;
          setPref('kanjiMode', value);
        } else {
          config[set] = value;
          /* 這一項是長期偏好，切了就記住 */
          if (set === 'readingAskIn') setPref('readingAskIn', value);
        }

        /**
         * 這裡不再夾限題數。
         * 上限是隨題源與範圍浮動的衍生值，交給 countWithin／countChipOf
         * 在每次重畫時當場算——寫回 config 的話就會黏住，切一次小範圍
         * 再切回來，使用者選的 10 題會變成整個題庫。
         */
        renderSetup();
      });
    });

    mount.querySelector('[data-start]').addEventListener('click', start);
  }

  function start() {
    try {
      resetPlayState();
      /* 範圍與上限一起算，兩者必須來自同一次讀取才不會互相打架 */
      const onlyIds = scopeIds(config.scope);
      const count = countWithin(sizeWithin(config.source, onlyIds));
      session = buildSession({
        lang,
        words,
        sentences,
        scenes,
        readings,
        source: config.source,
        direction: config.direction,
        readingAskIn: config.readingAskIn,
        kanjiMode: config.kanjiMode,
        onlyIds,
        count,
      });
      recorded = false;
      saveFailed = false;
      phase = 'playing';
      renderQuestion();
    } catch (error) {
      phase = 'setup';
      renderSetup(error.message);
    }
  }

  /**
   * 回到設定畫面。session 與填空暫存一律丟掉——半局狀態不保留是刻意的設計。
   */
  function backToSetup() {
    session = null;
    resetPlayState();
    phase = 'setup';
    renderSetup();
  }

  /* ── 作答畫面 ─────────────────────────────────────────── */

  function renderQuestion(errorMessage) {
    const q = session.questions[session.cursor];
    if (q.kind === 'cloze') renderClozeQuestion(errorMessage);
    else renderChoiceQuestion();
  }

  /**
   * 題號與進度條，兩種題型共用
   */
  function quizTop(index, total, label) {
    return `
        <div class="quiz-top">
          <span class="progress-text">第 ${index + 1} / ${total} 題 · ${esc(label)}</span>
          <span class="bar"><i style="width:${progressPercent(session)}%"></i></span>
        </div>`;
  }

  function renderChoiceQuestion() {
    const index = session.cursor;
    const q = session.questions[index];
    const total = session.questions.length;
    const answered = q.answeredIndex !== null;
    const isLast = index === total - 1;

    /**
     * 題面是目標語言時才提供朗讀；中翻外的題面是中文，沒有朗讀的意義。
     * 閱讀題的 speakText 是 null（整篇短文不提供朗讀），也要一起擋掉，
     * 否則會畫出一顆按了唸不出東西的按鈕。
     */
    const promptSpeak =
      q.direction === 'target2zh' && q.speakText
        ? `<button class="speak" type="button" data-speak="${esc(q.speakText)}"
             data-speak-lang="${lang}" title="朗讀題目" aria-label="朗讀題目">🔊</button>`
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
        const button = `<button class="${cls}" type="button" data-opt="${i}" ${answered ? 'disabled' : ''}>
            <span class="key">${i + 1}</span>${rubyHtml(option.ruby, option.text)}${mark}
          </button>`;

        /**
         * 作答後在正解旁邊補一顆朗讀鍵，讓使用者聽正確的說法。
         * speakText 的檢查跟上面題面那顆是同一道守衛，不能只擋一邊——
         * 閱讀題切到全外語模式時 optionLang 不是 zh，漏掉這個條件就會
         * 在正解旁畫出一顆 data-speak 為空、按了完全沒反應的按鈕。
         */
        const needsSpeak = answered && i === q.correctIndex && q.optionLang !== 'zh' && q.speakText;
        return needsSpeak
          ? `<div class="opt-row">${button}<button class="speak tall" type="button"
               data-speak="${esc(q.speakText)}" data-speak-lang="${lang}"
               title="朗讀正解" aria-label="朗讀正解">🔊</button></div>`
          : button;
      })
      .join('');

    const feedback = !answered
      ? ''
      : q.answeredIndex === q.correctIndex
        ? `<div class="feedback good">答對了。${q.note ? esc(q.note) : ''}</div>`
        : `<div class="feedback">正解是 <b>${rubyHtml(
            q.options[q.correctIndex].ruby,
            q.options[q.correctIndex].text
          )}</b>。${
            q.note ? `<br>${esc(q.note)}` : ''
          }</div>`;

    /**
     * 情境題的場合描述與閱讀題的短文都放在題面之上。
     * 不能併進題面：這一題問的是「該怎麼自稱」，而場合是判斷的依據，
     * 兩者混成一段長句之後，使用者會分不清哪一句才是問題。
     *
     * 閱讀題多一個標題與作答後才出現的中文翻譯——
     * 先給翻譯就沒得考了，所以要等他選完才顯示。
     */
    const isReading = Boolean(q.passageId);

    /**
     * 同一篇短文的第二題以後預設收合。
     *
     * 一篇會連出三到四題，每一題都把整篇攤開的話，讀過的人每次都要捲過
     * 三百多個像素才看得到選項。第一題攤開讓他讀，之後收起來但隨時能點開回頭查。
     */
    const previous = index > 0 ? session.questions[index - 1] : null;
    const sameAsPrevious = isReading && previous?.passageId === q.passageId;

    /**
     * 展開狀態要跟著使用者走，不能每次重繪都回到預設。
     *
     * 作答會整塊重建 innerHTML，如果照 sameAsPrevious 重新決定 open，
     * 使用者手動收起來的短文會在選完答案的瞬間又攤開，把剛出現的
     * 「正解／你選的」標記推出視窗；反過來手動展開的也會被收掉，
     * 正好是他要對照原文的那一刻。sameAsPrevious 只當作第一次出現時的初始值。
     */
    if (isReading && !(q.passageId in passageOpen)) {
      passageOpen[q.passageId] = !sameAsPrevious;
    }
    const isOpen = isReading && passageOpen[q.passageId];

    const context = !q.context
      ? ''
      : isReading
        ? `<details class="context passage" lang="${lang}" data-passage="${esc(q.passageId)}" ${isOpen ? 'open' : ''}>
             <summary class="passage-title">${esc(q.title)}</summary>${esc(q.context)}
           </details>`
        : `<div class="context">${esc(q.context)}</div>`;
    const translation =
      isReading && answered
        ? `<details class="translation"><summary>對照中文翻譯</summary><p>${esc(q.translation)}</p></details>`
        : '';

    /* 題型標籤：閱讀與情境有自己的名字，其餘顯示出題方向 */
    const topLabel = isReading
      ? SOURCE_LABEL.reading
      : q.context
        ? SOURCE_LABEL.scene
        : DIRECTION_LABEL[q.direction][lang];

    mount.innerHTML = `
      <div class="card">
        ${quizTop(index, total, topLabel)}

        ${context}
        <div class="prompt">${rubyHtml(q.promptRuby, q.prompt)}${promptSpeak}</div>
        <div class="prompt-sub">${
          isReading ? '依短文內容作答' : `選出正確的${q.optionLang === 'zh' ? '中文意思' : '說法'}`
        }<span class="kbd-hint">　·　可按鍵盤 1-4</span></div>

        <div class="opts${
          /* 有一顆標了漢字，四顆就一起加行距——否則會排成高低不一的階梯 */
          q.options.some((o) => o.ruby?.some((p) => p.ruby)) ? ' has-ruby' : ''
        }">${options}</div>
        ${feedback}
        ${translation}

        <div class="actions">
          <button class="btn" type="button" data-next ${answered ? '' : 'disabled'}>${
            isLast ? '看結果' : '下一題 →'
          }</button>
          <button class="btn ghost" type="button" data-quit>結束這局</button>
        </div>
      </div>`;

    /* 朗讀一律走 bindSpeakButtons 的事件委派，這裡只綁作答與流程控制 */
    mount.querySelectorAll('[data-opt]').forEach((button) => {
      button.addEventListener('click', () => choose(Number(button.dataset.opt)));
    });
    mount.querySelector('[data-passage]')?.addEventListener('toggle', (event) => {
      passageOpen[event.currentTarget.dataset.passage] = event.currentTarget.open;
    });
    mount.querySelector('[data-next]').addEventListener('click', next);
    mount.querySelector('[data-quit]').addEventListener('click', backToSetup);
  }

  /* ── 填空題 ───────────────────────────────────────────── */

  /**
   * 填空題作答中的暫存。
   *
   * assign 記的是「哪一格放了候選區的第幾張」而不是文字：同一句要填兩個「を」時，
   * 只記文字就分不出使用者用掉的是哪一張，候選區會少扣一張。
   * order 記的是放置的先後順序，退格鍵要靠它才知道「最後填的」是哪一格。
   * 換題就整組重來——這一頁本來就不支援回上一題。
   */
  let draft = null;

  /**
   * 快取鍵不能只看題號。
   *
   * 每一局都從第 0 題開始，所以「上一局的第 1 題」與「這一局的第 1 題」題號相同，
   * 只比對題號會讓新題目撿到上一局的暫存：空格一載入就被填好使用者沒放過的詞，
   * 兩局空格數不同時 allFilled 還會拿舊陣列算出 true，提交鍵在畫面還有空格時就變成可按。
   * 一併比對 sourceId 與空格數，任何一項不同就重建。
   */
  function draftFor(q, index) {
    const stale =
      !draft ||
      draft.index !== index ||
      draft.sourceId !== q.sourceId ||
      draft.assign.length !== q.blanks.length;

    if (stale) {
      draft = {
        index,
        sourceId: q.sourceId,
        assign: q.blanks.map(() => null),
        order: [],
        word: null,
        blank: null,
      };
    }
    return draft;
  }

  /* 換局時把畫面暫存丟掉：填空的作答暫存、閱讀短文的展開狀態 */
  function resetPlayState() {
    draft = null;
    passageOpen = {};
  }

  /* 清空一格，同時把它從放置順序裡拿掉 */
  function clearBlank(state, blankIndex) {
    if (state.assign[blankIndex] === null) return;
    state.assign[blankIndex] = null;
    const at = state.order.lastIndexOf(blankIndex);
    if (at !== -1) state.order.splice(at, 1);
  }

  /**
   * 把候選詞放進空格。
   * 那一格原本有東西就先退回候選區，不做交換——
   * 交換在只有兩格時很方便，格數一多就變成猜不到的行為。
   */
  function place(state, blankIndex, wordIndex) {
    const previous = state.assign.indexOf(wordIndex);
    if (previous !== -1) clearBlank(state, previous);
    clearBlank(state, blankIndex);
    state.assign[blankIndex] = wordIndex;
    state.order.push(blankIndex);
    state.word = null;
    state.blank = null;
  }

  function renderClozeQuestion(errorMessage) {
    const index = session.cursor;
    const q = session.questions[index];
    const total = session.questions.length;
    const answered = isAnswered(q);
    const isLast = index === total - 1;
    const state = draftFor(q, index);

    /* 已提交的題目改看 q.filled，逐格標出對錯；未提交則看作答中的暫存 */
    const blankHtml = (blankIndex) => {
      /* 填進去的字要標哪個漢字，看的是「這張候選詞是誰」，不是這一格該填誰 */
      const rubyFor = (text) => {
        const at = q.bank.indexOf(text);
        return at === -1 ? null : q.bankRuby?.[at] || null;
      };
      const withRuby = (text) => {
        const ruby = rubyFor(text);
        return ruby ? rubyHtml([{ text, ruby }], text) : esc(text);
      };

      if (answered) {
        const chosen = q.filled[blankIndex];
        const right = q.blanks[blankIndex].answer;
        const ok = chosen === right;
        return `<span class="cz-blank ${ok ? 'is-correct' : 'is-wrong'}">${withRuby(chosen)}${
          ok ? '' : `<i class="cz-fix">${withRuby(right)}</i>`
        }</span>`;
      }
      const wordIndex = state.assign[blankIndex];
      const filledText = wordIndex === null ? '' : q.bank[wordIndex];
      const active = state.blank === blankIndex ? ' is-active' : '';
      return `<button class="cz-blank is-open${filledText ? ' is-filled' : ''}${active}"
          type="button" data-blank="${blankIndex}"
          aria-label="第 ${blankIndex + 1} 個空格${filledText ? `，目前是 ${esc(filledText)}` : '，尚未填入'}"
        >${withRuby(filledText)}</button>`;
    };

    /**
     * 詞間隔由 core 決定（英文有空白、日文沒有），這裡不再自己判斷語言。
     *
     * 但間隔必須包成實體元素才畫得出來：.cz-line 是 flex 容器，
     * 而 flex 會把「只含空白的文字節點」整個丟棄——
     * 直接 join(' ') 的結果是畫面上出現「study abroadin Japan」，
     * core 特地為英文準備的空白被版面抵銷掉。
     */
    const gapHtml = q.gap ? `<span class="cz-gap">${esc(q.gap)}</span>` : '';
    const line = q.segments
      .map((seg) =>
        seg.type === 'text'
          ? `<span class="cz-text">${rubyHtml(seg.ruby ? [seg] : null, seg.text)}</span>`
          : blankHtml(seg.blankIndex)
      )
      .join(gapHtml);

    const used = new Set(state.assign.filter((v) => v !== null));
    const bank = answered
      ? ''
      : `<div class="cz-bank" aria-label="候選詞">${q.bank
          .map((text, i) => {
            const isUsed = used.has(i);
            const active = state.word === i ? ' is-active' : '';
            const ruby = q.bankRuby?.[i];
            return `<button class="cz-word${isUsed ? ' is-used' : ''}${active}" type="button"
                data-word="${i}" draggable="${!isUsed}"
                aria-pressed="${state.word === i}"
              ><span class="key">${i + 1}</span>${
                ruby ? rubyHtml([{ text, ruby }], text) : esc(text)
              }</button>`;
          })
          .join('')}</div>`;

    const allFilled = state.assign.every((v) => v !== null);
    const rightCount = answered
      ? q.blanks.filter((b, i) => q.filled[i] === b.answer).length
      : 0;

    const feedback = !answered
      ? ''
      : rightCount === q.blanks.length
        ? `<div class="feedback good">全部填對。${q.note ? esc(q.note) : ''}</div>`
        : `<div class="feedback">
             ${q.blanks.length} 格對了 ${rightCount} 格，紅色格子右邊是正解。
             ${q.note ? `<br>${esc(q.note)}` : ''}
           </div>`;

    /* 提交後補一顆朗讀鍵，讓使用者聽完整正確的句子 */
    const answerSpeak = answered
      ? `<button class="speak" type="button" data-speak="${esc(q.speakText)}"
           data-speak-lang="${lang}" title="朗讀整句" aria-label="朗讀整句">🔊</button>`
      : '';

    mount.innerHTML = `
      <div class="card">
        ${quizTop(index, total, '填空')}

        <div class="prompt">${esc(q.prompt)}${answerSpeak}</div>
        <div class="prompt-sub">${
          answered
            ? '對照下方的正解，再看一次語序說明'
            : '點候選詞再點空格' +
              /* 拖放在觸控裝置上根本不會觸發，講了就是假的，所以無條件藏掉 */
              '<span class="drag-hint">，或直接把候選詞拖進空格</span>' +
              '<span class="kbd-hint">　·　可按鍵盤數字選詞、Enter 提交</span>'
        }</div>

        <div class="cz-line" lang="${lang}">${line}</div>
        ${bank}
        ${errorMessage ? `<div class="notice">${esc(errorMessage)}</div>` : ''}
        ${feedback}

        <div class="actions">
          ${
            answered
              ? `<button class="btn" type="button" data-next>${isLast ? '看結果' : '下一題 →'}</button>`
              : `<button class="btn" type="button" data-submit ${allFilled ? '' : 'disabled'}>${
                  allFilled ? '提交' : `還有 ${state.assign.filter((v) => v === null).length} 格沒填`
                }</button>`
          }
          <button class="btn ghost" type="button" data-quit>結束這局</button>
        </div>
      </div>`;

    if (!answered) bindClozeInteractions(q, state);
    mount.querySelector('[data-submit]')?.addEventListener('click', submitCloze);
    mount.querySelector('[data-next]')?.addEventListener('click', next);
    mount.querySelector('[data-quit]').addEventListener('click', backToSetup);

    /**
     * 剛好填滿最後一格時把提交鍵帶進視野。
     *
     * 實測 375×812 的手機：句子加候選詞排完，提交鍵底部落在 818px——
     * 差六個像素，但使用者看到的是「填完了，然後呢」。
     * 只在「這一次填滿」時捲，每填一格都捲會很暈。
     */
    if (!answered && allFilled && !state.scrolled) {
      state.scrolled = true;
      mount.querySelector('[data-submit]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (!allFilled) state.scrolled = false;
  }

  /**
   * 填空題的點擊與拖放。
   *
   * 兩種操作都要能用：桌機習慣拖，手機根本拖不動（HTML5 拖放在觸控裝置上不觸發），
   * 所以點選才是主要路徑，拖放只是加分。
   */
  function bindClozeInteractions(q, state) {
    mount.querySelectorAll('[data-word]').forEach((chip) => {
      const wordIndex = Number(chip.dataset.word);

      chip.addEventListener('click', () => {
        /* 點已經用掉的候選詞＝把它從空格收回來 */
        const at = state.assign.indexOf(wordIndex);
        if (at !== -1) {
          clearBlank(state, at);
          state.word = null;
          state.blank = null;
        } else if (state.blank !== null) {
          place(state, state.blank, wordIndex);
        } else {
          state.word = state.word === wordIndex ? null : wordIndex;
          state.blank = null;
        }
        renderQuestion();
      });

      chip.addEventListener('dragstart', (event) => {
        if (state.assign.includes(wordIndex)) return event.preventDefault();
        event.dataTransfer.setData('text/plain', String(wordIndex));
        event.dataTransfer.effectAllowed = 'move';
      });
    });

    mount.querySelectorAll('[data-blank]').forEach((slot) => {
      const blankIndex = Number(slot.dataset.blank);

      slot.addEventListener('click', () => {
        /**
         * 手上已經選好詞的話，一律照做——就算那一格已經有東西也直接換掉。
         * 反過來（清空並忽略選取）會讓「我選了這個字、點了這一格」變成沒反應，
         * 使用者只會再點一次，結果又把剛換上去的清掉。
         * 被換下來的詞會自動回到候選區，因為 assign 裡不再有它的索引。
         */
        if (state.word !== null) {
          place(state, blankIndex, state.word);
        } else if (state.assign[blankIndex] !== null) {
          clearBlank(state, blankIndex);
          state.blank = null;
        } else {
          state.blank = state.blank === blankIndex ? null : blankIndex;
        }
        renderQuestion();
      });

      /* dragover 一定要擋掉預設行為，否則瀏覽器不會觸發 drop */
      slot.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        slot.classList.add('is-over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('is-over'));
      slot.addEventListener('drop', (event) => {
        event.preventDefault();
        const wordIndex = Number(event.dataTransfer.getData('text/plain'));
        if (!Number.isInteger(wordIndex) || !q.bank[wordIndex]) return;
        place(state, blankIndex, wordIndex);
        renderQuestion();
      });
    });
  }

  function submitCloze() {
    const q = session.questions[session.cursor];
    if (isAnswered(q)) return;
    const state = draftFor(q, session.cursor);
    if (state.assign.some((v) => v === null)) return;

    /**
     * answerCloze 的兩個錯誤訊息是寫給使用者看的（「還有空格沒填」「格式不符」），
     * 不接住的話會變成 console 裡的未捕捉例外，畫面上完全沒有反應——
     * 使用者只會看到按了提交什麼都沒發生。
     */
    try {
      answer(session, session.cursor, state.assign.map((i) => q.bank[i]));
    } catch (error) {
      renderQuestion(error.message);
      return;
    }
    renderQuestion();
    mount.querySelector('[data-next]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function choose(optionIndex) {
    const q = session.questions[session.cursor];
    if (q.answeredIndex !== null) return;
    answer(session, session.cursor, optionIndex);
    renderQuestion();

    /**
     * 作答後把「下一題」帶進視野。
     *
     * 實測 720px 高的筆電視窗：四個選項加上回饋文字之後，
     * 按鈕底部落在 751px——每一題都要手動捲動才能繼續，一局就是十次。
     * 句子題的選項更長，落差更大。
     * block:'nearest' 只在真的看不到時才捲，大螢幕上完全不動。
     */
    mount.querySelector('[data-next]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function next() {
    const q = session.questions[session.cursor];
    if (!isAnswered(q)) return;
    if (session.cursor < session.questions.length - 1) {
      session.cursor += 1;
      renderQuestion();
    } else {
      renderResult();
    }
  }

  /* ── 結果畫面 ─────────────────────────────────────────── */

  function renderResult() {
    phase = 'result';
    const s = summarize(session);

    /**
     * 只有完整跑完的一局才計入，而且只寫一次。
     *
     * 兩份資料一起寫：統計是「我練得怎麼樣」，逐題紀錄是「我該練哪些」。
     * 紀錄的時間戳只取一次並共用，同一局的每一題排程才不會差幾毫秒——
     * 那個差距會讓同一天答完的題目落在不同的「今天」邊界上。
     */
    if (!recorded && isComplete(session)) {
      recorded = true;
      const store = storage();
      const statsOk = saveStats(store, applySession(loadStats(store), lang, session.source, s));
      const progressOk = saveProgress(store, recordSession(loadProgress(store), session, Date.now()));
      saveFailed = !statsOk || !progressOk;
    }

    /**
     * 錯題的朗讀一律用 speakText（目標語言，日文為假名），不分出題方向。
     * 不能拿 correctText 代替：外翻中的正解是中文，日文的正解是漢字，
     * 兩種都送不出正確的發音。
     */
    const wrongItems = s.wrongList
      .map(
        (w) => `
        <div class="wrong">
          ${
            /**
             * 閱讀題帶短文標題、情境題帶場合描述。
             * 少了這一行，「他怎麼從車站到公司？」在檢討畫面上認不出是哪一篇；
             * 情境題更嚴重——場合就是判斷的全部依據。
             */
            w.title
              ? `<div class="wrong-src">${esc(w.title)}</div>`
              : w.context
                ? `<div class="wrong-src">${esc(w.context)}</div>`
                : ''
          }
          <div class="q">${esc(w.prompt)}${
            w.speakText
              ? `<button class="speak" type="button" data-speak="${esc(w.speakText)}"
                   data-speak-lang="${lang}" title="朗讀正確說法" aria-label="朗讀正確說法">🔊</button>`
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

        ${saveFailed ? '<div class="notice"><b>這次的成績無法保存。</b>瀏覽器的儲存空間被停用或已滿，測驗本身不受影響。</div>' : ''}

        <div class="actions">
          <button class="btn" type="button" data-again>再玩一局</button>
          <a class="btn ghost" href="./index.html">回首頁</a>
        </div>
      </div>`;

    mount.querySelector('[data-again]').addEventListener('click', backToSetup);
  }

  /* ── 鍵盤操作 ─────────────────────────────────────────── */

  /**
   * 快捷鍵只在作答畫面生效，而且焦點在按鈕或連結上時一律讓路。
   *
   * 少了這兩道守衛，Enter 會被無條件攔截並 preventDefault，
   * 結果畫面上「再玩一局」「回首頁」按了沒反應——純鍵盤使用者會卡在那一頁出不來。
   */
  const INTERACTIVE = 'button, a[href], input, select, textarea, [contenteditable]';

  document.addEventListener('keydown', (event) => {
    noticeKeyboard(event);
    if (phase !== 'playing' || !session) return;
    if (event.target.closest?.(INTERACTIVE)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const q = session.questions[session.cursor];
    if (!q) return;

    const answered = isAnswered(q);
    const digit = event.key >= '1' && event.key <= '9' ? Number(event.key) - 1 : -1;

    if (q.kind === 'cloze') {
      /**
       * 數字選候選詞，選完自動落進第一個空格——
       * 鍵盤使用者沒有「點空格」這個動作，要求他先選格子等於卡死。
       */
      if (!answered && digit >= 0 && digit < q.bank.length) {
        const state = draftFor(q, session.cursor);
        if (state.assign.includes(digit)) return;
        const target = state.blank !== null ? state.blank : state.assign.indexOf(null);
        if (target === -1) return;
        event.preventDefault();
        place(state, target, digit);
        renderQuestion();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (answered) next();
        else submitCloze();
      } else if (event.key === 'Backspace') {
        /**
         * 退格清掉「最後填的」那一格——照放置順序，不是照位置。
         *
         * 不能用「陣列裡索引最大的非空格」：先填第 3 格再填第 1 格時，
         * 那樣會清掉第 3 格（最早填、而且可能是填對的那格），
         * 使用者剛放好的第 1 格反而動不到。純鍵盤使用者沒有點空格可以繞過。
         */
        const state = draftFor(q, session.cursor);
        const last = state.order.length ? state.order[state.order.length - 1] : -1;
        if (answered || last === -1) return;
        event.preventDefault();
        clearBlank(state, last);
        renderQuestion();
      }
      return;
    }

    if (digit >= 0 && digit < 4 && digit < q.options.length) {
      event.preventDefault();
      choose(digit);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (answered) {
        event.preventDefault();
        next();
      }
    }
  });

  /**
   * 語音降級與朗讀委派由這裡負責，與其他四支 view 一致。
   * 頁面只需要呼叫 renderNav() 與 initQuizPage()，不必自己補呼叫。
   */
  applySpeechFallback(lang, noticeHost);
  bindSpeakButtons(mount, lang);

  renderSetup();
}
