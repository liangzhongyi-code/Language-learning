/**
 * 漢字讀音題：看字選讀音、看讀音選字。
 *
 * 使用者的母語是繁體中文，字形與意思多半看得懂，卡住的是「日文怎麼唸」，
 * 所以題目只考讀音：一個字的音讀與訓讀合成一組，四組裡挑出屬於這個字的那組。
 * 用整組而不是單一讀音出題，是因為很多字共用讀音（日 と 火 都有 ひ），
 * 只給一個讀音會有兩個字都說得通。
 *
 * 寫法和繁體不同的字（学／學、気／氣）另外可以只挑出來練，因為那些字連「認得」都會卡。
 */

import { shuffle } from './shuffle.js';

export const KANJI_SCOPES = [
  { key: 'all', label: '全部', note: 'N5 常用漢字全部一起練。' },
  { key: 'diff', label: '寫法和繁體不同的', note: '只練日本寫法和繁體不一樣的字，例如 学（學）、気（氣）。' },
];
export const KANJI_SCOPE_KEYS = KANJI_SCOPES.map((s) => s.key);

const DISTRACTORS = 3;

/**
 * 一個字的讀音組，例：「音 ガク　訓 まな(ぶ)」
 */
export function kanjiReadingSet(item) {
  return [item.on?.length ? `音 ${item.on.join('・')}` : '', item.kun?.length ? `訓 ${item.kun.join('・')}` : '']
    .filter(Boolean).join('　');
}

/**
 * 依範圍篩題池
 */
export function kanjiFilter(items, { scope = 'all' } = {}) {
  return (items || []).filter((k) => scope !== 'diff' || k.char !== k.trad);
}

/**
 * 干擾選項從整個漢字表挑（不受範圍限制，否則「只練不同的」選項會太少），
 * 讀音組相同的字不能同時出現。先挑讀音有重疊的字——那才是真正會混淆的。
 */
export function kanjiDistractors(all, item, rng) {
  const own = kanjiReadingSet(item);
  const readings = new Set([...(item.on || []), ...(item.kun || []).map((r) => r.replace(/[()]/g, ''))]);
  const taken = new Set([own]);
  const picked = [];
  const usable = (all || []).filter((k) => k.id !== item.id && kanjiReadingSet(k));
  const overlaps = (k) => [...(k.on || []), ...(k.kun || []).map((r) => r.replace(/[()]/g, ''))].some((r) => readings.has(r));
  for (const list of [usable.filter(overlaps), usable]) {
    for (const k of shuffle(list, rng)) {
      if (picked.length >= DISTRACTORS) break;
      const set = kanjiReadingSet(k);
      if (taken.has(set)) continue;
      taken.add(set);
      picked.push(k);
    }
  }
  if (picked.length < DISTRACTORS) throw new Error('題庫筆數不足：漢字表湊不出四個選項。');
  return picked;
}

/**
 * 作答後的解說：意思、繁體對照、讀音、例詞
 */
export function kanjiNote(item) {
  const trad = item.char !== item.trad ? `繁體寫成 ${item.trad}${item.diff ? `，${item.diff}` : '。'}` : '寫法和繁體相同。';
  const examples = (item.examples || []).map((e) => `${e.word}（${e.reading}，${e.zh}）`).join('、');
  return `${item.char}：${item.meaning}。${trad}讀音：${kanjiReadingSet(item)}。例詞：${examples}。${item.note || ''}`;
}

/**
 * 產生一題漢字讀音題。
 *
 * target2zh＝看字選讀音、zh2target＝看讀音選字，沿用全站的方向 key，學習紀錄不需新格式。
 * 朗讀用第一個例詞的假名讀音：單獨一個漢字丟給語音引擎，唸出來的讀音不一定是你想聽的那個。
 */
export function buildKanjiQuestion(item, all, { direction, rng }) {
  const others = kanjiDistractors(all, item, rng);
  const field = direction === 'target2zh' ? kanjiReadingSet : (k) => k.char;
  const options = shuffle([item, ...others].map((k) => ({ text: field(k), isCorrect: k.id === item.id })), rng);
  return {
    kind: 'choice',
    sourceId: item.id,
    direction,
    kanjiChar: item.char,
    prompt: direction === 'target2zh' ? item.char : kanjiReadingSet(item),
    promptLang: direction === 'target2zh' ? 'ja' : 'reading',
    optionLang: direction === 'target2zh' ? 'reading' : 'ja',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    speakText: item.examples?.[0]?.reading || '',
    note: kanjiNote(item),
    answeredIndex: null,
  };
}
