/**
 * 收藏／單字簿／筆記／學習意向的交易操作。規則在 core/library*.js 與 learning-intents.js，
 * 這裡讀取最新列、帶入目前 epoch 與 revision，以一次提交保存；衝突時重讀重算。
 */
import { createBook, renameBook, deleteBook, setMembership, saveNote, FAVORITES_BOOK_ID } from '../../core/library.js';
import { exportLibrary, previewLibraryImport, applyLibraryImport } from '../../core/library-exchange.js';
import { setWantToLearn, setSelfAssessedKnown, withdrawSelfAssessed } from '../../core/learning-intents.js';
import { newOperationId } from './learning-store.js';

const STORES = ['books', 'notes', 'intents'];

export function createLibraryService({ store, now = () => Date.now() }) {
  async function snapshot() {
    const { meta, rows } = await store.read(STORES);
    return { meta, books: rows.books, notes: rows.notes, intents: rows.intents };
  }

  function run(prefix, build, options) {
    return store.commit({ stores: STORES, operationId: newOperationId(prefix, now()), build, ...options });
  }

  return {
    snapshot,
    create(name) {
      const bookId = newOperationId('book', now());
      return run('book-create', (rows, meta) => {
        const made = createBook({ books: rows.books, name, now: now(), bookId, epoch: meta.dataEpoch, currentEpoch: meta.dataEpoch });
        return { changes: made.changes, value: made.book };
      });
    },
    rename(bookId, name, expectedRevision) {
      return run('book-rename', (rows, meta) => renameBook({ books: rows.books, bookId, name, now: now(), expectedRevision,
        epoch: meta.dataEpoch, currentEpoch: meta.dataEpoch }).changes);
    },
    remove(bookId, expectedRevision) {
      return run('book-delete', (rows, meta) => deleteBook({ books: rows.books, bookId, expectedRevision,
        epoch: meta.dataEpoch, currentEpoch: meta.dataEpoch }).changes);
    },
    /**
     * 加入／移出時以最新 revision 計算：使用者在另一分頁先改了同一本，仍以目前內容為準，不覆蓋。
     */
    setMember(bookId, wordId, member) {
      return run('book-member', (rows, meta) => {
        const book = rows.books[bookId] ?? null;
        return setMembership({ book, wordId, member, now: now(), expectedRevision: book?.revision ?? 0,
          epoch: meta.dataEpoch, currentEpoch: meta.dataEpoch }).changes;
      });
    },
    toggleFavorite(wordId) {
      return run('favorite', (rows, meta) => {
        const book = rows.books[FAVORITES_BOOK_ID];
        return setMembership({ book, wordId, member: !book.wordIds.includes(wordId), now: now(),
          expectedRevision: book.revision, epoch: meta.dataEpoch, currentEpoch: meta.dataEpoch }).changes;
      });
    },
    /**
     * 筆記保存帶著開始編輯時看到的 revision 與 epoch；其間被刪除、改寫或資料已清除都會被拒絕。
     */
    saveNote(wordId, text, { expectedRevision, epoch }) {
      return run('note', (rows, meta) => saveNote({ note: rows.notes[wordId] ?? null, wordId, text, now: now(),
        expectedRevision, epoch, currentEpoch: meta.dataEpoch }).changes);
    },
    setWant(sourceId, value) {
      return run('intent-want', (rows) => setWantToLearn({ intent: rows.intents[sourceId] ?? null, sourceId, value, now: now() }).changes);
    },
    setKnown(sourceId, known) {
      return run('intent-known', (rows) => (known
        ? setSelfAssessedKnown({ intent: rows.intents[sourceId] ?? null, sourceId, now: now() })
        : withdrawSelfAssessed({ intent: rows.intents[sourceId] ?? null, sourceId, now: now() })).changes);
    },
    async exportBooks(bookIds) {
      const { books, notes } = await snapshot();
      return exportLibrary({ books, notes, now: now(), bookIds });
    },
    async previewImport(text, knownWordIds) {
      const { books, notes } = await snapshot();
      return previewLibraryImport({ text, books, notes, knownWordIds, now: now() });
    },
    /**
     * 匯入整批一次交易；預覽後本機若已變更（STALE_PREVIEW）整批拒絕，請使用者重新預覽。
     */
    applyImport(preview, choices) {
      return run('library-import', (rows) => {
        let n = 0;
        return applyLibraryImport(preview, choices, { now: now(), books: rows.books, notes: rows.notes,
          newBookId: () => newOperationId(`book${n++}`, now()) }).changes;
      }, { large: true });
    },
  };
}
