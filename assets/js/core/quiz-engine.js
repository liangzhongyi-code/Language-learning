/**
 * 測驗引擎：抽題、產生干擾選項、判定作答。
 *
 * 這裡是整個網站正確性最容易出事的地方——題目重複、選項只有三個、
 * 干擾選項剛好與正解同義——所以全部寫成無 DOM 的純函式，讓測試能完整覆蓋。
 * 亂數一律由參數注入，測試可用固定序列重現同一局。
 *
 * 題目分兩種作答型態（`kind`）：
 *   choice 四選一，答案是一個選項索引；
 *   cloze  句子挖空，答案是每一格填進去的字。
 * 兩者的判定方式不同，其餘差異（情境描述、短文）都只是題面多帶欄位，
 * 仍然走 choice 那條路——不要為了「看起來不一樣」多開一種 kind。
 */

import { shuffle, sample } from './shuffle.js';
import { speakTextOf } from './speech-text.js';

/**
 * 一題需要一個正解加三個干擾選項
 */
const OPTIONS_PER_QUESTION = 4;
const DISTRACTORS_PER_QUESTION = OPTIONS_PER_QUESTION - 1;

/**
 * 填空題的候選詞至少要比空格多幾個。
 * 一樣多的話用刪去法就能全對，等於沒考。
 */
const BANK_EXTRA = 3;

/**
 * 題源對應的作答型態。
 * 沒列在這裡的題源一律當成 choice。
 */
const SOURCE_KIND = {
  words: 'choice',
  sentences: 'choice',
  mixed: 'choice',
  cloze: 'cloze',
};

/**
 * 出題方向對應的題面與選項欄位
 */
const DIRECTION_FIELDS = {
  zh2target: { prompt: 'zh', option: 'target' },
  target2zh: { prompt: 'target', option: 'zh' },
};

/**
 * 某一題是否已經作答完畢。
 *
 * 兩種題型的「作答完畢」定義不同：選擇題按下選項就算，
 * 填空題要按下提交才算——只填了一半不算，否則進度條會騙人。
 * 這個判斷散在 engine、stats、view 三處各寫一份遲早會不一致，所以收在這裡。
 */
export function isAnswered(question) {
  if (!question) return false;
  if (question.kind === 'cloze') return question.submitted === true;
  return question.answeredIndex !== null && question.answeredIndex !== undefined;
}

/**
 * 某一題是否答對。未作答一律視為答錯。
 */
export function isCorrect(question) {
  if (!isAnswered(question)) return false;
  if (question.kind === 'cloze') {
    return question.blanks.every((blank, i) => question.filled[i] === blank.answer);
  }
  return question.answeredIndex === question.correctIndex;
}

/**
 * 挑三個干擾選項。
 * 依「同 category → 同 level → 全域」三段遞補，讓干擾選項盡量與正解同一個
 * 語意範疇，題目才有鑑別度；但無論如何都要湊滿三個，湊不滿就是題庫太小，
 * 寧可拋錯也不回傳選項不足的瑕疵題。
 *
 * 顯示文字與正解相同的項目一律排除，否則會出現兩個都對的選項。
 */
export function pickDistractors(pool, correct, optionField, rng = Math.random) {
  const candidates = (pool || []).filter(
    (item) => item.id !== correct.id && item[optionField] !== correct[optionField]
  );

  if (candidates.length < DISTRACTORS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：可用的干擾選項只有 ${candidates.length} 筆，` +
        `每題需要 ${DISTRACTORS_PER_QUESTION} 個。請至少準備 ${OPTIONS_PER_QUESTION} 筆不重複的題目。`
    );
  }

  const tiers = [
    candidates.filter((c) => c.category === correct.category),
    candidates.filter((c) => c.category !== correct.category && c.level === correct.level),
    candidates,
  ];

  const picked = [];
  const takenIds = new Set();
  const takenTexts = new Set();

  for (const tier of tiers) {
    if (picked.length >= DISTRACTORS_PER_QUESTION) break;
    const fresh = tier.filter((c) => !takenIds.has(c.id) && !takenTexts.has(c[optionField]));
    for (const item of shuffle(fresh, rng)) {
      if (picked.length >= DISTRACTORS_PER_QUESTION) break;
      if (takenTexts.has(item[optionField])) continue;
      picked.push(item);
      takenIds.add(item.id);
      takenTexts.add(item[optionField]);
    }
  }

  if (picked.length < DISTRACTORS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：湊不出 ${DISTRACTORS_PER_QUESTION} 個文字相異的干擾選項（正解：${correct.id}）。`
    );
  }

  return picked;
}

/**
 * 依題源取出題庫。mixed 把單字與句子併在一起抽。
 * 設定畫面要顯示各題源的筆數，所以一併匯出——
 * 讓 UI 直接用這裡的定義，而不是自己再寫一份分支。
 */
export function poolOf(source, words, sentences) {
  if (source === 'words') return [...(words || [])];
  if (source === 'sentences') return [...(sentences || [])];
  /**
   * 填空題挖的是句子裡的區塊，單字沒有可挖的結構，題源只能是句子；
   * 而且挖掉一塊之後還要留下線索，所以只有一塊的句子在這裡就先剔除。
   * 留到抽題時才擋，會變成「大部分時候正常、偶爾整局炸掉」的間歇性失敗。
   */
  if (source === 'cloze') return (sentences || []).filter((s) => (s.chunks?.length || 0) >= 2);
  return [...(words || []), ...(sentences || [])];
}

/**
 * 題源用哪一種作答型態出題
 */
export function kindOf(source) {
  return SOURCE_KIND[source] || 'choice';
}

/**
 * 一局的作答進度百分比，0-100 的整數。
 * 已作答的當前題目算完成，這樣進度條在按下選項時就會前進。
 */
export function progressPercent(session) {
  const questions = session?.questions || [];
  if (!questions.length) return 0;
  const done = questions.filter(isAnswered).length;
  return Math.round((done / questions.length) * 100);
}

/**
 * 產生一題選擇題
 */
function buildChoiceQuestion(item, pool, { lang, direction, rng }) {
  const fields = DIRECTION_FIELDS[direction];
  const distractors = pickDistractors(pool, item, fields.option, rng);

  const options = shuffle(
    [
      { text: item[fields.option], isCorrect: true },
      ...distractors.map((d) => ({ text: d[fields.option], isCorrect: false })),
    ],
    rng
  );

  return {
    kind: 'choice',
    sourceId: item.id,
    direction,
    prompt: item[fields.prompt],
    promptLang: direction === 'zh2target' ? 'zh' : lang,
    optionLang: direction === 'zh2target' ? lang : 'zh',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    /* 題面或正解要朗讀時用的目標語言文字 */
    speakText: speakTextOf(item, lang),
    /* 句子題才有語序說明，錯題檢討會顯示 */
    note: item.note ?? null,
    answeredIndex: null,
  };
}

/**
 * 決定一句要挖幾個空。
 *
 * 挖到只剩一塊就不是填空而是重組整句了，所以無論如何都留下至少一塊當線索。
 * 塊數少的句子只挖一個，長句才挖到三個。
 */
function blankCountFor(chunkCount, rng) {
  const wanted = chunkCount <= 3 ? 1 : chunkCount <= 5 ? 2 : 2 + (rng() < 0.5 ? 0 : 1);
  return Math.min(wanted, chunkCount - 1);
}

/**
 * 選出要挖掉的塊，不挖相鄰的兩塊。
 *
 * 相鄰的空格會連成一段完全沒有線索的空白（「猫は魚＿＿」），
 * 前後文一斷，題目就從「讀懂句子挑對詞」退化成「從候選區湊排列」。
 *
 * 作法不是「隨機挑、撞到相鄰就換一個」——那種貪婪法會卡死：
 * 六塊要挖三個時先挑中 1 再挑中 4，剩下的位置全部與這兩個相鄰，就再也湊不滿。
 * 這裡改用不相鄰組合與一般組合之間的標準對應：
 * 先從 n-k+1 個位置挑 k 個，再把第 j 個往後推 j 格，
 * 推完相鄰兩個的間距必定 ≥2。只要 k ≤ (n+1)/2 就一定挑得出來，不必重試。
 */
function pickBlankIndices(chunkCount, count, rng) {
  const room = chunkCount - count + 1;

  /* 句子短到連一組不相鄰的位置都排不下時，寧可挖相鄰的也不要少挖 */
  if (count > room) {
    return new Set(sample(Array.from({ length: chunkCount }, (_, i) => i), count, rng));
  }

  const chosen = sample(Array.from({ length: room }, (_, i) => i), count, rng).sort((a, b) => a - b);
  return new Set(chosen.map((c, j) => c + j));
}

/**
 * 湊出填空題的候選詞。
 *
 * 干擾詞優先取「同一個語法角色」的塊——助詞的空格就配別的助詞，
 * 動詞的空格就配別的動詞。角色不同的干擾詞一眼就能刷掉，等於沒放。
 * 同角色湊不滿才往全部塊退，退到底仍不滿就只好少幾個，不拋錯：
 * 候選詞比空格多一個就還能考，沒必要為此讓整局出不來。
 */
function buildBank(answers, blankRoles, otherChunks, rng) {
  const taken = new Set(answers);
  const wanted = answers.length + BANK_EXTRA;
  const picked = [];

  const tiers = [
    otherChunks.filter((ch) => blankRoles.has(ch.role)),
    otherChunks,
  ];

  for (const tier of tiers) {
    if (picked.length >= BANK_EXTRA) break;
    for (const chunk of shuffle(tier, rng)) {
      if (picked.length >= BANK_EXTRA) break;
      if (taken.has(chunk.target)) continue;
      taken.add(chunk.target);
      picked.push(chunk.target);
    }
  }

  /* answers 保留重複：同一句出現兩個「を」時，候選區也要有兩張才填得完 */
  return shuffle([...answers, ...picked], rng).slice(0, wanted);
}

/**
 * 產生一題填空題。
 *
 * 題面是整句中文，作答區是把目標語言句子按 chunks 拆開、挖掉其中幾塊。
 * segments 交錯排列固定文字與空格，畫面層照順序畫出來就是原句。
 */
function buildClozeQuestion(sentence, pool, { lang, rng }) {
  const chunks = sentence.chunks || [];
  if (chunks.length < 2) {
    throw new Error(`句子 ${sentence.id} 只有 ${chunks.length} 塊，挖空後不剩線索，無法出填空題。`);
  }

  const count = blankCountFor(chunks.length, rng);
  const blankAt = pickBlankIndices(chunks.length, count, rng);

  const segments = [];
  const blanks = [];
  for (const [i, chunk] of chunks.entries()) {
    if (blankAt.has(i)) {
      segments.push({ type: 'blank', blankIndex: blanks.length });
      blanks.push({ answer: chunk.target, role: chunk.role, zh: chunk.zh });
    } else {
      segments.push({ type: 'text', text: chunk.target });
    }
  }

  const blankRoles = new Set(blanks.map((b) => b.role));
  const otherChunks = pool
    .filter((s) => s.id !== sentence.id)
    .flatMap((s) => s.chunks || []);

  return {
    kind: 'cloze',
    sourceId: sentence.id,
    /* 填空一律看中文填目標語言，沒有反向的意義 */
    direction: 'zh2target',
    prompt: sentence.zh,
    promptLang: 'zh',
    optionLang: lang,
    segments,
    blanks,
    bank: buildBank(blanks.map((b) => b.answer), blankRoles, otherChunks, rng),
    filled: blanks.map(() => null),
    submitted: false,
    speakText: speakTextOf(sentence, lang),
    note: sentence.note ?? null,
    answeredIndex: null,
  };
}

/**
 * 組出一局測驗。
 * 題數超過題庫時取全部；題庫少於四筆時拋錯。
 */
export function buildSession({
  lang,
  words,
  sentences,
  source = 'words',
  direction = 'zh2target',
  count = 10,
  rng = Math.random,
}) {
  const pool = poolOf(source, words, sentences);

  if (pool.length < OPTIONS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：題源 ${source} 只有 ${pool.length} 筆，至少需要 ${OPTIONS_PER_QUESTION} 筆才能出題。`
    );
  }

  const kind = kindOf(source);
  const picked = sample(pool, count, rng);
  const questions = picked.map((item) => {
    if (kind === 'cloze') return buildClozeQuestion(item, pool, { lang, rng });
    const dir = direction === 'mixed' ? (rng() < 0.5 ? 'zh2target' : 'target2zh') : direction;
    return buildChoiceQuestion(item, pool, { lang, direction: dir, rng });
  });

  return { lang, source, direction, questions, cursor: 0 };
}

/**
 * 提交一題選擇題的答案
 */
function answerChoice(q, optionIndex) {
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) {
    throw new Error(`選項索引不合法：${optionIndex}`);
  }

  const alreadyAnswered = q.answeredIndex !== null;
  if (!alreadyAnswered) q.answeredIndex = optionIndex;

  return {
    correct: q.answeredIndex === q.correctIndex,
    correctIndex: q.correctIndex,
    correctText: q.options[q.correctIndex].text,
    chosenIndex: q.answeredIndex,
    alreadyAnswered,
  };
}

/**
 * 提交一題填空題的答案。
 *
 * 傳進來的是每一格填了什麼字（沒填的是 null）。空格沒填滿一律拒收：
 * 使用者按了提交卻少填一格，多半是漏看而不是放棄，直接判錯太粗暴。
 */
function answerCloze(q, filled) {
  if (!Array.isArray(filled) || filled.length !== q.blanks.length) {
    throw new Error(`填空答案格式不符：需要 ${q.blanks.length} 格，收到 ${
      Array.isArray(filled) ? filled.length : typeof filled
    }。`);
  }

  const alreadyAnswered = q.submitted === true;
  if (!alreadyAnswered) {
    if (filled.some((text) => text === null || text === undefined || text === '')) {
      throw new Error('還有空格沒填，不能提交。');
    }
    q.filled = [...filled];
    q.submitted = true;
  }

  const perBlank = q.blanks.map((blank, i) => ({
    answer: blank.answer,
    chosen: q.filled[i],
    correct: q.filled[i] === blank.answer,
  }));

  return {
    correct: perBlank.every((b) => b.correct),
    perBlank,
    correctText: q.blanks.map((b) => b.answer).join(''),
    chosenText: q.filled.join(''),
    alreadyAnswered,
  };
}

/**
 * 提交一題的答案。
 * 已作答的題目不再變更，避免重複作答刷分。
 *
 * response 的型態依題型而定：選擇題是選項索引，填空題是每一格的字組成的陣列。
 */
export function answer(session, questionIndex, response) {
  const q = session?.questions?.[questionIndex];
  if (!q) throw new Error(`題目索引超出範圍：${questionIndex}`);
  return q.kind === 'cloze' ? answerCloze(q, response) : answerChoice(q, response);
}
