/**
 * 測驗頁。設定 → 作答 → 結果三個狀態在同一頁切換。
 *
 * 這一層刻意做得很薄：抽題、干擾選項、計分全部在 core/quiz-engine.js，
 * 統計在 core/stats.js。這裡只負責把資料畫出來、把點擊轉成函式呼叫。
 *
 * 固定題面與已提交答案保存至交易儲存；重開可續答，未提交的填空草稿不保存。
 * 答題數逐題累計，全部完成才增加一局，結果畫面不再重算。
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
import { summarize } from '../core/stats.js';
import { emptyProgress, weakest, dueIds } from '../core/progress.js';
import { sessionCount, countChip, scopeState, scopeTotals, strandedReason } from '../core/quiz-setup.js';
import { issueReportOf, encodeIssueCode } from '../core/issue-code.js';
import { levelLabel, levelsOf } from '../data/shared/levels.js';
import { applySpeechFallback, bindSpeakButtons } from './speech.js';
import { loadPrefs, setPref } from './prefs.js';
import { awaitLearningStore } from './storage-gate.js';
import { newOperationId, storageMessage } from './platform/learning-store.js';
import { createQuizService } from './platform/quiz-service.js';

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
function strandedNote(stranded, scopeTotals, scopeSizes, sourceLabel) {
  const lines = stranded.map((s) => {
    const total = scopeTotals[s] || 0;
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
  weak: '只出你錯過、而且還沒練熟的題目，錯得最兇的優先。FSRS 依能力是否練熟判斷，不承諾固定答對次數。干擾選項仍然從完整題庫抽。',
  due: '依能力排程，只出今天（含之前）到期的題目。FSRS 依實際作答安排下一次複習，未到期答對不把日期往後推。',
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

export function initQuizPage({ lang, words = [], sentences = [], scenes = [], readings = [], dataProvider, dataMeta = {}, onDataRetry, mount, noticeHost }) {
  const sourceKeys = { words: ['words'], sentences: ['sentences'], mixed: ['words', 'sentences'], cloze: ['sentences'], scene: ['scenes'], reading: ['readings'] };
  const loadedKeys = new Set(typeof dataProvider === 'function' ? [] : ['words', 'sentences', 'scenes', 'readings']);
  let sourceGeneration = 0;
  let sourceLoading = false;
  let sourceError = '';
  const sourceReady = (source) => sourceKeys[source].every((key) => loadedKeys.has(key));
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
     * 日文測驗的 JLPT 難度隔離。all 表示不分級，數字 1–5 對應 N5–N1。
     * 不存成長期偏好：切換題型時某些級別可能根本沒有足夠題目，
     * 記住它會讓下次開頁直接落在一個不能開始的狀態。
     */
    level: 'all',
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
  /**
   * 保存狀態：saving／saved／failed／offline。每题落盤前不能換題，
   * 失敗保留同一個 reviewId 供重試，不重複計數。
   */
  let saveState = null;
  let saveError = '';
  let saveErrorCode = '';
  let quizService = null;
  let savedSessionId = null;
  let pendingReview = null;
  let resumable = [];
  /* 交易式學習儲存；未就緒或使用者選擇不保存時為 null */
  let store = null;
  let offline = false;
  /* 範圍膠囊用的逐題紀錄快照，保存成功或回到設定畫面時重讀 */
  let progressCache = emptyProgress();
  /* 目前所在的畫面，鍵盤快捷鍵只在作答時生效 */
  let phase = 'setup';
  /* 閱讀短文的展開狀態，以 passageId 為鍵。重繪要靠它才不會把使用者的操作蓋掉 */
  let passageOpen = {};
  /* 每題的回報說明與產生過的代碼；作答造成重繪時不能把使用者剛打的字洗掉 */
  const issueStates = new Map();
  /* 設定畫面最後一次算出來的範圍 id 與上限，start() 直接用它，畫面與實際才不會分家 */
  let lastSetup = null;

  /**
   * 鍵盤提示與數字徽章的顯示。
   *
   * 觸控裝置預設藏起來——手機沒有鍵盤，「可按鍵盤 1-4」只是雜訊。
   * 但不能只靠 media query 決定：接了藍芽鍵盤的平板在 CSS 眼裡仍然是
   * pointer: coarse，那樣會把提示藏給真正用得到的人看不到。
   *
   * 所以不猜有沒有鍵盤，等它自己出現——按下任何一個鍵就把提示放出來並記住。
   * 問題回報欄位雖然可以輸入文字，但下方快捷鍵處理會先讓 textarea 通過，
   * 不會把描述裡的數字誤當成答案。
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
   * 未載入的題源使用 metadata，載入後以 core 實際題池為準；每次接收資料清除衍生快取。
   */
  const poolSizeCache = new Map();
  function poolSize(source) {
    if (!poolSizeCache.has(source)) {
      const counts = { words: dataMeta.words, sentences: dataMeta.sentences,
        cloze: dataMeta.cloze ?? dataMeta.sentences, scene: dataMeta.scenes, reading: dataMeta.readingQuestions,
        mixed: source === 'mixed' ? poolSize('words') + poolSize('sentences') : 0 };
      poolSizeCache.set(source, sourceReady(source)
        ? poolOf(source, words, sentences, scenes, readings).length : counts[source] || 0);
    }
    return poolSizeCache.get(source);
  }

  function countsAtLevels(source) {
    if (sourceReady(source)) {
      const pool = poolOf(source, words, sentences, scenes, readings);
      return Object.fromEntries(levelsOf('ja').map(({ level }) => [level, pool.filter((item) => item.level === level).length]));
    }
    const maps = { words: dataMeta.wordsByLevel, sentences: dataMeta.sentencesByLevel,
      cloze: dataMeta.clozeByLevel ?? dataMeta.sentencesByLevel, scene: dataMeta.scenesByLevel,
      reading: dataMeta.readingQuestionsByLevel };
    if (source !== 'mixed') return maps[source] || {};
    const wordCounts = countsAtLevels('words');
    const sentenceCounts = countsAtLevels('sentences');
    return Object.fromEntries(levelsOf('ja').map(({ level }) => [level,
      (wordCounts[level] || 0) + (sentenceCounts[level] || 0)]));
  }

  /**
   * 每次選源或重試增加世代；晚到成功／失敗都不修改題庫、設定或已恢復的題面。
   */
  async function loadSource() {
    const generation = ++sourceGeneration;
    const source = config.source;
    sourceLoading = !sourceReady(source);
    sourceError = '';
    lastSetup = null;
    renderSetup();
    if (!sourceLoading) return;
    try {
      const dataset = await dataProvider(source);
      if (generation !== sourceGeneration || phase !== 'setup' || config.source !== source) return;
      if (!dataset || sourceKeys[source].some((key) => !Array.isArray(dataset[key]))) {
        throw new Error('題庫資料格式不完整');
      }
      if (sourceKeys[source].includes('words')) words = dataset.words;
      if (sourceKeys[source].includes('sentences')) sentences = dataset.sentences;
      if (sourceKeys[source].includes('scenes')) scenes = dataset.scenes;
      if (sourceKeys[source].includes('readings')) readings = dataset.readings;
      sourceKeys[source].forEach((key) => loadedKeys.add(key));
      poolSizeCache.clear();
      levelIdCache.clear();
    } catch {
      if (generation !== sourceGeneration || phase !== 'setup' || config.source !== source) return;
      sourceError = `${SOURCE_LABEL[source]}題庫載入失敗，請重試。${typeof onDataRetry === 'function' ? '重試會重新載入頁面；已存紀錄保留，臨時測驗設定會重設。' : ''}`;
    }
    sourceLoading = false;
    renderSetup();
  }

  /**
   * 依目前選擇的 JLPT 級別切出題庫。
   * 英文頁永遠回完整題庫；日文的 all 也不做任何篩選。
   */
  function poolAtLevel(source, level = config.level) {
    const pool = poolOf(source, words, sentences, scenes, readings);
    if (lang !== 'ja' || level === 'all') return pool;
    return pool.filter((item) => item.level === Number(level));
  }

  /**
   * 某一級在所有題型裡實際存在的題目 id。
   * mixed 與 cloze 都重用單字／句子的 id，Set 會自然去重；閱讀題則要先攤平才拿得到題目 id。
   */
  const levelIdCache = new Map();
  function idsAtLevel(level) {
    if (level === 'all') return null;
    if (!levelIdCache.has(level)) {
      const numeric = Number(level);
      const all = [...words, ...sentences, ...scenes, ...poolOf('reading', words, sentences, scenes, readings)];
      levelIdCache.set(level, new Set(all.filter((item) => item.level === numeric).map((item) => item.id)));
    }
    return levelIdCache.get(level);
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
    scope === 'all' ? null : scopeIdsFrom(progressCache, scope);

  /**
   * 從交易儲存重讀逐題紀錄；讀不到時保留上一份快照，不拿空資料畫出「沒有到期」。
   */
  async function refreshProgress() {
    if (!store) return;
    try {
      progressCache = (await store.legacyView(lang)).progress;
      if (quizService) resumable = await quizService.listActive();
    } catch {
      /* 保留舊快照，保存訊息另由結果畫面顯示 */
    }
  }

  /* 目前題源 ∩ 某個範圍有幾題 */
  function sizeWithin(source, ids, level = config.level) {
    const pool = poolAtLevel(source, level);
    if (!ids) return pool.length;
    const set = new Set(ids);
    return pool.filter((item) => set.has(item.id)).length;
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
   * 用自有屬性檢查，而不是 `SOURCE_LABEL[requested]` 的真值判斷。
   *
   * 後者會吃到繼承來的屬性：`?source=toString` 查到 Object.prototype.toString
   * 這個函式，真值成立；接著 poolOf 認不得這個名字、落到預設分支回傳
   * words + sentences（7755 筆，遠超過門檻），於是 config.source 被設成
   * 'toString'——題型那一排沒有任何膠囊選取、實際卻照混合出題，
   * 而畫面上每個 SOURCE_LABEL[config.source] 都會印出一段函式原始碼。
   * 這正是下面那段註解說要擋掉的失敗模式，只是換一個入口進來。
   *
   * 不用 Object.hasOwn：它是 ES2022，Safari 15.4 以下沒有，而這一行在
   * initQuizPage 裡無條件執行、沒有 try/catch——舊 iPhone 開測驗頁會拿到一片
   * 空白連錯誤訊息都沒有。全站其餘語法最新只到 ES2020，沒有理由在這裡拉高底線。
   */
  const isSource = Object.prototype.hasOwnProperty.call(SOURCE_LABEL, requested ?? '');
  if (isSource && poolSize(requested) >= MIN_POOL) {
    config.source = requested;
  }

  /* ── 設定畫面 ─────────────────────────────────────────── */

  function renderSetup(errorMessage) {
    const chips = (name, options, current) =>
      options
        .map(
          ([value, label, disabled = false]) =>
            `<button class="chip" data-set="${name}" data-value="${value}" aria-pressed="${
              String(value) === String(current)
            }" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`
        )
        .join('');

    /**
     * 三個範圍各自涵蓋目前這個題源的幾題。
     * 學習紀錄只讀一次、題庫只取一次——兩者都是這一頁最貴的操作。
     */
    const progress = progressCache;
    const fullPool = poolOf(config.source, words, sentences, scenes, readings);
    const levelCounts = countsAtLevels(config.source);

    /**
     * 切換題型後，原本的級別可能不足四題。
     * 例如句型沒有 N2/N1、情境的 N4 目前只有三題；這時退回「全部」，
     * 不留下沒有任何膠囊選中、按開始才爆錯的幽靈狀態。
     */
    if (lang === 'ja' && config.level !== 'all' && (levelCounts[config.level] || 0) < MIN_POOL) {
      config.level = 'all';
    }
    const pool = config.level === 'all'
      ? fullPool
      : fullPool.filter((item) => item.level === Number(config.level));
    const idsByScope = {
      all: null,
      weak: scopeIdsFrom(progress, 'weak'),
      due: scopeIdsFrom(progress, 'due'),
    };
    const levelIds = idsAtLevel(config.level);
    const totals = scopeTotals(idsByScope, levelIds);
    const sizeOf = (scope) => {
      const ids = idsByScope[scope];
      if (!ids) return pool.length;
      const set = new Set(ids);
      return pool.filter((item) => set.has(item.id)).length;
    };
    const scopeSizes = { all: sourceReady(config.source) ? pool.length
      : config.level === 'all' ? poolSize(config.source) : levelCounts[config.level] || 0,
      weak: sizeOf('weak'), due: sizeOf('due') };

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
      totals,
      scope: config.scope,
      minPool: MIN_POOL,
    });
    // 冷載入的空池不代表範圍不足；等題源就緒後才套用 fallback，避免吃掉使用者的選擇。
    if (sourceReady(config.source)) {
      config.scope = scope;
      lastSetup = { idsByScope, limit: total, level: config.level };
    }

    mount.innerHTML = `
      <div class="card">
        ${resumable.length ? `<div class="notice"><b>有尚未完成的測驗</b><p>已提交答案可接續，未提交輸入不保留。</p><div class="actions">${resumable.slice(0, 5).map((round) => `<button type="button" class="btn ghost" data-resume-quiz="${esc(round.sessionId)}">繼續${esc(SOURCE_LABEL[round.source])}（${round.answered}/${round.total}）</button>`).join('')}</div></div>` : ''}
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
            ...(poolSize('scene') ? [['scene', `情境（${poolSize('scene')}）`]] : []),
            /* 閱讀題顯示的是題數不是篇數——使用者選的是這一局要作答幾題 */
            ...(poolSize('reading') ? [['reading', `閱讀（${poolSize('reading')}）`]] : []),
          ], config.source)}</div>
        </div>

        ${
          lang === 'ja'
            ? `<div class="setting">
          <label>JLPT 難度</label>
          <div class="chips">${chips(
            'level',
            [['all', `全部（${poolSize(config.source)}）`]].concat(
              levelsOf('ja').map(({ level, label }) => [
                level,
                `${label}（${levelCounts[level] || 0}）`,
                (levelCounts[level] || 0) < MIN_POOL,
              ])
            ),
            config.level
          )}</div>
          <p class="setting-note">${
            config.level === 'all'
              ? '不分級，題目與自動抽出的干擾選項可能來自 N5 到 N1。'
              : `只出 ${levelsOf('ja').find((item) => item.level === Number(config.level))?.label} 題目；干擾選項與填空候選詞仍取自完整題源，可能跨級。`
          }　灰色級別表示目前題型不足 ${MIN_POOL} 題。</p>
        </div>`
            : ''
        }

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
          ${stranded.length ? strandedNote(stranded, totals, scopeSizes, SOURCE_LABEL[config.source]) : ''}
        </div>`
            : stranded.length
              ? strandedNote(stranded, totals, scopeSizes, SOURCE_LABEL[config.source])
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
        ${sourceLoading || sourceError ? `<div class="notice" role="status" aria-live="polite">${sourceLoading ? '正在載入題庫…' : esc(sourceError)}${sourceError ? '<button class="btn ghost" type="button" data-source-retry>重試載入</button>' : ''}</div>` : ''}

        <div class="actions">
          <button class="btn" type="button" data-start ${sourceLoading || sourceError || !sourceReady(config.source) ? 'disabled' : ''}>開始測驗</button>
        </div>
        <p class="setting-note quiz-backup-link">測驗紀錄會自動保存在這個瀏覽器；要匯出請到<a href="../index.html#backup">全站首頁的「備份與還原」</a>。</p>
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
        if (set === 'source') loadSource();
        else renderSetup();
      });
    });

    mount.querySelector('[data-start]').addEventListener('click', start);
    mount.querySelector('[data-source-retry]')?.addEventListener('click', () => {
      if (typeof onDataRetry === 'function') onDataRetry(config.source);
      else loadSource();
    });
    mount.querySelectorAll('[data-resume-quiz]').forEach((button) => button.addEventListener('click', () => resumeQuiz(button.dataset.resumeQuiz)));
  }

  async function start() {
    if (phase !== 'setup' || sourceLoading || sourceError || !sourceReady(config.source)) return;
    phase = 'starting';
    mount.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      resetPlayState();
      /**
       * 直接用設定畫面最後一次畫出來的那份範圍與上限，不重新讀。
       *
       * 重讀會讓畫面與實際分家：「今天該複習」是時間相依的，畫完設定畫面到
       * 按下開始之間若剛好跨過一個到期時點，膠囊寫「全部（5）」卻出 6 題。
       * 使用者按下去的就是他看到的那個數字——所見即所得比「最新」重要。
       * 上一局的結果仍會反映：backToSetup 一定會重畫，重畫就會重讀。
       */
      let onlyIds = lastSetup?.idsByScope[config.scope] ?? scopeIds(config.scope);
      const limit = lastSetup?.limit ?? sizeWithin(config.source, onlyIds);
      const selectedLevel = lastSetup?.level ?? config.level;
      if (lang === 'ja' && selectedLevel !== 'all') {
        const scopeSet = onlyIds ? new Set(onlyIds) : null;
        onlyIds = poolAtLevel(config.source, selectedLevel)
          .filter((item) => !scopeSet || scopeSet.has(item.id)).map((item) => item.id);
      }
      const count = countWithin(limit);
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
        level: null,
        onlyIds,
        count,
      });
      session.level = selectedLevel === 'all' ? null : Number(selectedLevel);
      saveState = null;
      saveError = '';
      pendingReview = null;
      savedSessionId = null;
      if (quizService && !offline) {
        const created = await quizService.start(session, { kanjiMode: hasKanaVersion(session.source) ? config.kanjiMode : 'show' });
        savedSessionId = created.sessionId;
      }
      phase = 'playing';
      renderQuestion();
    } catch (error) {
      phase = 'setup';
      renderSetup(error.message);
    }
  }

  /**
   * 從儲存題面接續，不重抽題、不重算已提交答案；所有設定以保存的那局為準。
   */
  async function resumeQuiz(id) {
    if (phase !== 'setup' || !quizService) return;
    ++sourceGeneration;
    sourceLoading = false;
    sourceError = '';
    lastSetup = null;
    phase = 'starting';
    mount.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const saved = await quizService.resume(id);
      session = saved.quiz;
      savedSessionId = saved.sessionId;
      config.source = session.source;
      config.direction = session.direction;
      config.level = session.level ?? 'all';
      config.kanjiMode = saved.kanjiMode;
      config.count = session.questions.length;
      config.useAll = false;
      if (session.source === 'reading') config.readingAskIn = session.questions[0]?.promptLang === lang ? 'target' : 'zh';
      pendingReview = null;
      saveState = saved.done ? 'saved' : null;
      saveError = '';
      resetPlayState();
      phase = 'playing';
      if (saved.done) renderResult();
      else renderQuestion();
    } catch (error) {
      phase = 'setup';
      loadSource();
    }
  }

  /**
   * 暫停這局：丟掉未提交輸入，已保存題面與答案仍可從設定畫面續答。
   */
  function backToSetup() {
    if (phase === 'playing' && ['saving', 'failed'].includes(saveState)) return;
    session = null;
    pendingReview = null;
    saveState = null;
    resetPlayState();
    phase = 'setup';
    refreshProgress().then(() => { if (phase === 'setup') loadSource(); });
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
    const difficulty = lang === 'ja' && session.level ? `${levelLabel('ja', session.level)} · ` : '';
    return `
        <div class="quiz-top">
          <span class="progress-text">第 ${index + 1} / ${total} 題 · ${difficulty}${esc(label)}</span>
          <span class="bar"><i style="width:${progressPercent(session)}%"></i></span>
        </div>`;
  }

  const issueKeyOf = (question, index) => `${index}:${question.sourceId}`;
  const answerStampOf = (question) => JSON.stringify({
    answeredIndex: question.answeredIndex ?? null,
    submitted: question.submitted ?? false,
    filled: question.filled ?? null,
  });

  function issueStateFor(question, index) {
    const key = issueKeyOf(question, index);
    const answerStamp = answerStampOf(question);
    if (!issueStates.has(key)) {
      issueStates.set(key, { open: false, description: '', code: '', message: '', answerStamp });
    }
    const state = issueStates.get(key);
    if (state.answerStamp !== answerStamp) {
      state.answerStamp = answerStamp;
      state.code = '';
      state.message = '';
    }
    return state;
  }

  /**
   * 每題共用的問題回報欄位。
   * 代碼會帶題目 id、畫面快照與當局設定，但不會帶整份學習紀錄。
   */
  function issueReportHtml(question, index) {
    const state = issueStateFor(question, index);
    return `
      <details class="issue-report" data-issue data-issue-key="${esc(issueKeyOf(question, index))}" ${state.open ? 'open' : ''}>
        <summary>這題有問題？產生回報代碼</summary>
        <div class="issue-body">
          <p class="setting-note">題目 ID：<code>${esc(question.sourceId)}</code>。請簡單寫下哪裡不對，再把代碼傳給我；代碼不包含其他題目的學習紀錄。</p>
          <label class="issue-label">問題描述（選填，最多 300 字）
            <textarea class="field issue-description" data-issue-description rows="3" maxlength="300"
              placeholder="例如：中文翻譯不自然、正解可能有兩個、假名有誤……">${esc(state.description)}</textarea>
          </label>
          <div class="actions">
            <button class="btn ghost sm" type="button" data-issue-copy>複製回報代碼</button>
          </div>
          <div class="issue-output" data-issue-output ${state.code ? '' : 'hidden'}>
            <label class="issue-label">回報代碼
              <textarea class="backup-code issue-code" data-issue-code rows="3" readonly>${esc(state.code)}</textarea>
            </label>
          </div>
          <p class="issue-message" data-issue-message role="status" aria-live="polite">${esc(state.message)}</p>
        </div>
      </details>`;
  }

  function bindIssueReport(question, index) {
    const panel = mount.querySelector('[data-issue]');
    if (!panel) return;
    const state = issueStateFor(question, index);
    const description = panel.querySelector('[data-issue-description]');
    const codeBox = panel.querySelector('[data-issue-code]');
    const output = panel.querySelector('[data-issue-output]');
    const status = panel.querySelector('[data-issue-message]');
    const key = issueKeyOf(question, index);

    panel.addEventListener('toggle', () => {
      state.open = panel.open;
    });
    description.addEventListener('input', () => {
      if (state.description === description.value) return;
      state.description = description.value;
      state.code = '';
      state.message = '';
      codeBox.value = '';
      output.hidden = true;
      status.textContent = '';
    });
    panel.querySelector('[data-issue-copy]').addEventListener('click', async () => {
      state.description = description.value;
      const report = issueReportOf({
        session,
        question,
        index,
        settings: {
          direction: question.direction,
          kanjiMode: hasKanaVersion(session.source) ? config.kanjiMode : 'show',
          readingAskIn: session.source === 'reading' ? config.readingAskIn : null,
          scope: config.scope,
        },
        description: state.description,
      });
      state.code = encodeIssueCode(report);
      const generatedCode = state.code;
      codeBox.value = generatedCode;
      output.hidden = false;

      let copied = false;
      try {
        await navigator.clipboard.writeText(generatedCode);
        copied = true;
      } catch {
        /* 剪貼簿被擋時保留畫面上的代碼，讓使用者手動複製 */
      }
      /* 等待權限期間若使用者已作答或換題，舊結果不能覆蓋新畫面的狀態 */
      if (state.code !== generatedCode) return;
      state.message = copied
        ? '已複製。把這串回報代碼貼給我即可定位題目。'
        : '剪貼簿不給用，已在下方顯示代碼；請全選後複製。';
      const livePanel = mount.querySelector('[data-issue]');
      if (livePanel?.dataset.issueKey === key) {
        const liveStatus = livePanel.querySelector('[data-issue-message]');
        const liveCode = livePanel.querySelector('[data-issue-code]');
        const liveOutput = livePanel.querySelector('[data-issue-output]');
        liveStatus.textContent = state.message;
        liveCode.value = generatedCode;
        liveOutput.hidden = false;
        if (!copied) {
          liveCode.focus();
          liveCode.select();
        }
      }
    });
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
        <div data-question-save role="status" aria-live="polite">${questionSaveHtml()}</div>
        ${translation}
        ${issueReportHtml(q, index)}

        <div class="actions">
          <button class="btn" type="button" data-next ${answered && canAdvance() ? '' : 'disabled'}>${
            isLast ? '看結果' : '下一題 →'
          }</button>
          <button class="btn ghost" type="button" data-quit ${['saving', 'failed'].includes(saveState) ? 'disabled' : ''}>暫停這局</button>
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
    bindIssueReport(q, index);
    bindQuestionRetry();
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

  /* 換局時把畫面暫存丟掉：填空作答、閱讀展開狀態與題目回報草稿 */
  function resetPlayState() {
    draft = null;
    passageOpen = {};
    issueStates.clear();
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
        <div data-question-save role="status" aria-live="polite">${questionSaveHtml()}</div>
        ${issueReportHtml(q, index)}

        <div class="actions">
          ${
            answered
              ? `<button class="btn" type="button" data-next ${canAdvance() ? '' : 'disabled'}>${isLast ? '看結果' : '下一題 →'}</button>`
              : `<button class="btn" type="button" data-submit ${allFilled ? '' : 'disabled'}>${
                  allFilled ? '提交' : `還有 ${state.assign.filter((v) => v === null).length} 格沒填`
                }</button>`
          }
          <button class="btn ghost" type="button" data-quit ${['saving', 'failed'].includes(saveState) ? 'disabled' : ''}>暫停這局</button>
        </div>
      </div>`;

    if (!answered) bindClozeInteractions(q, state);
    mount.querySelector('[data-submit]')?.addEventListener('click', submitCloze);
    mount.querySelector('[data-next]')?.addEventListener('click', next);
    mount.querySelector('[data-quit]').addEventListener('click', backToSetup);
    bindIssueReport(q, index);
    bindQuestionRetry();

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
    persistAnswer(state.assign.map((i) => q.bank[i]));
    mount.querySelector('[data-next]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function choose(optionIndex) {
    const q = session.questions[session.cursor];
    if (q.answeredIndex !== null) return;
    answer(session, session.cursor, optionIndex);
    renderQuestion();
    persistAnswer(optionIndex);

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
    if (!isAnswered(q) || !canAdvance()) return;
    if (session.cursor < session.questions.length - 1) {
      session.cursor += 1;
      saveState = null;
      pendingReview = null;
      renderQuestion();
    } else {
      renderResult();
    }
  }

  /* ── 結果畫面 ─────────────────────────────────────────── */

  function renderResult() {
    phase = 'result';
    const s = summarize(session);

    /* 最後一題交易已完成局數；結果畫面只畫檢討，不再重算。 */

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

        <div data-save-status role="status" aria-live="polite">${saveStatusHtml()}</div>

        <div class="actions">
          <button class="btn" type="button" data-again>再玩一局</button>
          <a class="btn ghost" href="./index.html">回首頁</a>
        </div>
      </div>`;

    mount.querySelector('[data-again]').addEventListener('click', backToSetup);
  }

  /**
   * 保存狀態的文字。只有交易真的完成才說「已保存」，保存中不先報成功。
   */
  function saveStatusHtml() {
    if (saveState === 'saving') return '<p class="hint">正在保存這一局…</p>';
    if (saveState === 'saved') return '<p class="hint">這一局已保存。</p>';
    if (saveState === 'offline') return '<div class="notice"><b>這一局沒有保存。</b>學習紀錄目前無法使用，測驗本身不受影響。</div>';
    if (saveState === 'failed') return `<div class="notice">尚未保存：${esc(saveError)}</div>`;
    return '';
  }

  function canAdvance() {
    return offline || saveState === 'saved';
  }

  function questionSaveHtml() {
    if (saveState === 'saving') return '<p class="hint">正在保存這一題…</p>';
    if (saveState === 'saved') return '<p class="hint">已保存。</p>';
    if (saveState === 'offline') return '<p class="hint">這次練習不保存，關頁後無法續答。</p>';
    if (saveState === 'failed') {
      const needsReload = ['ENTRY_CONFLICT', 'STALE_EPOCH', 'STALE_PLAN', 'OPERATION_MISMATCH', 'INVALID_DATA', 'UNSUPPORTED', 'UNSUPPORTED_VERSION'].includes(saveErrorCode);
      return `<div class="notice">這題尚未保存：${esc(saveError)}<div class="actions">${needsReload
        ? '<button class="btn" type="button" data-question-reload>重新載入並同步紀錄</button>'
        : '<button class="btn" type="button" data-question-retry>重試保存</button>'}</div></div>`;
    }
    return '';
  }

  function bindQuestionRetry() {
    mount.querySelector('[data-question-retry]')?.addEventListener('click', () => persistAnswer());
    mount.querySelector('[data-question-reload]')?.addEventListener('click', () => window.location.reload());
  }

  function updateQuestionSave() {
    const host = mount.querySelector('[data-question-save]');
    if (host) { host.innerHTML = questionSaveHtml(); bindQuestionRetry(); }
    const nextButton = mount.querySelector('[data-next]');
    if (nextButton) nextButton.disabled = !canAdvance();
    const quitButton = mount.querySelector('[data-quit]');
    if (quitButton) quitButton.disabled = ['saving', 'failed'].includes(saveState);
  }

  /**
   * 每題保存，重試保留答案、reviewId 與時間，不再重判或整局重算。
   */
  async function persistAnswer(response) {
    if (saveState === 'saving') return;
    const target = session;
    if (!quizService || offline) {
      saveState = 'offline';
      updateQuestionSave();
      return;
    }
    if (!pendingReview) pendingReview = { sessionId: savedSessionId, index: target.cursor, response,
      reviewId: newOperationId('quiz-rv'), answeredAt: Date.now() };
    saveState = 'saving';
    updateQuestionSave();
    try {
      await quizService.submit(pendingReview);
      saveState = 'saved';
    } catch (error) {
      saveState = 'failed';
      saveErrorCode = error?.code ?? '';
      saveError = storageMessage(error);
    }
    if (session === target) updateQuestionSave();
  }

  /* ── 鍵盤操作 ─────────────────────────────────────────── */

  /**
   * 快捷鍵只在作答畫面生效，而且焦點在按鈕或連結上時一律讓路。
   *
   * 少了這兩道守衛，Enter 會被無條件攔截並 preventDefault，
   * 結果畫面上「再玩一局」「回首頁」按了沒反應——純鍵盤使用者會卡在那一頁出不來。
   */
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [contenteditable]';
  const TEXT_ENTRY = 'input, select, textarea, [contenteditable]';

  document.addEventListener('keydown', (event) => {
    /* 手機在回報欄位叫出的虛擬鍵盤不算實體鍵盤，不能因此放出數字快捷鍵提示 */
    if (!event.target.closest?.(TEXT_ENTRY)) noticeKeyboard(event);
    if (phase !== 'playing' || !session) return;
    if (['saving', 'failed'].includes(saveState)) return;
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

  /**
   * 學習紀錄就緒後才畫設定畫面：範圍膠囊要用到逐題紀錄，未就緒時不能畫出假的 0。
   * 儲存無法使用時可選擇先練習，但結果頁會明說這次不保存。
   */
  awaitLearningStore(mount, async (ready) => {
    store = ready;
    quizService = createQuizService({ store, lang });
    await refreshProgress();
    await loadSource();
  }, { onSkip: () => { offline = true; loadSource(); } });
}
