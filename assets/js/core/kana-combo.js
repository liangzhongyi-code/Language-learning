/**
 * 五十音的進階題：組合讀法。
 *
 * 單一假名背熟之後，真正會卡住的是「兩個假名放在一起，唸法跟一個一個唸不一樣」：
 *   拗音　き＋小ょ 合成一個音 kyo，不是 ki-yo；
 *   促音　小っ 不發音，停一拍，下一個子音寫兩次：きって kitte；
 *   長音　ー，以及 お段＋う、え段＋い、同母音連寫，都是把前一個音拉長：がっこう 唸 gakkō。
 *
 * 題目全部來自 N5 單字題庫（reading／romaji 欄位），不另外造一份詞表：
 * 練到的詞之後在單字題還會再見到。干擾選項不是隨便抽別的詞，
 * 而是把正解照初學者最常犯的錯改一處——漏掉っ、把小ょ看成大よ、少拉一拍——
 * 選錯時看得出自己是哪一條規則沒掌握。
 *
 * 另一個方向是看漢字選讀音：漢字沒辦法從字形推出唸法，只能一個詞一個詞記，
 * 這裡用同樣的錯誤改法出選項，順便複習組合規則。
 */

import { shuffle } from './shuffle.js';
import { hasKanji } from './kana.js';

/**
 * 三條組合規則。note 是設定畫面與對照表頁給零基礎的人看的說明。
 */
export const COMBO_RULES = [
  { key: 'youon', label: '拗音 小ゃゅょ', note: '「き＋小ょ」合成一個音 kyo，只佔一拍，不唸成 ki-yo。' },
  { key: 'sokuon', label: '促音 小っ', note: '小っ 本身不發音，停頓一拍，下一個子音寫兩次：きって 是 kitte。' },
  { key: 'chouon', label: '長音 ー・おう・えい', note: '把前一個音拉長一拍：コーヒー 是 koohii；お段後面的う、え段後面的い 也是拉長，がっこう 實際唸 gakkō。' },
];
export const COMBO_RULE_KEYS = COMBO_RULES.map((r) => r.key);

/* ── 假名轉羅馬音 ───────────────────────────────────────────
   與單字題庫產生 romaji 的工具（openspec/tools/kana-romaji.mjs）同一套規則：
   照字母一個一個轉，長音的う／い 照寫，ー 重複前一個母音，ん 接母音加隔音符。
   出題時只收「這裡轉出來與題庫 romaji 一致」的詞，兩邊不會各說各話。 */

const BASE = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
};

/**
 * 拗音與片假名外來音：兩個字合成一個音
 */
const YOUON = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  てぃ: 'ti', でぃ: 'di', ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
};

const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/**
 * 把假名切成一拍一拍：拗音兩個字算一拍，其餘一個字一拍。
 * 每一拍帶著平假名寫法與羅馬音，ー 與 っ 的羅馬音由前後文決定，這裡先留空。
 */
function tokenize(kana) {
  const src = toHira(String(kana || ''));
  const out = [];
  for (let i = 0; i < src.length;) {
    const pair = src.slice(i, i + 2);
    if (YOUON[pair]) {
      out.push({ text: pair, romaji: YOUON[pair] });
      i += 2;
    } else {
      out.push({ text: src[i], romaji: BASE[src[i]] ?? null });
      i += 1;
    }
  }
  return out;
}

/**
 * 假名轉羅馬音。不認得的字回 null，呼叫端據此把詞排除。
 */
export function kanaToRomaji(kana) {
  const tokens = tokenize(kana);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const { text, romaji } = tokens[i];
    const next = tokens[i + 1]?.romaji || '';
    if (text === 'っ') {
      if (!next || 'aiueon'.includes(next[0])) return null;
      out += next.startsWith('ch') ? 't' : next[0];
    } else if (text === 'ー') {
      const last = out.slice(-1);
      if (!'aiueo'.includes(last) || !last) return null;
      out += last;
    } else if (text === 'ん') {
      out += next && 'aiueoy'.includes(next[0]) ? "n'" : 'n';
    } else if (romaji === null) {
      return null;
    } else {
      out += romaji;
    }
  }
  return out || null;
}

/* ── 找出詞裡的組合 ─────────────────────────────────────── */

const vowelOf = (token) => (token && token.romaji ? token.romaji.slice(-1) : '');

/**
 * 這一拍是不是把前一拍拉長：ー，或 お段＋う、え段＋い、同母音連寫。
 * 動詞結尾的う（おもう、かう）是活用語尾，唸得出 u，不算長音。
 */
function isLengthener(tokens, i, pos) {
  const token = tokens[i];
  const before = vowelOf(tokens[i - 1]);
  if (i === 0 || !before || tokens[i - 1].text === 'っ' || tokens[i - 1].text === 'ん') return false;
  if (token.text === 'ー') return true;
  if (pos === 'verb' && i === tokens.length - 1) return false;
  const pairs = { a: 'あ', i: 'い', u: 'う', e: 'えい', o: 'おう' };
  return token.text.length === 1 && 'あいうえお'.includes(token.text) && pairs[before].includes(token.text);
}

/**
 * 一個詞裡每一處組合：哪一條規則、在第幾拍
 */
export function comboSpots(kana, pos = null) {
  const tokens = tokenize(kana);
  const spots = [];
  tokens.forEach((token, i) => {
    if (token.text.length === 2) spots.push({ rule: 'youon', at: i });
    else if (token.text === 'っ') spots.push({ rule: 'sokuon', at: i });
    else if (isLengthener(tokens, i, pos)) spots.push({ rule: 'chouon', at: i });
  });
  return spots;
}

/* ── 題庫 ──────────────────────────────────────────────── */

const KATAKANA_WORD = /^[ァ-ヺー]+$/;
const HIRAGANA_WORD = /^[ぁ-ゖ]+$/;

/**
 * 把 N5 單字攤成組合題的題池。
 *
 * 片假名詞（外來語）直接考片假名寫法；其餘考平假名讀音。
 * 只收至少含一處組合、而且轉出的羅馬音與題庫一致的詞——
 * 不一致多半是助詞は（こんにちは 唸 wa），照字母教會教錯，寧可不出。
 * 每個詞出兩種 id：ja-kc-（看假名／看羅馬音）與 ja-kj-（看漢字選讀音），學習紀錄分開記。
 */
const entryCache = new WeakMap();

export function comboEntries(words) {
  /* 設定畫面每次重繪都會問一次，同一份單字陣列只算一遍 */
  if (Array.isArray(words) && entryCache.has(words)) return entryCache.get(words);
  const out = [];
  for (const word of words || []) {
    if (word.level !== 1 || typeof word.reading !== 'string' || typeof word.romaji !== 'string') continue;
    const num = /^ja-w-(\d+)$/.exec(word.id)?.[1];
    if (!num) continue;
    const katakana = KATAKANA_WORD.test(word.target);
    const kana = katakana ? word.target : word.reading;
    if (!katakana && (!HIRAGANA_WORD.test(kana) || /[ァ-ヺ]/.test(word.target))) continue;
    if (kanaToRomaji(kana) !== word.romaji) continue;
    const spots = comboSpots(kana, word.pos);
    if (!spots.length) continue;
    const entry = {
      id: `ja-kc-${num}`,
      wordId: word.id,
      script: katakana ? 'katakana' : 'hiragana',
      kana,
      reading: word.reading,
      romaji: word.romaji,
      target: word.target,
      zh: word.zh,
      pos: word.pos,
      rules: COMBO_RULE_KEYS.filter((key) => spots.some((s) => s.rule === key)),
    };
    if (comboDistractors(entry, 'kana', () => 0.5).length < DISTRACTORS) continue;
    out.push(entry);
    if (!katakana && hasKanji(word.target) && comboDistractors(entry, 'kanji', () => 0.5).length >= DISTRACTORS) {
      out.push({ ...entry, id: `ja-kj-${num}`, kanji: true });
    }
  }
  if (Array.isArray(words)) entryCache.set(words, out);
  return out;
}

/**
 * 依模式、規則與方向篩出這一局的題池。
 * 看漢字選讀音只用 ja-kj- 那一份，讀音一律是平假名，模式不影響；其餘只用 ja-kc-。
 */
export function comboFilter(entries, { script, rules, kanji = false }) {
  return entries.filter((e) => Boolean(e.kanji) === Boolean(kanji)
    && (kanji || script === 'mixed' || e.script === script)
    && e.rules.some((r) => rules.includes(r)));
}

/* ── 干擾選項：把正解照常見錯誤改一處 ─────────────────────── */

const DISTRACTORS = 3;
const SMALL_TO_BIG = { ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ぃ: 'い', ぁ: 'あ', ぇ: 'え', ぉ: 'お', ぅ: 'う' };

/**
 * 清音與濁音互換（か⇄が、は⇄ば）。沒有對應的字回 null。
 */
function toggleVoice(ch) {
  const plain = ch.normalize('NFD').replace(/[゙゚]/g, '');
  if (plain !== ch) return plain;
  const voiced = `${ch}゙`.normalize('NFC');
  return voiced.length === 1 ? voiced : null;
}

/**
 * 正解的各種錯誤版本，每個都帶著是犯了哪一條規則。
 * 規則類的錯誤排前面；只靠規則湊不滿三個時，才用清濁音或多加一拍補。
 */
function variantsOf(kana, katakana = false) {
  const tokens = tokenize(kana).map((t) => t.text);
  const spots = comboSpots(kana);
  const join = (list) => list.join('');
  const replaced = (i, text) => join(tokens.map((t, j) => (j === i ? text : t)));
  const out = [];
  for (const { rule, at } of spots) {
    const token = tokens[at];
    if (rule === 'sokuon') {
      out.push({ rule, text: replaced(at, '') });
      out.push({ rule, text: replaced(at, 'つ') });
    } else if (rule === 'youon') {
      out.push({ rule, text: replaced(at, token[0] + SMALL_TO_BIG[token[1]]) });
      out.push({ rule, text: replaced(at, token[0]) });
    } else {
      out.push({ rule, text: replaced(at, '') });
    }
  }
  /* 補位：清濁音互換、多一個っ、多拉一拍 */
  tokens.forEach((token, i) => {
    const voice = token.length === 1 ? toggleVoice(token) : null;
    if (voice) out.push({ rule: 'extra', text: replaced(i, voice) });
    const romaji = tokenize(token)[0]?.romaji || '';
    if (i > 0 && tokens[i - 1] !== 'っ' && tokens[i - 1] !== 'ん' && /^[kstpc]/.test(romaji)) {
      out.push({ rule: 'extra', text: replaced(i, `っ${token}`) });
    }
    if (i < tokens.length - 1 && /[oe]$/.test(romaji) && !['ん', 'っ'].includes(tokens[i + 1]) && !spots.some((s) => s.at === i + 1)) {
      out.push({ rule: 'extra', text: replaced(i, token + (katakana ? 'ー' : romaji.endsWith('o') ? 'う' : 'い')) });
    }
  });
  return out;
}

/**
 * 挑三個干擾選項。
 *
 * mode 是 kana（選項比羅馬音或假名寫法）或 kanji（選項是平假名讀音）。
 * 兩種都以「羅馬音不同」去重：羅馬音相同的兩個寫法（じ／ぢ）同時出現，兩個都說得通。
 * 規則類的錯誤輪流各取一個，避免三個選項都是同一種錯；不夠才用補位的。
 */
export function comboDistractors(item, mode, rng) {
  const base = mode === 'kanji' ? item.reading : item.kana;
  const katakana = mode !== 'kanji' && item.script === 'katakana';
  const taken = new Set([kanaToRomaji(base)]);
  const picked = [];
  const groups = new Map();
  for (const v of shuffle(variantsOf(base, katakana), rng)) {
    if (!v.text || v.text === base) continue;
    const text = katakana ? toKata(v.text) : v.text;
    if (katakana ? !KATAKANA_WORD.test(text) : !HIRAGANA_WORD.test(text)) continue;
    const romaji = kanaToRomaji(text);
    if (!romaji) continue;
    if (!groups.has(v.rule)) groups.set(v.rule, []);
    groups.get(v.rule).push({ text, romaji, rule: v.rule });
  }
  const order = [...groups.keys()].filter((k) => k !== 'extra');
  let added = true;
  while (picked.length < DISTRACTORS && added) {
    added = false;
    for (const key of order) {
      const list = groups.get(key);
      while (list.length) {
        const v = list.shift();
        if (taken.has(v.romaji)) continue;
        taken.add(v.romaji);
        picked.push(v);
        added = true;
        break;
      }
      if (picked.length >= DISTRACTORS) break;
    }
  }
  for (const v of groups.get('extra') || []) {
    if (picked.length >= DISTRACTORS) break;
    if (taken.has(v.romaji)) continue;
    taken.add(v.romaji);
    picked.push(v);
  }
  return picked;
}

/* ── 解說 ──────────────────────────────────────────────── */

/**
 * 一處組合的白話說明，例：「きょ：き＋小ょ 合成一個音 kyo」
 */
function spotNote(tokens, { rule, at }) {
  const token = tokens[at];
  const prev = tokens[at - 1];
  const next = tokens[at + 1];
  if (rule === 'youon') {
    return `${token.text}：${token.text[0]}＋小${token.text[1]} 合成一個音 ${token.romaji}，只佔一拍`;
  }
  if (rule === 'sokuon') {
    const consonant = next.romaji.startsWith('ch') ? 't' : next.romaji[0];
    return `っ：不發音，停頓一拍，所以下一個 ${next.text} 的子音寫兩次（${consonant}${next.romaji}）`;
  }
  const v = vowelOf(prev);
  if (token.text === 'ー') return `ー：把前面的 ${prev.text} 拉長一拍（${prev.romaji}${v}）`;
  if (token.text === 'う' && v === 'o') {
    return `${prev.text}う：お段後面的う不唸 u，而是把 o 拉長，實際唸 ${prev.romaji.slice(0, -1)}ō；羅馬音照字母寫 ${prev.romaji}u，打字也這樣打（英文常見的 shoyu、Tokyo 是把長音省掉的簡寫，照那樣唸就短了一拍）`;
  }
  if (token.text === 'い' && v === 'e') {
    return `${prev.text}い：え段後面的い通常把 e 拉長，實際唸 ${prev.romaji.slice(0, -1)}ē；羅馬音照字母寫 ${prev.romaji}i`;
  }
  return `${prev.text}${token.text}：同一個母音連著寫就是拉長，唸成長長的 ${v}`;
}

/**
 * 作答後的解說：這個詞是什麼、每一處組合怎麼唸；漢字題再補一句漢字讀音的事
 */
export function comboNote(item) {
  const tokens = tokenize(item.kana).map((t) => ({ ...t, text: item.script === 'katakana' ? toKata(t.text) : t.text }));
  /* ー 與 っ 沒有自己的羅馬音，說明裡要用到前後拍的羅馬音 */
  const notes = [...new Set(comboSpots(item.kana, item.pos).map((spot) => spotNote(tokens, spot)))];
  const head = item.kanji
    ? `${item.target} 讀作 ${item.reading}（${item.romaji}），意思是「${item.zh}」。漢字的唸法沒辦法從字形推出來，要連同整個詞一起記。`
    : `${item.kana}（${item.romaji}）${item.target !== item.kana ? `寫成漢字是 ${item.target}，` : ''}意思是「${item.zh}」。`;
  return `${head}${notes.join('。')}。`;
}

/**
 * 產生一題組合讀法選擇題。
 *
 * 方向沿用 target2zh／zh2target：看假名選羅馬音是 target2zh，看羅馬音選假名是 zh2target；
 * 看漢字選讀音也是 target2zh，靠 ja-kj- 的 id 與 ja-kc- 分開記。
 */
export function buildComboQuestion(item, { direction, rng }) {
  const kanji = Boolean(item.kanji);
  const dir = kanji ? 'target2zh' : direction;
  const distractors = comboDistractors(item, kanji ? 'kanji' : 'kana', rng);
  if (distractors.length < DISTRACTORS) throw new Error(`題庫筆數不足：${item.target} 湊不出四個選項。`);
  const answer = kanji ? item.reading : dir === 'target2zh' ? item.romaji : item.kana;
  const field = kanji ? 'text' : dir === 'target2zh' ? 'romaji' : 'text';
  const options = shuffle([
    { text: answer, isCorrect: true },
    ...distractors.map((d) => ({ text: d[field], isCorrect: false })),
  ], rng);
  return {
    kind: 'choice',
    sourceId: item.id,
    direction: dir,
    kanaKind: 'combo',
    kanaScript: kanji ? 'hiragana' : item.script,
    kanaKanji: kanji,
    kanaRules: item.rules,
    prompt: kanji ? item.target : dir === 'target2zh' ? item.kana : item.romaji,
    promptLang: kanji || dir === 'target2zh' ? 'ja' : 'romaji',
    optionLang: kanji || dir === 'zh2target' ? 'ja' : 'romaji',
    options,
    correctIndex: options.findIndex((o) => o.isCorrect),
    speakText: item.kana,
    note: comboNote(item),
    answeredIndex: null,
  };
}
