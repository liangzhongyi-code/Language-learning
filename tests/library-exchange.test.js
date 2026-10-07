import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_EXCHANGE_FORMAT, LIBRARY_EXCHANGE_VERSION, MAX_LIBRARY_IMPORT_BYTES,
  exportLibrary, previewLibraryImport, applyLibraryImport,
} from '../assets/js/core/library-exchange.js';
import { MAX_BOOKS, MAX_BOOK_WORDS, isQuizEligible } from '../assets/js/core/library.js';
import { emptyLearning, validateLearningRecord } from '../assets/js/core/learning-schema.js';

const now = Date.parse('2026-10-07T04:00:00Z');
const later = now + 60000;
const known = new Set(['ja-w-001', 'ja-w-002', 'ja-w-003', 'ja-w-004']);

function bookWith(id, name, wordIds = [], revision = 0) {
  return { bookId: id, name, system: false, wordIds, revision, createdAt: now, updatedAt: now };
}

function localState() {
  const favorites = emptyLearning({ now, timeZone: 'Asia/Taipei' }).library.books.favorites;
  return {
    books: { favorites: { ...favorites, wordIds: ['ja-w-001'] }, a: bookWith('a', '旅行', ['ja-w-001', 'ja-w-002'], 4) },
    notes: { 'ja-w-001': { wordId: 'ja-w-001', text: '本機筆記', updatedAt: now, revision: 1 } },
  };
}

function file(extra = {}) {
  return {
    format: LIBRARY_EXCHANGE_FORMAT, version: LIBRARY_EXCHANGE_VERSION, exportedAt: now,
    books: [
      { bookId: 'x-fav', name: '收藏', system: true, wordIds: ['ja-w-001', 'ja-w-003'] },
      { bookId: 'x-1', name: ' 旅行 ', system: false, wordIds: ['ja-w-002', 'ja-w-003', 'ja-w-003', 'ja-w-999'] },
      { bookId: 'x-2', name: '動詞', system: false, wordIds: ['ja-w-004'] },
    ],
    notes: [
      { wordId: 'ja-w-001', text: '匯入筆記', updatedAt: now },
      { wordId: 'ja-w-003', text: '<img src=x onerror=alert(1)>', updatedAt: now },
      { wordId: 'ja-w-002', text: '新筆記' },
    ],
    ...extra,
  };
}

function apply(db, changes) {
  const next = structuredClone(db);
  for (const change of changes) {
    if (change.delete === true) delete next[change.store][change.key];
    else next[change.store][change.key] = structuredClone(change.value);
  }
  return next;
}

const ids = () => { let n = 0; return () => `imported-${++n}`; };

test('O05 匯出為獨立交換格式，只含簿與筆記，不含統計／進度／偏好／revision', () => {
  const { books, notes } = localState();
  const data = exportLibrary({ books, notes, now: later });
  assert.deepEqual(Object.keys(data).sort(), ['books', 'exportedAt', 'format', 'notes', 'version']);
  assert.equal(data.format, 'lang-learn-library');
  assert.equal(data.version, 1);
  assert.equal(data.exportedAt, later);
  assert.deepEqual(data.books.map(b => b.bookId), ['favorites', 'a'], '收藏固定排第一');
  assert.deepEqual(Object.keys(data.books[1]).sort(), ['bookId', 'name', 'system', 'wordIds']);
  assert.deepEqual(data.notes, [{ wordId: 'ja-w-001', text: '本機筆記', updatedAt: now }]);
  const json = JSON.stringify(data);
  for (const word of ['stats', 'progress', 'prefs', 'itemStates', 'revision']) assert.ok(!json.includes(word));
});

test('O05 指定 bookIds 只匯出那些簿與其字的筆記；未知 bookId 拒絕', () => {
  const { books, notes } = localState();
  notes['ja-w-009'] = { wordId: 'ja-w-009', text: '不相干', updatedAt: now, revision: 0 };
  const data = exportLibrary({ books, notes, now, bookIds: ['a'] });
  assert.deepEqual(data.books.map(b => b.bookId), ['a']);
  assert.deepEqual(data.notes.map(n => n.wordId), ['ja-w-001']);
  assert.throws(() => exportLibrary({ books, notes, now, bookIds: ['gone'] }), e => e.code === 'INVALID_DATA');
});

test('O05 匯出再匯入同一份本機資料：全部視為重複、零變更', () => {
  const { books, notes } = localState();
  const text = JSON.stringify(exportLibrary({ books, notes, now }));
  const preview = previewLibraryImport({ text, books, notes, knownWordIds: known, now });
  assert.deepEqual(preview.newBooks, []);
  assert.equal(preview.notes.conflicts.length, 0);
  assert.equal(preview.notes.create.length, 0);
  const result = applyLibraryImport(preview, {}, { now, newBookId: ids() });
  assert.deepEqual(result.changes, []);
});

test('O05 預覽：新增簿、同名衝突（預設合併、建議新名）、重複字略過數、筆記衝突與未知 wordId', () => {
  const { books, notes } = localState();
  const preview = previewLibraryImport({ text: JSON.stringify(file()), books, notes, knownWordIds: known, now });
  assert.deepEqual(preview.newBooks.map(b => b.name), ['動詞']);
  assert.equal(preview.bookConflicts.length, 1);
  const conflict = preview.bookConflicts[0];
  assert.equal(conflict.name, '旅行');
  assert.equal(conflict.target.bookId, 'a');
  assert.equal(conflict.defaultStrategy, 'merge');
  assert.deepEqual(conflict.strategies, ['merge', 'rename']);
  assert.equal(conflict.suggestedName, '旅行 (2)');
  // 收藏 ja-w-001 已在本機；旅行 ja-w-002 已在本機、ja-w-003 檔內重複一次
  assert.equal(preview.skippedDuplicateWords, 3);
  assert.deepEqual(preview.notes.conflicts.map(c => [c.wordId, c.localText, c.importedText, c.defaultChoice]), [['ja-w-001', '本機筆記', '匯入筆記', 'keep']]);
  assert.deepEqual(preview.notes.create.map(n => n.wordId), ['ja-w-002', 'ja-w-003']);
  assert.deepEqual(preview.unknownWordIds, ['ja-w-999']);
  assert.equal(preview.limits.exceeded, false);
});

test('O05 確認匯入預設：合併同名簿、保留本機筆記、未知字保留但不可出題；只碰 books／notes', () => {
  const local = localState();
  const db = { ...structuredClone(local), itemStates: { k: { sourceId: 'ja-w-001' } }, reviewEvents: { r: {} }, stats: { answered: 9 }, prefs: { theme: 'dark' } };
  const preview = previewLibraryImport({ object: file(), books: local.books, notes: local.notes, knownWordIds: known, now });
  const result = applyLibraryImport(preview, {}, { now: later, newBookId: ids() });
  for (const change of result.changes) {
    assert.ok(['books', 'notes'].includes(change.store));
    assert.deepEqual(validateLearningRecord(change.store, change.value), { ok: true, errors: [] });
  }
  const after = apply(db, result.changes);
  assert.deepEqual(after.books.favorites.wordIds, ['ja-w-001', 'ja-w-003']);
  assert.equal(after.books.favorites.revision, 1);
  assert.deepEqual(after.books.a.wordIds, ['ja-w-001', 'ja-w-002', 'ja-w-003', 'ja-w-999']);
  assert.equal(after.books.a.revision, 5);
  assert.equal(after.books.a.updatedAt, later);
  assert.deepEqual(after.books['imported-1'], { bookId: 'imported-1', name: '動詞', system: false, wordIds: ['ja-w-004'], revision: 0, createdAt: later, updatedAt: later });
  assert.equal(after.notes['ja-w-001'].text, '本機筆記', '預設保留本機筆記');
  assert.equal(after.notes['ja-w-002'].text, '新筆記');
  assert.deepEqual(after.itemStates, db.itemStates);
  assert.deepEqual(after.reviewEvents, db.reviewEvents);
  assert.deepEqual(after.stats, db.stats);
  assert.deepEqual(after.prefs, db.prefs);
  assert.equal(isQuizEligible('ja-w-999', known), false);
  assert.deepEqual(result.summary.unknownWordIds, ['ja-w-999']);
});

test('O05 選擇另存新名與覆寫筆記；自訂名稱仍檢查同名', () => {
  const local = localState();
  const preview = previewLibraryImport({ object: file(), books: local.books, notes: local.notes, knownWordIds: known, now });
  const index = preview.bookConflicts[0].index;
  const result = applyLibraryImport(preview, { books: { [index]: { strategy: 'rename' } }, notes: { 'ja-w-001': 'overwrite' } }, { now: later, newBookId: ids() });
  const after = apply(local, result.changes);
  assert.deepEqual(after.books.a, local.books.a, '另存新名不動本機同名簿');
  const renamed = Object.values(after.books).find(b => b.name === '旅行 (2)');
  assert.deepEqual(renamed.wordIds, ['ja-w-002', 'ja-w-003', 'ja-w-999']);
  assert.equal(after.notes['ja-w-001'].text, '匯入筆記');
  assert.equal(after.notes['ja-w-001'].revision, 2);
  assert.throws(() => applyLibraryImport(preview, { books: { [index]: { strategy: 'rename', name: '動詞' } } }, { now, newBookId: ids() }),
    e => e.code === 'ENTRY_CONFLICT' && e.details.reason === 'DUPLICATE_NAME');
  assert.throws(() => applyLibraryImport(preview, { books: { [index]: { strategy: 'delete-everything' } } }, { now, newBookId: ids() }), e => e.code === 'INVALID_DATA');
  assert.throws(() => applyLibraryImport(preview, { notes: { 'ja-w-001': 'replace-all' } }, { now, newBookId: ids() }), e => e.code === 'INVALID_DATA');
});

test('O05 預覽後本機資料改變則拒絕套用（STALE_PREVIEW）', () => {
  const local = localState();
  const preview = previewLibraryImport({ object: file(), books: local.books, notes: local.notes, knownWordIds: known, now });
  const changed = structuredClone(local);
  changed.books.a.revision = 5;
  assert.throws(() => applyLibraryImport(preview, {}, { now, newBookId: ids(), books: changed.books, notes: changed.notes }), e => e.code === 'STALE_PREVIEW');
  changed.books.a.revision = 4;
  changed.notes['ja-w-003'] = { wordId: 'ja-w-003', text: '別頁', updatedAt: now, revision: 0 };
  assert.throws(() => applyLibraryImport(preview, {}, { now, newBookId: ids(), books: changed.books, notes: changed.notes }), e => e.code === 'STALE_PREVIEW');
  assert.doesNotThrow(() => applyLibraryImport(preview, {}, { now, newBookId: ids(), books: local.books, notes: local.notes }));
});

test('O05 newBookId 必須產生安全且不重複的 ID', () => {
  const local = localState();
  const preview = previewLibraryImport({ object: file(), books: local.books, notes: local.notes, knownWordIds: known, now });
  assert.throws(() => applyLibraryImport(preview, {}, { now, newBookId: () => 'a' }), e => e.code === 'INVALID_DATA');
  assert.throws(() => applyLibraryImport(preview, {}, { now, newBookId: () => 'favorites' }), e => e.code === 'INVALID_DATA');
  assert.throws(() => applyLibraryImport(preview, {}, { now, newBookId: () => '__proto__' }), e => e.code === 'INVALID_DATA');
});

test('O06 HTML 筆記原樣當純文字保存，不轉義也不剝除', () => {
  const local = localState();
  const preview = previewLibraryImport({ object: file(), books: local.books, notes: local.notes, knownWordIds: known, now });
  const result = applyLibraryImport(preview, {}, { now, newBookId: ids() });
  const note = result.changes.find(c => c.store === 'notes' && c.key === 'ja-w-003');
  assert.equal(note.value.text, '<img src=x onerror=alert(1)>');
});

test('O06 原型污染 key、非 JSON、錯誤格式或版本整批拒絕且不改原資料', () => {
  const local = localState();
  const before = structuredClone(local);
  const base = { books: local.books, notes: local.notes, knownWordIds: known, now };
  const polluted = JSON.stringify(file()).replace('"name":"動詞"', '"name":"動詞","__proto__":{"polluted":true}');
  assert.throws(() => previewLibraryImport({ ...base, text: polluted }), e => e.code === 'INVALID_DATA');
  assert.equal({}.polluted, undefined);
  const ctor = JSON.stringify(file()).replace('"exportedAt"', '"constructor":{"prototype":{"x":1}},"exportedAt"');
  assert.throws(() => previewLibraryImport({ ...base, text: ctor }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, text: '{not json' }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), format: 'lang-learn-backup' } }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), version: 2 } }), e => e.code === 'UNSUPPORTED_VERSION');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), stats: {} } }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), books: [{ name: 'x', system: false, wordIds: ['__proto__'] }] } }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), notes: [{ wordId: 'ja-w-001', text: 'a' }, { wordId: 'ja-w-001', text: 'b' }] } }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), books: [{ name: 'x', system: false, wordIds: [] }, { name: ' X ', system: false, wordIds: [] }] } }), e => e.code === 'INVALID_DATA');
  assert.deepEqual(local, before);
});

test('O06 超長名稱、超長筆記拒絕', () => {
  const { books, notes } = localState();
  const base = { books, notes, knownWordIds: known, now };
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), books: [{ name: '字'.repeat(61), system: false, wordIds: [] }] } }), e => e.code === 'INVALID_DATA');
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), notes: [{ wordId: 'ja-w-001', text: 'a'.repeat(2001) }] } }), e => e.code === 'INVALID_DATA');
});

test('O06 超過 10 MiB（UTF-8 bytes）在解析前拒絕', () => {
  const { books, notes } = localState();
  const huge = '"' + '字'.repeat(Math.ceil(MAX_LIBRARY_IMPORT_BYTES / 3) + 1) + '"';
  assert.ok(huge.length < MAX_LIBRARY_IMPORT_BYTES, '字元數低於上限，但 UTF-8 bytes 超過');
  assert.throws(() => previewLibraryImport({ text: huge, books, notes, knownWordIds: known, now }),
    e => e.code === 'QUOTA_EXCEEDED' && e.details.limit === MAX_LIBRARY_IMPORT_BYTES);
});

test('O06 檔案超過 100 本或單簿超過 15000 字整批拒絕並說明', () => {
  const { books, notes } = localState();
  const base = { books, notes, knownWordIds: known, now };
  const many = Array.from({ length: MAX_BOOKS + 1 }, (_, i) => ({ name: `簿${i}`, system: false, wordIds: [] }));
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), books: many } }), e => e.code === 'QUOTA_EXCEEDED' && e.details.limit === MAX_BOOKS);
  const big = Array.from({ length: MAX_BOOK_WORDS + 1 }, (_, i) => `ja-w-${i}`);
  assert.throws(() => previewLibraryImport({ ...base, object: { ...file(), books: [{ name: '大', system: false, wordIds: big }] } }), e => e.code === 'QUOTA_EXCEEDED' && e.details.limit === MAX_BOOK_WORDS);
});

test('O06 合併後總簿數超過 100 或合併後單簿超過 15000 時整批拒絕', () => {
  const { notes } = localState();
  const books = { favorites: localState().books.favorites };
  for (let i = 1; i < MAX_BOOKS; i++) books[`b${i}`] = bookWith(`b${i}`, `本機${i}`);
  const preview = previewLibraryImport({ object: { ...file(), books: [{ name: '新簿', system: false, wordIds: [] }] }, books, notes, knownWordIds: known, now });
  assert.equal(preview.limits.exceeded, true);
  assert.throws(() => applyLibraryImport(preview, {}, { now, newBookId: ids() }), e => e.code === 'QUOTA_EXCEEDED' && e.details.bookCount === MAX_BOOKS + 1);

  const full = Array.from({ length: MAX_BOOK_WORDS }, (_, i) => `ja-w-${i}`);
  const local = { favorites: localState().books.favorites, a: bookWith('a', '大', full) };
  const merge = previewLibraryImport({ object: { ...file(), books: [{ name: '大', system: false, wordIds: ['ja-x-1'] }] }, books: local, notes, knownWordIds: known, now });
  assert.equal(merge.limits.exceeded, true);
  assert.throws(() => applyLibraryImport(merge, {}, { now, newBookId: ids() }),
    e => e.code === 'QUOTA_EXCEEDED' && e.details.oversizedBooks[0].wordCount === MAX_BOOK_WORDS + 1);
  const index = merge.bookConflicts[0].index;
  assert.doesNotThrow(() => applyLibraryImport(merge, { books: { [index]: 'rename' } }, { now, newBookId: ids() }));
});
