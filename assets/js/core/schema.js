/**
 * 題庫資料驗證。
 * 題庫是長期手動增補的靜態資料，寫錯一個欄位不會在瀏覽器上立刻爆炸，
 * 而是變成一題怪題目或一個唸錯的字，所以驗證一律在測試階段跑完。
 *
 * 所有 validate* 都回傳 { ok, errors }，errors 每筆為 { id, field, message }，
 * 且一律把該筆的所有錯誤蒐集完才回傳，不會遇到第一個錯誤就中止。
 */

import { CATEGORY_KEYS } from '../data/shared/categories.js';
import { ROLE_KEYS } from '../data/shared/roles.js';
import { patternById } from '../data/shared/patterns.js';
import { LEVELS } from '../data/shared/levels.js';
import { SCENE_AXIS_KEYS } from '../data/shared/scene-axes.js';

/**
 * 允許的詞性
 */
export const POS_KEYS = ['noun', 'verb', 'adjective', 'adverb', 'other'];

/**
 * 允許的難度。定義在 data/shared/levels.js，
 * 那裡同時放各語言的顯示標籤，改分級時只要動一個檔案。
 */
export { LEVELS };

/**
 * id 的流水號位數。
 * 原本寫死三位，題庫一過 999 筆就全部驗不過；
 * 匯入多益與日檢題庫後單筆語言會到四位數，所以放寬成 3–5 位。
 */
const SERIAL = '\\d{3,5}';

/**
 * 允許的假名類型
 */
export const KANA_TYPES = ['seion', 'dakuon', 'handakuon', 'youon'];

/**
 * 需要讀音欄位的語言。英文的 reading / romaji 必須是 null
 */
const READING_REQUIRED = ['ja'];

const isFilledString = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * 錯誤蒐集器，把重複的 push 樣板收斂成一個小物件
 */
function collector(id) {
  const errors = [];
  return {
    errors,
    add(field, message) {
      errors.push({ id, field, message });
    },
    result() {
      return { ok: errors.length === 0, errors };
    },
  };
}

/**
 * 共用的讀音欄位檢查。
 * 日文必須有讀音、英文必須是 null。
 * 單字有 reading 與 romaji 兩個欄位，句子只有整句 reading，
 * 所以要檢查哪些欄位由呼叫端指定。
 */
function checkReading(c, entry, lang, fields = ['reading', 'romaji']) {
  const required = READING_REQUIRED.includes(lang);
  for (const field of fields) {
    if (required) {
      if (!isFilledString(entry[field])) c.add(field, `${lang} 的 ${field} 不可為空`);
    } else if (entry[field] !== null) {
      c.add(field, `${lang} 的 ${field} 必須是 null，實際為 ${JSON.stringify(entry[field])}`);
    }
  }
}

/**
 * 驗證一筆單字
 */
export function validateWord(entry, lang) {
  const c = collector(entry?.id);
  if (!entry || typeof entry !== 'object') {
    c.add('(entry)', '不是物件');
    return c.result();
  }

  if (!new RegExp(`^${lang}-w-${SERIAL}$`).test(entry.id || '')) {
    c.add('id', `id 必須符合 ${lang}-w-NNN（3–5 位流水號），實際為 ${JSON.stringify(entry.id)}`);
  }
  if (!isFilledString(entry.zh)) c.add('zh', 'zh 不可為空');
  if (!isFilledString(entry.target)) c.add('target', 'target 不可為空');
  checkReading(c, entry, lang);
  if (!POS_KEYS.includes(entry.pos)) c.add('pos', `pos 不在允許值內：${JSON.stringify(entry.pos)}`);
  if (!CATEGORY_KEYS.includes(entry.category)) {
    c.add('category', `category 不在允許值內：${JSON.stringify(entry.category)}`);
  }
  if (!LEVELS.includes(entry.level)) {
    c.add('level', `level 必須是 ${LEVELS.join('/')}，實際為 ${JSON.stringify(entry.level)}`);
  }

  return c.result();
}

/**
 * 去掉全部空白後比對，用於目標語言整句的串接檢查。
 * 英文的 chunk 之間有空白、日文沒有，統一忽略空白就不必分語言處理。
 */
const stripSpaces = (s) => String(s).replace(/\s+/g, '');

/**
 * 驗證一筆句子。
 * 最關鍵的是三條一致性規則：
 *   1. 依陣列順序串接 target，忽略空白後等於整句 target
 *   2. 依 zhIndex 排序串接 zh，等於整句 zh
 *   3. zhIndex 為 0 起算、不跳號、不重複的連續整數
 * 這三條讓手寫題庫幾乎不可能默默寫錯，是這個資料結構最大的價值。
 */
export function validateSentence(entry, lang) {
  const c = collector(entry?.id);
  if (!entry || typeof entry !== 'object') {
    c.add('(entry)', '不是物件');
    return c.result();
  }

  if (!new RegExp(`^${lang}-s-${SERIAL}$`).test(entry.id || '')) {
    c.add('id', `id 必須符合 ${lang}-s-NNN（3–5 位流水號），實際為 ${JSON.stringify(entry.id)}`);
  }
  if (!isFilledString(entry.zh)) c.add('zh', 'zh 不可為空');
  if (!isFilledString(entry.target)) c.add('target', 'target 不可為空');
  if (!isFilledString(entry.note)) c.add('note', 'note 不可為空，要說明語序差異或文法重點');
  checkReading(c, entry, lang, ['reading']);
  if (!CATEGORY_KEYS.includes(entry.category)) {
    c.add('category', `category 不在允許值內：${JSON.stringify(entry.category)}`);
  }
  if (!LEVELS.includes(entry.level)) {
    c.add('level', `level 必須是 ${LEVELS.join('/')}，實際為 ${JSON.stringify(entry.level)}`);
  }

  const chunks = entry.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    c.add('chunks', 'chunks 必須是非空陣列');
    return c.result();
  }

  /* 逐塊的欄位檢查 */
  for (const [i, ch] of chunks.entries()) {
    if (!ROLE_KEYS.includes(ch?.role)) {
      c.add('chunks.role', `第 ${i} 塊的 role 未定義：${JSON.stringify(ch?.role)}`);
    }
    if (!isFilledString(ch?.target)) {
      c.add('chunks.target', `第 ${i} 塊的 target 不可為空`);
    }
    if (typeof ch?.zh !== 'string') {
      c.add('chunks.zh', `第 ${i} 塊的 zh 必須是字串（助詞用空字串）`);
    }
    if (!Number.isInteger(ch?.zhIndex)) {
      c.add('chunks.zhIndex', `第 ${i} 塊的 zhIndex 必須是整數：${JSON.stringify(ch?.zhIndex)}`);
    }
  }

  /* 句型比對：陣列順序即目標語言語序，必須與句型定義的 roles 一致 */
  const pattern = patternById(entry.patternId);
  if (!pattern) {
    c.add('patternId', `找不到句型：${JSON.stringify(entry.patternId)}`);
  } else if (pattern.lang !== lang) {
    c.add('patternId', `句型 ${pattern.id} 屬於 ${pattern.lang}，與本檔的 ${lang} 不符`);
  } else {
    const actual = chunks.map((ch) => ch?.role).join(' + ');
    const expected = pattern.roles.join(' + ');
    if (actual !== expected) {
      c.add('patternId', `chunks 的角色順序與句型 ${pattern.id} 不符：期望 [${expected}]，實際 [${actual}]`);
    }
  }

  /* 規則 3：zhIndex 必須是 0 起算的連續序列 */
  const indices = chunks.map((ch) => ch?.zhIndex);
  if (indices.every(Number.isInteger)) {
    const sorted = [...indices].sort((a, b) => a - b);
    const expected = chunks.map((_, i) => i);
    if (sorted.join(',') !== expected.join(',')) {
      c.add(
        'chunks.zhIndex',
        `zhIndex 必須是 0 起算、不跳號、不重複的連續整數，期望 [${expected}]，實際排序後為 [${sorted}]`
      );
    }
  }

  /* 規則 1：依陣列順序串接 target */
  const joinedTarget = chunks.map((ch) => ch?.target ?? '').join(' ');
  if (stripSpaces(joinedTarget) !== stripSpaces(entry.target ?? '')) {
    c.add(
      'chunks.target',
      `依陣列順序串接的 target 組不回整句：串接為「${joinedTarget.trim()}」，整句為「${entry.target}」`
    );
  }

  /* 規則 2：依 zhIndex 排序串接 zh。助詞的 zh 是空字串，不貢獻任何字 */
  const joinedZh = [...chunks]
    .sort((a, b) => (a?.zhIndex ?? 0) - (b?.zhIndex ?? 0))
    .map((ch) => ch?.zh ?? '')
    .join('');
  if (joinedZh !== (entry.zh ?? '')) {
    c.add('chunks.zh', `依 zhIndex 排序串接的 zh 組不回整句：串接為「${joinedZh}」，整句為「${entry.zh}」`);
  }

  return c.result();
}

/**
 * 拗音的小字與段位對照。
 * きゃ 必須配 column 'ya'，寫成 'yu' 是資料錯誤，會讓假名表排到錯誤的欄位。
 */
const SMALL_KANA_COLUMN = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ャ: 'ya', ュ: 'yu', ョ: 'yo' };

const SEION_COLUMNS = ['a', 'i', 'u', 'e', 'o'];
const YOUON_COLUMNS = ['ya', 'yu', 'yo'];

/**
 * 需要標註清音來源的假名類型
 */
const NEEDS_SEION_SOURCE = ['dakuon', 'handakuon'];

/**
 * 驗證一筆假名
 */
export function validateKana(entry) {
  const c = collector(entry?.id);
  if (!entry || typeof entry !== 'object') {
    c.add('(entry)', '不是物件');
    return c.result();
  }

  if (!isFilledString(entry.romaji)) {
    c.add('romaji', 'romaji 不可為空');
  } else if (!/^[a-z]+$/.test(entry.romaji)) {
    c.add('romaji', `romaji 只能是小寫英文字母：${JSON.stringify(entry.romaji)}`);
  } else if (entry.id !== `ja-k-${entry.romaji}`) {
    c.add('id', `id 必須是 ja-k-${entry.romaji}，實際為 ${JSON.stringify(entry.id)}`);
  }

  if (!KANA_TYPES.includes(entry.type)) {
    c.add('type', `type 不在允許值內：${JSON.stringify(entry.type)}`);
  }
  if (!isFilledString(entry.row)) c.add('row', 'row 不可為空');
  if (!isFilledString(entry.exampleWord)) c.add('exampleWord', 'exampleWord 不可為空');
  if (!isFilledString(entry.exampleZh)) c.add('exampleZh', 'exampleZh 不可為空');

  const isYouon = entry.type === 'youon';
  const expectedLength = isYouon ? 2 : 1;
  for (const field of ['hiragana', 'katakana']) {
    const v = entry[field];
    if (!isFilledString(v)) {
      c.add(field, `${field} 不可為空`);
      continue;
    }
    if ([...v].length !== expectedLength) {
      c.add(field, `${entry.type} 的 ${field} 應為 ${expectedLength} 個字元，實際為「${v}」`);
      continue;
    }
    if (isYouon) {
      const small = [...v][1];
      if (!SMALL_KANA_COLUMN[small]) {
        c.add(field, `拗音的第二個字必須是小字（ゃ/ゅ/ょ），實際為「${small}」`);
      } else if (SMALL_KANA_COLUMN[small] !== entry.column) {
        c.add(field, `「${v}」的小字對應段位 ${SMALL_KANA_COLUMN[small]}，與 column ${JSON.stringify(entry.column)} 不符`);
      }
    }
  }

  const allowedColumns = isYouon ? YOUON_COLUMNS : SEION_COLUMNS;
  if (!allowedColumns.includes(entry.column)) {
    c.add('column', `${entry.type} 的 column 限 ${allowedColumns.join('/')}，實際為 ${JSON.stringify(entry.column)}`);
  }

  if (NEEDS_SEION_SOURCE.includes(entry.type)) {
    if (!isFilledString(entry.seionSource)) {
      c.add('seionSource', `${entry.type} 必須標註清音來源，例如 が 的來源是 か`);
    }
  } else if (entry.seionSource !== null) {
    c.add('seionSource', `${entry.type} 的 seionSource 必須是 null，實際為 ${JSON.stringify(entry.seionSource)}`);
  }

  return c.result();
}

/**
 * 驗證一筆英文字母
 */
export function validateLetter(entry) {
  const c = collector(entry?.id);
  if (!entry || typeof entry !== 'object') {
    c.add('(entry)', '不是物件');
    return c.result();
  }

  if (!/^[A-Z]$/.test(entry.upper || '')) {
    c.add('upper', `upper 必須是單一大寫字母：${JSON.stringify(entry.upper)}`);
  }
  if (entry.lower !== String(entry.upper || '').toLowerCase()) {
    c.add('lower', `lower 必須是 upper 的小寫，實際為 ${JSON.stringify(entry.lower)}`);
  }
  if (entry.id !== `en-a-${entry.lower}`) {
    c.add('id', `id 必須是 en-a-${entry.lower}，實際為 ${JSON.stringify(entry.id)}`);
  }
  if (!isFilledString(entry.ipa)) c.add('ipa', 'ipa 不可為空');
  if (!isFilledString(entry.exampleZh)) c.add('exampleZh', 'exampleZh 不可為空');

  if (!isFilledString(entry.exampleWord)) {
    c.add('exampleWord', 'exampleWord 不可為空');
  } else if (!entry.exampleWord.toLowerCase().startsWith(String(entry.lower || '').toLowerCase())) {
    c.add('exampleWord', `例字「${entry.exampleWord}」必須以字母 ${entry.upper} 開頭`);
  }

  return c.result();
}

/**
 * 找出清單中重複的 id。
 * 同一個 id 出現多次也只回報一次。
 */
export function findDuplicateIds(list) {
  const seen = new Set();
  const dups = new Set();
  for (const item of list || []) {
    if (seen.has(item?.id)) dups.add(item.id);
    else seen.add(item?.id);
  }
  return [...dups];
}

/**
 * 情境題與閱讀題的選項數。與選擇題一致，四選一。
 *
 * 上下限都要檢查。只擋下限的話，寫五個選項會通過驗證並在畫面上畫出五顆按鈕，
 * 但鍵盤處理與題面提示都寫死 1-4，第五顆永遠選不到——
 * 畫面正在告訴使用者可以按一個他按不到的鍵。
 */
const CHOICE_OPTIONS = 4;

/**
 * 驗證一筆情境題。
 *
 * 情境題的干擾選項不能像單字題那樣從題庫自動抽——
 * 「向社長報告時怎麼自稱」的錯誤選項必須是「おれ」「ぼく」這種
 * 同樣是自稱、但場合不對的字，隨機抽出來的名詞完全構不成干擾。
 * 所以選項寫死在資料裡，驗證的責任也就落在這裡：
 * 選項數要夠、彼此不重複、而且一定要包含正解。
 */
export function validateScene(entry, lang) {
  const c = collector(entry?.id);
  if (!entry || typeof entry !== 'object') {
    c.add('(entry)', '不是物件');
    return c.result();
  }

  if (!new RegExp(`^${lang}-sc-${SERIAL}$`).test(entry.id || '')) {
    c.add('id', `id 必須符合 ${lang}-sc-NNN（3–5 位流水號），實際為 ${JSON.stringify(entry.id)}`);
  }
  if (!SCENE_AXIS_KEYS.includes(entry.axis)) {
    c.add('axis', `axis 不在允許值內：${JSON.stringify(entry.axis)}`);
  }
  if (!isFilledString(entry.scene)) c.add('scene', 'scene 不可為空，要描述說話的場合與對象');
  if (!isFilledString(entry.ask)) c.add('ask', 'ask 不可為空，要問出這一題在考什麼');
  if (!isFilledString(entry.answer)) c.add('answer', 'answer 不可為空');
  if (!isFilledString(entry.note)) c.add('note', 'note 不可為空，要說明為什麼是這個而不是別的');
  checkReading(c, entry, lang, ['reading']);
  if (!CATEGORY_KEYS.includes(entry.category)) {
    c.add('category', `category 不在允許值內：${JSON.stringify(entry.category)}`);
  }
  if (!LEVELS.includes(entry.level)) {
    c.add('level', `level 必須是 ${LEVELS.join('/')}，實際為 ${JSON.stringify(entry.level)}`);
  }

  const options = entry.options;
  if (!Array.isArray(options) || options.length !== CHOICE_OPTIONS) {
    c.add('options', `options 必須剛好 ${CHOICE_OPTIONS} 個，實際為 ${JSON.stringify(options)}`);
    return c.result();
  }
  if (options.some((o) => !isFilledString(o))) c.add('options', 'options 不可有空字串');
  if (new Set(options).size !== options.length) {
    c.add('options', `options 有重複：${options.filter((o, i) => options.indexOf(o) !== i).join('、')}`);
  }
  if (!options.includes(entry.answer)) {
    c.add('options', `options 必須包含正解「${entry.answer}」，否則這題無解`);
  }

  return c.result();
}

/**
 * 一篇短文至少要有幾道題。
 * 只出一題的話，讀完整篇的成本與收穫不成比例。
 */
const MIN_READING_QUESTIONS = 3;

/**
 * 短文的長度下限。
 *
 * 單位不同：日文沒有詞間空白只能數字數，英文數詞數。
 * 這是「還算得上一篇短文」的底線，不是目標值——現有的日文是 155-199 字、
 * 英文是 60-71 詞。少了這道下限，兩種語言的鬆緊會各自漂移。
 */
const MIN_PASSAGE = { ja: 120, en: 50 };

/**
 * 驗證一篇閱讀短文。
 *
 * 短文與題目是一對多，所以驗證分兩層：外層檢查文章本身，
 * 內層逐題檢查。題目的 id 必須以短文 id 開頭，
 * 這樣錯題檢討只看 id 就知道是哪一篇的第幾題。
 */
export function validateReading(entry, lang) {
  const c = collector(entry?.id);
  if (!entry || typeof entry !== 'object') {
    c.add('(entry)', '不是物件');
    return c.result();
  }

  if (!new RegExp(`^${lang}-r-${SERIAL}$`).test(entry.id || '')) {
    c.add('id', `id 必須符合 ${lang}-r-NNN（3–5 位流水號），實際為 ${JSON.stringify(entry.id)}`);
  }
  if (!isFilledString(entry.title)) c.add('title', 'title 不可為空');
  if (!isFilledString(entry.passage)) {
    c.add('passage', 'passage 不可為空');
  } else {
    /**
     * 短文太短就不是閱讀題，是加長版的句型題——沒有足夠的上下文可以推。
     * 兩種語言的計量單位不同：日文沒有詞間空白，只能數字數。
     */
    const size = lang === 'ja' ? entry.passage.length : entry.passage.trim().split(/\s+/).length;
    const min = MIN_PASSAGE[lang] ?? 0;
    if (size < min) {
      c.add('passage', `短文長度不足：${lang === 'ja' ? `${size} 字` : `${size} 詞`}，至少要 ${min}`);
    }
  }
  if (!isFilledString(entry.translation)) {
    c.add('translation', 'translation 不可為空，作答後要讓人對照著看');
  }
  if (!CATEGORY_KEYS.includes(entry.category)) {
    c.add('category', `category 不在允許值內：${JSON.stringify(entry.category)}`);
  }
  if (!LEVELS.includes(entry.level)) {
    c.add('level', `level 必須是 ${LEVELS.join('/')}，實際為 ${JSON.stringify(entry.level)}`);
  }

  const questions = entry.questions;
  if (!Array.isArray(questions) || questions.length < MIN_READING_QUESTIONS) {
    c.add('questions', `每篇至少 ${MIN_READING_QUESTIONS} 題，實際 ${questions?.length ?? 0} 題`);
    return c.result();
  }

  for (const [i, q] of questions.entries()) {
    const at = `questions[${i}]`;
    if (!new RegExp(`^${entry.id}-q\\d+$`).test(q?.id || '')) {
      c.add(`${at}.id`, `題目 id 必須是「${entry.id}-qN」，實際為 ${JSON.stringify(q?.id)}`);
    }
    /* 問法有中文與目標語言兩版，測驗頁可以切換，兩邊都不能缺 */
    if (!isFilledString(q?.ask?.zh)) c.add(`${at}.ask.zh`, 'ask.zh 不可為空');
    if (!isFilledString(q?.ask?.target)) c.add(`${at}.ask.target`, 'ask.target 不可為空');
    if (!isFilledString(q?.note)) c.add(`${at}.note`, 'note 不可為空，要指出答案在文中的哪裡');

    const options = q?.options;
    if (!Array.isArray(options) || options.length !== CHOICE_OPTIONS) {
      c.add(`${at}.options`, `options 必須剛好 ${CHOICE_OPTIONS} 個`);
      continue;
    }

    /**
     * 正解直接標在選項上（correct: true），不另外寫一個要去對照的 answer 欄位。
     * 分成兩欄的話，改了選項卻忘了改 answer 就會產生一題無解的題目；
     * 標在選項上就沒有東西可以對不起來。
     */
    const correct = options.filter((o) => o?.correct === true);
    if (correct.length !== 1) {
      c.add(`${at}.options`, `必須恰好有一個選項標記 correct: true，實際有 ${correct.length} 個`);
    }

    for (const [k, o] of options.entries()) {
      if (!isFilledString(o?.zh)) c.add(`${at}.options[${k}].zh`, '選項的中文不可為空');
      if (!isFilledString(o?.target)) c.add(`${at}.options[${k}].target`, '選項的目標語言不可為空');
    }

    /* 兩種語言各自都不能有重複的選項，否則切到那一邊就會出現兩個一樣的按鈕 */
    for (const field of ['zh', 'target']) {
      const texts = options.map((o) => o?.[field]);
      const dups = texts.filter((v, k) => v && texts.indexOf(v) !== k);
      if (dups.length) {
        c.add(`${at}.options`, `${field} 選項有重複：${[...new Set(dups)].join('、')}`);
      }
    }
  }

  const ids = questions.map((q) => q?.id);
  const dups = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dups.length) c.add('questions', `題目 id 重複：${[...new Set(dups)].join('、')}`);

  return c.result();
}

/**
 * 每個資料區塊對應的驗證函式。
 * words、sentences、scenes 與 readings 需要語言參數，kana 與 letters 不需要。
 */
const SECTION_VALIDATORS = {
  words: (entry, lang) => validateWord(entry, lang),
  sentences: (entry, lang) => validateSentence(entry, lang),
  scenes: (entry, lang) => validateScene(entry, lang),
  readings: (entry, lang) => validateReading(entry, lang),
  kana: (entry) => validateKana(entry),
  letters: (entry) => validateLetter(entry),
};

/**
 * 一次驗證某語言的全部題庫。
 * 一律把所有錯誤蒐集完才回傳，這樣修資料時可以一次看到全貌，
 * 不必反覆跑測試一個一個修。
 */
export function validateDataset(dataset, lang) {
  const errors = [];
  for (const [section, validate] of Object.entries(SECTION_VALIDATORS)) {
    const list = dataset?.[section];
    if (!Array.isArray(list)) continue;

    for (const entry of list) {
      errors.push(...validate(entry, lang).errors);
    }
    for (const dup of findDuplicateIds(list)) {
      errors.push({ id: dup, field: 'id', message: `${section} 中有重複的 id：${dup}` });
    }
  }
  return errors;
}
