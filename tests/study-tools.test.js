/**
 * 漢字表、N5 文法點、閱讀逐句讀音三份手寫資料，以及它們的出題、查詢與紀錄。
 *
 * 手寫資料最怕的是「看起來對」：例詞的讀音跟題庫不一致、文法題兩個選項都說得通、
 * 讀音拼起來跟原文對不上。能用程式驗的全部逐筆驗，驗不了的（讀音本身對不對）寫在變更紀錄。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { kanji } from '../assets/js/data/ja/kanji.js';
import { grammarPoints } from '../assets/js/data/ja/grammar-points.js';
import { readings } from '../assets/js/data/ja/readings.js';
import { readingKana } from '../assets/js/data/ja/reading-kana.js';
import { words } from '../assets/js/data/ja/words.js';
import { words as n5 } from '../assets/js/data/catalog/ja-words-1.js';
import { kanjiReadingSet, kanjiFilter, buildKanjiQuestion } from '../assets/js/core/kanji-quiz.js';
import { buildGrammarQuestion, GRAMMAR_BLANK } from '../assets/js/core/grammar-quiz.js';
import { sentenceSegments, buildWordIndex, lookupWord, lookupKanji } from '../assets/js/core/reading-lookup.js';
import { buildSession } from '../assets/js/core/quiz-engine.js';
import { createQuizService } from '../assets/js/ui/platform/quiz-service.js';
import { createLearningStore } from '../assets/js/ui/platform/learning-store.js';
import { createMemoryRepository } from './helpers/memory-repository.js';
import { validateLearning } from '../assets/js/core/learning-schema.js';
import { loadDataset, CATALOG_META } from '../assets/js/data/catalog.js';

function seeded(seed = 7) {
  let n = seed;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

const HIRAGANA_READING = /^[ぁ-ゖー。、？！「」『』〜\s]+$/;

test('漢字表：id 對碼位、例詞全部出自 N5 題庫且讀音一致、音讀片假名、訓讀平假名', () => {
  assert.ok(kanji.length >= 100, `只有 ${kanji.length} 個字`);
  const byId = new Map(n5.map((w) => [w.id, w]));
  for (const k of kanji) {
    assert.equal(k.id, `ja-kanji-${k.char.codePointAt(0).toString(16)}`);
    assert.equal(k.level, 1);
    assert.equal(k.char === k.trad, k.diff === '', `${k.char} 的繁體與說明要一致`);
    assert.ok(k.on.every((r) => /^[ァ-ヺー]+$/.test(r)), `${k.char} 音讀`);
    assert.ok(k.kun.every((r) => /^[ぁ-ゖ]+(\([ぁ-ゖ]+\))?$/.test(r)), `${k.char} 訓讀`);
    assert.ok(k.on.length + k.kun.length > 0);
    assert.ok(k.examples.length >= 1 && k.examples.length <= 3);
    for (const e of k.examples) {
      const w = byId.get(e.wordId);
      assert.ok(w, `${k.char} 的例詞 ${e.wordId} 不在 N5 題庫`);
      assert.equal(e.word, w.target);
      assert.equal(e.reading, w.reading);
      assert.ok(e.word.includes(k.char));
    }
  }
  assert.equal(new Set(kanji.map((k) => k.char)).size, kanji.length);
  /* 讀音組相同的字（午／語 都只列 ゴ）允許存在，但下一個測試保證它們不會同題出現 */
  assert.ok(new Set(kanji.map(kanjiReadingSet)).size >= kanji.length - 3);
});

test('漢字題：四組讀音只有一組是對的；只練寫法不同的範圍照樣湊得滿選項', () => {
  for (const seed of [1, 2]) {
    for (const item of kanji) {
      for (const direction of ['target2zh', 'zh2target']) {
        const q = buildKanjiQuestion(item, kanji, { direction, rng: seeded(seed) });
        assert.equal(q.options.length, 4);
        assert.equal(new Set(q.options.map((o) => o.text)).size, 4);
        assert.equal(q.options.filter((o) => o.isCorrect).length, 1);
        assert.equal(q.options[q.correctIndex].text, direction === 'target2zh' ? kanjiReadingSet(item) : item.char);
        const sets = q.options.map((o) => kanjiReadingSet(direction === 'target2zh' ? { on: [], kun: [] } : kanji.find((k) => k.char === o.text)));
        if (direction === 'zh2target') assert.equal(new Set(sets).size, 4, `${item.char} 的選項有讀音組相同的字`);
        assert.match(q.speakText, /^[ぁ-ゖー]+$/, '朗讀用例詞的假名');
      }
    }
  }
  const diff = kanjiFilter(kanji, { scope: 'diff' });
  assert.ok(diff.length >= 4 && diff.every((k) => k.char !== k.trad));
  const quiz = buildSession({ lang: 'ja', kanji, source: 'kanji', kanjiScope: 'diff', direction: 'mixed', count: 100, rng: seeded() });
  assert.equal(quiz.questions.length, diff.length);
  assert.ok(quiz.questions.every((q) => /^ja-kanji-[0-9a-f]+$/.test(q.sourceId)));
  assert.throws(() => buildSession({ lang: 'ja', kanji, source: 'kanji', kanjiScope: 'nope' }), /漢字範圍/);
});

test('文法點：每題四個選項含正解、句子與讀音對得上，出題只抽該點自己的題', () => {
  assert.ok(grammarPoints.length >= 30);
  assert.deepEqual(grammarPoints.map((p) => p.id), grammarPoints.map((_, i) => `ja-g-${String(i + 1).padStart(3, '0')}`));
  for (const p of grammarPoints) {
    assert.ok(p.title && p.meaning && p.form && p.explain);
    assert.ok(p.examples.length >= 2 && p.examples.length <= 3);
    for (const e of p.examples) assert.match(e.reading, HIRAGANA_READING, `${p.id} 例句讀音`);
    assert.ok(p.quiz.length >= 2 && p.quiz.length <= 3);
    for (const q of p.quiz) {
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4);
      assert.ok(q.options.includes(q.answer));
      assert.match(q.reading, HIRAGANA_READING, `${p.id} 題目讀音`);
      assert.ok(q.zh && q.why);
    }
  }
  const point = grammarPoints[0];
  const seen = new Set();
  for (let seed = 1; seed < 20; seed++) {
    const q = buildGrammarQuestion(point, { rng: seeded(seed) });
    assert.ok(q.prompt.includes(GRAMMAR_BLANK));
    assert.equal(q.sourceId, point.id);
    assert.equal(q.direction, 'target2zh');
    assert.equal(q.options.filter((o) => o.isCorrect).length, 1);
    seen.add(q.prompt);
  }
  assert.equal(seen.size, point.quiz.length, '每次從該文法點的題目裡抽，幾題都抽得到');
});

test('閱讀讀音：每篇逐句拼回原文，標假名的片段替換後等於整句讀音', () => {
  assert.deepEqual(Object.keys(readingKana).sort(), readings.map((r) => r.id).sort());
  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const r of readings) {
    const list = readingKana[r.id];
    assert.equal(list.map((s) => s.text).join(''), r.passage, `${r.id} 切句後拼不回原文`);
    for (const s of list) {
      assert.match(s.reading, HIRAGANA_READING, `${r.id}：${s.text}`);
      const segments = sentenceSegments(s.text, s.ruby);
      assert.equal(segments.map((x) => x.text).join(''), s.text);
      assert.equal(segments.filter((x) => x.reading).length, s.ruby.length, `${s.text} 有 ruby 對不上位置`);
      assert.equal(toHira(segments.map((x) => x.reading || x.text).join('')), s.reading, `${s.text} 的 ruby 拼不出讀音`);
      assert.ok(!/[一-龯々]/.test(segments.filter((x) => !x.reading).map((x) => x.text).join('')), `${s.text} 有漢字沒標讀音`);
    }
  }
});

test('點詞查詢：活用形查得到原形，讀音不同的同形詞不採用，查不到退回漢字表', () => {
  const index = buildWordIndex(words);
  const at = (text, chunk) => text.indexOf(chunk);
  const find = (text, chunk, reading) => lookupWord(index, text, at(text, chunk), chunk, reading)?.target;
  assert.equal(find('七時半に家を出て、', '出', 'で'), '出る');
  assert.equal(find('駅から歩いて十分ぐらいです。', '歩', 'ある'), '歩く');
  assert.equal(find('まず新聞を読んで、', '読', 'よ'), '読む');
  assert.equal(find('それから朝ご飯を食べます。', '飯', 'はん'), 'ご飯');
  assert.equal(find('駅から歩いて十分ぐらいです。', '十分', 'じゅっぷん'), undefined, '十分（足夠）唸 じゅうぶん，不能拿來解釋十分鐘');
  assert.deepEqual(lookupKanji(kanji, '十分').map((k) => k.char), ['十', '分']);
});

test('漢字與文法作答寫進既有紀錄格式：recognition、ja:kanji／ja:grammar，v2 備份照常通過', async () => {
  const T0 = Date.UTC(2026, 10, 26, 1);
  const repository = createMemoryRepository({ now: () => T0 });
  const store = createLearningStore({ repository, now: () => T0 });
  const service = createQuizService({ store, lang: 'ja', now: () => T0 });
  const quizzes = [
    buildSession({ lang: 'ja', kanji, source: 'kanji', direction: 'mixed', count: 2, rng: seeded(3) }),
    buildSession({ lang: 'ja', grammarPoints, source: 'grammar', direction: 'target2zh', count: 2, rng: seeded(4) }),
  ];
  for (const quiz of quizzes) {
    const round = await service.start(quiz, { kanjiMode: 'show' });
    for (let i = 0; i < 2; i++) {
      await service.submit({ sessionId: round.sessionId, index: i, response: quiz.questions[i].correctIndex,
        reviewId: `${quiz.source}-${i}`, answeredAt: T0 + i });
    }
    const resumed = await service.resume(round.sessionId);
    assert.equal(resumed.quiz.source, quiz.source);
  }
  const { rows } = await store.read(['reviewEvents', 'stats']);
  const ids = Object.values(rows.reviewEvents).map((e) => e.sourceId);
  assert.equal(ids.filter((id) => /^ja-kanji-/.test(id)).length, 2);
  assert.equal(ids.filter((id) => /^ja-g-\d{3}$/.test(id)).length, 2);
  assert.ok(Object.values(rows.reviewEvents).every((e) => /:recognition:(target2zh|zh2target)$/.test(e.skillKey)));
  assert.equal(rows.stats['ja:kanji'].answered, 2);
  assert.equal(rows.stats['ja:grammar'].answered, 2);
  const { learning } = await store.exportBackup();
  assert.equal(learning.schemaVersion, 2);
  assert.deepEqual(validateLearning(learning), { ok: true, errors: [] });
});

test('題庫載入：漢字與文法點直接讀原始資料，筆數寫進索引；英文沒有', async () => {
  assert.deepEqual((await loadDataset('ja', 'kanji')).kanji, kanji);
  assert.deepEqual((await loadDataset('ja', 'grammar')).grammarPoints, grammarPoints);
  assert.equal(CATALOG_META.ja.kanji, kanji.length);
  assert.equal(CATALOG_META.ja.grammarPoints, grammarPoints.length);
  assert.equal(CATALOG_META.en.kanji, 0);
  await assert.rejects(loadDataset('en', 'kanji'), /沒有此題型/);
});
