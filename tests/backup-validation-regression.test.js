import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPayload, parseBackup } from '../assets/js/core/backup.js';
import { BACKUP_JSON_MAX_BYTES } from '../assets/js/core/backup-limits.js';

const progress = { schemaVersion: 1, items: { 'ja-w-001': { n: 2, w: 1 } } };
const stats = { schemaVersion: 1, byScope: { 'ja:words': { answered: 2, correct: 1, sessions: 1 } } };
const parse = data => parseBackup(JSON.stringify(exportPayload(data, 123)));

test('舊備份：future／損壞的學習區塊不進入可覆寫資料', () => {
  for (const bad of [
    { ...progress, schemaVersion: 99 },
    { ...progress, schemaVersion: '1' },
    { schemaVersion: 1, items: { 'ja-w-001': { n: 1, w: 2 } } },
    { schemaVersion: 1, items: { 'ja-w-001': { n: -1, w: 0 } } },
    { schemaVersion: 1, items: { 'ja-w-001': { n: 1, w: 0, box: 99 } } },
    { schemaVersion: 1, items: [] },
  ]) {
    const result = parse({ progress: bad });
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.deepEqual(result.data, {});
    assert.match(result.errors.join(''), /progress.*跳過/);
  }
  for (const bad of [
    { ...stats, schemaVersion: 99 },
    { schemaVersion: 1, byScope: { 'ja:words': { answered: 1, correct: 2, sessions: 1 } } },
    { schemaVersion: 1, byScope: { 'ja:words': { answered: 1, correct: 1 } } },
  ]) assert.equal(parse({ stats: bad }).ok, false);
});

test('舊備份：明確跳過壞區塊，好區塊與早期缺少排程欄位的進度原樣保留', () => {
  const result = parse({ stats: { ...stats, schemaVersion: 99 }, progress, prefs: { hideKanji: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { progress, prefs: { hideKanji: true } });
  assert.match(result.errors.join(''), /stats.*跳過/);
  assert.deepEqual(result.counts, { progress: 1, prefs: 1 });
});

test('舊備份：外殼只接受實際整數 v0／v1，壞版本不借合法 prefs 通過', () => {
  for (const version of [undefined, null, -1, 0.5, '1', 'oops', 2, { toString: null }, { valueOf: false }, []]) {
    const payload = { ...exportPayload({ prefs: { theme: 'dark' } }, 123), version };
    const result = parseBackup(JSON.stringify(payload));
    assert.equal(result.ok, false, JSON.stringify(version));
    assert.deepEqual(result.data, {});
    assert.match(result.errors.join(''), /版本|格式/);
  }
  for (const version of [0, 1]) {
    const result = parseBackup(JSON.stringify({ ...exportPayload({ stats, progress }, 123), version }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { stats, progress });
  }
});

test('舊備份：偏好只接受目前可操作的合法模式與布林，不允許未知或危險鍵', () => {
  const prefs = { theme: 'light', palette: 'forest', background: 'dust', reducedEffects: true,
    grammarLines: false, kanaMode: 'both', readingAskIn: 'target', kanjiMode: 'ruby', keyboardSeen: false, hideKanji: true };
  assert.deepEqual(parse({ prefs }).data.prefs, prefs);
  for (const bad of [{ theme: 'neon' }, { palette: 'unknown' }, { background: 'rain' },
    { kanaMode: 'romaji' }, { readingAskIn: 'ja' }, { kanjiMode: true }, { grammarLines: 'false' },
    { extra: 'setting' }, JSON.parse('{"__proto__":{"theme":"light"}}')]) {
    const result = parse({ prefs: bad, progress });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { progress });
    assert.match(result.errors.join(''), /prefs.*跳過/);
  }
});

test('舊備份：解析前拒絕超過 10 MiB 的 UTF-8 檔案，字數小於上限也必須擋下', () => {
  const text = JSON.stringify(exportPayload({ prefs: { theme: '字'.repeat(Math.ceil(BACKUP_JSON_MAX_BYTES / 3)) } }, 123));
  assert.ok(text.length < BACKUP_JSON_MAX_BYTES);
  const result = parseBackup(text);
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, {});
  assert.match(result.errors.join(''), /10 MiB/);
});

test('舊備份：10 MiB 邊界合法 JSON 可讀，多一 byte 就整份拒絕', () => {
  const base = JSON.stringify(exportPayload({ progress }, 123));
  const boundary = base + ' '.repeat(BACKUP_JSON_MAX_BYTES - base.length);
  assert.equal(parseBackup(boundary).ok, true);
  const result = parseBackup(boundary + ' ');
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, {});
  assert.match(result.errors.join(''), /10 MiB/);
});
