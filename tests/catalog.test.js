import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATALOG_META, loadWords, loadDataset } from '../assets/js/data/catalog.js';
import { words as ja } from '../assets/js/data/ja/words.js';
import { words as en } from '../assets/js/data/en/words.js';

for (const [lang, words] of [['ja', ja], ['en', en]]) {
  test(`catalog ${lang}: 完整與分級資料完全保留 ID、欄位及原順序`, async () => {
    assert.deepEqual(await loadWords(lang), words);
    assert.equal(CATALOG_META[lang].words, words.length);
    for (let level = 1; level <= 5; level++) {
      const selected = words.filter(w => w.level === level);
      assert.deepEqual(await loadWords(lang, { level }), selected);
      assert.equal(CATALOG_META[lang].wordsByLevel[level], selected.length);
    }
    for (const kind of ['sentences', 'scenes', 'readings']) {
      const rows = kind === 'scenes' && lang === 'en' ? []
        : (await import(`../assets/js/data/${lang}/${kind}.js`))[kind];
      const source = { sentences: 'sentences', scenes: 'scene', readings: 'reading' }[kind];
      assert.deepEqual((await loadDataset(lang, source))[kind], rows);
      assert.equal(CATALOG_META[lang][kind], rows.length);
      if (kind === 'readings') {
        const questions = rows.flatMap(p => p.questions.map(q => ({ ...q, level: p.level })));
        assert.equal(CATALOG_META[lang].readingQuestions, questions.length);
        for (let level = 1; level <= 5; level++) {
          assert.equal(CATALOG_META[lang].readingQuestionsByLevel[level], questions.filter(q => q.level === level).length);
        }
      }
    }
  });
}

test('J10/R09 catalog: JLPT 只有日文、按級別分檔、不帶審查欄位、題數以題目計', async () => {
  const { jlpt } = await import('../assets/js/data/ja/jlpt.js');
  const { jlptReading } = await import('../assets/js/data/ja/jlpt-reading.js');
  const { JLPT_KIND_KEYS, jlptKindKeyOf } = await import('../assets/js/core/jlpt-mondai.js');
  const strip = ({ sourceRef, edited, ...row }) => row;
  const all = await loadDataset('ja', 'jlpt');
  assert.deepEqual(all.jlpt, jlpt.map(strip));
  assert.deepEqual(all.jlptReading, jlptReading.map(strip));
  assert.ok([...all.jlpt, ...all.jlptReading].every(row => !('sourceRef' in row) && !('edited' in row)));
  const questions = [...jlpt, ...jlptReading.flatMap(set => set.questions.map(() => set))];
  assert.equal(CATALOG_META.ja.jlpt, questions.length);
  for (let level = 1; level <= 5; level++) {
    const one = await loadDataset('ja', 'jlpt', { level });
    assert.deepEqual(one.jlpt, jlpt.filter(q => q.level === level).map(strip));
    assert.deepEqual(one.jlptReading, jlptReading.filter(s => s.level === level).map(strip));
    assert.equal(CATALOG_META.ja.jlptByLevel[level], questions.filter(q => q.level === level).length);
    for (const key of JLPT_KIND_KEYS) {
      assert.equal(CATALOG_META.ja.jlptByMondai[level][key],
        questions.filter(q => q.level === level && jlptKindKeyOf(q) === key).length, `${level} ${key}`);
    }
  }
  await assert.rejects(loadDataset('ja', 'jlpt', { level: 6 }), /級別/);
  assert.equal(CATALOG_META.en.jlpt, 0);
  await assert.rejects(loadDataset('en', 'jlpt'), /沒有此題型/);
});

test('R09 catalog: JLPT 各級分檔，N5 檔不含讀解、N1 檔不含 N5 題目', async () => {
  const n5 = await import('../assets/js/data/catalog/ja-jlpt-1.js');
  const n1 = await import('../assets/js/data/catalog/ja-jlpt-5.js');
  assert.ok(n5.jlpt.length > 0 && n5.jlptReading.length === 0);
  assert.ok(n1.jlpt.length === 0);
  assert.ok(n1.jlptReading.every(set => set.level === 5));
  const files = await readdir(new URL('../assets/js/data/catalog/', import.meta.url));
  assert.ok(!files.includes('ja-jlpt.js'), '舊的單一 JLPT 檔已移除');
});

test('catalog: 22 個生成資源及索引必須與來源逐檔同步', () => {
  const script = fileURLToPath(new URL('../tools/build-catalog.mjs', import.meta.url));
  assert.match(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' }), /PASS catalog/);
});

test('catalog: 題型只取得對應資料；無效語言／級別／題型明確拒絕', async () => {
  assert.deepEqual(Object.keys(await loadDataset('ja', 'scene')), ['scenes']);
  assert.deepEqual(Object.keys(await loadDataset('ja', 'cloze')), ['sentences']);
  assert.deepEqual(Object.keys(await loadDataset('ja', 'reading')), ['readings']);
  assert.deepEqual(Object.keys(await loadDataset('en', 'mixed')).sort(), ['sentences', 'words']);
  assert.equal((await loadDataset('en', 'scene')).scenes.length, 0);
  await assert.rejects(loadWords('constructor'), /語言/);
  for (const level of [0, 6, 'N5', null]) await assert.rejects(loadWords('ja', { level }), /級別/);
  await assert.rejects(loadDataset('ja', 'constructor'), /題型/);
});

test('catalog: 減少請求不能以膨脹題庫位元組作交換', async () => {
  for (const lang of ['en', 'ja']) {
    const directory = new URL(`../assets/js/data/${lang}/words/`, import.meta.url);
    const originals = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.js')).map(name => readFile(new URL(name, directory))));
    const generated = await Promise.all([1, 2, 3, 4, 5].map(level => readFile(new URL(`../assets/js/data/catalog/${lang}-words-${level}.js`, import.meta.url))));
    assert.ok(generated.reduce((sum, bytes) => sum + bytes.length, 0) <= originals.reduce((sum, bytes) => sum + bytes.length, 0), `${lang} 生成資源不能大於原始批次合計`);
  }
});
