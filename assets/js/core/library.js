/**
 * 收藏、自訂單字簿與筆記的純狀態轉換。只回傳候選紀錄與 changes 清單，
 * 由 repository 同交易保存；不讀時鐘、亂數或平台儲存，now 與新 ID 由呼叫端注入。
 * changes 沿用 repository commit 格式：{ store, key, value } 或 { store, key, delete: true }。
 */
import { LearningError } from './learning-errors.js';
import { validateLearningRecord } from './learning-schema.js';

/**
 * 固定系統簿的 ID 與顯示名稱，與 emptyLearning 建立的收藏簿一致。
 */
export const FAVORITES_BOOK_ID = 'favorites';
export const FAVORITES_BOOK_NAME = '收藏';

/**
 * 上限常數；名稱與筆記長度一律以 code point（[...str].length）計算。
 * 簿數上限包含固定收藏簿。
 */
export const MAX_BOOKS = 100;
export const MAX_BOOK_NAME_LENGTH = 60;
export const MAX_BOOK_WORDS = 15000;
export const MAX_NOTE_LENGTH = 2000;

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (code, message, details = {}) => { throw new LearningError(code, message, details); };

/**
 * 以 code point 計算字數，emoji 等補充平面字元算一字。
 */
export const charLength = (text) => [...text].length;

/**
 * 與 learning-schema 的 id 規則一致：非空、最多 256 字元、無前後空白與控制字元、非原型 key。
 */
export function isSafeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && !forbidden.has(value);
}

function checkId(value, label) {
  if (!isSafeId(value)) fail('INVALID_DATA', `${label}不是安全的 ID。`);
}

function checkNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_DATA', '時間必須是有效的非負毫秒數。');
}

function checkRecord(collection, row) {
  const result = validateLearningRecord(collection, row);
  if (!result.ok) fail('INVALID_DATA', `單字簿資料不合法：${collection}`, { errors: result.errors });
}

/**
 * epoch 是編輯開始時的資料世代、currentEpoch 是保存時 repository 的世代。
 * 兩者不同代表期間已清除或還原，延遲保存不能寫進新世代。
 */
export function checkEpoch(epoch, currentEpoch, required = false) {
  if (!required && epoch === undefined && currentEpoch === undefined) return;
  if (typeof epoch !== 'string' || typeof currentEpoch !== 'string' || !epoch || !currentEpoch) {
    fail('INVALID_DATA', '必須提供編輯時與目前的資料世代。');
  }
  if (epoch !== currentEpoch) fail('STALE_EPOCH', '資料已清除或還原，這次的變更沒有保存。', { epoch, currentEpoch });
}

function checkRevision(actual, expected) {
  if (!Number.isSafeInteger(expected) || expected < 0) fail('INVALID_DATA', 'expectedRevision 必須是非負整數。');
  if (actual !== expected) {
    fail('REVISION_CONFLICT', '資料已在其他頁面變更，請重新載入後再試。', { expectedRevision: expected, actualRevision: actual });
  }
}

function bump(revision) {
  if (revision >= Number.MAX_SAFE_INTEGER) fail('REVISION_EXHAUSTED', '修訂號已達上限。');
  return revision + 1;
}

/**
 * 接受 ID-keyed 物件或陣列，逐筆驗證後回傳陣列；物件 key 必須等於 bookId。
 */
export function bookList(books) {
  if (books === null || typeof books !== 'object') fail('INVALID_DATA', '單字簿集合必須是物件或陣列。');
  const rows = Array.isArray(books) ? books : Object.values(books);
  if (!Array.isArray(books)) {
    for (const [key, row] of Object.entries(books)) if (row?.bookId !== key) fail('INVALID_DATA', '單字簿 key 與 bookId 不符。');
  }
  const seen = new Set();
  for (const row of rows) {
    checkRecord('books', row);
    if (seen.has(row.bookId)) fail('INVALID_DATA', '單字簿 ID 重複。');
    seen.add(row.bookId);
  }
  return rows;
}

/**
 * 接受 ID-keyed 物件或陣列，逐筆驗證後回傳以 wordId 為 key 的 Map。
 */
export function noteMap(notes) {
  if (notes === null || typeof notes !== 'object') fail('INVALID_DATA', '筆記集合必須是物件或陣列。');
  const rows = Array.isArray(notes) ? notes : Object.values(notes);
  if (!Array.isArray(notes)) {
    for (const [key, row] of Object.entries(notes)) if (row?.wordId !== key) fail('INVALID_DATA', '筆記 key 與 wordId 不符。');
  }
  const map = new Map();
  for (const row of rows) {
    checkRecord('notes', row);
    if (map.has(row.wordId)) fail('INVALID_DATA', '筆記 wordId 重複。');
    map.set(row.wordId, row);
  }
  return map;
}

/**
 * 同名比較鍵：去頭尾空白、NFKC（全半形一致）並忽略大小寫。只用於比對，不改寫保存的名稱。
 */
export function bookNameKey(name) {
  return name.trim().normalize('NFKC').toLowerCase();
}

/**
 * 回傳 trim 後的名稱；空白、控制字元或超過 60 字一律拒絕。
 */
export function normalizeBookName(name) {
  if (typeof name !== 'string') fail('INVALID_DATA', '單字簿名稱必須是文字。');
  const trimmed = name.trim();
  if (!trimmed) fail('INVALID_DATA', '單字簿名稱不可空白。');
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) fail('INVALID_DATA', '單字簿名稱不可包含控制字元。');
  if (charLength(trimmed) > MAX_BOOK_NAME_LENGTH) {
    fail('INVALID_DATA', `單字簿名稱最多 ${MAX_BOOK_NAME_LENGTH} 字。`, { limit: MAX_BOOK_NAME_LENGTH });
  }
  return trimmed;
}

function assertUniqueName(list, name, exceptId) {
  const key = bookNameKey(name);
  const clash = list.find((row) => row.bookId !== exceptId && bookNameKey(row.name) === key);
  if (clash) {
    fail('ENTRY_CONFLICT', `已有同名單字簿「${clash.name}」。`, { reason: 'DUPLICATE_NAME', bookId: clash.bookId, name: clash.name });
  }
}

function findBook(list, bookId) {
  checkId(bookId, '單字簿 ');
  return list.find((row) => row.bookId === bookId) ?? null;
}

function bookDeleted(bookId) {
  fail('REVISION_CONFLICT', '單字簿已被刪除，這次的變更沒有保存。', { reason: 'BOOK_DELETED', bookId });
}

/**
 * 建立自訂簿。bookId 由呼叫端注入（安全 ID），不可為 favorites 或與既有簿重複。
 */
export function createBook({ books, name, now, bookId, epoch, currentEpoch }) {
  checkNow(now);
  checkEpoch(epoch, currentEpoch);
  const list = bookList(books);
  checkId(bookId, '單字簿 ');
  if (bookId === FAVORITES_BOOK_ID) fail('INVALID_OPERATION', '收藏是固定系統簿，不能另外建立。');
  if (list.some((row) => row.bookId === bookId)) fail('ENTRY_CONFLICT', '單字簿 ID 已存在。', { reason: 'DUPLICATE_ID', bookId });
  const trimmed = normalizeBookName(name);
  assertUniqueName(list, trimmed, null);
  if (list.length >= MAX_BOOKS) fail('QUOTA_EXCEEDED', `單字簿最多 ${MAX_BOOKS} 本（含收藏）。`, { limit: MAX_BOOKS });
  const book = { bookId, name: trimmed, system: false, wordIds: [], revision: 0, createdAt: now, updatedAt: now };
  checkRecord('books', book);
  return { book, changes: [{ store: 'books', key: bookId, value: clone(book) }] };
}

/**
 * 改名遞增 revision；收藏不可改名，已刪除的簿不會因晚到的改名而復活。
 */
export function renameBook({ books, bookId, name, now, expectedRevision, epoch, currentEpoch }) {
  checkNow(now);
  checkEpoch(epoch, currentEpoch);
  const list = bookList(books);
  const book = findBook(list, bookId);
  if (!book) bookDeleted(bookId);
  if (book.system) fail('INVALID_OPERATION', '收藏是固定系統簿，不能改名。');
  checkRevision(book.revision, expectedRevision);
  const trimmed = normalizeBookName(name);
  if (trimmed === book.name) return { book: clone(book), changes: [] };
  assertUniqueName(list, trimmed, bookId);
  const next = { ...clone(book), name: trimmed, revision: bump(book.revision), updatedAt: Math.max(now, book.updatedAt) };
  checkRecord('books', next);
  return { book: next, changes: [{ store: 'books', key: bookId, value: clone(next) }] };
}

/**
 * 只刪除指定的自訂簿；不刪筆記、不刪其他簿，也不碰任何學習歷史或排程。
 * 已不存在時視為已完成，不產生變更。
 */
export function deleteBook({ books, bookId, expectedRevision, epoch, currentEpoch }) {
  checkEpoch(epoch, currentEpoch);
  const list = bookList(books);
  checkId(bookId, '單字簿 ');
  if (bookId === FAVORITES_BOOK_ID) fail('INVALID_OPERATION', '收藏是固定系統簿，不能刪除。');
  const book = findBook(list, bookId);
  if (!book) return { deleted: false, changes: [] };
  checkRevision(book.revision, expectedRevision);
  return { deleted: true, changes: [{ store: 'books', key: bookId, delete: true }] };
}

/**
 * 加入或移出一個字。book 為 null 代表已刪除，晚到的操作不能復活它。
 * 已是目標狀態時不產生變更；加入時保留既有順序（含未知字）並附加在最後。
 */
export function setMembership({ book, wordId, member, now, expectedRevision, epoch, currentEpoch }) {
  checkNow(now);
  checkEpoch(epoch, currentEpoch);
  if (book === null || book === undefined) bookDeleted(null);
  checkRecord('books', book);
  checkId(wordId, '單字 ');
  if (typeof member !== 'boolean') fail('INVALID_DATA', 'member 必須是布林值。');
  checkRevision(book.revision, expectedRevision);
  const present = book.wordIds.includes(wordId);
  if (present === member) return { book: clone(book), changes: [] };
  if (member && book.wordIds.length >= MAX_BOOK_WORDS) {
    fail('QUOTA_EXCEEDED', `每本單字簿最多 ${MAX_BOOK_WORDS} 字。`, { limit: MAX_BOOK_WORDS, bookId: book.bookId });
  }
  const wordIds = member ? [...book.wordIds, wordId] : book.wordIds.filter((id) => id !== wordId);
  const next = { ...clone(book), wordIds, revision: bump(book.revision), updatedAt: Math.max(now, book.updatedAt) };
  checkRecord('books', next);
  return { book: next, changes: [{ store: 'books', key: book.bookId, value: clone(next) }] };
}

/**
 * 保存筆記純文字：不轉 HTML、不去除角括號，顯示端負責跳脫。空字串代表刪除。
 * expectedRevision 為 null 表示編輯開始時尚無筆記；為數字表示編輯的是該 revision。
 * 筆記已被刪除而 expectedRevision 仍是刪除前的值時拒絕，延遲保存不能復活已刪資料。
 * epoch／currentEpoch 必填，資料已清除或還原時回 STALE_EPOCH。
 * bookExists 為 false 表示來源簿已刪；仍只保存筆記（筆記屬於字而非簿），不會產生 books 變更。
 */
export function saveNote({ note = null, wordId, text, now, expectedRevision, epoch, currentEpoch, bookExists }) {
  checkNow(now);
  checkEpoch(epoch, currentEpoch, true);
  checkId(wordId, '單字 ');
  if (typeof text !== 'string') fail('INVALID_DATA', '筆記必須是文字。');
  if (charLength(text) > MAX_NOTE_LENGTH) fail('INVALID_DATA', `筆記最多 ${MAX_NOTE_LENGTH} 字。`, { limit: MAX_NOTE_LENGTH });
  if (bookExists !== undefined && typeof bookExists !== 'boolean') fail('INVALID_DATA', 'bookExists 必須是布林值。');
  if (note !== null) {
    checkRecord('notes', note);
    if (note.wordId !== wordId) fail('INVALID_DATA', '筆記與單字不一致。');
  }
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    fail('INVALID_DATA', 'expectedRevision 必須是 null 或非負整數。');
  }
  const bookMissing = bookExists === false;
  if (note === null && expectedRevision !== null) {
    fail('REVISION_CONFLICT', '筆記已在其他頁面刪除，這次的變更沒有保存。', { reason: 'NOTE_DELETED', wordId, expectedRevision });
  }
  if (note !== null && expectedRevision === null) {
    fail('REVISION_CONFLICT', '其他頁面已新增這個字的筆記，請重新載入後再試。', { reason: 'NOTE_EXISTS', wordId, actualRevision: note.revision });
  }
  if (note !== null) checkRevision(note.revision, expectedRevision);
  if (text === '') {
    return note === null ? { note: null, changes: [], bookMissing }
      : { note: null, changes: [{ store: 'notes', key: wordId, delete: true }], bookMissing };
  }
  if (note !== null && note.text === text) return { note: clone(note), changes: [], bookMissing };
  const next = note === null ? { wordId, text, updatedAt: now, revision: 0 }
    : { wordId, text, updatedAt: Math.max(now, note.updatedAt), revision: bump(note.revision) };
  checkRecord('notes', next);
  return { note: next, changes: [{ store: 'notes', key: wordId, value: clone(next) }], bookMissing };
}

/**
 * 題庫已知字可用 Set 或任何可迭代集合傳入；Set 直接沿用，不複製。
 */
export function toWordIdSet(knownWordIds) {
  if (knownWordIds instanceof Set) return knownWordIds;
  if (knownWordIds === null || knownWordIds === undefined || typeof knownWordIds[Symbol.iterator] !== 'function') {
    fail('INVALID_DATA', 'knownWordIds 必須是 Set 或陣列。');
  }
  return new Set(knownWordIds);
}

/**
 * 未知或已從題庫移除的 wordId 仍保留在簿與筆記中，但不可出題、也不偷換成別字。
 */
export function isQuizEligible(wordId, knownWordIds) {
  return isSafeId(wordId) && toWordIdSet(knownWordIds).has(wordId);
}

/**
 * 把簿內字分成可出題與不可出題兩組，保持原順序，供指定簿練習與 UI 標示使用。
 */
export function quizWordIds(book, knownWordIds) {
  checkRecord('books', book);
  const known = toWordIdSet(knownWordIds);
  const eligible = [];
  const unavailable = [];
  for (const id of book.wordIds) (known.has(id) ? eligible : unavailable).push(id);
  return { eligible, unavailable };
}
