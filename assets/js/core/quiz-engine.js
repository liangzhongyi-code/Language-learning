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
import { kanaPool } from './kana.js';

/**
 * 一題需要一個正解加三個干擾選項
 */
const OPTIONS_PER_QUESTION = 4;
const DISTRACTORS_PER_QUESTION = OPTIONS_PER_QUESTION - 1;

/**
 * 題庫至少要有這麼多筆才出得出題。
 * 匯出給 ui 用——設定畫面要在按下開始「之前」就知道某個題源能不能選，
 * 兩邊各寫一個 4 遲早會分家。
 */
export const MIN_POOL = OPTIONS_PER_QUESTION;

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
  scene: 'choice',
  reading: 'choice',
};

/**
 * 出題方向對應的題面與選項欄位
 */
const DIRECTION_FIELDS = {
  zh2target: { prompt: 'zh', option: 'target' },
  target2zh: { prompt: 'target', option: 'zh' },
};

/**
 * 支援「隱藏漢字」的題源。
 *
 * 單字、句子與句子的每一塊都有 reading 可以換；
 * 情境題的四個選項與閱讀題的短文都沒有假名版，換不了——
 * 沒列在這裡的題源就算開了開關也照常出漢字。
 * 匯出給 ui 用，設定畫面才知道那顆開關該不該出現。
 */
const KANA_SOURCES = ['words', 'sentences', 'mixed', 'cloze'];

export function supportsHideKanji(source) {
  return KANA_SOURCES.includes(source);
}

/**
 * 目標語言把詞拼成句子時的間隔。
 * 英文的詞之間有空白、日文沒有；填空題要把區塊拼回整句，這個差別不能忽略，
 * 否則英文會黏成 Shestudiesatthelibrary。
 */
const WORD_GAP = { en: ' ', ja: '' };

/**
 * 把填空題還原成完整句子。
 *
 * fill 決定每一格放什麼——傳正解就得到標準答案，傳使用者填的就得到他寫出來的句子。
 * 錯題檢討只列出空格內容（「私を」）看不懂，一定要放回句子裡才知道錯在哪。
 */
export function clozeSentence(question, fill) {
  return (question?.segments || [])
    .map((seg) => (seg.type === 'text' ? seg.text : fill(seg.blankIndex)))
    .join(question?.gap ?? '');
}

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
 * 依 category 把題庫分桶，給 pickDistractors 的第一段用。
 * 桶內順序與原本的陣列順序相同，所以抽出來的結果與掃全表時完全一樣。
 */
function indexByCategory(pool) {
  const map = new Map();
  for (const item of pool) {
    const key = item.category ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * 挑三個干擾選項。
 * 依「同 category → 同 level → 全域」三段遞補，讓干擾選項盡量與正解同一個
 * 語意範疇，題目才有鑑別度；但無論如何都要湊滿三個，湊不滿就是題庫太小，
 * 寧可拋錯也不回傳選項不足的瑕疵題。
 *
 * 顯示文字與正解相同的項目一律排除，否則會出現兩個都對的選項。
 *
 * promptField 是題面那一側的欄位，撞到了同樣要排除。
 * 題面相同代表這一題問的是同一件事，那個干擾選項就跟正解一樣對。
 * 平常很少發生，但隱藏漢字模式下題面變成假名，「橋」與「箸」都成了はし，
 * 日文的同音詞又特別多——不擋的話會固定出現一批無解的題目。
 */
export function pickDistractors(
  pool,
  correct,
  optionField,
  rng = Math.random,
  byCategory = null,
  promptField = null
) {
  const list = pool || [];
  const clashes = promptField && promptField !== optionField
    ? (item) => item[optionField] === correct[optionField] || item[promptField] === correct[promptField]
    : (item) => item[optionField] === correct[optionField];
  const usable = (item) => item.id !== correct.id && !clashes(item);
  /* 有索引就從同 category 的桶子裡挑，沒有就退回掃全表（單獨呼叫時的路徑） */
  const sameCategory = byCategory ? byCategory.get(correct.category ?? '') ?? [] : null;

  /**
   * 三段一律惰性求值。
   *
   * 以前是三段都先 filter 出來放進陣列，加上一開始的 candidates 共四趟全掃，
   * 即使第一段就湊滿也照掃不誤。題數選「全部」時等於 7608 題 × 四趟 7608 筆，
   * 主執行緒同步凍結 2.2 秒、畫面上沒有任何提示。
   * 絕大多數情況同 category 就湊得滿，後兩段連掃都不該掃。
   */
  const tiers = [
    () => (sameCategory || list).filter((c) => usable(c) && c.category === correct.category),
    () => list.filter((c) => usable(c) && c.category !== correct.category && c.level === correct.level),
    () => list.filter(usable),
  ];

  const picked = [];
  const takenIds = new Set();
  const takenTexts = new Set();

  for (const tierOf of tiers) {
    if (picked.length >= DISTRACTORS_PER_QUESTION) break;
    const fresh = tierOf().filter((c) => !takenIds.has(c.id) && !takenTexts.has(c[optionField]));
    for (const item of shuffle(fresh, rng)) {
      if (picked.length >= DISTRACTORS_PER_QUESTION) break;
      if (takenTexts.has(item[optionField])) continue;
      picked.push(item);
      takenIds.add(item.id);
      takenTexts.add(item[optionField]);
    }
  }

  /* 湊不滿才回頭算總數——這一趟只在出錯時付，不在每一題上付 */
  if (picked.length < DISTRACTORS_PER_QUESTION) {
    const total = list.filter(usable).length;
    if (total < DISTRACTORS_PER_QUESTION) {
      throw new Error(
        `題庫筆數不足：可用的干擾選項只有 ${total} 筆，` +
          `每題需要 ${DISTRACTORS_PER_QUESTION} 個。請至少準備 ${OPTIONS_PER_QUESTION} 筆不重複的題目。`
      );
    }
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
export function poolOf(source, words, sentences, scenes, readings) {
  if (source === 'words') return [...(words || [])];
  if (source === 'sentences') return [...(sentences || [])];
  if (source === 'scene') return [...(scenes || [])];
  /**
   * 閱讀題是「一篇短文對多道題」，但題庫必須是一維的才抽得動，
   * 所以在這裡攤平成一題一筆，每一筆都帶著自己那篇短文。
   * 設定畫面顯示的數字因此是題數而不是篇數——使用者選的是要作答幾題。
   */
  if (source === 'reading') {
    return (readings || []).flatMap((r) =>
      (r.questions || []).map((q) => ({
        ...q,
        passageId: r.id,
        title: r.title,
        passage: r.passage,
        translation: r.translation,
        category: r.category,
        level: r.level,
      }))
    );
  }
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
function buildChoiceQuestion(item, pool, { lang, direction, rng, byCategory = null }) {
  const fields = DIRECTION_FIELDS[direction];
  const distractors = pickDistractors(pool, item, fields.option, rng, byCategory, fields.prompt);

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
 * 產生一題情境題。
 *
 * 與單字題最大的差別是選項不自動抽，直接用資料裡寫死的那四個。
 * 「向社長報告時怎麼自稱」的干擾選項必須是「おれ」「ぼく」這種
 * 同樣是自稱、只是場合不對的字；從題庫隨機抽出來的名詞完全構不成干擾，
 * 一眼就能刷掉，那題等於沒考。
 *
 * 題面因此分成兩層：context 是場合描述、prompt 是問題本身。
 * 兩者都要顯示，缺了場合這題就無從判斷。
 */
function buildSceneQuestion(scene, { lang, rng }) {
  const options = shuffle(
    scene.options.map((text) => ({ text, isCorrect: text === scene.answer })),
    rng
  );

  return {
    kind: 'choice',
    sourceId: scene.id,
    direction: 'zh2target',
    /* 場合描述，畫面上要放在問題之上 */
    context: scene.scene,
    prompt: scene.ask,
    promptLang: 'zh',
    optionLang: lang,
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    speakText: speakTextOf({ reading: scene.reading, target: scene.answer }, lang),
    note: scene.note ?? null,
    answeredIndex: null,
  };
}

/**
 * 產生一題閱讀題。
 *
 * 結構與情境題幾乎一樣，差別在 context 是整篇短文而不是一句場合描述，
 * 而且多帶一份中文翻譯——作答後才顯示，先給翻譯就沒得考了。
 *
 * 沒有 speakText：整篇短文的假名轉寫工程量太大，而且日文漢字直接餵給
 * 語音引擎會唸錯讀音，寧可不提供也不要唸錯。閱讀練習的重點本來就不在發音。
 */
function buildReadingQuestion(item, { lang, rng, askIn = 'zh' }) {
  /**
   * 問法與選項要嘛都用中文、要嘛都用目標語言，不能各用一種。
   *
   * 「日文選項配中文題目」是沒有人想要的半吊子模式：
   * 想測純理解就該連題目都是中文，想模擬 JLPT 讀解就該整題都是日文。
   * 所以這個欄位一次決定兩者。
   */
  const field = askIn === 'target' ? 'target' : 'zh';

  const options = shuffle(
    item.options.map((o) => ({ text: o[field], isCorrect: o.correct === true })),
    rng
  );

  return {
    kind: 'choice',
    sourceId: item.id,
    passageId: item.passageId,
    direction: 'target2zh',
    title: item.title,
    context: item.passage,
    /* 作答後才顯示，讓人對照著看自己讀懂了多少 */
    translation: item.translation,
    contextLang: lang,
    prompt: item.ask[field],
    promptLang: field === 'target' ? lang : 'zh',
    optionLang: field === 'target' ? lang : 'zh',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    /**
     * 一律不掛朗讀鍵。
     * 中文模式的選項是中文，唸出來沒有意義；
     * 目標語言模式的選項雖然是日文，但漢字直接餵給語音引擎會唸錯讀音，
     * 而整篇短文的假名轉寫成本又太高——寧可不給也不要唸錯。
     */
    speakText: null,
    note: item.note ?? null,
    answeredIndex: null,
  };
}

/**
 * 閱讀題的抽題：先抽短文，再把整篇的題目一起放進來。
 *
 * 不能像其他題型那樣直接從題目池隨機抽——那樣十題會來自十篇不同的短文，
 * 每一題都要重讀一篇新文章，一局下來等於讀了十篇。
 * 按篇抽才會形成「讀一篇、答完它的三四題、再換下一篇」的節奏。
 */
function sampleReadingQuestions(pool, count, rng) {
  const byPassage = new Map();
  for (const item of pool) {
    if (!byPassage.has(item.passageId)) byPassage.set(item.passageId, []);
    byPassage.get(item.passageId).push(item);
  }

  const picked = [];
  for (const passageId of shuffle([...byPassage.keys()], rng)) {
    if (picked.length >= count) break;
    picked.push(...byPassage.get(passageId));
  }
  return picked.slice(0, count);
}

/**
 * 決定一句要挖幾個空。
 *
 * 挖到只剩一塊就不是填空而是重組整句了，所以無論如何都留下至少一塊當線索。
 * 塊數少的句子只挖一個，長句才挖到三個。
 */
function blankCountFor(chunkCount, rng) {
  const wanted = chunkCount <= 3 ? 1 : chunkCount <= 5 ? 2 : 2 + (rng() < 0.5 ? 0 : 1);
  /**
   * 上限有兩條：至少留一塊不挖，以及挖得出不相鄰的位置。
   * 後者是 floor((n+1)/2)——n 塊最多能排下這麼多個彼此不相鄰的位置。
   * 這條夾限就是 pickBlankIndices 的前提，寫在這裡才擋得住往後放寬挖空數時
   * 悄悄開始出現相鄰空格。
   */
  return Math.min(wanted, chunkCount - 1, Math.floor((chunkCount + 1) / 2));
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
 * 那個前提由 blankCountFor 保證。
 */
function pickBlankIndices(chunkCount, count, rng) {
  const room = chunkCount - count + 1;

  /**
   * 前提不成立就是呼叫端算錯了挖空數，不是資料問題。
   * 以前這裡是「排不下就改挖相鄰的」，但那條路現行的 blankCountFor 永遠走不到，
   * 於是它成了唯一會產生相鄰空格、卻沒有任何測試會經過的分支。
   * 放寬 blankCountFor 的人應該當場看到錯誤，而不是在題目上看到兩個連在一起的空格。
   */
  if (count > room) {
    throw new Error(
      `挖空數 ${count} 超過 ${chunkCount} 塊排得下的不相鄰位置（上限 ${Math.floor((chunkCount + 1) / 2)}）。`
    );
  }

  const chosen = sample(Array.from({ length: room }, (_, i) => i), count, rng).sort((a, b) => a - b);
  return new Set(chosen.map((c, j) => c + j));
}

/**
 * 湊出填空題的候選詞。
 *
 * 干擾詞取「同一個語法角色」的塊——助詞的空格配別的助詞，動詞的空格配別的動詞。
 * 角色不同的干擾詞一眼就能刷掉，等於沒放。
 *
 * 而且要各個角色輪流取，不能一口氣從同一個角色抓滿。
 * 「他昨天寄包裹」挖掉主詞與時間，若干擾詞全是主詞（They／She／I），
 * 時間那一格就只剩正解可填，那一格等於送分。輪流取才能保證每一格都有像樣的對手。
 *
 * 同角色湊不滿才往全部塊退；退到底仍不滿就少放幾個，不拋錯——
 * 候選詞比空格多就還能考，沒必要為此讓整局出不來。
 */
function buildBank(blanks, otherChunks, rng) {
  const answers = blanks.map((b) => b.answer);
  const taken = new Set(answers);
  const roles = [...new Set(blanks.map((b) => b.role))];
  const picked = [];

  /* 先按角色分堆並各自洗牌，之後只要依序取用就是隨機的 */
  const byRole = new Map(roles.map((r) => [r, shuffle(otherChunks.filter((c) => c.role === r), rng)]));

  const take = (list) => {
    while (list.length) {
      const chunk = list.shift();
      if (taken.has(chunk.target)) continue;
      taken.add(chunk.target);
      picked.push(chunk.target);
      return true;
    }
    return false;
  };

  /* 一輪給每個角色一個，輪到沒有人拿得出東西為止 */
  while (picked.length < BANK_EXTRA) {
    let progressed = false;
    for (const role of roles) {
      if (picked.length >= BANK_EXTRA) break;
      if (take(byRole.get(role))) progressed = true;
    }
    if (!progressed) break;
  }

  /* 同角色不夠用，退而取任何塊 */
  const rest = shuffle(otherChunks, rng);
  while (picked.length < BANK_EXTRA && take(rest));

  /* answers 保留重複：同一句出現兩個「を」時，候選區也要有兩張才填得完 */
  return shuffle([...answers, ...picked], rng);
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
    /* 把區塊拼回整句時要用的間隔，畫面與錯題檢討都靠它 */
    gap: WORD_GAP[lang] ?? '',
    bank: buildBank(blanks, otherChunks, rng),
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
  scenes,
  readings,
  source = 'words',
  /* 閱讀題的問法與選項要用中文還是目標語言 */
  readingAskIn = 'zh',
  /**
   * 把題目裡的漢字換成假名。
   * 在整局的最上游換掉，下游的干擾選項去重、正解比對、填空候選詞
   * 就全部落在假名上，不必每一處各自判斷一次。
   */
  hideKanji = false,
  direction = 'zh2target',
  count = 10,
  rng = Math.random,
}) {
  const base = poolOf(source, words, sentences, scenes, readings);
  const pool = hideKanji && supportsHideKanji(source) ? kanaPool(base) : base;

  if (pool.length < OPTIONS_PER_QUESTION) {
    throw new Error(
      `題庫筆數不足：題源 ${source} 只有 ${pool.length} 筆，至少需要 ${OPTIONS_PER_QUESTION} 筆才能出題。`
    );
  }

  const kind = kindOf(source);
  /* 閱讀題按篇抽，其餘題型逐題抽 */
  const picked =
    source === 'reading' ? sampleReadingQuestions(pool, count, rng) : sample(pool, count, rng);

  /**
   * 干擾選項的第一段是「同 category」，分桶一次就不必每題掃全表。
   * 一局 10 題感覺不出來，但題數選「全部」時是 7608 題 × 7608 筆的差別。
   */
  const byCategory = kind === 'choice' && source !== 'scene' && source !== 'reading'
    ? indexByCategory(pool)
    : null;

  const questions = picked.map((item) => {
    if (kind === 'cloze') return buildClozeQuestion(item, pool, { lang, rng });
    if (source === 'scene') return buildSceneQuestion(item, { lang, rng });
    if (source === 'reading') return buildReadingQuestion(item, { lang, rng, askIn: readingAskIn });
    const dir = direction === 'mixed' ? (rng() < 0.5 ? 'zh2target' : 'target2zh') : direction;
    return buildChoiceQuestion(item, pool, { lang, direction: dir, rng, byCategory });
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
    correctText: clozeSentence(q, (i) => q.blanks[i].answer),
    chosenText: clozeSentence(q, (i) => q.filled[i]),
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
