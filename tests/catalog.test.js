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

test('catalog: 17 個生成資源及索引必須與來源逐檔同步', () => {
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
