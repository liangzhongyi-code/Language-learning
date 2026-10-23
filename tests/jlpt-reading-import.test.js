import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  parseBankFile, normalizeUpstream, loadUpstream, selectionOrder, compareWithUpstream, draftType,
  SOURCE_SHA256, TYPES, FIRST_BATCH,
} from '../tools/import-yomitaku.mjs';
import { jlptReading, jlptReadingExcluded } from '../assets/js/data/ja/jlpt-reading.js';
import { validateJlptReading } from '../assets/js/core/schema.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');

/**
 * 假上游：tanbun 有 20 組，字數夠長的與不夠長的都有；其他題型給空題庫
 */
const set = (n, len = 260) => ({
  id: `sim-tan${n}`, typeKey: 'tanbun', title: `模拟${n}`, minutes: 2, source: '本站原创模拟（非真题）',
  passage: `⟪劃線句${n}。⟫` + 'あ'.repeat(len),
  questions: [{ label: '划线句含义', q: `「劃線句${n}。」とはどういう意味か。`, options: [`甲${n}`, `乙${n}`, ` 丙${n} `, `丁${n}`], answer: 2,
    explain: ['錯。', '錯。', '正解。', '錯。'] }],
});
const SETS = Array.from({ length: 20 }, (_, i) => set(i + 1, i === 15 ? 50 : 260));
const fileOf = (sets, tail = '') => `/* 题库 */\nwindow.BANK.push(\n${sets.map((s) => JSON.stringify(s)).join(',\n')}\n);\n${tail}`;

async function fakeUpstream(tanbun = fileOf(SETS)) {
  const dir = await mkdtemp(join(tmpdir(), 'yomi-up-'));
  await mkdir(join(dir, 'js/bank'), { recursive: true });
  const hashes = {};
  for (const t of TYPES) {
    const text = t === 'tanbun' ? tanbun : fileOf([]);
    await writeFile(join(dir, `js/bank/${t}.js`), text);
    hashes[`js/bank/${t}.js`] = sha(text);
  }
  return { dir, hashes };
}

const ours = (u, i) => ({
  id: `ja-jr-${String(i + 1).padStart(4, '0')}`, level: 5, type: u.type, passage: u.passage, passageA: u.passageA, passageB: u.passageB,
  underline: u.underline, questions: u.questions.map((q, k) => ({ id: `ja-jr-${String(i + 1).padStart(4, '0')}-q${k + 1}`, focus: q.focus,
    ask: q.ask, options: [...q.options], answer: q.answer, explain: ['錯在…', '錯在…', '正解…', '錯在…'] })),
  sourceRef: u.sourceRef, edited: null,
});

test('R06 雜湊不符時拒絕並指出檔名', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    await assert.rejects(loadUpstream(dir, { hashes: { ...hashes, 'js/bank/joho.js': '0'.repeat(64) } }), /joho\.js/);
    assert.equal((await loadUpstream(dir, { hashes })).length, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('R06 只當資料解析：外框外的程式碼不會被執行，外框內不是 JSON 就拒絕', async () => {
  delete globalThis.__yomitakuExecuted;
  const { dir, hashes } = await fakeUpstream(fileOf(SETS, 'globalThis.__yomitakuExecuted = true;'));
  try {
    assert.equal((await loadUpstream(dir, { hashes })).length, 20);
    assert.equal(globalThis.__yomitakuExecuted, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.throws(() => parseBankFile('window.BANK.push(\n(globalThis.__yomitakuExecuted = true)\n);'), /不是純 JSON/);
  assert.throws(() => parseBankFile('const x = 1;'), /外框/);
  assert.equal(globalThis.__yomitakuExecuted, undefined);
});

test('格式正規化：⟪⟫ 轉 underline、考點標籤轉 focus、正解索引轉文字並去頭尾空白', () => {
  const u = normalizeUpstream(set(3));
  assert.equal(u.underline, '劃線句3。');
  assert.ok(!/[⟪⟫]/.test(u.passage));
  assert.equal(u.questions[0].focus, 'underline');
  assert.equal(u.questions[0].answer, '丙3');
  const togo = normalizeUpstream({ id: 'sim-togo1', typeKey: 'togo', passageA: 'A文', passageB: 'B文', questions: [] });
  assert.deepEqual([togo.passage, togo.passageA, togo.passageB], [null, 'A文', 'B文']);
});

test('R07 選組：可重現、避開早期 15% 與字數不足', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    const upstream = await loadUpstream(dir, { hashes });
    const a = selectionOrder(upstream, 'tanbun');
    assert.deepEqual(selectionOrder(upstream, 'tanbun'), a);
    assert.ok(!a.includes('sim-tan1') && !a.includes('sim-tan2') && !a.includes('sim-tan3'), '前 15%（3 組）不收');
    assert.ok(!a.includes('sim-tan16'), '字數不足');
    assert.equal(a.length, 16);
    assert.notDeepEqual(selectionOrder(upstream, 'tanbun', { seed: 1 }), a, '換種子會換順序');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('R07 對照：修改要寫原因、排除要寫原因、必須依選組順序遞補', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    const upstream = await loadUpstream(dir, { hashes });
    const order = selectionOrder(upstream, 'tanbun');
    const by = new Map(upstream.map((u) => [u.sourceRef, u]));
    const first = order.slice(0, 3).map((ref, i) => ours(by.get(ref), i));
    assert.deepEqual(compareWithUpstream({ upstream, data: first, types: ['tanbun'] }), []);

    const changed = [{ ...first[0], passage: first[0].passage + 'い' }, first[1], first[2]];
    assert.match(compareWithUpstream({ upstream, data: changed, types: ['tanbun'] }).join(), /edited 沒寫原因/);
    assert.deepEqual(compareWithUpstream({ upstream, data: [{ ...changed[0], edited: '修正錯字' }, first[1], first[2]], types: ['tanbun'] }), []);
    assert.match(compareWithUpstream({ upstream, data: [{ ...first[0], edited: '多寫的' }, first[1], first[2]], types: ['tanbun'] }).join(), /內容與上游/);

    const skipSecond = [first[0], ours(by.get(order[2]), 1)];
    assert.match(compareWithUpstream({ upstream, data: skipSecond, types: ['tanbun'] }).join(), /依選組順序遞補/);
    assert.deepEqual(compareWithUpstream({ upstream, data: skipSecond, excluded: [{ sourceRef: order[1], reason: '正解不唯一' }], types: ['tanbun'] }), []);
    assert.match(compareWithUpstream({ upstream, data: skipSecond, excluded: [{ sourceRef: order[1], reason: '' }], types: ['tanbun'] }).join(), /沒寫原因/);
    assert.match(compareWithUpstream({ upstream, data: [ours(by.get('sim-tan1'), 0)], types: ['tanbun'] }).join(), /不在選組名單/);
    assert.match(compareWithUpstream({ upstream, data: first, types: ['tanbun'], batch: 2 }).join(), /超過本批/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('草稿：依選組順序、id 從指定號碼起，除了解說以外都符合 schema', async () => {
  const { dir, hashes } = await fakeUpstream();
  try {
    const upstream = await loadUpstream(dir, { hashes });
    const text = draftType(upstream, 'tanbun', { start: 7, count: 2 });
    const { passages } = await import(`data:text/javascript,${encodeURIComponent(text)}`);
    assert.deepEqual(passages.map((p) => p.id), ['ja-jr-0007', 'ja-jr-0008']);
    assert.deepEqual(passages.map((p) => p.sourceRef), selectionOrder(upstream, 'tanbun').slice(0, 2));
    for (const p of passages) {
      assert.deepEqual([...new Set(validateJlptReading({ ...p, level: 5 }, 'ja').errors.map((e) => e.field))], ['questions[0].explain', 'passage']
        .filter((f) => f !== 'passage' || p.passage.length < 140));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('R07 已進版控的排除表都有原因，上游組不重複；每個題型不超過本批組數', () => {
  for (const e of jlptReadingExcluded) assert.ok(e.reason?.trim(), `${e.sourceRef} 沒寫原因`);
  const refs = [...jlptReading.map((p) => p.sourceRef), ...jlptReadingExcluded.map((e) => e.sourceRef)];
  assert.equal(new Set(refs).size, refs.length);
  for (const t of TYPES) assert.ok(jlptReading.filter((p) => p.type === t).length <= FIRST_BATCH);
  assert.equal(Object.keys(SOURCE_SHA256).length, 6);
});
