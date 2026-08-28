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
import { scenes as jaScenes } from '../assets/js/data/ja/scenes.js';
import { readings as jaReadings } from '../assets/js/data/ja/readings.js';
import { readings as enReadings } from '../assets/js/data/en/readings.js';

/**
 * 錯誤陣列轉成好讀的訊息，測試失敗時才看得出是哪一筆資料寫錯
 */
const report = (errors) =>
  errors.map((e) => `${e.id} · ${e.field}：${e.message}`).join('\n');

/**
 * 固定序列的假亂數，讓兩次抽題抽到同一批題目才比較得出差異
 */
function seeded() {
  let n = 0;
  return () => {
    n += 1;
    return ((n * 9301 + 49297) % 233280) / 233280;
  };
}

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
    { words: enWords, sentences: enSentences, readings: enReadings, letters },
    'en'
  );
  assert.equal(errors.length, 0, `\n${report(errors)}`);
});

test('日文題庫：validateDataset 零錯誤', () => {
  const errors = validateDataset(
    { words: jaWords, sentences: jaSentences, scenes: jaScenes, readings: jaReadings, kana },
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
  for (const [name, list] of Object.entries({ enWords, jaWords, enSentences, jaSentences })) {
    for (const field of ['target', 'zh']) {
      const values = list.map((w) => w[field]);
      const dups = values.filter((v, i) => values.indexOf(v) !== i);
      assert.deepEqual([...new Set(dups)], [], `${name} 的 ${field} 有重複：${[...new Set(dups)]}`);
    }
  }
});

/**
 * mixed 題源把單字與句子倒進同一個池子抽，
 * 兩邊各自不重複還不夠——跨過去撞到一樣要出雙正解。
 */
test('mixed 題源：單字與句子之間也不可有 target 或 zh 相同', () => {
  for (const [lang, words, sentences] of [
    ['en', enWords, enSentences],
    ['ja', jaWords, jaSentences],
  ]) {
    for (const field of ['target', 'zh']) {
      const wordValues = new Set(words.map((w) => w[field]));
      const clash = sentences.filter((s) => wordValues.has(s[field])).map((s) => `${s.id}「${s[field]}」`);
      assert.deepEqual(clash, [], `${lang} 的句子 ${field} 與單字相撞：${clash.join('、')}`);
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

/* ── 情境題 ───────────────────────────────────────────────── */

test('情境題：每一題的四個選項都不重複，而且一定包含正解', () => {
  for (const s of jaScenes) {
    assert.ok(s.options.length >= 4, `${s.id} 選項不足四個`);
    assert.equal(new Set(s.options).size, s.options.length, `${s.id} 選項有重複`);
    assert.ok(s.options.includes(s.answer), `${s.id} 的選項不含正解「${s.answer}」`);
  }
});

test('情境題：id 不重複，場合描述也不重複', () => {
  assert.deepEqual(findDuplicateIds(jaScenes), []);
  const scenesText = jaScenes.map((s) => `${s.scene}｜${s.ask}`);
  const dups = scenesText.filter((v, i) => scenesText.indexOf(v) !== i);
  assert.deepEqual([...new Set(dups)], [], `有兩題的場合與問法完全一樣：${[...new Set(dups)]}`);
});

/**
 * 情境題考的是「同樣的意思、不同的場合該用哪個字」，
 * 所以四個軸都要有題目——只練自稱不練敬語，等於只做了四分之一。
 */
test('情境題：四個考點軸都有題目', () => {
  const byAxis = countBy(jaScenes, 'axis');
  for (const axis of ['self', 'address', 'honorific', 'inout']) {
    assert.ok(byAxis[axis] >= 3, `${axis} 只有 ${byAxis[axis] || 0} 題，太少`);
  }
});

test('情境題：真的能出出一局，而且選項恰有一個正解', () => {
  const session = buildSession({
    lang: 'ja',
    words: jaWords,
    sentences: jaSentences,
    scenes: jaScenes,
    source: 'scene',
    count: 20,
  });

  assert.equal(session.questions.length, 20);
  assert.equal(new Set(session.questions.map((q) => q.sourceId)).size, 20, '有重複題目');

  for (const q of session.questions) {
    assert.equal(q.kind, 'choice');
    assert.ok(q.context && q.context.trim(), `${q.sourceId} 缺場合描述，這題無從判斷`);
    assert.ok(q.prompt && q.prompt.trim(), `${q.sourceId} 缺問題`);
    assert.equal(q.options.filter((o) => o.isCorrect).length, 1, `${q.sourceId} 正解不是恰好一個`);
    assert.equal(new Set(q.options.map((o) => o.text)).size, q.options.length, `${q.sourceId} 選項重複`);
    assert.ok(q.note && q.note.trim(), `${q.sourceId} 缺解說`);
    assert.ok(q.speakText && q.speakText.trim(), `${q.sourceId} 缺朗讀文字`);
  }
});

test('情境題：一局跑完會寫進 ja:scene 這個統計分組', () => {
  const session = buildSession({
    lang: 'ja',
    words: jaWords,
    sentences: jaSentences,
    scenes: jaScenes,
    source: 'scene',
    count: 5,
  });
  for (let i = 0; i < session.questions.length; i++) answer(session, i, session.questions[i].correctIndex);

  assert.equal(isComplete(session), true);
  assert.equal(summarize(session).accuracy, 100);
  assert.equal(session.source, 'scene');
});

/* ── 閱讀短文 ─────────────────────────────────────────────── */

test('閱讀短文：每篇至少三題，每題四個選項且恰有一個正解', () => {
  for (const list of [jaReadings, enReadings]) {
    for (const r of list) {
      assert.ok(r.questions.length >= 3, `${r.id} 只有 ${r.questions.length} 題`);
      for (const q of r.questions) {
        assert.ok(q.options.length >= 4, `${q.id} 選項不足四個`);
        assert.equal(
          q.options.filter((o) => o.correct === true).length,
          1,
          `${q.id} 標記 correct 的選項不是恰好一個`
        );
        assert.ok(q.note && q.note.trim(), `${q.id} 缺解說`);
      }
    }
  }
});

/**
 * 問法與選項各有中文與目標語言兩版，兩邊都要完整。
 * 缺一邊的話，切到那個模式就會出現空白的題目或選項。
 */
test('閱讀短文：中文與目標語言兩版都齊全，而且各自不重複', () => {
  for (const list of [jaReadings, enReadings]) {
    for (const r of list) {
      for (const q of r.questions) {
        assert.ok(q.ask?.zh?.trim(), `${q.id} 缺中文問法`);
        assert.ok(q.ask?.target?.trim(), `${q.id} 缺目標語言問法`);

        for (const field of ['zh', 'target']) {
          const texts = q.options.map((o) => o[field]);
          assert.ok(texts.every((t) => t && t.trim()), `${q.id} 的 ${field} 選項有空的`);
          assert.equal(
            new Set(texts).size,
            texts.length,
            `${q.id} 的 ${field} 選項有重複：${texts.filter((t, i) => texts.indexOf(t) !== i)}`
          );
        }
      }
    }
  }
});

/**
 * 短文太短就沒有「讀完再回答」的價值，太長則一屏放不下。
 * 這個下限抓得很寬鬆，只是防止有人塞一句話進來當短文。
 */
test('閱讀短文：文章長度足夠，而且一定附中文翻譯', () => {
  for (const [name, list, min] of [
    ['日文', jaReadings, 80],
    ['英文', enReadings, 150],
  ]) {
    for (const r of list) {
      assert.ok(r.passage.length >= min, `${name} ${r.id} 只有 ${r.passage.length} 字，太短`);
      assert.ok(r.translation.trim(), `${name} ${r.id} 缺中文翻譯`);
      assert.ok(r.title.trim(), `${name} ${r.id} 缺標題`);
    }
  }
});

test('閱讀短文：題目 id 全域不重複', () => {
  for (const [name, list] of [
    ['ja', jaReadings],
    ['en', enReadings],
  ]) {
    const ids = list.flatMap((r) => r.questions.map((q) => q.id));
    const dups = ids.filter((v, i) => ids.indexOf(v) !== i);
    assert.deepEqual([...new Set(dups)], [], `${name} 的閱讀題 id 重複：${[...new Set(dups)]}`);
  }
});

/**
 * 閱讀題按篇抽而不是逐題抽。
 * 逐題抽的話十題會來自十篇不同的短文，每一題都要重讀一篇新文章，
 * 一局下來等於讀了十篇——那不是閱讀練習，是折磨。
 */
test('閱讀題：同一篇的題目排在一起，不會跳來跳去', () => {
  for (const [lang, readings] of [
    ['ja', jaReadings],
    ['en', enReadings],
  ]) {
    const session = buildSession({ lang, words: [], sentences: [], readings, source: 'reading', count: 10 });
    assert.equal(session.questions.length, 10);

    const order = session.questions.map((q) => q.passageId);
    const firstSeen = new Map();
    order.forEach((pid, i) => {
      if (!firstSeen.has(pid)) firstSeen.set(pid, i);
    });
    for (const [pid, start] of firstSeen) {
      const positions = order.map((p, i) => (p === pid ? i : -1)).filter((i) => i >= 0);
      const expected = positions.map((_, k) => start + k);
      assert.deepEqual(positions, expected, `${lang} 的 ${pid} 題目被打散了：${positions.join(',')}`);
    }
  }
});

test('閱讀題：每一題都帶著自己的短文與翻譯，且不掛朗讀鍵', () => {
  const session = buildSession({
    lang: 'ja',
    words: [],
    sentences: [],
    readings: jaReadings,
    source: 'reading',
    count: 8,
  });

  for (const q of session.questions) {
    assert.equal(q.kind, 'choice');
    assert.ok(q.context && q.context.length > 50, `${q.sourceId} 沒帶到短文`);
    assert.ok(q.translation && q.translation.trim(), `${q.sourceId} 沒帶到翻譯`);
    assert.ok(q.title && q.title.trim(), `${q.sourceId} 沒帶到標題`);
    assert.equal(q.optionLang, 'zh', '選項是中文，這樣考的才是讀懂沒有');
    assert.equal(q.speakText, null, '整篇短文不提供朗讀，漢字餵給語音引擎會唸錯');
    assert.equal(q.options.filter((o) => o.isCorrect).length, 1);
  }
});

/**
 * 開關要真的換掉題目與選項，而且是「一次換兩者」——
 * 「日文選項配中文題目」是沒有人想要的半吊子模式。
 */
test('閱讀題：切換問法語言時，題目與選項一起換', () => {
  const base = { lang: 'ja', words: [], sentences: [], readings: jaReadings, source: 'reading', count: 8 };
  const zh = buildSession({ ...base, readingAskIn: 'zh', rng: seeded() });
  const target = buildSession({ ...base, readingAskIn: 'target', rng: seeded() });

  assert.deepEqual(
    zh.questions.map((q) => q.sourceId),
    target.questions.map((q) => q.sourceId),
    '同一個亂數種子應該抽到同一批題目，才比較得出語言差異'
  );

  for (const [i, q] of zh.questions.entries()) {
    const t = target.questions[i];
    const source = jaReadings.flatMap((r) => r.questions).find((x) => x.id === q.sourceId);

    assert.equal(q.prompt, source.ask.zh);
    assert.equal(t.prompt, source.ask.target);
    assert.notEqual(q.prompt, t.prompt, `${q.sourceId} 兩個模式的題目一樣，開關等於沒作用`);

    assert.equal(q.promptLang, 'zh');
    assert.equal(q.optionLang, 'zh');
    assert.equal(t.promptLang, 'ja');
    assert.equal(t.optionLang, 'ja');

    /* 兩邊的正解必須指向同一個選項，只是換個語言寫 */
    const zhAnswer = q.options[q.correctIndex].text;
    const targetAnswer = t.options[t.correctIndex].text;
    const correct = source.options.find((o) => o.correct === true);
    assert.equal(zhAnswer, correct.zh);
    assert.equal(targetAnswer, correct.target);
  }
});

test('閱讀題：沒有指定語言時預設中文', () => {
  const s = buildSession({
    lang: 'en',
    words: [],
    sentences: [],
    readings: enReadings,
    source: 'reading',
    count: 4,
  });
  for (const q of s.questions) {
    assert.equal(q.optionLang, 'zh');
    assert.equal(q.speakText, null, '兩種模式都不掛朗讀鍵');
  }
});
