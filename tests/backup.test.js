/**
 * 匯出與匯入。
 *
 * 這一支最重要的不是「好檔案能還原」，而是「壞檔案不會把現有紀錄弄壞」——
 * 使用者最容易犯的錯是選錯檔案，而覆蓋學習紀錄是不可逆的。
 * 所以每一種壞法都各驗一次，而且要確認壞的時候 ok 是 false。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  exportPayload,
  parseBackup,
  countOf,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  SECTIONS,
} from '../assets/js/core/backup.js';

const T0 = 1756700000000;

const SAMPLE = {
  stats: { schemaVersion: 1, byScope: { 'ja:words': { answered: 30, correct: 24, sessions: 3 } } },
  progress: { schemaVersion: 1, items: { 'ja-w-001': { n: 3, w: 1, box: 1, last: T0, due: T0 } } },
  prefs: { kanjiMode: 'ruby', kanaMode: 'both' },
};

const roundTrip = (data) => parseBackup(JSON.stringify(exportPayload(data, T0)));

/* ── 來回一致 ────────────────────────────────────────────── */

test('匯出再匯入拿回一模一樣的東西', () => {
  const result = roundTrip(SAMPLE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, SAMPLE);
  assert.equal(result.exportedAt, T0);
  assert.deepEqual(result.errors, []);
});

test('匯出的檔案帶得出格式與版本，否則認不出是誰的備份', () => {
  const payload = exportPayload(SAMPLE, T0);
  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.version, BACKUP_VERSION);
  assert.equal(payload.exportedAt, T0);
});

test('沒有的區塊不寫進檔案，也不會在匯入時憑空冒出來', () => {
  const payload = exportPayload({ prefs: SAMPLE.prefs }, T0);
  assert.equal('stats' in payload, false);
  assert.equal('progress' in payload, false);

  const result = parseBackup(JSON.stringify(payload));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), ['prefs']);
});

test('完全空的紀錄匯出之後不算是可還原的備份', () => {
  const result = roundTrip({});
  assert.equal(result.ok, false);
  assert.match(result.errors.join(''), /沒有任何可以還原的資料/);
});

/* ── 壞檔案一律擋下 ──────────────────────────────────────── */

test('不是 JSON 就擋下', () => {
  const r = parseBackup('這不是 JSON');
  assert.equal(r.ok, false);
  assert.deepEqual(r.data, {});
  assert.match(r.errors.join(''), /JSON/);
});

test('別人的 JSON 擋下，而且說清楚沒有動任何資料', () => {
  for (const text of ['{}', '[]', 'null', '123', '"字串"', JSON.stringify({ format: 'other' })]) {
    const r = parseBackup(text);
    assert.equal(r.ok, false, `${text} 不該被當成備份檔`);
    assert.deepEqual(r.data, {}, `${text} 不該回傳任何可寫入的資料`);
  }
  assert.match(parseBackup('{}').errors.join(''), /沒有動任何資料/);
});

test('比自己新的格式版本擋下', () => {
  const r = parseBackup(JSON.stringify({ ...exportPayload(SAMPLE, T0), version: BACKUP_VERSION + 1 }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(''), new RegExp(`v${BACKUP_VERSION + 1}`));
});

test('比自己舊的格式版本仍然收——備份的意義就是放久了還救得回來', () => {
  const r = parseBackup(JSON.stringify({ ...exportPayload(SAMPLE, T0), version: 0 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, SAMPLE);
});

test('壞掉的區塊跳過，好的區塊照樣救回來', () => {
  const payload = { ...exportPayload(SAMPLE, T0), stats: '壞掉了' };
  const r = parseBackup(JSON.stringify(payload));
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.data).sort(), ['prefs', 'progress']);
  assert.match(r.errors.join(''), /stats/);
});

test('缺 exportedAt 不影響匯入，只是時間顯示為未知', () => {
  const payload = exportPayload(SAMPLE, T0);
  delete payload.exportedAt;
  const r = parseBackup(JSON.stringify(payload));
  assert.equal(r.ok, true);
  assert.equal(r.exportedAt, null);
});

/* ── 匯入前的預覽數字 ────────────────────────────────────── */

test('countOf 各區塊算出對使用者有意義的數字', () => {
  assert.equal(countOf('stats', SAMPLE.stats), 1);
  assert.equal(countOf('progress', SAMPLE.progress), 1);
  assert.equal(countOf('prefs', SAMPLE.prefs), 2);
});

test('countOf 對壞資料回傳 0 而不是拋錯', () => {
  for (const bad of [null, undefined, 'x', 3, []]) {
    for (const section of SECTIONS) assert.equal(countOf(section, bad), 0);
  }
  assert.equal(countOf('stats', {}), 0, '缺 byScope 就是 0 組');
  assert.equal(countOf('progress', {}), 0);
});

test('解析結果附上每個區塊的筆數，匯入前才看得到自己要蓋掉什麼', () => {
  const r = roundTrip(SAMPLE);
  assert.deepEqual(r.counts, { stats: 1, progress: 1, prefs: 2 });
});

/* ── 不可就地改動 ────────────────────────────────────────── */

test('exportPayload 不改動傳進來的資料', () => {
  const snapshot = JSON.stringify(SAMPLE);
  exportPayload(SAMPLE, T0);
  assert.equal(JSON.stringify(SAMPLE), snapshot);
});
