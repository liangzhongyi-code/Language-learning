/**
 * 閱讀短文的逐句排版與點詞查詢。
 *
 * 句子的假名讀音是手寫的（data/ja/reading-kana.js），每個漢字片段帶著自己的讀音；
 * 這裡把一句切成「普通字」與「漢字片段」，漢字片段可以標假名、也可以點來查。
 *
 * 查詢從單字題庫找：片段開頭相同、而且跟句子接下來的字對得最長的那個詞。
 * 動詞與形容詞在句子裡是活用過的（起きます），題庫存的是辭書形（起きる），
 * 所以只要求「漢字部分完整對上」，後面的假名對到哪算到哪。
 * 題庫查不到（六時、三十分 這種數量詞）就退回漢字表，一個字一個字列出讀音。
 */

const KANA = /[ぁ-ゖァ-ヺー]/;
const isKana = (ch) => KANA.test(ch || '');

/**
 * 把一句切成片段。ruby 依出現順序列出漢字片段；找不到的片段當普通文字，不讓排版壞掉。
 */
export function sentenceSegments(text, ruby = []) {
  const segments = [];
  let cursor = 0;
  for (const r of ruby) {
    const at = text.indexOf(r.text, cursor);
    if (at < 0) continue;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), at: cursor });
    segments.push({ text: r.text, reading: r.reading, at });
    cursor = at + r.text.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), at: cursor });
  return segments;
}

/**
 * 以詞首字分桶，查詢時不必掃整個題庫
 */
export function buildWordIndex(words) {
  const index = new Map();
  for (const w of words || []) {
    const first = w.target?.[0];
    if (!first) continue;
    if (!index.has(first)) index.set(first, []);
    index.get(first).push(w);
  }
  return index;
}

const commonPrefix = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/**
 * 片段後面緊接的假名若不是助詞，就是送假名（出て、歩いて），這時該找動詞或形容詞，
 * 不能被同字的名詞（出、歩）搶走。
 */
const PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'か', 'ね', 'よ', 'ま', 'さ']);

/**
 * 從句子的 at 位置找題庫裡的詞。chunk 是這個位置的漢字片段，reading 是它在這句裡的讀音。
 * 前面緊貼著美化語的 お／ご 時（お茶、ご飯），連它一起試。
 * 讀音對不上的詞一律不採用：十分 在「十分ぐらい」唸 じゅっぷん，不能查成 じゅうぶん（足夠）。
 */
export function lookupWord(index, text, at, chunk, reading = '') {
  const after = text[at + chunk.length];
  const inflected = isKana(after) && !PARTICLES.has(after);
  const starts = [at];
  if (at > 0 && ['お', 'ご'].includes(text[at - 1])) starts.unshift(at - 1);
  let best = null;
  for (const start of starts) {
    const rest = text.slice(start);
    const need = at - start + chunk.length;
    for (const word of index.get(rest[0]) || []) {
      const common = commonPrefix(word.target, rest);
      if (common < need) continue;
      /* 題庫的詞比句子長時，多出來的部分必須是活用的假名，不能是另一個漢字 */
      if (common < word.target.length && !isKana(word.target[common])) continue;
      if (reading && !String(word.reading || '').includes(reading)) continue;
      const exact = common === word.target.length;
      const conjugates = ['verb', 'adjective'].includes(word.pos);
      const score = common * 10 + (exact ? 5 : 0) + (inflected ? (conjugates ? 8 : -8) : 0)
        - Math.abs(word.target.length - common) - (word.level || 0) * 0.01;
      if (!best || score > best.score) best = { word, score };
    }
  }
  return best?.word ?? null;
}

/**
 * 查不到詞時，片段裡每個漢字在漢字表裡的資料（沒收錄的字略過）
 */
export function lookupKanji(kanji, chunk) {
  const byChar = new Map((kanji || []).map((k) => [k.char, k]));
  return [...chunk].map((ch) => byChar.get(ch)).filter(Boolean);
}
