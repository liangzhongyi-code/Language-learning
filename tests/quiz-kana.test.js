/**
 * 漢字的三種顯示方式：show / ruby / kana。
 *
 * kana 的價值全繫在一件事上：畫面上真的不能出現漢字。
 * 漏掉任何一條路徑——選項、題面、填空的候選詞——那一題就洩了題，
 * 而且是靜靜地洩，畫面看起來完全正常。所以每一條路徑都各驗一次。
 *
 * ruby 的價值則繫在「標對人」：漢字要標在對應的那一段假名上，
 * 標錯位置比不標更糟——使用者會照著錯的對應去記。
 *
 * 另一半是它們不能弄壞別的東西：朗讀仍要送假名、show 要與原本一模一樣、
 * 換成假名之後不能生出兩個都對的選項。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasKanji, kanaText, kanaItem, kanaPool, rubyPairs } from '../assets/js/core/kana.js';
import {
  buildSession,
  pickDistractors,
  hasKanaVersion,
  KANJI_MODES,
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

test('hasKanaVersion：只有換得掉的四種題源有假名版', () => {
  for (const source of ['words', 'sentences', 'mixed', 'cloze']) {
    assert.equal(hasKanaVersion(source), true, `${source} 應該支援`);
  }
  for (const source of ['scene', 'reading']) {
    assert.equal(hasKanaVersion(source), false, `${source} 沒有假名版，不該宣稱支援`);
  }
});

/* ── 真正的題目裡不能出現漢字 ────────────────────────────── */

test('單字題（中翻日）：選項一個漢字都沒有', () => {
  const session = ja({ source: 'words', direction: 'zh2target', kanjiMode: 'kana' });
  for (const q of session.questions) {
    for (const option of q.options) {
      assert.ok(!KANJI.test(option.text), `選項出現漢字：${option.text}`);
    }
  }
});

test('單字題（日翻中）：題面一個漢字都沒有', () => {
  const session = ja({ source: 'words', direction: 'target2zh', kanjiMode: 'kana' });
  for (const q of session.questions) {
    assert.ok(!KANJI.test(q.prompt), `題面出現漢字：${q.prompt}`);
  }
});

test('句型題：整句選項一個漢字都沒有', () => {
  const session = ja({ source: 'sentences', direction: 'zh2target', kanjiMode: 'kana' });
  for (const q of session.questions) {
    for (const option of q.options) {
      assert.ok(!KANJI.test(option.text), `選項出現漢字：${option.text}`);
    }
  }
});

test('混合題：兩種方向的日文那一側都不出現漢字', () => {
  const session = ja({ source: 'mixed', direction: 'mixed', kanjiMode: 'kana' });
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
  const session = ja({ source: 'cloze', kanjiMode: 'kana' });
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
  const session = ja({ source: 'cloze', kanjiMode: 'kana' });
  for (const q of session.questions) {
    for (const blank of q.blanks) {
      assert.ok(q.bank.includes(blank.answer), `${q.sourceId} 的正解「${blank.answer}」不在候選詞裡`);
    }
  }
});

/* ── 不能弄壞的東西 ──────────────────────────────────────── */

test('關掉時與原本完全一樣', () => {
  for (const source of ['words', 'sentences', 'cloze']) {
    const off = ja({ source, kanjiMode: 'show' });
    const never = ja({ source });
    assert.deepEqual(off, never, `${source} 在關掉時不該與沒有這個參數時有任何差異`);
  }
});

test('情境題與閱讀題開了也不變——它們沒有假名版，寧可照舊也不要半套', () => {
  for (const source of ['scene', 'reading']) {
    const on = ja({ source, kanjiMode: 'kana' });
    const off = ja({ source, kanjiMode: 'show' });
    assert.deepEqual(on, off, `${source} 不該被隱藏漢字影響`);
  }
});

test('朗讀送出去的仍然是假名，沒有被換字影響', () => {
  const session = ja({ source: 'words', direction: 'target2zh', kanjiMode: 'kana' });
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
    kanjiMode: 'kana',
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
  const session = ja({ source: 'words', direction: 'target2zh', kanjiMode: 'kana', count: 200 });
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
    const session = ja({ source: 'words', direction, kanjiMode: 'kana', count: 200 });
    for (const q of session.questions) {
      const texts = q.options.map((o) => o.text);
      assert.equal(new Set(texts).size, texts.length, `選項重複：${texts.join(' / ')}`);
    }
  }
});

/* ── 漢字標在假名上 ──────────────────────────────────────── */

test('KANJI_MODES 就是這三種', () => {
  assert.deepEqual(KANJI_MODES, ['show', 'ruby', 'kana']);
});

test('rubyPairs：單字給一對，沒有漢字的 ruby 留空', () => {
  assert.deepEqual(rubyPairs({ target: '寿司', reading: 'すし' }), [{ text: 'すし', ruby: '寿司' }]);
  assert.deepEqual(rubyPairs({ target: 'コーヒー', reading: 'こーひー' }), [
    { text: 'コーヒー', ruby: '' },
  ]);
});

test('rubyPairs：句子逐塊給，串起來就是整句', () => {
  const pairs = rubyPairs({
    target: '私は本を読みます',
    reading: 'わたしはほんをよみます',
    chunks: [
      { target: '私', reading: 'わたし' },
      { target: 'は' },
      { target: '本', reading: 'ほん' },
      { target: 'を' },
      { target: '読みます', reading: 'よみます' },
    ],
  });
  assert.deepEqual(pairs.map((p) => p.text), ['わたし', 'は', 'ほん', 'を', 'よみます']);
  assert.deepEqual(pairs.map((p) => p.ruby), ['私', '', '本', '', '読みます']);
});

test('ruby 模式：讀的是假名，漢字掛在對照裡而不是掛在文字上', () => {
  const session = ja({ source: 'words', direction: 'zh2target', kanjiMode: 'ruby' });
  let annotated = 0;
  for (const q of session.questions) {
    for (const option of q.options) {
      assert.ok(!KANJI.test(option.text), `選項本體不該有漢字：${option.text}`);
      assert.ok(Array.isArray(option.ruby), '目標語言的選項要帶漢字對照');
      if (option.ruby.some((p) => p.ruby)) annotated++;
    }
  }
  assert.ok(annotated > 0, '整局沒有任何一個選項標到漢字，這個模式等於沒生效');
});

test('ruby 模式：標註接回去就是原本的漢字寫法', () => {
  const session = ja({ source: 'sentences', direction: 'zh2target', kanjiMode: 'ruby' });
  const byId = new Map(jaSentences.map((s) => [s.id, s]));
  for (const q of session.questions) {
    const correct = q.options[q.correctIndex];
    const restored = correct.ruby.map((p) => p.ruby || p.text).join('');
    assert.equal(restored, byId.get(q.sourceId).target, `${q.sourceId} 的標註接不回原句`);
  }
});

test('ruby 模式：中文那一側不掛對照，畫面才不會多出空的標註格', () => {
  const session = ja({ source: 'words', direction: 'target2zh', kanjiMode: 'ruby' });
  for (const q of session.questions) {
    assert.ok(Array.isArray(q.promptRuby), '日文題面要有對照');
    for (const option of q.options) {
      assert.equal(option.ruby, null, '中文選項不該有對照');
    }
  }
});

test('ruby 模式的填空題：句子、候選詞、正解三處都帶對照', () => {
  const session = ja({ source: 'cloze', kanjiMode: 'ruby' });
  let annotated = 0;
  for (const q of session.questions) {
    assert.equal(q.bankRuby?.length ?? q.bank.length, q.bank.length, '對照要與候選詞一一對應');
    for (const seg of q.segments) {
      if (seg.type === 'text') assert.ok(!KANJI.test(seg.text), `句子本體不該有漢字：${seg.text}`);
    }
    for (const word of q.bank) assert.ok(!KANJI.test(word), `候選詞本體不該有漢字：${word}`);
    if (q.bankRuby?.some(Boolean)) annotated++;
  }
  assert.ok(annotated > 0, '整局的候選詞都沒標到漢字，這個模式等於沒生效');
});

test('ruby 模式的填空題：每張候選詞標的是自己的漢字', () => {
  const session = ja({ source: 'cloze', kanjiMode: 'ruby' });
  const byKana = new Map();
  for (const s of jaSentences) {
    for (const c of s.chunks || []) {
      const kana = kanaText(c);
      if (kana !== c.target) byKana.set(kana, c.target);
    }
  }
  for (const q of session.questions) {
    q.bank.forEach((text, i) => {
      const ruby = q.bankRuby?.[i];
      if (!ruby) return;
      assert.equal(ruby, byKana.get(text), `候選詞「${text}」標成了「${ruby}」`);
    });
  }
});

test('kana 模式不帶對照——那個模式的重點就是看不到漢字', () => {
  const session = ja({ source: 'words', direction: 'zh2target', kanjiMode: 'kana' });
  for (const q of session.questions) {
    for (const option of q.options) {
      assert.ok(!option.ruby, '純假名模式不該把漢字一起送到畫面層');
    }
  }
  const cloze = ja({ source: 'cloze', kanjiMode: 'kana' });
  for (const q of cloze.questions) {
    assert.equal(q.bankRuby, null);
    assert.ok(q.segments.every((s) => !s.ruby));
  }
});

test('show 模式不帶對照，三種模式的作答內容完全相同', () => {
  const modes = KANJI_MODES.map((kanjiMode) => ja({ source: 'cloze', kanjiMode }));
  const [show, ruby, kana] = modes;
  for (const q of show.questions) assert.equal(q.bankRuby, null);
  /* 換的是顯示，不是題目本身：抽到哪幾句、挖哪幾格、候選詞幾張都要一樣 */
  assert.deepEqual(
    modes.map((m) => m.questions.map((q) => `${q.sourceId}:${q.blanks.length}:${q.bank.length}`)),
    Array(3).fill(show.questions.map((q) => `${q.sourceId}:${q.blanks.length}:${q.bank.length}`))
  );
  /* ruby 與 kana 讀的是同一串假名，只差在有沒有把漢字一起帶著 */
  assert.deepEqual(
    ruby.questions.map((q) => q.bank),
    kana.questions.map((q) => q.bank)
  );
});
