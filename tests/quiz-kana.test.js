/**
 * 隱藏漢字模式。
 *
 * 這個模式的價值全繫在一件事上：畫面上真的不能出現漢字。
 * 漏掉任何一條路徑——選項、題面、填空的候選詞——那一題就洩了題，
 * 而且是靜靜地洩，畫面看起來完全正常。所以每一條路徑都各驗一次。
 *
 * 另一半是它不能弄壞別的東西：朗讀仍要送假名、關掉時要與原本一模一樣、
 * 換成假名之後不能生出兩個都對的選項。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasKanji, kanaText, kanaItem, kanaPool } from '../assets/js/core/kana.js';
import {
  buildSession,
  pickDistractors,
  supportsHideKanji,
} from '../assets/js/core/quiz-engine.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { sentences as jaSentences } from '../assets/js/data/ja/sentences.js';
import { scenes as jaScenes } from '../assets/js/data/ja/scenes.js';
import { readings as jaReadings } from '../assets/js/data/ja/readings.js';

const KANJI = /[々㐀-䶿一-鿿]/;

/**
 * 固定序列的假亂數，讓同一組設定每次都抽到同一批題目
 */
function seeded() {
  let n = 0;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

const ja = (over = {}) =>
  buildSession({
    lang: 'ja',
    words: jaWords,
    sentences: jaSentences,
    scenes: jaScenes,
    readings: jaReadings,
    count: 30,
    rng: seeded(),
    ...over,
  });

/* ── kanaText 的三條規則 ─────────────────────────────────── */

test('hasKanji：認得漢字與疊字符，不把假名當漢字', () => {
  assert.equal(hasKanji('寿司'), true);
  assert.equal(hasKanji('ご飯'), true, '混在假名裡的一個漢字也算');
  assert.equal(hasKanji('人々'), true, '疊字符「々」要算進去');
  assert.equal(hasKanji('コーヒー'), false);
  assert.equal(hasKanji('たべます'), false);
  assert.equal(hasKanji(''), false);
  assert.equal(hasKanji(undefined), false);
});

test('kanaText：有漢字就換成 reading', () => {
  assert.equal(kanaText({ target: '寿司', reading: 'すし' }), 'すし');
  assert.equal(kanaText({ target: 'ご飯', reading: 'ごはん' }), 'ごはん');
});

test('kanaText：沒有漢字的詞維持原樣，不會被 reading 蓋掉', () => {
  /* コーヒー 的 reading 是全平假名的 こーひー，換過去就成了沒人這樣寫的日文 */
  assert.equal(kanaText({ target: 'コーヒー', reading: 'こーひー' }), 'コーヒー');
  assert.equal(kanaText({ target: 'たべます', reading: 'たべます' }), 'たべます');
});

test('kanaText：沒有 reading 時退回 target，不會回傳空值', () => {
  assert.equal(kanaText({ target: '寿司' }), '寿司');
  assert.equal(kanaText({ target: '寿司', reading: '' }), '寿司');
});

test('kanaItem：句子連同每一塊 chunk 一起換', () => {
  const item = kanaItem({
    target: '私は本を読みます',
    reading: 'わたしはほんをよみます',
    chunks: [
      { role: 'subject', target: '私', reading: 'わたし' },
      { role: 'particle', target: 'は' },
      { role: 'object', target: '本', reading: 'ほん' },
    ],
  });
  assert.equal(item.target, 'わたしはほんをよみます');
  assert.deepEqual(item.chunks.map((c) => c.target), ['わたし', 'は', 'ほん']);
  assert.equal(item.chunks[0].role, 'subject', 'chunk 的其他欄位要原封不動');
});

test('kanaItem 與 kanaPool 不會改到原始題庫', () => {
  const original = { target: '寿司', reading: 'すし', chunks: [{ target: '寿司', reading: 'すし' }] };
  kanaPool([original]);
  assert.equal(original.target, '寿司');
  assert.equal(original.chunks[0].target, '寿司');
});

test('kanaText 保留 reading 欄位，朗讀才不會跟著變', () => {
  const item = kanaItem({ target: '寿司', reading: 'すし' });
  assert.equal(item.reading, 'すし');
});

/* ── 哪些題源支援 ────────────────────────────────────────── */

test('supportsHideKanji：只有換得掉的四種題源支援', () => {
  for (const source of ['words', 'sentences', 'mixed', 'cloze']) {
    assert.equal(supportsHideKanji(source), true, `${source} 應該支援`);
  }
  for (const source of ['scene', 'reading']) {
    assert.equal(supportsHideKanji(source), false, `${source} 沒有假名版，不該宣稱支援`);
  }
});

/* ── 真正的題目裡不能出現漢字 ────────────────────────────── */

test('單字題（中翻日）：選項一個漢字都沒有', () => {
  const session = ja({ source: 'words', direction: 'zh2target', hideKanji: true });
  for (const q of session.questions) {
    for (const option of q.options) {
      assert.ok(!KANJI.test(option.text), `選項出現漢字：${option.text}`);
    }
  }
});

test('單字題（日翻中）：題面一個漢字都沒有', () => {
  const session = ja({ source: 'words', direction: 'target2zh', hideKanji: true });
  for (const q of session.questions) {
    assert.ok(!KANJI.test(q.prompt), `題面出現漢字：${q.prompt}`);
  }
});

test('句型題：整句選項一個漢字都沒有', () => {
  const session = ja({ source: 'sentences', direction: 'zh2target', hideKanji: true });
  for (const q of session.questions) {
    for (const option of q.options) {
      assert.ok(!KANJI.test(option.text), `選項出現漢字：${option.text}`);
    }
  }
});

test('混合題：兩種方向的日文那一側都不出現漢字', () => {
  const session = ja({ source: 'mixed', direction: 'mixed', hideKanji: true });
  let checked = 0;
  for (const q of session.questions) {
    /* 中文那一側本來就是漢字，只驗日文那一側 */
    if (q.promptLang === 'ja') {
      assert.ok(!KANJI.test(q.prompt), `題面出現漢字：${q.prompt}`);
      checked++;
    }
    if (q.optionLang === 'ja') {
      for (const option of q.options) {
        assert.ok(!KANJI.test(option.text), `選項出現漢字：${option.text}`);
      }
      checked++;
    }
  }
  assert.ok(checked > 0, '這一局沒有任何日文那一側可驗，測試本身失去意義');
});

test('填空題：句子本體與候選詞都不出現漢字', () => {
  const session = ja({ source: 'cloze', hideKanji: true });
  for (const q of session.questions) {
    for (const seg of q.segments) {
      if (seg.type === 'text') assert.ok(!KANJI.test(seg.text), `句子出現漢字：${seg.text}`);
    }
    for (const word of q.bank) {
      assert.ok(!KANJI.test(word), `候選詞出現漢字：${word}`);
    }
    for (const blank of q.blanks) {
      assert.ok(!KANJI.test(blank.answer), `正解出現漢字：${blank.answer}`);
    }
  }
});

test('填空題：正解仍在候選詞裡，換成假名沒有讓題目變成無解', () => {
  const session = ja({ source: 'cloze', hideKanji: true });
  for (const q of session.questions) {
    for (const blank of q.blanks) {
      assert.ok(q.bank.includes(blank.answer), `${q.sourceId} 的正解「${blank.answer}」不在候選詞裡`);
    }
  }
});

/* ── 不能弄壞的東西 ──────────────────────────────────────── */

test('關掉時與原本完全一樣', () => {
  for (const source of ['words', 'sentences', 'cloze']) {
    const off = ja({ source, hideKanji: false });
    const never = ja({ source });
    assert.deepEqual(off, never, `${source} 在關掉時不該與沒有這個參數時有任何差異`);
  }
});

test('情境題與閱讀題開了也不變——它們沒有假名版，寧可照舊也不要半套', () => {
  for (const source of ['scene', 'reading']) {
    const on = ja({ source, hideKanji: true });
    const off = ja({ source, hideKanji: false });
    assert.deepEqual(on, off, `${source} 不該被隱藏漢字影響`);
  }
});

test('朗讀送出去的仍然是假名，沒有被換字影響', () => {
  const session = ja({ source: 'words', direction: 'target2zh', hideKanji: true });
  const byId = new Map(jaWords.map((w) => [w.id, w]));
  for (const q of session.questions) {
    assert.equal(q.speakText, byId.get(q.sourceId).reading);
  }
});

test('英文開了也沒事——沒有漢字可換，等於沒開', () => {
  const session = buildSession({
    lang: 'en',
    words: [
      { id: 'en-w-001', zh: '蘋果', target: 'apple', reading: null, romaji: null, category: 'food', level: 1 },
      { id: 'en-w-002', zh: '書', target: 'book', reading: null, romaji: null, category: 'daily', level: 1 },
      { id: 'en-w-003', zh: '貓', target: 'cat', reading: null, romaji: null, category: 'animal', level: 1 },
      { id: 'en-w-004', zh: '狗', target: 'dog', reading: null, romaji: null, category: 'animal', level: 1 },
    ],
    sentences: [],
    source: 'words',
    hideKanji: true,
    count: 4,
    rng: seeded(),
  });
  const shown = session.questions.flatMap((q) => q.options.map((o) => o.text));
  assert.deepEqual([...new Set(shown)].sort(), ['apple', 'book', 'cat', 'dog'], '英文選項不該被動到');
});

/* ── 同音詞不能變成兩個都對 ──────────────────────────────── */

test('pickDistractors：題面相同的項目要排除，否則兩個選項都對', () => {
  /* 換成假名之後「橋」與「箸」都是はし，題面一樣就分不出該選哪個 */
  const pool = [
    { id: 'ja-w-001', zh: '橋', target: 'はし', category: 'city', level: 1 },
    { id: 'ja-w-002', zh: '筷子', target: 'はし', category: 'food', level: 1 },
    { id: 'ja-w-003', zh: '山', target: 'やま', category: 'nature', level: 1 },
    { id: 'ja-w-004', zh: '河', target: 'かわ', category: 'nature', level: 1 },
    { id: 'ja-w-005', zh: '海', target: 'うみ', category: 'nature', level: 1 },
  ];
  const picked = pickDistractors(pool, pool[0], 'zh', seeded(), null, 'target');
  assert.ok(!picked.some((p) => p.id === 'ja-w-002'), '同音的「筷子」不該被選為干擾選項');
  assert.equal(picked.length, 3);
});

test('日翻中在隱藏漢字下不會出現題面相同的兩個答案', () => {
  const session = ja({ source: 'words', direction: 'target2zh', hideKanji: true, count: 200 });
  const byKana = new Map();
  for (const w of jaWords) {
    const k = hasKanji(w.target) ? w.reading || w.target : w.target;
    if (!byKana.has(k)) byKana.set(k, new Set());
    byKana.get(k).add(w.zh);
  }
  for (const q of session.questions) {
    const alsoCorrect = q.options.filter((o) => byKana.get(q.prompt)?.has(o.text));
    assert.equal(alsoCorrect.length, 1, `「${q.prompt}」有 ${alsoCorrect.length} 個選項都對`);
  }
});

test('選項彼此不重複，換成假名之後也一樣', () => {
  for (const direction of ['zh2target', 'target2zh']) {
    const session = ja({ source: 'words', direction, hideKanji: true, count: 200 });
    for (const q of session.questions) {
      const texts = q.options.map((o) => o.text);
      assert.equal(new Set(texts).size, texts.length, `選項重複：${texts.join(' / ')}`);
    }
  }
});
