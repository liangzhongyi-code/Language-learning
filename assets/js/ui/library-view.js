/**
 * 單字簿頁：收藏與自訂單字簿、筆記、想學／自評已會，以及單字簿的匯出匯入。
 *
 * 單字簿跨語言共用，這一頁只列出本語言的字；題庫已移除的字保留在簿內但標示不出題。
 * 筆記一律以文字節點顯示，不當 HTML 解讀。
 */
import { awaitLearningStore } from './storage-gate.js';
import { createLibraryService } from './platform/library-service.js';
import { storageMessage } from './platform/learning-store.js';
import { FAVORITES_BOOK_ID, MAX_NOTE_LENGTH } from '../core/library.js';
import { describeIntent } from '../core/learning-intents.js';
import { applySpeechFallback, bindSpeakButtons } from './speech.js';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function initLibraryPage({ lang, words, mount, noticeHost }) {
  const byId = new Map(words.map((word) => [word.id, word]));
  const knownIds = new Set(words.map((word) => word.id));
  const params = new URLSearchParams(window.location.search);
  let service = null;
  let data = null;
  let selected = params.get('book') || FAVORITES_BOOK_ID;
  let query = '';
  let editing = null;
  let importPreview = null;
  let importChoices = { books: {}, notes: {} };

  const shell = document.createElement('div');
  const status = document.createElement('p');
  status.className = 'backup-msg';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const say = (text) => { status.textContent = text; status.hidden = !text; };

  async function refresh() {
    try {
      data = await service.snapshot();
    } catch (error) {
      say(storageMessage(error));
      return;
    }
    if (!data.books[selected]) selected = FAVORITES_BOOK_ID;
    render();
  }

  async function act(promise, done) {
    try {
      await promise;
      if (done) say(done);
    } catch (error) {
      say(`沒有變更：${error?.code === 'REVISION_CONFLICT' || error?.code === 'STALE_PREVIEW' ? error.message : storageMessage(error)}`);
    }
    await refresh();
  }

  const langIds = (book) => book.wordIds.filter((id) => id.startsWith(`${lang}-`));

  function booksHtml() {
    const books = Object.values(data.books).sort((a, b) => (a.system ? -1 : b.system ? 1 : a.createdAt - b.createdAt));
    return `<ul class="book-list">${books.map((book) => `
      <li>
        <span class="book-name">${book.system ? '★ ' : ''}${esc(book.name)}　<span class="hint">${langIds(book).length} 字</span></span>
        <button class="btn ghost sm" type="button" data-open="${esc(book.bookId)}" aria-pressed="${book.bookId === selected}">查看</button>
        <a class="btn ghost sm" href="./practice.html?book=${encodeURIComponent(book.bookId)}">練習這本</a>
        ${book.system ? '' : `<button class="btn ghost sm" type="button" data-rename="${esc(book.bookId)}">改名</button>
          <button class="btn ghost sm" type="button" data-delete="${esc(book.bookId)}">刪除</button>`}
      </li>`).join('')}</ul>`;
  }

  function wordRow(id, book) {
    const word = byId.get(id);
    const note = data.notes[id];
    const intent = describeIntent(data.intents[id] ?? null);
    const isEditing = editing?.wordId === id;
    return `<li>
      <span class="book-name">
        ${word ? `<span lang="${lang}">${esc(word.target)}</span>${word.reading && word.reading !== word.target ? `（<span lang="${lang}">${esc(word.reading)}</span>）` : ''}　${esc(word.zh)}`
          : `<span class="hint">${esc(id)}（題庫已移除，保留但不出題）</span>`}
        ${intent.wantToLearn ? '<span class="hint">　想學</span>' : ''}
        ${intent.selfAssessedKnown ? '<span class="hint">　自評已會（未驗證）</span>' : ''}
        ${note && !isEditing ? `<span class="note-text" data-note-text="${esc(id)}"></span>` : ''}
      </span>
      ${word ? `<button class="speak" type="button" data-speak="${esc(word.reading || word.target)}" data-speak-lang="${lang}" aria-label="朗讀">🔊</button>` : ''}
      <button class="btn ghost sm" type="button" data-note="${esc(id)}">${note ? '改筆記' : '寫筆記'}</button>
      <button class="btn ghost sm" type="button" data-want="${esc(id)}" aria-pressed="${intent.wantToLearn}">想學</button>
      ${intent.selfAssessedKnown ? `<button class="btn ghost sm" type="button" data-unknown="${esc(id)}">撤回自評</button>` : ''}
      <button class="btn ghost sm" type="button" data-remove="${esc(id)}" data-book="${esc(book.bookId)}">移出</button>
      ${isEditing ? `<div class="field-row" style="width:100%">
        <label class="setting-label" for="note-${esc(id)}">筆記（純文字，最多 ${MAX_NOTE_LENGTH} 字；清空後保存即刪除）</label>
        <textarea id="note-${esc(id)}" class="backup-code" data-note-input rows="3" maxlength="${MAX_NOTE_LENGTH}"></textarea>
        <button class="btn sm" type="button" data-note-save>保存筆記</button>
        <button class="btn ghost sm" type="button" data-note-cancel>取消</button>
      </div>` : ''}
    </li>`;
  }

  function searchResults() {
    const q = query.trim().toLowerCase();
    if (!q) return '';
    const book = data.books[selected];
    const hits = words.filter((word) => [word.target, word.reading, word.romaji, word.zh]
      .some((field) => typeof field === 'string' && field.toLowerCase().includes(q))).slice(0, 30);
    if (!hits.length) return '<p class="hint">找不到符合的單字。</p>';
    return `<ul class="book-list">${hits.map((word) => {
      const inBook = book.wordIds.includes(word.id);
      const fav = data.books[FAVORITES_BOOK_ID].wordIds.includes(word.id);
      return `<li><span class="book-name"><span lang="${lang}">${esc(word.target)}</span>　${esc(word.zh)}</span>
        <button class="btn ghost sm" type="button" data-fav="${esc(word.id)}" aria-pressed="${fav}">${fav ? '★ 已收藏' : '☆ 收藏'}</button>
        ${selected === FAVORITES_BOOK_ID ? '' : `<button class="btn ghost sm" type="button" data-add="${esc(word.id)}" ${inBook ? 'disabled' : ''}>${inBook ? '已在這本' : `加入「${esc(book.name)}」`}</button>`}
      </li>`;
    }).join('')}</ul>`;
  }

  function importHtml() {
    if (!importPreview) return '';
    const p = importPreview;
    const conflicts = p.bookConflicts.map((c) => `<li>「${esc(c.name)}」與本機同名：
      <label><input type="radio" name="bc-${c.index}" data-book-choice="${c.index}" value="merge" ${(importChoices.books[c.index] ?? 'merge') === 'merge' ? 'checked' : ''}> 合併</label>
      <label><input type="radio" name="bc-${c.index}" data-book-choice="${c.index}" value="rename" ${importChoices.books[c.index] === 'rename' ? 'checked' : ''}> 另存為「${esc(c.suggestedName)}」</label></li>`).join('');
    return `<div class="backup-preview">
      <p><b>單字簿匯入預覽</b></p>
      <p class="backup-now">新增 ${p.newBooks.length} 本　·　同名 ${p.bookConflicts.length} 本　·　略過重複字 ${p.skippedDuplicateWords}　·　新筆記 ${p.notes.create.length}　·　筆記衝突 ${p.notes.conflicts.length}${p.favoritesMerge ? `　·　收藏加入 ${p.favoritesMerge.newWordCount} 字` : ''}</p>
      ${p.unknownWordIds.length ? `<p class="backup-warn">有 ${p.unknownWordIds.length} 個字不在目前題庫：會保留在簿內，但不會出題。</p>` : ''}
      ${conflicts ? `<ul>${conflicts}</ul>` : ''}
      ${p.notes.conflicts.length ? `<label class="backup-now"><input type="checkbox" data-overwrite-notes ${importChoices.overwriteNotes ? 'checked' : ''}> 筆記衝突時用匯入的內容覆寫本機（預設保留本機）</label>` : ''}
      <p class="backup-note">只會新增或合併單字簿與筆記，不會動到統計、學習進度或偏好設定。</p>
      <div class="backup-actions">
        <button class="btn sm" type="button" data-import-confirm>確認匯入</button>
        <button class="btn ghost sm" type="button" data-import-cancel>取消</button>
      </div></div>`;
  }

  function knownListHtml() {
    const rows = Object.values(data.intents).filter((intent) => intent.sourceId.startsWith(`${lang}-`) && intent.selfAssessedKnown);
    if (!rows.length) return '<p class="hint">目前沒有標為「自評已會」的字。</p>';
    return `<ul class="book-list">${rows.map((intent) => {
      const word = byId.get(intent.sourceId);
      return `<li><span class="book-name">${esc(word?.target ?? intent.sourceId)}　${esc(word?.zh ?? '')}　<span class="hint">未經測驗驗證</span></span>
        <button class="btn ghost sm" type="button" data-unknown="${esc(intent.sourceId)}">撤回</button></li>`;
    }).join('')}</ul>`;
  }

  function render() {
    const book = data.books[selected];
    const ids = langIds(book);
    shell.innerHTML = `
      <div class="card">
        <h2 class="backup-title">我的單字簿</h2>
        ${booksHtml()}
        <div class="field-row" style="margin-top:12px">
          <label class="setting-label" for="new-book">新增單字簿（最多 60 字）</label>
          <input id="new-book" class="text-input" data-new-name maxlength="60" placeholder="例如：旅行用語">
          <button class="btn sm" type="button" data-create>建立</button>
        </div>
      </div>
      <div class="card">
        <h2 class="backup-title">${book.system ? '★ ' : ''}${esc(book.name)}（${ids.length} 字）</h2>
        ${ids.length ? `<ul class="book-list">${ids.map((id) => wordRow(id, book)).join('')}</ul>` : '<p class="hint">這本還沒有本語言的字。用下面的搜尋加入。</p>'}
      </div>
      <div class="card">
        <h2 class="backup-title">找單字加入</h2>
        <div class="field-row">
          <label class="setting-label" for="word-search">搜尋外文、讀音或中文</label>
          <input id="word-search" class="text-input" data-search value="${esc(query)}" placeholder="${lang === 'ja' ? '例如：たべる、吃' : '例如：apple、蘋果'}">
        </div>
        <div data-results>${searchResults()}</div>
      </div>
      <div class="card">
        <h2 class="backup-title">自評已會</h2>
        <p class="backup-note">自評已會只是不再當新字介紹，不代表通過測驗；之後答錯會自動解除。</p>
        ${knownListHtml()}
      </div>
      <div class="card">
        <h2 class="backup-title">分享單字簿</h2>
        <p class="backup-note">匯出檔只含單字簿與筆記，不含學習紀錄。完整備份請用首頁的「備份與還原」。</p>
        <div class="backup-actions">
          <button class="btn ghost sm" type="button" data-export-one>匯出「${esc(book.name)}」</button>
          <button class="btn ghost sm" type="button" data-export-all>匯出全部單字簿</button>
          <label class="btn ghost sm file-btn">匯入單字簿檔<input type="file" class="file-input" accept="application/json,.json,text/plain,.txt" data-import-file></label>
        </div>
        ${importHtml()}
      </div>`;
    for (const node of shell.querySelectorAll('[data-note-text]')) node.textContent = data.notes[node.dataset.noteText]?.text ?? '';
    const input = shell.querySelector('[data-note-input]');
    if (input && editing) { input.value = editing.text; input.focus(); }
    bind();
  }

  function bind() {
    const on = (selector, handler) => shell.querySelectorAll(selector).forEach((node) => node.addEventListener('click', () => handler(node)));
    on('[data-open]', (node) => { selected = node.dataset.open; editing = null; render(); });
    on('[data-create]', () => {
      const name = shell.querySelector('[data-new-name]').value;
      act(service.create(name).then((r) => { if (r.value) selected = r.value.bookId; }), '已建立單字簿。');
    });
    on('[data-rename]', (node) => {
      const book = data.books[node.dataset.rename];
      const name = window.prompt('新的名稱（最多 60 字）', book.name);
      if (name !== null) act(service.rename(book.bookId, name, book.revision), '已改名。');
    });
    on('[data-delete]', (node) => {
      const book = data.books[node.dataset.delete];
      if (window.confirm(`刪除「${book.name}」？只會刪掉這本簿子，字的筆記與學習紀錄都會保留。`)) act(service.remove(book.bookId, book.revision), '已刪除單字簿。');
    });
    on('[data-remove]', (node) => act(service.setMember(node.dataset.book, node.dataset.remove, false), '已移出。'));
    on('[data-add]', (node) => act(service.setMember(selected, node.dataset.add, true), '已加入。'));
    on('[data-fav]', (node) => act(service.toggleFavorite(node.dataset.fav)));
    on('[data-want]', (node) => act(service.setWant(node.dataset.want, node.getAttribute('aria-pressed') !== 'true')));
    on('[data-unknown]', (node) => act(service.setKnown(node.dataset.unknown, false), '已撤回自評，這個字重新可以當新字學習。'));
    on('[data-note]', (node) => {
      const note = data.notes[node.dataset.note];
      editing = { wordId: node.dataset.note, text: note?.text ?? '', expectedRevision: note ? note.revision : null, epoch: data.meta.dataEpoch };
      render();
    });
    on('[data-note-cancel]', () => { editing = null; render(); });
    on('[data-note-save]', () => {
      const text = shell.querySelector('[data-note-input]').value;
      const target = editing;
      editing = null;
      act(service.saveNote(target.wordId, text, target), text ? '筆記已保存。' : '筆記已刪除。');
    });
    shell.querySelector('[data-search]')?.addEventListener('input', (event) => {
      query = event.currentTarget.value;
      shell.querySelector('[data-results]').innerHTML = searchResults();
      shell.querySelectorAll('[data-results] [data-add]').forEach((node) => node.addEventListener('click', () => act(service.setMember(selected, node.dataset.add, true), '已加入。')));
      shell.querySelectorAll('[data-results] [data-fav]').forEach((node) => node.addEventListener('click', () => act(service.toggleFavorite(node.dataset.fav))));
    });
    on('[data-export-one]', () => exportBooks([selected]));
    on('[data-export-all]', () => exportBooks(undefined));
    shell.querySelector('[data-import-file]')?.addEventListener('change', async (event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      try {
        importPreview = await service.previewImport(await file.text(), knownIds);
        importChoices = { books: {}, notes: {}, overwriteNotes: false };
        say('');
      } catch (error) {
        importPreview = null;
        say(`讀不出這個單字簿檔，沒有動任何資料：${error?.message || ''}`);
      }
      render();
    });
    shell.querySelectorAll('[data-book-choice]').forEach((node) => node.addEventListener('change', () => {
      importChoices.books[node.dataset.bookChoice] = node.value;
    }));
    shell.querySelector('[data-overwrite-notes]')?.addEventListener('change', (event) => { importChoices.overwriteNotes = event.currentTarget.checked; });
    on('[data-import-cancel]', () => { importPreview = null; render(); });
    on('[data-import-confirm]', () => {
      const notes = {};
      if (importChoices.overwriteNotes) for (const c of importPreview.notes.conflicts) notes[c.wordId] = 'overwrite';
      const preview = importPreview;
      importPreview = null;
      act(service.applyImport(preview, { books: importChoices.books, notes }), '單字簿已匯入。');
    });
  }

  async function exportBooks(bookIds) {
    try {
      const payload = await service.exportBooks(bookIds);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `lang-learn-單字簿-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
      say('已下載單字簿檔。');
    } catch (error) {
      say(`沒有匯出：${error?.message || storageMessage(error)}`);
    }
  }

  applySpeechFallback(lang, noticeHost);
  awaitLearningStore(mount, async (store) => {
    mount.replaceChildren(shell, status);
    service = createLibraryService({ store });
    bindSpeakButtons(shell, lang);
    await refresh();
  });
}
