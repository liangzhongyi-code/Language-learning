/**
 * 單字簿與筆記的獨立交換格式：匯出、匯入預覽與確認套用。
 * 只處理 books／notes 兩個集合，絕不包含或覆蓋統計、進度、排程與偏好。
 * 純函式：不讀時鐘、亂數或平台儲存；套用結果是 changes 清單，由 repository 同交易保存。
 */
import { LearningError } from './learning-errors.js';
import { validateLearningRecord, validatePlainJson } from './learning-schema.js';
import {
  FAVORITES_BOOK_ID, FAVORITES_BOOK_NAME, MAX_BOOKS, MAX_BOOK_NAME_LENGTH, MAX_BOOK_WORDS, MAX_NOTE_LENGTH,
  bookList, noteMap, bookNameKey, normalizeBookName, isSafeId, charLength, toWordIdSet,
} from './library.js';

export const LIBRARY_EXCHANGE_FORMAT = 'lang-learn-library';
export const LIBRARY_EXCHANGE_VERSION = 1;

/**
 * 匯入檔上限 10 MiB（以 UTF-8 bytes 計），在 JSON.parse 前檢查。
 */
export const MAX_LIBRARY_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * 單一交換檔的筆記數上限；另受檔案大小上限約束。
 */
export const MAX_EXCHANGE_NOTES = 50000;

const PREVIEW_KIND = 'library-import-preview';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (code, message, details = {}) => { throw new LearningError(code, message, details); };

function checkNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_DATA', '時間必須是有效的非負毫秒數。');
}

function checkRecord(collection, row) {
  const result = validateLearningRecord(collection, row);
  if (!result.ok) fail('INVALID_DATA', `單字簿資料不合法：${collection}`, { errors: result.errors });
}

function bump(revision) {
  if (revision >= Number.MAX_SAFE_INTEGER) fail('REVISION_EXHAUSTED', '修訂號已達上限。');
  return revision + 1;
}

/**
 * 逐字計算 UTF-8 bytes，超過 limit 即提早結束，不為超大字串配置編碼緩衝。
 * 未成對的 surrogate 依 TextEncoder 行為以 3 bytes（U+FFFD）計。
 */
function utf8ByteLength(text, limit = Infinity) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > limit) return bytes;
  }
  return bytes;
}

function tooLarge() {
  fail('QUOTA_EXCEEDED', `單字簿交換檔不可超過 ${MAX_LIBRARY_IMPORT_BYTES / 1024 / 1024} MiB。`, { limit: MAX_LIBRARY_IMPORT_BYTES });
}

/**
 * 匯出指定（或全部）單字簿與筆記。指定 bookIds 時只帶這些簿內字的筆記。
 * 收藏固定排第一，其餘依建立時間與 ID；筆記依 wordId 排序，輸出可重現。
 */
export function exportLibrary({ books, notes, now, bookIds }) {
  checkNow(now);
  const list = bookList(books);
  const notesByWord = noteMap(notes);
  let selected = list;
  if (bookIds !== undefined) {
    if (!Array.isArray(bookIds) || bookIds.some((id) => !isSafeId(id))) fail('INVALID_DATA', 'bookIds 必須是單字簿 ID 陣列。');
    const wanted = new Set(bookIds);
    for (const id of wanted) if (!list.some((row) => row.bookId === id)) fail('INVALID_DATA', '找不到要匯出的單字簿。', { bookId: id });
    selected = list.filter((row) => wanted.has(row.bookId));
  }
  selected = [...selected].sort((a, b) => Number(b.system) - Number(a.system) || a.createdAt - b.createdAt || compare(a.bookId, b.bookId));
  const scope = bookIds === undefined ? null : new Set(selected.flatMap((row) => row.wordIds));
  const exportedNotes = [...notesByWord.values()].filter((row) => scope === null || scope.has(row.wordId))
    .sort((a, b) => compare(a.wordId, b.wordId))
    .map((row) => ({ wordId: row.wordId, text: row.text, updatedAt: row.updatedAt }));
  const data = {
    format: LIBRARY_EXCHANGE_FORMAT, version: LIBRARY_EXCHANGE_VERSION, exportedAt: now,
    books: selected.map((row) => ({ bookId: row.bookId, name: row.name, system: row.system, wordIds: [...row.wordIds] })),
    notes: exportedNotes,
  };
  // 匯出檔必須能被自己的匯入讀回；超過上限時請改為指定部分單字簿。
  if (utf8ByteLength(JSON.stringify(data), MAX_LIBRARY_IMPORT_BYTES) > MAX_LIBRARY_IMPORT_BYTES) tooLarge();
  return data;
}

/**
 * 讀入文字或物件：先查大小，再確認是 plain JSON（拒絕 __proto__／constructor／prototype key）。
 */
function readInput(text, input) {
  if ((text === undefined) === (input === undefined)) fail('INVALID_DATA', '必須提供 text 或 object 其中之一。');
  let raw = input;
  if (text !== undefined) {
    if (typeof text !== 'string') fail('INVALID_DATA', '匯入內容必須是文字。');
    if (text.length > MAX_LIBRARY_IMPORT_BYTES || utf8ByteLength(text, MAX_LIBRARY_IMPORT_BYTES) > MAX_LIBRARY_IMPORT_BYTES) tooLarge();
    try { raw = JSON.parse(text); } catch { fail('INVALID_DATA', '匯入內容不是有效的 JSON。'); }
  }
  const plain = validatePlainJson(raw);
  if (!plain.ok) fail('INVALID_DATA', '匯入內容含不安全或非 JSON 的結構。', { errors: plain.errors });
  if (text === undefined && utf8ByteLength(JSON.stringify(raw), MAX_LIBRARY_IMPORT_BYTES) > MAX_LIBRARY_IMPORT_BYTES) tooLarge();
  return raw;
}

/**
 * 嚴格驗證交換檔：格式、版本、數量上限先判斷（整批拒絕並說明），其餘形狀問題一併列出。
 */
function validateExchange(raw) {
  if (!object(raw)) fail('INVALID_DATA', '匯入內容必須是物件。');
  if (raw.format !== LIBRARY_EXCHANGE_FORMAT) fail('INVALID_DATA', '這不是單字簿交換檔。');
  if (raw.version !== LIBRARY_EXCHANGE_VERSION) {
    fail('UNSUPPORTED_VERSION', `僅支援單字簿交換檔版本 ${LIBRARY_EXCHANGE_VERSION}。`, { version: raw.version });
  }
  if (!Array.isArray(raw.books) || !Array.isArray(raw.notes)) fail('INVALID_DATA', '交換檔必須包含 books 與 notes 陣列。');
  if (raw.books.length > MAX_BOOKS) {
    fail('QUOTA_EXCEEDED', `匯入檔超過 ${MAX_BOOKS} 本單字簿，整批未匯入。`, { limit: MAX_BOOKS, count: raw.books.length });
  }
  if (raw.notes.length > MAX_EXCHANGE_NOTES) {
    fail('QUOTA_EXCEEDED', `匯入檔超過 ${MAX_EXCHANGE_NOTES} 則筆記，整批未匯入。`, { limit: MAX_EXCHANGE_NOTES, count: raw.notes.length });
  }
  raw.books.forEach((row, index) => {
    if (object(row) && Array.isArray(row.wordIds) && row.wordIds.length > MAX_BOOK_WORDS) {
      fail('QUOTA_EXCEEDED', `單字簿「${typeof row.name === 'string' ? row.name : index + 1}」超過 ${MAX_BOOK_WORDS} 字，整批未匯入。`,
        { limit: MAX_BOOK_WORDS, index, count: row.wordIds.length });
    }
  });
  const errors = [];
  const issue = (path, message) => { if (errors.length < 100) errors.push({ code: 'INVALID_DATA', path, message }); };
  const onlyKeys = (value, path, allowed) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(`${path}[${JSON.stringify(key)}]`, '不接受未知欄位。');
  };
  onlyKeys(raw, '$', ['format', 'version', 'exportedAt', 'books', 'notes']);
  if (!Number.isSafeInteger(raw.exportedAt) || raw.exportedAt < 0) issue('$.exportedAt', '必須是有效的非負毫秒時間。');
  const names = new Set();
  let systemCount = 0;
  raw.books.forEach((row, index) => {
    const path = `$.books[${index}]`;
    if (!object(row)) return issue(path, '必須是物件。');
    onlyKeys(row, path, ['bookId', 'name', 'system', 'wordIds']);
    if (own(row, 'bookId') && !isSafeId(row.bookId)) issue(`${path}.bookId`, '必須是安全的 ID。');
    if (typeof row.system !== 'boolean') issue(`${path}.system`, '必須是布林值。');
    if (row.system === true && ++systemCount > 1) issue(path, '只能有一本收藏簿。');
    try {
      const name = normalizeBookName(row.name);
      if (row.system !== true) {
        if (names.has(bookNameKey(name))) issue(`${path}.name`, '匯入檔內有同名單字簿。');
        names.add(bookNameKey(name));
      }
    } catch (error) {
      issue(`${path}.name`, error.message ?? `名稱必須是 1 至 ${MAX_BOOK_NAME_LENGTH} 字。`);
    }
    if (!Array.isArray(row.wordIds)) issue(`${path}.wordIds`, '必須是陣列。');
    else row.wordIds.forEach((id, i) => { if (!isSafeId(id)) issue(`${path}.wordIds[${i}]`, '必須是安全的單字 ID。'); });
  });
  const seen = new Set();
  raw.notes.forEach((row, index) => {
    const path = `$.notes[${index}]`;
    if (!object(row)) return issue(path, '必須是物件。');
    onlyKeys(row, path, ['wordId', 'text', 'updatedAt']);
    if (!isSafeId(row.wordId)) issue(`${path}.wordId`, '必須是安全的單字 ID。');
    else if (seen.has(row.wordId)) issue(`${path}.wordId`, '同一個字只能有一則筆記。');
    else seen.add(row.wordId);
    if (typeof row.text !== 'string' || charLength(row.text) > MAX_NOTE_LENGTH) issue(`${path}.text`, `筆記必須是最多 ${MAX_NOTE_LENGTH} 字的文字。`);
    if (own(row, 'updatedAt') && (!Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0)) issue(`${path}.updatedAt`, '必須是有效的非負毫秒時間。');
  });
  if (errors.length) fail('INVALID_DATA', '單字簿交換檔不合法，整批未匯入。', { errors });
}

/**
 * 產生不與 taken 重複的「名稱 (n)」，必要時截短主幹以符合 60 字上限。
 */
function uniqueName(base, taken) {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const stem = [...base].slice(0, MAX_BOOK_NAME_LENGTH - charLength(suffix)).join('').trimEnd();
    const candidate = `${stem}${suffix}`;
    if (!taken.has(bookNameKey(candidate))) return candidate;
  }
}

/**
 * 依預覽與選擇計算每本目標簿的最終字數（合併採聯集），供預覽提示與套用判定共用。
 */
function projectLimits(localCount, targets, items, choose) {
  const unions = new Map();
  let bookCount = localCount;
  for (const item of items) {
    const strategy = choose(item);
    if (strategy === 'merge') {
      const id = item.target ? item.target.bookId : FAVORITES_BOOK_ID;
      if (!unions.has(id)) {
        unions.set(id, { name: item.target ? item.target.name : FAVORITES_BOOK_NAME, set: new Set(targets[id]?.wordIds ?? []) });
        if (!item.target) bookCount++;
      }
      for (const word of item.wordIds) unions.get(id).set.add(word);
    } else {
      bookCount++;
    }
  }
  const oversizedBooks = [...unions.entries()].filter(([, row]) => row.set.size > MAX_BOOK_WORDS)
    .map(([bookId, row]) => ({ bookId, name: row.name, wordCount: row.set.size }));
  return { maxBooks: MAX_BOOKS, maxBookWords: MAX_BOOK_WORDS, bookCount, oversizedBooks, exceeded: bookCount > MAX_BOOKS || oversizedBooks.length > 0 };
}

/**
 * 匯入預覽：不產生任何變更。回傳新增簿、同名衝突（預設合併，可另存新名）、
 * 重複字略過數、筆記衝突（預設保留本機，可選覆寫）與未知 wordId（保留但不可出題）。
 * HTML 內容的筆記原樣當純文字，顯示端負責跳脫。
 */
export function previewLibraryImport({ text, object: input, books, notes, knownWordIds, now }) {
  checkNow(now);
  const raw = readInput(text, input);
  validateExchange(raw);
  const localBooks = bookList(books);
  const localNotes = noteMap(notes);
  const known = toWordIdSet(knownWordIds);
  const favorites = localBooks.find((row) => row.bookId === FAVORITES_BOOK_ID) ?? null;
  const taken = new Set(localBooks.map((row) => bookNameKey(row.name)));
  for (const row of raw.books) if (!row.system) taken.add(bookNameKey(row.name));
  const targets = {};
  const unknown = new Set();
  let skippedDuplicateWords = 0;
  const items = raw.books.map((row, index) => {
    const name = row.system ? FAVORITES_BOOK_NAME : row.name.trim();
    const target = row.system ? favorites
      : localBooks.find((local) => bookNameKey(local.name) === bookNameKey(name)) ?? null;
    const seen = new Set();
    const wordIds = [];
    let duplicateInFile = 0;
    for (const id of row.wordIds) {
      if (seen.has(id)) { duplicateInFile++; continue; }
      seen.add(id);
      wordIds.push(id);
      if (!known.has(id)) unknown.add(id);
    }
    const localWords = new Set(target?.wordIds ?? []);
    const alreadyInBook = wordIds.filter((id) => localWords.has(id)).length;
    skippedDuplicateWords += duplicateInFile + alreadyInBook;
    if (target) targets[target.bookId] = clone(target);
    const suggestedName = target && !row.system ? uniqueName(name, taken) : null;
    if (suggestedName) taken.add(bookNameKey(suggestedName));
    return {
      index, name, system: row.system, wordIds, duplicateInFile, alreadyInBook,
      newWordCount: wordIds.length - alreadyInBook,
      target: target ? { bookId: target.bookId, name: target.name, revision: target.revision, wordCount: target.wordIds.length } : null,
      defaultStrategy: target || row.system ? 'merge' : 'create',
      suggestedName,
    };
  });
  const create = [];
  const conflicts = [];
  const localNoteSnapshots = {};
  const baseNotes = {};
  let unchanged = 0;
  let skippedEmpty = 0;
  for (const row of raw.notes) {
    const local = localNotes.get(row.wordId) ?? null;
    baseNotes[row.wordId] = local ? { revision: local.revision, text: local.text } : null;
    if (!known.has(row.wordId)) unknown.add(row.wordId);
    if (row.text === '') { skippedEmpty++; continue; }
    if (!local) create.push({ wordId: row.wordId, text: row.text });
    else if (local.text === row.text) unchanged++;
    else {
      localNoteSnapshots[row.wordId] = clone(local);
      conflicts.push({ wordId: row.wordId, localText: local.text, importedText: row.text, localRevision: local.revision,
        defaultChoice: 'keep', choices: ['keep', 'overwrite'] });
    }
  }
  create.sort((a, b) => compare(a.wordId, b.wordId));
  conflicts.sort((a, b) => compare(a.wordId, b.wordId));
  return {
    kind: PREVIEW_KIND, format: raw.format, version: raw.version, exportedAt: raw.exportedAt, previewedAt: now,
    books: items,
    newBooks: items.filter((item) => item.defaultStrategy === 'create')
      .map((item) => ({ index: item.index, name: item.name, wordCount: item.wordIds.length })),
    bookConflicts: items.filter((item) => item.target && !item.system).map((item) => ({
      index: item.index, name: item.name, target: item.target, defaultStrategy: 'merge', strategies: ['merge', 'rename'],
      suggestedName: item.suggestedName, alreadyInBook: item.alreadyInBook, newWordCount: item.newWordCount })),
    favoritesMerge: items.filter((item) => item.system)
      .map((item) => ({ index: item.index, newWordCount: item.newWordCount, alreadyInBook: item.alreadyInBook }))[0] ?? null,
    skippedDuplicateWords,
    notes: { create, conflicts, unchanged, skippedEmpty },
    unknownWordIds: [...unknown].sort(compare),
    limits: projectLimits(localBooks.length, targets, items, (item) => item.defaultStrategy),
    base: {
      books: localBooks.map((row) => ({ bookId: row.bookId, name: row.name, revision: row.revision })),
      notes: baseNotes,
    },
    local: { books: targets, notes: localNoteSnapshots },
  };
}

/**
 * 有提供目前 books／notes 時，確認預覽後本機沒有被其他頁面改動。
 */
function assertFresh(preview, books, notes) {
  const current = new Map(bookList(books ?? {}).map((row) => [row.bookId, row]));
  const stale = () => fail('STALE_PREVIEW', '單字簿在預覽後已變更，請重新預覽。');
  if (current.size !== preview.base.books.length) stale();
  for (const row of preview.base.books) {
    const latest = current.get(row.bookId);
    if (!latest || latest.revision !== row.revision || latest.name !== row.name) stale();
  }
  const currentNotes = noteMap(notes ?? {});
  for (const [wordId, base] of Object.entries(preview.base.notes)) {
    const row = currentNotes.get(wordId) ?? null;
    if ((row === null) !== (base === null) || row && (row.revision !== base.revision || row.text !== base.text)) stale();
  }
}

function readStrategy(choice) {
  if (choice === undefined) return { strategy: 'merge', name: null };
  const strategy = typeof choice === 'string' ? choice : object(choice) ? choice.strategy : undefined;
  if (!['merge', 'rename'].includes(strategy)) fail('INVALID_DATA', '同名單字簿只能選擇合併或另存新名。');
  const name = object(choice) && choice.name !== undefined ? choice.name : null;
  return { strategy, name };
}

/**
 * 確認匯入：依 choices 產生 books／notes 的 changes，不碰統計、進度、排程或偏好。
 * choices.books[index] 為 'merge'｜'rename'｜{ strategy, name }；choices.notes[wordId] 為 'keep'｜'overwrite'。
 * newBookId({ index, name }) 由呼叫端注入安全且唯一的新 ID。
 * 套用後超過 100 本或任何一本超過 15000 字時整批拒絕並說明。
 * 傳入目前 books／notes 時會檢查預覽是否過期（STALE_PREVIEW）。
 */
export function applyLibraryImport(preview, choices = {}, { now, newBookId, books, notes } = {}) {
  checkNow(now);
  if (!object(preview) || preview.kind !== PREVIEW_KIND || !validatePlainJson(preview).ok) fail('INVALID_DATA', '匯入預覽不合法，請重新預覽。');
  if (typeof newBookId !== 'function') fail('INVALID_DATA', '必須提供 newBookId 產生新單字簿 ID。');
  if (!object(choices)) fail('INVALID_DATA', 'choices 必須是物件。');
  const bookChoices = choices.books ?? {};
  const noteChoices = choices.notes ?? {};
  if (!object(bookChoices) || !object(noteChoices)) fail('INVALID_DATA', 'choices.books／choices.notes 必須是物件。');
  if (books !== undefined || notes !== undefined) assertFresh(preview, books, notes);

  const decided = new Map();
  for (const item of preview.books) {
    if (item.system || !item.target) decided.set(item.index, { strategy: item.defaultStrategy, name: null });
    else decided.set(item.index, readStrategy(own(bookChoices, String(item.index)) ? bookChoices[item.index] : undefined));
  }
  const limits = projectLimits(preview.base.books.length, preview.local.books, preview.books, (item) => decided.get(item.index).strategy);
  if (limits.bookCount > MAX_BOOKS) {
    fail('QUOTA_EXCEEDED', `匯入後會超過 ${MAX_BOOKS} 本單字簿，整批未匯入。`, { limit: MAX_BOOKS, bookCount: limits.bookCount });
  }
  if (limits.oversizedBooks.length) {
    fail('QUOTA_EXCEEDED', `合併後單字簿超過 ${MAX_BOOK_WORDS} 字，整批未匯入；可改為另存新名。`,
      { limit: MAX_BOOK_WORDS, oversizedBooks: limits.oversizedBooks });
  }

  const taken = new Set(preview.base.books.map((row) => bookNameKey(row.name)));
  for (const item of preview.books) if (decided.get(item.index).strategy === 'create') taken.add(bookNameKey(item.name));
  const usedIds = new Set(preview.base.books.map((row) => row.bookId));
  const merged = new Map();
  const changed = new Set();
  const created = [];
  let wordsAdded = 0;
  for (const item of preview.books) {
    const { strategy, name: customName } = decided.get(item.index);
    if (strategy === 'merge') {
      const id = item.target ? item.target.bookId : FAVORITES_BOOK_ID;
      if (!merged.has(id)) {
        merged.set(id, item.target ? clone(preview.local.books[id])
          : { bookId: FAVORITES_BOOK_ID, name: FAVORITES_BOOK_NAME, system: true, wordIds: [], revision: 0, createdAt: now, updatedAt: now });
        if (!item.target) changed.add(id);
      }
      const row = merged.get(id);
      const present = new Set(row.wordIds);
      for (const word of item.wordIds) {
        if (present.has(word)) continue;
        present.add(word);
        row.wordIds.push(word);
        changed.add(id);
        wordsAdded++;
      }
      continue;
    }
    const name = strategy === 'create' ? item.name : normalizeBookName(customName ?? item.suggestedName);
    if (strategy === 'rename') {
      const key = bookNameKey(name);
      if (taken.has(key)) fail('ENTRY_CONFLICT', `已有同名單字簿「${name}」。`, { reason: 'DUPLICATE_NAME', name });
      taken.add(key);
    }
    const bookId = newBookId({ index: item.index, name });
    if (!isSafeId(bookId) || bookId === FAVORITES_BOOK_ID || usedIds.has(bookId)) fail('INVALID_DATA', '新單字簿 ID 不合法或重複。', { bookId: String(bookId) });
    usedIds.add(bookId);
    created.push({ bookId, name, system: false, wordIds: [...item.wordIds], revision: 0, createdAt: now, updatedAt: now });
    wordsAdded += item.wordIds.length;
  }

  const changes = [];
  let favoritesCreated = false;
  for (const [id, row] of merged) {
    if (!changed.has(id)) continue;
    if (preview.local.books[id]) {
      row.revision = bump(row.revision);
      row.updatedAt = Math.max(now, row.updatedAt);
    } else favoritesCreated = true;
    checkRecord('books', row);
    changes.push({ store: 'books', key: id, value: clone(row) });
  }
  for (const row of created) {
    checkRecord('books', row);
    changes.push({ store: 'books', key: row.bookId, value: clone(row) });
  }
  for (const row of preview.notes.create) {
    const note = { wordId: row.wordId, text: row.text, updatedAt: now, revision: 0 };
    checkRecord('notes', note);
    changes.push({ store: 'notes', key: row.wordId, value: note });
  }
  let notesOverwritten = 0;
  let notesKept = 0;
  for (const conflict of preview.notes.conflicts) {
    const choice = own(noteChoices, conflict.wordId) ? noteChoices[conflict.wordId] : conflict.defaultChoice;
    if (!['keep', 'overwrite'].includes(choice)) fail('INVALID_DATA', '筆記衝突只能選擇保留本機或覆寫。', { wordId: conflict.wordId });
    if (choice === 'keep') { notesKept++; continue; }
    const local = preview.local.notes[conflict.wordId];
    const note = { wordId: conflict.wordId, text: conflict.importedText, updatedAt: Math.max(now, local.updatedAt), revision: bump(local.revision) };
    checkRecord('notes', note);
    changes.push({ store: 'notes', key: conflict.wordId, value: note });
    notesOverwritten++;
  }
  return {
    changes,
    summary: {
      booksCreated: created.length + Number(favoritesCreated), booksMerged: changed.size - Number(favoritesCreated), wordsAdded,
      notesCreated: preview.notes.create.length, notesOverwritten, notesKept, unknownWordIds: [...preview.unknownWordIds],
    },
  };
}
