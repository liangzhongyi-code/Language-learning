import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcAccuracy,
  summarize,
  isComplete,
  scopeKey,
  emptyStats,
  loadStats,
  saveStats,
  applySession,
  clearStats,
  statsOfLang,
  STATS_KEY,
  SCHEMA_VERSION,
} from '../assets/js/core/stats.js';

/**
 * 記憶體版的假 storage，行為與 localStorage 相同
 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

/**
 * 讀取一律拋例外的假 storage，模擬 Safari 無痕模式
 */
const throwingOnRead = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {},
  removeItem() {},
};

/**
 * 寫入一律拋例外的假 storage，模擬容量已滿
 */
const throwingOnWrite = {
  getItem: () => null,
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {},
};

/**
 * 造一局測驗結果。answers 是每題選的索引，null 代表未作答
 */
function makeSession(answers, correctIndices, extra = {}) {
  return {
    lang: 'en',
    source: 'words',
    questions: answers.map((ans, i) => ({
      sourceId: `en-w-00${i + 1}`,
      prompt: `題目${i + 1}`,
      options: [
        { text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' },
      ],
      correctIndex: correctIndices[i],
      answeredIndex: ans,
      note: null,
      ...extra,
    })),
  };
}

/* ── calcAccuracy ─────────────────────────────────────────── */

test('calcAccuracy：一般情況四捨五入到整數', () => {
  assert.equal(calcAccuracy(7, 10), 70);
  assert.equal(calcAccuracy(2, 3), 67);
  assert.equal(calcAccuracy(1, 3), 33);
  assert.equal(calcAccuracy(10, 10), 100);
});

test('calcAccuracy：零題不得產生 NaN 或 Infinity', () => {
  const r = calcAccuracy(0, 0);
  assert.equal(r, 0);
  assert.ok(Number.isFinite(r), '不可為 NaN 或 Infinity');
});

test('calcAccuracy：分母為負或非數字時回傳 0', () => {
  assert.equal(calcAccuracy(1, -3), 0);
  assert.equal(calcAccuracy(1, undefined), 0);
});

/* ── summarize ────────────────────────────────────────────── */

test('summarize：算出總題數、答對數與正確率', () => {
  const s = makeSession([0, 1, 2, 0, 1], [0, 1, 0, 0, 3]);
  const r = summarize(s);
  assert.equal(r.total, 5);
  assert.equal(r.correct, 3);
  assert.equal(r.accuracy, 60);
});

test('summarize：錯題清單含題面、使用者答案與正解', () => {
  const s = makeSession([2], [0]);
  s.questions[0].options = [
    { text: '正解' }, { text: '干擾1' }, { text: '我選的' }, { text: '干擾3' },
  ];
  const r = summarize(s);
  assert.equal(r.wrongList.length, 1);
  const w = r.wrongList[0];
  assert.equal(w.prompt, '題目1');
  assert.equal(w.chosenText, '我選的');
  assert.equal(w.correctText, '正解');
  assert.equal(w.sourceId, 'en-w-001');
});

test('summarize：句子題的錯題帶出語序說明', () => {
  const s = makeSession([1], [0], { note: '英文的時間副詞放句尾' });
  const r = summarize(s);
  assert.equal(r.wrongList[0].note, '英文的時間副詞放句尾');
});

test('summarize：錯題帶出目標語言的朗讀文字', () => {
  const s = makeSession([1], [0], { speakText: 'あめ', optionLang: 'ja' });
  const r = summarize(s);
  assert.equal(
    r.wrongList[0].speakText,
    'あめ',
    '不能拿 correctText 代替：日文的正解是漢字，送語音引擎會唸錯'
  );
});

test('summarize：外翻中的錯題一樣帶得出朗讀文字', () => {
  /* 這個方向的正解是中文，但仍然要能唸出目標語言的說法 */
  const s = makeSession([1], [0], { speakText: 'badminton', optionLang: 'zh', direction: 'target2zh' });
  const r = summarize(s);
  assert.equal(r.wrongList[0].speakText, 'badminton');
});

test('summarize：題目沒有朗讀文字時為 null 而非 undefined', () => {
  const s = makeSession([1], [0]);
  assert.equal(summarize(s).wrongList[0].speakText, null);
});

test('summarize：全對時錯題清單為空', () => {
  const s = makeSession([0, 1], [0, 1]);
  const r = summarize(s);
  assert.equal(r.correct, 2);
  assert.deepEqual(r.wrongList, []);
});

test('summarize：未作答的題目算錯，且 chosenText 為 null', () => {
  const s = makeSession([0, null], [0, 1]);
  const r = summarize(s);
  assert.equal(r.correct, 1);
  assert.equal(r.wrongList.length, 1);
  assert.equal(r.wrongList[0].chosenText, null);
});

test('summarize：零題的局不產生 NaN', () => {
  const r = summarize({ lang: 'en', source: 'words', questions: [] });
  assert.equal(r.total, 0);
  assert.equal(r.accuracy, 0);
  assert.deepEqual(r.wrongList, []);
});

test('isComplete：每題都作答才算完成', () => {
  assert.equal(isComplete(makeSession([0, 1], [0, 1])), true);
  assert.equal(isComplete(makeSession([0, null], [0, 1])), false);
  assert.equal(isComplete({ questions: [] }), false);
});

/* ── 儲存與讀取 ───────────────────────────────────────────── */

test('scopeKey：以語言與題源組成', () => {
  assert.equal(scopeKey('en', 'words'), 'en:words');
  assert.equal(scopeKey('ja', 'sentences'), 'ja:sentences');
});

test('loadStats：沒有紀錄時回傳初始統計', () => {
  const st = loadStats(memoryStorage());
  assert.deepEqual(st, emptyStats());
  assert.equal(st.schemaVersion, SCHEMA_VERSION);
});

test('saveStats 後 loadStats 讀回相同內容', () => {
  const storage = memoryStorage();
  const st = applySession(emptyStats(), 'en', 'words', { total: 10, correct: 8 });
  saveStats(storage, st);
  assert.deepEqual(loadStats(storage), st);
});

test('loadStats：內容不是合法 JSON 時安全重置', () => {
  const storage = memoryStorage({ [STATS_KEY]: '{ 這不是 JSON' });
  assert.deepEqual(loadStats(storage), emptyStats());
});

test('loadStats：schemaVersion 是舊版本時丟棄', () => {
  const storage = memoryStorage({
    [STATS_KEY]: JSON.stringify({ schemaVersion: 0, byScope: { 'en:words': { answered: 99 } } }),
  });
  assert.deepEqual(loadStats(storage), emptyStats());
});

test('loadStats：結構不對時安全重置', () => {
  const storage = memoryStorage({
    [STATS_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSION, byScope: '不是物件' }),
  });
  assert.deepEqual(loadStats(storage), emptyStats());
});

test('loadStats：storage 讀取拋例外時降級而非爆掉', () => {
  assert.doesNotThrow(() => loadStats(throwingOnRead));
  assert.deepEqual(loadStats(throwingOnRead), emptyStats());
});

test('loadStats：storage 為 undefined 時也不爆', () => {
  assert.deepEqual(loadStats(undefined), emptyStats());
});

test('saveStats：寫入失敗時回傳 false 而非拋例外', () => {
  let ok;
  assert.doesNotThrow(() => {
    ok = saveStats(throwingOnWrite, emptyStats());
  });
  assert.equal(ok, false);
});

test('saveStats：寫入成功時回傳 true', () => {
  assert.equal(saveStats(memoryStorage(), emptyStats()), true);
});

/* ── 累加 ─────────────────────────────────────────────────── */

test('applySession：第一局建立紀錄', () => {
  const st = applySession(emptyStats(), 'en', 'words', { total: 10, correct: 6 });
  assert.deepEqual(st.byScope['en:words'], { answered: 10, correct: 6, sessions: 1 });
});

test('applySession：第二局累加到既有紀錄', () => {
  let st = applySession(emptyStats(), 'en', 'words', { total: 10, correct: 6 });
  st = applySession(st, 'en', 'words', { total: 10, correct: 8 });
  assert.deepEqual(st.byScope['en:words'], { answered: 20, correct: 14, sessions: 2 });
});

test('applySession：不同語言互不干擾', () => {
  let st = applySession(emptyStats(), 'en', 'words', { total: 10, correct: 6 });
  st = applySession(st, 'ja', 'words', { total: 5, correct: 5 });
  assert.deepEqual(st.byScope['en:words'], { answered: 10, correct: 6, sessions: 1 });
  assert.deepEqual(st.byScope['ja:words'], { answered: 5, correct: 5, sessions: 1 });
});

test('applySession：不就地改動傳入的統計物件', () => {
  const before = emptyStats();
  const snapshot = JSON.stringify(before);
  applySession(before, 'en', 'words', { total: 3, correct: 3 });
  assert.equal(JSON.stringify(before), snapshot, '原統計不得被改動');
});

test('statsOfLang：把同一語言的各題源加總', () => {
  let st = applySession(emptyStats(), 'en', 'words', { total: 30, correct: 24 });
  st = applySession(st, 'en', 'sentences', { total: 20, correct: 16 });
  st = applySession(st, 'ja', 'words', { total: 10, correct: 1 });
  const r = statsOfLang(st, 'en');
  assert.equal(r.answered, 50);
  assert.equal(r.correct, 40);
  assert.equal(r.accuracy, 80);
  assert.equal(r.sessions, 2);
});

test('statsOfLang：無紀錄時 hasData 為 false', () => {
  const r = statsOfLang(emptyStats(), 'en');
  assert.equal(r.hasData, false);
  assert.equal(r.accuracy, 0);
});

test('statsOfLang：有紀錄時 hasData 為 true', () => {
  const st = applySession(emptyStats(), 'en', 'words', { total: 1, correct: 0 });
  assert.equal(statsOfLang(st, 'en').hasData, true);
});

test('clearStats：移除 key 後讀回初始狀態', () => {
  const storage = memoryStorage();
  saveStats(storage, applySession(emptyStats(), 'en', 'words', { total: 9, correct: 9 }));
  clearStats(storage);
  assert.deepEqual(loadStats(storage), emptyStats());
  assert.equal(storage._dump()[STATS_KEY], undefined);
});

test('clearStats：storage 失效時不拋例外', () => {
  assert.doesNotThrow(() => clearStats(throwingOnRead));
});
