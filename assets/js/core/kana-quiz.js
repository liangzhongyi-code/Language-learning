/**
 * 五十音選擇題的出題規則：把假名表攤成題目、挑干擾選項、寫解說。
 *
 * 使用者可能一個假名都不認得，所以規則都往「練得下去」靠：
 *   範圍切成小組，一次只背十幾個；
 *   選項只從選取的範圍裡挑，不會突然冒出沒學過的字；
 *   每題答完都附兩套寫法、羅馬音與例字。
 *
 * 平假名與片假名是兩個要分開記的東西——會 あ 不等於會 ア——
 * 所以一個音攤成兩筆，各有自己的 id 與學習紀錄。
 */

import { shuffle } from './shuffle.js';

/**
 * 三種模式。note 是給完全沒學過的人看的說明。
 */
export const KANA_SCRIPTS = [
  { key: 'hiragana', label: '平假名', note: '圓圓的那一套，最常用，建議先學這套。' },
  { key: 'katakana', label: '片假名', note: '有稜有角的那一套，主要寫外來語。每個字的唸法都和平假名一樣，只是換一種寫法。' },
  { key: 'mixed', label: '混合', note: '平假名和片假名輪流出現，兩套都認得之後再來挑戰。' },
];
export const KANA_SCRIPT_KEYS = KANA_SCRIPTS.map((s) => s.key);

/**
 * 單一假名系統的名稱，題目上要標出這一題是哪一套
 */
export const KANA_SCRIPT_LABEL = { hiragana: '平假名', katakana: '片假名' };

/**
 * 出題範圍。
 *
 * 清音 46 個一次全出，對第一天學的人等於全部用猜的，所以切成三組、每組十五個左右；
 * 濁音以後是清音的變化，照對照表的四大區塊分。
 * 每一組都超過四個，單獨選任何一組都湊得出四個選項。
 */
export const KANA_GROUPS = [
  { key: 'seion-1', label: '清音① あ・か・さ行', type: 'seion', rows: ['あ', 'か', 'さ'], note: '第一次學就從這 15 個開始。' },
  { key: 'seion-2', label: '清音② た・な・は行', type: 'seion', rows: ['た', 'な', 'は'], note: '第一組認得差不多了再加這 15 個。' },
  { key: 'seion-3', label: '清音③ ま・や・ら・わ行・ん', type: 'seion', rows: ['ま', 'や', 'ら', 'わ', 'ん'], note: '練完這 16 個，基本的 46 個就齊了。' },
  { key: 'dakuon', label: '濁音 が・ざ・だ・ば行', type: 'dakuon', rows: null, note: '清音右上加兩點，例如 か（ka）變 が（ga）。' },
  { key: 'handakuon', label: '半濁音 ぱ行', type: 'handakuon', rows: null, note: '只有は行，右上加小圈，は（ha）變 ぱ（pa）。' },
  { key: 'youon', label: '拗音 きゃ・しゅ・ちょ…', type: 'youon', rows: null, note: '後面接小寫的 ゃゅょ，兩個字唸成一個音，き＋ゃ＝きゃ（kya）。' },
];
export const KANA_GROUP_KEYS = KANA_GROUPS.map((g) => g.key);

/**
 * 一個假名屬於哪一組
 */
export function kanaGroupOf(item) {
  return KANA_GROUPS.find((g) => g.type === item.type && (!g.rows || g.rows.includes(item.row)))?.key ?? null;
}

/**
 * 把假名表攤成「一個音 × 一套假名」一筆。
 * 欄位沿用題庫的 target，出題與練習紀錄就不必另開一條路。
 */
export function kanaEntries(kana) {
  return (kana || []).flatMap((item) => ['hiragana', 'katakana'].map((script) => ({
    ...item,
    id: `${item.id}-${script === 'hiragana' ? 'hira' : 'kata'}`,
    script,
    group: kanaGroupOf(item),
    target: item[script],
    note: kanaNote(item),
  })));
}

/**
 * 依模式與範圍篩出這一局的題池
 */
export function kanaFilter(entries, { script, groups }) {
  return entries.filter((e) => (script === 'mixed' || e.script === script) && groups.includes(e.group));
}

/**
 * 長得像、初學者最常認錯的字。同一列的字互為干擾選項的首選。
 */
const LOOKALIKES = [
  'あおぬめ', 'いりこ', 'うつらち', 'きさち', 'くへし', 'けはほに', 'すむ', 'たなに', 'ねれわ',
  'ぬめ', 'まもほよ', 'るろそ', 'ゆや', 'のめ', 'てそと',
  'アマヤ', 'イトノ', 'ウワフラ', 'クケタワ', 'エコユロヨ', 'オホネ', 'カヌク', 'キモサセ',
  'シツンソノ', 'スヌメナ', 'チテナ', 'ニミ', 'ハムレル', 'ヒセ', 'リソ', 'フヲラ', 'ルレ',
].map((text) => [...text]);

/**
 * 現在同音、羅馬音寫法卻不同的假名。
 * 看到「ji」選假名時 じ 與 ぢ 都說得通，同一題不能兩個都出現。
 */
const SAME_SOUND = [['o', 'wo'], ['ji', 'di'], ['zu', 'du']];
const soundOf = (romaji) => SAME_SOUND.find((set) => set.includes(romaji))?.[0] ?? romaji;

/**
 * 外形的主體：去掉濁點與半濁點，拗音取大的那個字（きゃ → き、ガ → カ）
 */
const shapeOf = (glyph) => [...glyph.normalize('NFD')][0];

/**
 * 字數不同（シ 與 シャ）一眼就分得出來，不算像
 */
function looksAlike(a, b) {
  if (a.target.length !== b.target.length) return false;
  const x = shapeOf(a.target);
  const y = shapeOf(b.target);
  return x === y || LOOKALIKES.some((set) => set.includes(x) && set.includes(y));
}

const DISTRACTORS = 3;

/**
 * 挑三個干擾選項，只從同一套假名、同一個範圍裡挑。
 *
 * 先放最多兩個長得像的（シ／ツ／ソ／ン），再補同一行或同一段的（か／き／く、か／さ／た），
 * 還不夠才用範圍內其他的。像的不放滿三個，是為了讓選項之間也分得出讀音的差別。
 */
export function kanaDistractors(pool, item, rng) {
  const taken = new Set([soundOf(item.romaji)]);
  const usable = pool.filter((e) => e.script === item.script && e.id !== item.id);
  const picked = [];
  const take = (list, limit) => {
    for (const e of shuffle(list, rng)) {
      if (picked.length >= limit) return;
      if (taken.has(soundOf(e.romaji))) continue;
      taken.add(soundOf(e.romaji));
      picked.push(e);
    }
  };
  take(usable.filter((e) => looksAlike(e, item)), DISTRACTORS - 1);
  take(usable.filter((e) => e.row === item.row || e.column === item.column), DISTRACTORS);
  take(usable, DISTRACTORS);
  if (picked.length < DISTRACTORS) throw new Error('題庫筆數不足：這個範圍的假名湊不出四個選項，請多選一個範圍。');
  return picked;
}

/**
 * 唸法或用法跟表面規律不同的假名，作答後提醒
 */
const SPECIAL = {
  shi: '照規律應該是 si，實際唸成 shi。',
  chi: '照規律應該是 ti，實際唸成 chi。',
  tsu: '照規律應該是 tu，實際唸成 tsu。',
  fu: '照規律應該是 hu，實際唸成 fu。',
  ha: '當助詞（標示主題的 は）時唸成 wa。',
  he: '當助詞（標示方向的 へ）時唸成 e。',
  wo: '和 お 同音，現在幾乎只當助詞用（標示動作的對象）。',
  ji: '和 ぢ 同音，一般都寫 じ。',
  zu: '和 づ 同音，一般都寫 ず。',
  di: '和 じ 同音，實際唸 ji；寫成 di 是為了跟 じ 區分，也是電腦打字時的拼法。',
  du: '和 ず 同音，實際唸 zu；寫成 du 是為了跟 ず 區分，也是電腦打字時的拼法。',
  n: '不跟母音，是單獨的鼻音，不會出現在詞的開頭。',
};

/**
 * 作答後的解說：兩套寫法、羅馬音、例字，有特殊唸法再補一句
 */
export function kanaNote(item) {
  const special = Object.prototype.hasOwnProperty.call(SPECIAL, item.romaji) ? SPECIAL[item.romaji] : '';
  return `平假名 ${item.hiragana}　片假名 ${item.katakana}　羅馬音 ${item.romaji}　例：${item.exampleWord}（${item.exampleZh}）。${special}`;
}

/**
 * 產生一題五十音選擇題。
 *
 * 方向沿用全站的 target2zh／zh2target：看假名選羅馬音是 target2zh，反過來是 zh2target，
 * 學習紀錄的能力 key 因此不需要新增任何格式。
 * speakText 是假名本身；看假名選羅馬音時唸出來就是答案，畫面層要等作答後才給朗讀。
 */
export function buildKanaQuestion(item, pool, { direction, rng }) {
  const [promptField, optionField] = direction === 'target2zh' ? ['target', 'romaji'] : ['romaji', 'target'];
  const options = shuffle(
    [item, ...kanaDistractors(pool, item, rng)].map((e) => ({ text: e[optionField], isCorrect: e.id === item.id })),
    rng
  );
  return {
    kind: 'choice',
    sourceId: item.id,
    direction,
    kanaScript: item.script,
    prompt: item[promptField],
    promptLang: direction === 'target2zh' ? 'ja' : 'romaji',
    optionLang: direction === 'target2zh' ? 'romaji' : 'ja',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    speakText: item.target,
    note: item.note,
    answeredIndex: null,
  };
}
