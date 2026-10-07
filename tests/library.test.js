import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BOOKS, MAX_BOOK_NAME_LENGTH, MAX_BOOK_WORDS, MAX_NOTE_LENGTH, FAVORITES_BOOK_ID,
  createBook, renameBook, deleteBook, setMembership, saveNote, isQuizEligible, quizWordIds,
} from '../assets/js/core/library.js';
import { emptyLearning, validateLearningRecord } from '../assets/js/core/learning-schema.js';

const now = Date.parse('2026-10-07T04:00:00Z');
const later = now + 60000;
const W1 = 'ja-w-001';
const W2 = 'ja-w-002';

/**
 * 以 repository commit 的語意套用 changes，用來證明只碰到宣告的集合與 key。
 */
function apply(db, changes) {
  const next = structuredClone(db);
  for (const change of changes) {
    if (change.delete === true) delete next[change.store][change.key];
    else next[change.store][change.key] = structuredClone(change.value);
  }
  return next;
}

/**
 * 每筆 put 都必須通過單筆 schema；delete 只能帶 store／key／delete。
 */
function assertValidChanges(changes) {
  for (const change of changes) {
    assert.ok(['books', 'notes', 'intents'].includes(change.store));
    if (change.delete === true) assert.deepEqual(Object.keys(change).sort(), ['delete', 'key', 'store']);
    else assert.deepEqual(validateLearningRecord(change.store, change.value), { ok: true, errors: [] });
  }
}

const favorites = () => emptyLearning({ now, timeZone: 'Asia/Taipei' }).library.books.favorites;
const baseBooks = () => ({ favorites: favorites() });

function bookWith(id, name, wordIds = [], revision = 0) {
  return { bookId: id, name, system: false, wordIds, revision, createdAt: now, updatedAt: now };
}

test('O04 建立自訂簿：名稱 trim、revision 0、只產生 books put 且通過 schema', () => {
  const books = baseBooks();
  const result = createBook({ books, name: '  旅行單字  ', now, bookId: 'book-1' });
  assert.deepEqual(result.book, bookWith('book-1', '旅行單字'));
  assert.deepEqual(result.changes, [{ store: 'books', key: 'book-1', value: result.book }]);
  assertValidChanges(result.changes);
  assert.deepEqual(books, baseBooks(), '不可修改輸入');
});

test('O04 建立自訂簿拒絕空白、超過 60 字、同名（含收藏與大小寫／全半形）並提示既有簿', () => {
  const books = { ...baseBooks(), a: bookWith('a', 'Travel') };
  assert.throws(() => createBook({ books, name: '   ', now, bookId: 'b' }), e => e.code === 'INVALID_DATA');
  assert.throws(() => createBook({ books, name: '字'.repeat(MAX_BOOK_NAME_LENGTH + 1), now, bookId: 'b' }), e => e.code === 'INVALID_DATA');
  assert.equal(createBook({ books, name: '😀'.repeat(MAX_BOOK_NAME_LENGTH), now, bookId: 'b' }).book.name.length, 120, '以 code point 計長度');
  assert.throws(() => createBook({ books, name: ' travel ', now, bookId: 'b' }),
    e => e.code === 'ENTRY_CONFLICT' && e.details.reason === 'DUPLICATE_NAME' && e.details.bookId === 'a');
  assert.throws(() => createBook({ books, name: 'ＴＲＡＶＥＬ', now, bookId: 'b' }), e => e.details.reason === 'DUPLICATE_NAME');
  assert.throws(() => createBook({ books, name: '收藏', now, bookId: 'b' }), e => e.details.bookId === FAVORITES_BOOK_ID);
});

test('O04 建立自訂簿拒絕 favorites／重複／不安全 ID，以及第 101 本', () => {
  const books = baseBooks();
  assert.throws(() => createBook({ books, name: 'x', now, bookId: 'favorites' }), e => e.code === 'INVALID_OPERATION');
  assert.throws(() => createBook({ books: { ...books, a: bookWith('a', 'A') }, name: 'x', now, bookId: 'a' }), e => e.code === 'ENTRY_CONFLICT');
  for (const bookId of ['', ' a', '__proto__', 'a\nb', 7]) {
    assert.throws(() => createBook({ books, name: 'x', now, bookId }), e => e.code === 'INVALID_DATA');
  }
  const full = baseBooks();
  for (let i = 1; i < MAX_BOOKS; i++) full[`b${i}`] = bookWith(`b${i}`, `簿${i}`);
  assert.equal(Object.keys(full).length, MAX_BOOKS);
  assert.throws(() => createBook({ books: full, name: '第101本', now, bookId: 'b101' }),
    e => e.code === 'QUOTA_EXCEEDED' && e.details.limit === MAX_BOOKS);
  assert.throws(() => createBook({ books, name: 'x', now: -1, bookId: 'b' }), e => e.code === 'INVALID_DATA');
});

test('O04 改名遞增 revision；收藏不可改名、revision 不符與同名拒絕、同名稱不產生變更', () => {
  const books = { ...baseBooks(), a: bookWith('a', 'A', [W1], 3), b: bookWith('b', 'B') };
  const result = renameBook({ books, bookId: 'a', name: ' A2 ', now: later, expectedRevision: 3 });
  assert.equal(result.book.name, 'A2');
  assert.equal(result.book.revision, 4);
  assert.equal(result.book.updatedAt, later);
  assert.deepEqual(result.book.wordIds, [W1]);
  assertValidChanges(result.changes);
  assert.throws(() => renameBook({ books, bookId: 'a', name: 'X', now, expectedRevision: 2 }), e => e.code === 'REVISION_CONFLICT');
  assert.throws(() => renameBook({ books, bookId: 'a', name: 'b', now, expectedRevision: 3 }), e => e.details.reason === 'DUPLICATE_NAME');
  assert.throws(() => renameBook({ books, bookId: 'favorites', name: '最愛', now, expectedRevision: 0 }), e => e.code === 'INVALID_OPERATION');
  assert.throws(() => renameBook({ books, bookId: 'gone', name: 'X', now, expectedRevision: 0 }), e => e.code === 'REVISION_CONFLICT' && e.details.reason === 'BOOK_DELETED');
  assert.deepEqual(renameBook({ books, bookId: 'a', name: 'A', now, expectedRevision: 3 }).changes, []);
});

test('O04 同字在兩本簿且有筆記與作答紀錄，刪其中一本只刪該簿；另一簿、筆記與歷史保留', () => {
  const itemState = { skillKey: `${W1}:recognition:target2zh`, sourceId: W1, ability: 'recognition', direction: 'target2zh', legacySummary: null, schedulerName: 'leitner', schedulerVersion: '1', schedulerState: { box: 2 }, due: now + 1000, lastEligibleReviewAt: now, learningStatus: 'review' };
  let db = {
    books: { ...baseBooks(), a: bookWith('a', 'A', [W1, W2]), b: bookWith('b', 'B', [W1]) },
    notes: {}, intents: {}, itemStates: { [itemState.skillKey]: itemState }, reviewEvents: { r1: { reviewId: 'r1', sourceId: W1 } },
  };
  const note = saveNote({ note: null, wordId: W1, text: '記得「は」讀 wa', now, expectedRevision: null, epoch: 'e1', currentEpoch: 'e1' });
  db = apply(db, note.changes);
  const removed = deleteBook({ books: db.books, bookId: 'a', expectedRevision: 0 });
  assert.deepEqual(removed.changes, [{ store: 'books', key: 'a', delete: true }]);
  const after = apply(db, removed.changes);
  assert.equal(after.books.a, undefined);
  assert.deepEqual(after.books.b, db.books.b);
  assert.deepEqual(after.books.favorites, db.books.favorites);
  assert.deepEqual(after.notes, db.notes);
  assert.deepEqual(after.itemStates, db.itemStates);
  assert.deepEqual(after.reviewEvents, db.reviewEvents);
});

test('O04 收藏不可刪；刪除已不存在的簿不產生變更；revision 不符拒絕', () => {
  const books = { ...baseBooks(), a: bookWith('a', 'A', [], 2) };
  assert.throws(() => deleteBook({ books, bookId: 'favorites', expectedRevision: 0 }), e => e.code === 'INVALID_OPERATION');
  assert.deepEqual(deleteBook({ books, bookId: 'gone', expectedRevision: 0 }), { deleted: false, changes: [] });
  assert.throws(() => deleteBook({ books, bookId: 'a', expectedRevision: 1 }), e => e.code === 'REVISION_CONFLICT');
});

test('O04 晚到的加入簿操作不能復活已刪簿', () => {
  assert.throws(() => setMembership({ book: null, wordId: W1, member: true, now, expectedRevision: 0 }),
    e => e.code === 'REVISION_CONFLICT' && e.details.reason === 'BOOK_DELETED');
  assert.throws(() => renameBook({ books: baseBooks(), bookId: 'a', name: '復活', now, expectedRevision: 0 }), e => e.code === 'REVISION_CONFLICT');
});

test('O04 加入／移出遞增 revision；重複加入或移出不存在的字不產生變更', () => {
  const book = bookWith('a', 'A', [W1], 5);
  const added = setMembership({ book, wordId: W2, member: true, now: later, expectedRevision: 5 });
  assert.deepEqual(added.book.wordIds, [W1, W2]);
  assert.equal(added.book.revision, 6);
  assert.equal(added.book.updatedAt, later);
  assertValidChanges(added.changes);
  const removed = setMembership({ book: added.book, wordId: W1, member: false, now: later, expectedRevision: 6 });
  assert.deepEqual(removed.book.wordIds, [W2]);
  assert.equal(removed.book.revision, 7);
  assert.deepEqual(setMembership({ book, wordId: W1, member: true, now, expectedRevision: 5 }).changes, []);
  assert.deepEqual(setMembership({ book, wordId: W2, member: false, now, expectedRevision: 5 }).changes, []);
  assert.deepEqual(book.wordIds, [W1], '不可修改輸入');
  const fav = setMembership({ book: favorites(), wordId: W1, member: true, now, expectedRevision: 0 });
  assert.equal(fav.book.system, true);
  assertValidChanges(fav.changes);
});

test('O04 加入簿 expectedRevision 不符回 REVISION_CONFLICT；不安全字 ID 拒絕；時間不倒退', () => {
  const book = bookWith('a', 'A', [], 5);
  assert.throws(() => setMembership({ book, wordId: W1, member: true, now, expectedRevision: 4 }),
    e => e.code === 'REVISION_CONFLICT' && e.details.actualRevision === 5);
  assert.throws(() => setMembership({ book, wordId: '__proto__', member: true, now, expectedRevision: 5 }), e => e.code === 'INVALID_DATA');
  assert.throws(() => setMembership({ book, wordId: W1, member: 'yes', now, expectedRevision: 5 }), e => e.code === 'INVALID_DATA');
  const earlier = setMembership({ book: { ...book, updatedAt: later }, wordId: W1, member: true, now, expectedRevision: 5 });
  assert.equal(earlier.book.updatedAt, later);
});

test('O04 每本最多 15000 字，第 15001 字拒絕', () => {
  const ids = Array.from({ length: MAX_BOOK_WORDS }, (_, i) => `ja-w-${i}`);
  const book = bookWith('a', 'A', ids, 1);
  assert.throws(() => setMembership({ book, wordId: 'ja-w-x', member: true, now, expectedRevision: 1 }),
    e => e.code === 'QUOTA_EXCEEDED' && e.details.limit === MAX_BOOK_WORDS);
  assert.equal(setMembership({ book, wordId: ids[0], member: false, now, expectedRevision: 1 }).book.wordIds.length, MAX_BOOK_WORDS - 1);
});

test('O04 筆記純文字保存（角括號與 HTML 原樣）、更新遞增 revision、相同內容不寫', () => {
  const text = '<b>注意</b> & <script>alert(1)</script>\n第二行';
  const created = saveNote({ note: null, wordId: W1, text, now, expectedRevision: null, epoch: 'e1', currentEpoch: 'e1' });
  assert.deepEqual(created.note, { wordId: W1, text, updatedAt: now, revision: 0 });
  assert.deepEqual(created.changes, [{ store: 'notes', key: W1, value: created.note }]);
  assertValidChanges(created.changes);
  const updated = saveNote({ note: created.note, wordId: W1, text: '新內容', now: later, expectedRevision: 0, epoch: 'e1', currentEpoch: 'e1' });
  assert.equal(updated.note.revision, 1);
  assert.equal(updated.note.updatedAt, later);
  assert.deepEqual(saveNote({ note: updated.note, wordId: W1, text: '新內容', now, expectedRevision: 1, epoch: 'e1', currentEpoch: 'e1' }).changes, []);
});

test('O04 筆記上限 2000 字（code point），超過拒絕', () => {
  const ok = saveNote({ note: null, wordId: W1, text: '😀'.repeat(MAX_NOTE_LENGTH), now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' });
  assertValidChanges(ok.changes);
  assert.throws(() => saveNote({ note: null, wordId: W1, text: 'a'.repeat(MAX_NOTE_LENGTH + 1), now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' }),
    e => e.code === 'INVALID_DATA' && e.details.limit === MAX_NOTE_LENGTH);
  assert.throws(() => saveNote({ note: null, wordId: W1, text: 42, now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' }), e => e.code === 'INVALID_DATA');
});

test('O04 空字串刪除筆記；不存在時刪除不產生變更', () => {
  const note = { wordId: W1, text: '舊', updatedAt: now, revision: 2 };
  const removed = saveNote({ note, wordId: W1, text: '', now, expectedRevision: 2, epoch: 'e', currentEpoch: 'e' });
  assert.equal(removed.note, null);
  assert.deepEqual(removed.changes, [{ store: 'notes', key: W1, delete: true }]);
  assert.deepEqual(saveNote({ note: null, wordId: W1, text: '', now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' }).changes, []);
});

test('O04 延遲保存不能復活已刪筆記：筆記已刪而 expectedRevision 是刪除前的，拒絕', () => {
  assert.throws(() => saveNote({ note: null, wordId: W1, text: '晚到內容', now: later, expectedRevision: 2, epoch: 'e', currentEpoch: 'e' }),
    e => e.code === 'REVISION_CONFLICT' && e.details.reason === 'NOTE_DELETED');
  const note = { wordId: W1, text: '別頁新建', updatedAt: now, revision: 0 };
  assert.throws(() => saveNote({ note, wordId: W1, text: '晚到', now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' }),
    e => e.code === 'REVISION_CONFLICT' && e.details.reason === 'NOTE_EXISTS');
  assert.throws(() => saveNote({ note: { ...note, revision: 3 }, wordId: W1, text: '晚到', now, expectedRevision: 2, epoch: 'e', currentEpoch: 'e' }),
    e => e.code === 'REVISION_CONFLICT');
});

test('O04 資料已清除／還原（epoch 不同）時延遲保存回 STALE_EPOCH；epoch 必填', () => {
  assert.throws(() => saveNote({ note: null, wordId: W1, text: '晚到', now, expectedRevision: null, epoch: 'old', currentEpoch: 'new' }), e => e.code === 'STALE_EPOCH');
  assert.throws(() => saveNote({ note: null, wordId: W1, text: '晚到', now, expectedRevision: null }), e => e.code === 'INVALID_DATA');
  assert.throws(() => setMembership({ book: bookWith('a', 'A'), wordId: W1, member: true, now, expectedRevision: 0, epoch: 'old', currentEpoch: 'new' }), e => e.code === 'STALE_EPOCH');
});

test('O04 來源簿已刪時晚到的筆記保存只寫 notes，不復活簿並標示 bookMissing', () => {
  const result = saveNote({ note: null, wordId: W1, text: '保留', now, expectedRevision: null, epoch: 'e', currentEpoch: 'e', bookExists: false });
  assert.equal(result.bookMissing, true);
  assert.ok(result.changes.every(change => change.store === 'notes'));
  assert.equal(saveNote({ note: null, wordId: W1, text: '保留', now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' }).bookMissing, false);
});

test('O04 未知／已移除字保留在簿與筆記中但不可出題', () => {
  const known = new Set([W1]);
  assert.equal(isQuizEligible(W1, known), true);
  assert.equal(isQuizEligible('ja-w-removed', known), false);
  assert.equal(isQuizEligible(W1, [W1]), true);
  assert.equal(isQuizEligible('__proto__', ['__proto__']), false);
  const book = bookWith('a', 'A', [W1, 'ja-w-removed']);
  assert.deepEqual(quizWordIds(book, known), { eligible: [W1], unavailable: ['ja-w-removed'] });
  const kept = setMembership({ book: { ...book, revision: 0 }, wordId: W2, member: true, now, expectedRevision: 0 });
  assert.ok(kept.book.wordIds.includes('ja-w-removed'), '加入其他字不偷偷清掉未知字');
  const note = saveNote({ note: null, wordId: 'ja-w-removed', text: '仍保留', now, expectedRevision: null, epoch: 'e', currentEpoch: 'e' });
  assertValidChanges(note.changes);
});

test('F20 純函式不修改 frozen 輸入', () => {
  const books = Object.freeze({ favorites: Object.freeze({ ...favorites(), wordIds: Object.freeze([]) }) });
  assert.doesNotThrow(() => createBook({ books, name: 'x', now, bookId: 'x' }));
  assert.doesNotThrow(() => setMembership({ book: books.favorites, wordId: W1, member: true, now, expectedRevision: 0 }));
  assert.throws(() => createBook({ books: { a: { ...bookWith('a', 'A'), name: '' } }, name: 'x', now, bookId: 'x' }), e => e.code === 'INVALID_DATA');
});
