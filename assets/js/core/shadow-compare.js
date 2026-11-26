/**
 * 跟讀比對：把語音辨識聽到的文字和原句比一比，算出像不像、哪幾個字沒對上。
 *
 * 語音辨識回來的是「它以為你說了什麼」，日文多半會轉成漢字（說 がっこう 回來 学校），
 * 所以同時跟原句寫法與假名讀音比，取比較像的那一個。
 * 這不是發音評分：辨識引擎會自動「修正」口音，能辨識出來只代表大致聽得懂，
 * 畫面上的說法要誠實，不能宣稱幫你打發音分數。
 */

/**
 * 比對前統一寫法：去掉標點與空白、全形轉半形、片假名轉平假名、英文轉小寫
 */
export function normalizeSpeech(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s。、，,．.！!？?「」『』（）()・…〜~ー－-]/g, (c) => (c === 'ー' ? c : ''))
    .toLowerCase();
}

/**
 * 最長共同子序列，回傳參照字串每個字有沒有被對上
 */
function alignment(reference, heard) {
  const a = [...reference];
  const b = [...heard];
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const matched = new Array(a.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      matched[i] = true;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return { chars: a, matched, common: table[0][0] };
}

/**
 * 像不像：共同字數同時除以兩邊長度取平均，多講或少講都會扣分
 */
function scoreOf(reference, heard) {
  const { chars, matched, common } = alignment(reference, heard);
  const lengths = [...reference].length + [...heard].length;
  return { score: lengths ? (2 * common) / lengths : 0, chars, matched };
}

/**
 * 比對一次跟讀。
 *
 * heard 可以是辨識引擎給的多個候選，取最像的那個。
 * 回傳 score（0～1）、verdict（good／close／retry）、拿來比的參照（target 或 reading），
 * 以及參照字串逐字的對上與否，畫面用它把沒對上的字標出來。
 */
export function compareSpeech({ heard, target, reading }) {
  const candidates = (Array.isArray(heard) ? heard : [heard]).map(normalizeSpeech).filter(Boolean);
  const references = [
    { kind: 'target', text: normalizeSpeech(target) },
    { kind: 'reading', text: normalizeSpeech(reading) },
  ].filter((r) => r.text);
  let best = { score: 0, kind: references[0]?.kind ?? 'target', chars: [...(references[0]?.text ?? '')], matched: [], heard: '' };
  for (const said of candidates) {
    for (const ref of references) {
      const result = scoreOf(ref.text, said);
      if (result.score > best.score) best = { ...result, kind: ref.kind, heard: said };
    }
  }
  if (!best.matched.length) best.matched = best.chars.map(() => false);
  const verdict = best.score >= 0.9 ? 'good' : best.score >= 0.6 ? 'close' : 'retry';
  return {
    score: Math.round(best.score * 100) / 100,
    verdict,
    reference: best.kind,
    heard: best.heard,
    chars: best.chars.map((ch, i) => ({ ch, ok: best.matched[i] })),
  };
}
