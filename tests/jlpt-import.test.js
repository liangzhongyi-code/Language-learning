import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  normalizeUpstream, loadUpstream, compareWithUpstream, draftSection, SOURCE_SHA256, SECTIONS,
} from '../tools/import-jlptsuccess.mjs';
import { jlpt, jlptExcluded } from '../assets/js/data/ja/jlpt.js';
import { validateJlpt } from '../assets/js/core/schema.js';

/**
 * 假上游：只放 moji 一份檔，其餘不讀。題目照上游的欄位命名
 */
const PAPER = {
  id: 'moji-1',
  questions: [
    { id: 'moji-1.1', mondai: 1, stem_html: 'あの 人は <u>学生</u> です。', choices: ['かくせ', 'かくせい', 'がくせ', 'がくせい'], correctIndex: 3, rationale: '学 (ガク) + 生 (セイ).' },
    { id: 'moji-1.2', mondai: 2, stem_html: '<u>がっこう</u> で べんきょうします。', choices: ['字交', '字校', '学交', '学校'], correctIndex: 3, rationale: '学校.' },
  ],
};
const sha = (text) => createHash('sha256').update(text).digest('hex');

async function fakeUpstream(text = JSON.stringify(PAPER)) {
  const dir = await mkdtemp(join(tmpdir(), 'jlpt-up-'));
  await mkdir(join(dir, 'papers/moji'), { recursive: true });
  for (let i = 1; i <= 7; i++) await writeFile(join(dir, `papers/moji/paper-${i}.json`), i === 1 ? text : JSON.stringify({ questions: [] }));
  const hashes = {};
  for (let i = 1; i <= 7; i++) hashes[`papers/moji/paper-${i}.json`] = sha(i === 1 ? text : JSON.stringify({ questions: [] }));
  return { dir, hashes };
}

const ours = (u, i) => ({ id: `ja-j-000${i + 1}`, level: 1, section: u.section, mondai: u.mondai, stem: u.stem, underline: u.underline,
  options: [...u.options], answer: u.answer, note: '說明', sourceRef: u.sourceRef, edited: null });

test('J04 上游檔雜湊不符時拒絕，指出是哪個檔', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    await assert.rejects(loadUpstream(dir, { sections: ['moji'], hashes: { ...hashes, 'papers/moji/paper-3.json': '0'.repeat(64) } }),
      /paper-3\.json/);
    await assert.rejects(loadUpstream(dir, { sections: ['goi'], hashes }), /讀不到/);
    assert.equal((await loadUpstream(dir, { sections: ['moji'], hashes })).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('J04 工具內記錄的是 21 個固定上游檔', () => {
  assert.equal(Object.keys(SOURCE_SHA256).length, 21);
  for (const s of SECTIONS) for (let i = 1; i <= 7; i++) assert.match(SOURCE_SHA256[`papers/${s}/paper-${i}.json`], /^[0-9a-f]{64}$/);
});

test('格式正規化：底線、括號空格、言い換え的「A: 」', () => {
  const u = normalizeUpstream(PAPER.questions[0], 'moji');
  assert.equal(u.stem, 'あの 人は 学生 です。');
  assert.equal(u.underline, '学生');
  assert.equal(u.answer, 'がくせい');
  assert.equal(normalizeUpstream({ id: 'bunpou-1.1', mondai: 1, stem_html: 'わたし（ ）たなかです。', choices: ['が', 'は', 'を', 'に'], correctIndex: 1 }, 'bunpou').stem,
    'わたし（　　）たなかです。');
  assert.equal(normalizeUpstream({ id: 'goi-5.2', mondai: 4, stem_html: 'A: でんしゃの 中で 本を 読みました。', choices: ['a', 'b', 'c', 'd'], correctIndex: 0 }, 'goi').stem,
    'でんしゃの 中で 本を 読みました。');
  /* 本批不收的題型（文法問題2、3）直接略過 */
  assert.equal(normalizeUpstream({ id: 'bunpou-5.1', mondai: 2, stem_html: '★', choices: [], correctIndex: 0 }, 'bunpou'), null);
});

test('J05 一致、修改、排除與遺漏', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    const upstream = await loadUpstream(dir, { sections: ['moji'], hashes });
    const data = upstream.map(ours);
    assert.deepEqual(compareWithUpstream({ upstream, data, sections: ['moji'] }), []);

    const changed = [data[0], { ...data[1], options: ['字交', '字校', '学校', '学効'] }];
    assert.match(compareWithUpstream({ upstream, data: changed, sections: ['moji'] }).join(), /edited 沒寫原因/);
    assert.deepEqual(compareWithUpstream({ upstream, data: [data[0], { ...changed[1], edited: '換掉不存在的詞' }], sections: ['moji'] }), []);
    assert.match(compareWithUpstream({ upstream, data: [data[0], { ...data[1], edited: '多寫的' }], sections: ['moji'] }).join(), /內容與上游/);

    assert.match(compareWithUpstream({ upstream, data: [data[0]], sections: ['moji'] }).join(), /moji-1\.2 沒有收錄/);
    assert.deepEqual(compareWithUpstream({ upstream, data: [data[0]], excluded: [{ sourceRef: 'moji-1.2', reason: '測試' }], sections: ['moji'] }), []);
    assert.match(compareWithUpstream({ upstream, data: [data[0]], excluded: [{ sourceRef: 'moji-1.2', reason: ' ' }], sections: ['moji'] }).join(), /沒寫原因/);
    assert.match(compareWithUpstream({ upstream, data, excluded: [{ sourceRef: 'moji-1.2', reason: '測試' }], sections: ['moji'] }).join(), /不能同時排除/);
    assert.match(compareWithUpstream({ upstream, data: [...data, { ...data[0], id: 'ja-j-0003' }], sections: ['moji'] }).join(), /已對應/);
    assert.match(compareWithUpstream({ upstream, data: [{ ...data[0], sourceRef: 'moji-9.9' }, data[1]], sections: ['moji'] }).join(), /上游沒有 moji-9\.9/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('草稿：id 從區段起始號連號，除了 note 以外都符合 schema', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    const text = draftSection(await loadUpstream(dir, { sections: ['moji'], hashes }), 'moji');
    const module = await import(`data:text/javascript,${encodeURIComponent(text)}`);
    assert.deepEqual(module.jlpt.map((q) => q.id), ['ja-j-0001', 'ja-j-0002']);
    for (const q of module.jlpt) {
      assert.deepEqual(validateJlpt(q, 'ja').errors.map((e) => e.field), ['note']);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('J05 已進版控的排除表每題都有原因，題庫的 sourceRef 不重複', () => {
  for (const e of jlptExcluded) assert.ok(e.reason?.trim(), `${e.sourceRef} 沒寫原因`);
  const refs = [...jlpt.map((q) => q.sourceRef), ...jlptExcluded.map((e) => e.sourceRef)];
  assert.equal(new Set(refs).size, refs.length);
});
