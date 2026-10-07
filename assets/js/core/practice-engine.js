/**
 * 新題型（打字、假名、聽力、聽寫、拼字、排句、語境詞性）的純出題與判題核心。
 * 出題範圍只取同語言、同題型、同級的人工種子資料，不跨級、不拿全題庫補題；
 * 亂數一律由呼叫端注入。題面可直接交給 review-events 的 createReviewEvent，
 * 正解一律收在 answerKey 子物件，UI 不得渲染它，也不得放進 aria／title。
 */
import { LearningError } from './learning-errors.js';
import { normalizeDailyLevel } from './daily-plan.js';
import { shuffle } from './shuffle.js';
import { judgeTyping } from './practice-answers.js';

const invalid = (message) => { throw new LearningError('INVALID_DATA', message); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * 題型 → 能力、方向與 review 事件使用的 questionMode。
 * 方向一律以「提示是哪一種語言」定義：target2zh 表示提示是外文，zh2target 表示提示是中文。
 * kana 在 review 事件裡沒有獨立模式，沿用 typing（同屬 production），以 practiceMode 區分，
 * 並靠 target2zh 方向與「看中文打日文」分開記錄能力。
 */
export const PRACTICE_MODES = Object.freeze({
  typing: Object.freeze({ ability: 'production', direction: 'zh2target', questionMode: 'typing' }),
  kana: Object.freeze({ ability: 'production', direction: 'target2zh', questionMode: 'typing' }),
  listening: Object.freeze({ ability: 'listening-recognition', direction: 'target2zh', questionMode: 'listening' }),
  dictation: Object.freeze({ ability: 'listening-production', direction: 'target2zh', questionMode: 'dictation' }),
  tiles: Object.freeze({ ability: 'assembly', direction: 'zh2target', questionMode: 'tiles' }),
  reorder: Object.freeze({ ability: 'assembly', direction: 'zh2target', questionMode: 'reorder' }),
  pos: Object.freeze({ ability: 'grammar', direction: 'target2zh', questionMode: 'pos' }),
});

const TEXT_MODES = ['typing', 'kana', 'dictation'];
const OPTION_MODES = ['listening', 'pos'];
const PIECE_MODES = ['tiles', 'reorder'];

function checkMode(mode) {
  if (typeof mode !== 'string' || !own(PRACTICE_MODES, mode)) invalid('未知的練習題型。');
  return PRACTICE_MODES[mode];
}

function checkItem(item) {
  if (!isPlainObject(item) || typeof item.id !== 'string' || typeof item.sourceId !== 'string') invalid('練習題缺少 id 或 sourceId。');
  checkMode(item.mode);
  const lang = item.id.split('-')[0];
  if (!['en', 'ja'].includes(lang) || !item.sourceId.startsWith(`${lang}-`)) invalid('練習題的語言前綴不合法。');
  return lang;
}

/**
 * 篩出可出題的練習題。同語言、同題型、同級；指定單字簿時只取 sourceId 在簿內者。
 * 不足 1 題時回 ok:false 與中文原因，呼叫端不應建立空 session。
 */
export function eligiblePractice({ items, lang, mode, level, bookWordIds = null }) {
  if (!Array.isArray(items)) invalid('練習題庫必須是陣列。');
  if (!['en', 'ja'].includes(lang)) invalid('不支援的學習語言。');
  checkMode(mode);
  const wanted = normalizeDailyLevel(lang, level);
  let book = null;
  if (bookWordIds !== null) {
    const list = bookWordIds instanceof Set ? [...bookWordIds] : bookWordIds;
    if (!Array.isArray(list) || list.some((id) => typeof id !== 'string')) invalid('單字簿必須是 sourceId 清單。');
    book = new Set(list);
  }
  const fail = (reason) => ({ ok: false, reason, items: [] });
  if (lang === 'en' && mode === 'kana') return fail('英文沒有假名讀音練習。');
  const seen = new Set();
  const leveled = items.filter((item) => {
    const itemLang = checkItem(item);
    if (seen.has(item.id)) invalid('練習題庫含重複 id。');
    seen.add(item.id);
    return itemLang === lang && item.mode === mode && normalizeDailyLevel(lang, item.level) === wanted;
  });
  if (leveled.length === 0) {
    return fail(lang === 'ja' && wanted !== 'N5'
      ? `日文 ${wanted} 的這種練習尚未補齊，目前只提供 N5。`
      : '此級別尚未提供這種練習的題目。');
  }
  const picked = book === null ? leveled : leveled.filter((item) => book.has(item.sourceId));
  if (picked.length === 0) return fail('單字簿裡沒有這個級別、這種練習的題目；不會改用全題庫補題。');
  return { ok: true, reason: null, items: picked };
}

/**
 * 包裝注入的 rng，每次取值都必須落在 [0,1)，避免壞亂數產生越界索引。
 */
function checkedRng(rng) {
  if (typeof rng !== 'function') invalid('出題必須注入亂數函式。');
  return () => {
    const value = rng();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) invalid('亂數必須落在 [0,1)。');
    return value;
  };
}

const order = (length, draw) => shuffle(Array.from({ length }, (_, index) => index), draw);
const strings = (list, message) => {
  if (!Array.isArray(list) || list.length === 0 || list.some((text) => typeof text !== 'string' || text.length === 0)) invalid(message);
  return [...list];
};
const optionIndex = (item) => {
  const options = strings(item.options, '選項題缺少選項。');
  if (!Number.isInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= options.length) invalid('選項題的正解索引不合法。');
  return options;
};

/**
 * 把一筆練習題轉成可作答、可寫入 review 事件的題面。
 * tiles／reorder 的片段包成 { instanceId, text } 後洗牌；instanceId 依顯示順序編號，
 * 不會洩漏正解順序，相同文字的片段也各有不同 instanceId。listening 的選項同樣洗牌，
 * pos 的詞性標籤維持固定順序，方便學習者對照。
 */
export function buildPracticeQuestion(item, rng) {
  const lang = checkItem(item);
  const draw = checkedRng(rng);
  const spec = PRACTICE_MODES[item.mode];
  const question = { practiceId: item.id, practiceMode: item.mode, sourceId: item.sourceId, lang, level: item.level,
    kind: spec.questionMode, questionMode: spec.questionMode, ability: spec.ability, direction: spec.direction,
    prompt: typeof item.prompt === 'string' ? item.prompt : '' };
  if (['listening', 'dictation'].includes(item.mode) && (typeof item.speakText !== 'string' || item.speakText.length === 0)) invalid('聽力題缺少朗讀文字。');
  if (typeof item.context === 'string') question.context = item.context;
  if (TEXT_MODES.includes(item.mode)) {
    if (item.mode === 'dictation') question.speakText = item.speakText;
    question.answerKey = { accepted: strings(item.accepted, '輸入題缺少可接受答案。'), caseSensitive: item.caseSensitive === true };
  } else if (item.mode === 'listening') {
    const options = optionIndex(item);
    const shuffled = order(options.length, draw);
    question.speakText = item.speakText;
    question.options = shuffled.map((index) => options[index]);
    question.answerKey = { correctIndex: shuffled.indexOf(item.correctIndex) };
  } else if (item.mode === 'pos') {
    if (typeof item.sentence !== 'string' || typeof item.targetWord !== 'string' || !Number.isInteger(item.position)) invalid('詞性題缺少句子或目標字。');
    Object.assign(question, { sentence: item.sentence, targetWord: item.targetWord, position: item.position, options: optionIndex(item) });
    question.answerKey = { correctIndex: item.correctIndex };
  } else if (item.mode === 'tiles') {
    const fragments = strings(item.fragments, '拼字題缺少片段。');
    if (typeof item.answer !== 'string' || item.answer.length === 0) invalid('拼字題缺少正解。');
    question.fragments = order(fragments.length, draw).map((index, at) => ({ instanceId: `t${at}`, text: fragments[index] }));
    question.answerKey = { answer: item.answer };
  } else {
    const chunks = strings(item.chunks, '排句題缺少片段。');
    if (!Array.isArray(item.legalOrders) || item.legalOrders.length === 0
      || item.legalOrders.some((legal) => !Array.isArray(legal) || legal.length !== chunks.length
        || [...legal].sort((a, b) => a - b).some((value, index) => value !== index))) invalid('排句題的合法語序必須是片段索引的排列。');
    const shuffled = order(chunks.length, draw);
    question.chunks = shuffled.map((index, at) => ({ instanceId: `c${at}`, text: chunks[index] }));
    const chunkIndexByInstance = {};
    shuffled.forEach((index, at) => { chunkIndexByInstance[`c${at}`] = index; });
    question.answerKey = { legalOrders: item.legalOrders.map((legal) => [...legal]), chunkIndexByInstance };
  }
  return question;
}

const result = (correct, valid = true, reason = null) => ({ correct, valid, reason });

/**
 * 依 instanceId 序列取出片段；不存在或重複使用同一個 instance 都算無效作答。
 */
function selectPieces(pieces, response) {
  if (!Array.isArray(response.instanceIds) || response.instanceIds.some((id) => typeof id !== 'string')) invalid('作答必須是 instanceId 清單。');
  const ids = response.instanceIds;
  if (ids.length === 0) return { error: result(false, false, '尚未選擇任何片段。') };
  const byInstance = new Map(pieces.map((piece) => [piece.instanceId, piece]));
  if (ids.some((id) => !byInstance.has(id))) return { error: result(false, false, '作答含不存在的片段。') };
  if (new Set(ids).size !== ids.length) return { error: result(false, false, '同一個片段不可使用兩次。') };
  return { picked: ids.map((id) => byInstance.get(id)), complete: ids.length === pieces.length };
}

/**
 * 判題，回傳 { correct, valid, reason }。valid 為 false 表示這次作答不成立（空白、索引越界、
 * 重複使用片段），呼叫端不應據此產生 review 事件；reason 是給使用者看的中文說明。
 */
export function judgePractice(question, response) {
  if (!isPlainObject(question) || !isPlainObject(question.answerKey)) invalid('缺少有效的練習題面。');
  if (!isPlainObject(response)) invalid('缺少作答內容。');
  const mode = question.practiceMode ?? question.kind;
  checkMode(mode);
  const key = question.answerKey;
  if (TEXT_MODES.includes(mode)) {
    if (typeof response.input !== 'string') invalid('輸入題的作答必須是字串。');
    const judged = judgeTyping({ input: response.input, accepted: key.accepted, lang: question.lang, caseSensitive: key.caseSensitive === true });
    return judged.empty ? result(false, false, '尚未輸入答案。') : result(judged.correct);
  }
  if (OPTION_MODES.includes(mode)) {
    const { selectedIndex } = response;
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !Array.isArray(question.options) || selectedIndex >= question.options.length) {
      return result(false, false, '選項索引不合法。');
    }
    return result(selectedIndex === key.correctIndex);
  }
  if (!PIECE_MODES.includes(mode)) invalid('未知的練習題型。');
  const pieces = mode === 'tiles' ? question.fragments : question.chunks;
  if (!Array.isArray(pieces)) invalid('題面缺少片段。');
  const selected = selectPieces(pieces, response);
  if (selected.error) return selected.error;
  if (!selected.complete) return result(false, true, '片段尚未全部用完。');
  if (mode === 'tiles') return result(selected.picked.map((piece) => piece.text).join('') === key.answer);
  const indices = selected.picked.map((piece) => key.chunkIndexByInstance[piece.instanceId]);
  return result(key.legalOrders.some((legal) => legal.every((value, at) => value === indices[at])));
}
