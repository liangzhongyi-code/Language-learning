import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateDataset, findDuplicateIds } from '../assets/js/core/schema.js';
import { buildSession, answer } from '../assets/js/core/quiz-engine.js';
import { summarize, isComplete } from '../assets/js/core/stats.js';
import { CATEGORY_KEYS } from '../assets/js/data/shared/categories.js';

import { words as enWords } from '../assets/js/data/en/words.js';
import { sentences as enSentences } from '../assets/js/data/en/sentences.js';
import { letters } from '../assets/js/data/en/alphabet.js';
import { words as jaWords } from '../assets/js/data/ja/words.js';
import { sentences as jaSentences } from '../assets/js/data/ja/sentences.js';
import { kana } from '../assets/js/data/ja/kana.js';

/**
 * 錯誤陣列轉成好讀的訊息，測試失敗時才看得出是哪一筆資料寫錯
 */
const report = (errors) =>
  errors.map((e) => `${e.id} · ${e.field}：${e.message}`).join('\n');

/**
 * 統計某個欄位的值分佈
 */
function countBy(list, key) {
  const out = {};
  for (const item of list) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

/* ── 整體驗證 ─────────────────────────────────────────────── */

test('英文題庫：validateDataset 零錯誤', () => {
  const errors = validateDataset(
    { words: enWords, sentences: enSentences, letters },
    'en'
  );
  assert.equal(errors.length, 0, `\n${report(errors)}`);
});

test('日文題庫：validateDataset 零錯誤', () => {
  const errors = validateDataset(
    { words: jaWords, sentences: jaSentences, kana },
    'ja'
  );
  assert.equal(errors.length, 0, `\n${report(errors)}`);
});

test('全部題庫：無重複 id', () => {
  for (const [name, list] of Object.entries({
    enWords, enSentences, letters, jaWords, jaSentences, kana,
  })) {
    assert.deepEqual(findDuplicateIds(list), [], `${name} 有重複 id`);
  }
});

/* ── 規模下限 ─────────────────────────────────────────────── */

test('規模：英文單字 ≥ 60、句型 ≥ 20、字母 = 26', () => {
  assert.ok(enWords.length >= 60, `實際 ${enWords.length} 筆`);
  assert.ok(enSentences.length >= 20, `實際 ${enSentences.length} 筆`);
  assert.equal(letters.length, 26);
});

test('規模：日文單字 ≥ 60、句型 ≥ 20、假名 = 104', () => {
  assert.ok(jaWords.length >= 60, `實際 ${jaWords.length} 筆`);
  assert.ok(jaSentences.length >= 20, `實際 ${jaSentences.length} 筆`);
  assert.equal(kana.length, 104, `實際 ${kana.length} 筆`);
});

/* ── 干擾選項品質的保護 ───────────────────────────────────── */

test('每個用到的分類至少 4 筆，否則同類別干擾選項會退化', () => {
  for (const [name, list] of Object.entries({ enWords, jaWords })) {
    const counts = countBy(list, 'category');
    for (const [cat, n] of Object.entries(counts)) {
      assert.ok(n >= 4, `${name} 的分類 ${cat} 只有 ${n} 筆，至少要 4 筆`);
    }
    assert.ok(Object.keys(counts).length >= 8, `${name} 只用了 ${Object.keys(counts).length} 個分類`);
  }
});

test('分類代碼都在 CATEGORIES 之內', () => {
  for (const list of [enWords, jaWords, enSentences, jaSentences]) {
    for (const item of list) {
      assert.ok(CATEGORY_KEYS.includes(item.category), `未知分類 ${item.category}（${item.id}）`);
    }
  }
});

test('同一語言內不可有兩筆 target 或 zh 相同，否則選擇題會出現雙正解', () => {
  for (const [name, list] of Object.entries({ enWords, jaWords })) {
    for (const field of ['target', 'zh']) {
      const values = list.map((w) => w[field]);
      const dups = values.filter((v, i) => values.indexOf(v) !== i);
      assert.deepEqual([...new Set(dups)], [], `${name} 的 ${field} 有重複：${[...new Set(dups)]}`);
    }
  }
});

/* ── 英文字母表 ───────────────────────────────────────────── */

test('英文字母表：A 到 Z 依序且每筆都有 IPA 與例字', () => {
  const expected = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  assert.deepEqual(letters.map((l) => l.upper), expected);
  for (const l of letters) {
    assert.ok(l.ipa.trim(), `${l.upper} 缺 IPA`);
    assert.ok(l.exampleWord.trim(), `${l.upper} 缺例字`);
  }
});

/* ── 日文假名表 ───────────────────────────────────────────── */

test('假名表：四種類型的數量為 46 / 20 / 5 / 33', () => {
  const counts = countBy(kana, 'type');
  assert.equal(counts.seion, 46, `清音實際 ${counts.seion} 筆`);
  assert.equal(counts.dakuon, 20, `濁音實際 ${counts.dakuon} 筆`);
  assert.equal(counts.handakuon, 5, `半濁音實際 ${counts.handakuon} 筆`);
  assert.equal(counts.youon, 33, `拗音實際 ${counts.youon} 筆`);
});

test('假名表：romaji 不重複', () => {
  const values = kana.map((k) => k.romaji);
  assert.equal(new Set(values).size, values.length, '有重複的羅馬拼音');
});

test('假名表：清音涵蓋 あ か さ た な は ま や ら わ ん 十一行', () => {
  const rows = [...new Set(kana.filter((k) => k.type === 'seion').map((k) => k.row))];
  assert.deepEqual(rows.sort(), ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', 'ん'].sort());
});

test('假名表：濁音四行、半濁音一行', () => {
  const dak = [...new Set(kana.filter((k) => k.type === 'dakuon').map((k) => k.row))];
  const han = [...new Set(kana.filter((k) => k.type === 'handakuon').map((k) => k.row))];
  assert.deepEqual(dak.sort(), ['が', 'ざ', 'だ', 'ば'].sort());
  assert.deepEqual(han, ['ぱ']);
});

test('假名表：拗音涵蓋十一個子音行', () => {
  const rows = [...new Set(kana.filter((k) => k.type === 'youon').map((k) => k.row))];
  assert.deepEqual(
    rows.sort(),
    ['き', 'し', 'ち', 'に', 'ひ', 'み', 'り', 'ぎ', 'じ', 'び', 'ぴ'].sort()
  );
});

/* ── 日文句型的語言特徵 ───────────────────────────────────── */

test('日文句型：每一筆都至少有一個助詞區塊', () => {
  for (const s of jaSentences) {
    assert.ok(
      s.chunks.some((c) => c.role === 'particle'),
      `${s.id} 沒有任何助詞區塊`
    );
  }
});

test('日文句型：動詞或否定一律位於 chunks 陣列的最後', () => {
  for (const s of jaSentences) {
    const last = s.chunks.at(-1).role;
    assert.ok(
      ['verb', 'negation', 'adjective'].includes(last),
      `${s.id} 的最後一塊是 ${last}，日文句尾應為動詞、否定或形容詞述語`
    );
  }
});

test('日文句型：助詞的 zh 一律是空字串', () => {
  for (const s of jaSentences) {
    for (const c of s.chunks.filter((c) => c.role === 'particle')) {
      assert.equal(c.zh, '', `${s.id} 的助詞 ${c.target} 的 zh 應為空字串`);
    }
  }
});

/* ── 英文句型的語序落差 ───────────────────────────────────── */

test('英文句型：至少 8 筆的中英語序不同，語序標記才有東西可展示', () => {
  const differing = enSentences.filter((s) => {
    const byZh = [...s.chunks].sort((a, b) => a.zhIndex - b.zhIndex);
    return s.chunks.some((c, i) => c !== byZh[i]);
  });
  assert.ok(differing.length >= 8, `只有 ${differing.length} 筆語序不同`);
});

test('句型題庫：涵蓋足夠的句型種類', () => {
  assert.ok(new Set(enSentences.map((s) => s.patternId)).size >= 4);
  assert.ok(new Set(jaSentences.map((s) => s.patternId)).size >= 4);
});

/* ── 用真實題庫跑完整局（整合檢查） ───────────────────────── */

test('真實題庫：全部語言 × 題源 × 方向的組合都能出出一局完整的題', () => {
  const datasets = {
    en: { words: enWords, sentences: enSentences },
    ja: { words: jaWords, sentences: jaSentences },
  };

  for (const [lang, data] of Object.entries(datasets)) {
    for (const source of ['words', 'sentences', 'mixed']) {
      for (const direction of ['zh2target', 'target2zh', 'mixed']) {
        const label = `${lang}/${source}/${direction}`;
        const session = buildSession({ lang, ...data, source, direction, count: 20 });

        assert.equal(session.questions.length, 20, `${label} 題數不對`);
        assert.equal(
          new Set(session.questions.map((q) => q.sourceId)).size,
          20,
          `${label} 有重複題目`
        );

        for (const q of session.questions) {
          assert.equal(q.options.length, 4, `${label} ${q.sourceId} 選項不是四個`);
          assert.equal(
            q.options.filter((o) => o.isCorrect).length,
            1,
            `${label} ${q.sourceId} 正解不是恰好一個`
          );
          assert.equal(
            new Set(q.options.map((o) => o.text)).size,
            4,
            `${label} ${q.sourceId} 有重複選項：${q.options.map((o) => o.text)}`
          );
          assert.ok(q.prompt && q.prompt.trim(), `${label} ${q.sourceId} 題面為空`);
          assert.ok(q.speakText && q.speakText.trim(), `${label} ${q.sourceId} 缺朗讀文字`);
        }
      }
    }
  }
});

test('真實題庫：日文題目的朗讀文字用假名而不是漢字', () => {
  const session = buildSession({
    lang: 'ja',
    words: jaWords,
    sentences: [],
    source: 'words',
    direction: 'zh2target',
    count: jaWords.length,
  });
  const byId = new Map(jaWords.map((w) => [w.id, w]));
  for (const q of session.questions) {
    assert.equal(q.speakText, byId.get(q.sourceId).reading, `${q.sourceId} 應朗讀假名讀音`);
  }
});

test('真實題庫：跑滿一局並全部答對後統計正確', () => {
  const session = buildSession({
    lang: 'en',
    words: enWords,
    sentences: enSentences,
    source: 'mixed',
    direction: 'mixed',
    count: 15,
  });
  session.questions.forEach((q, i) => answer(session, i, q.correctIndex));

  const s = summarize(session);
  assert.equal(isComplete(session), true);
  assert.equal(s.total, 15);
  assert.equal(s.correct, 15);
  assert.equal(s.accuracy, 100);
  assert.deepEqual(s.wrongList, []);
});

test('真實題庫：答錯的題目會帶出正解，句子題另帶語序說明', () => {
  const session = buildSession({
    lang: 'en',
    words: enWords,
    sentences: enSentences,
    source: 'sentences',
    direction: 'zh2target',
    count: 5,
  });
  session.questions.forEach((q, i) => answer(session, i, (q.correctIndex + 1) % 4));

  const s = summarize(session);
  assert.equal(s.correct, 0);
  assert.equal(s.wrongList.length, 5);
  for (const w of s.wrongList) {
    assert.ok(w.correctText, '錯題必須帶出正解文字');
    assert.ok(w.chosenText, '錯題必須帶出使用者選的答案');
    assert.ok(w.note && w.note.trim(), '句子題的錯題必須附上語序說明');
  }
});
