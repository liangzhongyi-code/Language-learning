/**
 * 填空題的抽題與判定。
 *
 * 填空題與選擇題共用同一個 session 結構，但作答型態完全不同：
 * 答案是一組字而不是一個索引，而且要按提交才算作答。
 * 這些差異最容易在「進度條」「統計」兩處出錯，所以獨立成一個檔案完整驗。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSession,
  answer,
  poolOf,
  progressPercent,
  isAnswered,
  isCorrect,
  kindOf,
} from '../assets/js/core/quiz-engine.js';
import { summarize, isComplete } from '../assets/js/core/stats.js';

/**
 * 造一批可以挖空的句子。
 * 每句六塊，才有足夠位置驗「挖不相鄰的塊」；
 * target 直接用角色名加編號，測試裡就能從文字反推它的語法角色。
 */
function makeChunkedSentences(count) {
  const roles = ['subject', 'particle', 'object', 'particle', 'adjective', 'verb'];
  return Array.from({ length: count }, (_, i) => ({
    id: `ja-s-${String(i + 1).padStart(3, '0')}`,
    zh: `中文句${i}`,
    target: roles.map((r) => `${r}${i}`).join(''),
    reading: `よみ${i}`,
    patternId: 'ja-p-sov',
    chunks: roles.map((role, k) => ({ role, zh: `塊${k}`, target: `${role}${i}`, zhIndex: k })),
    note: `說明${i}`,
    category: 'daily',
    level: 1,
  }));
}

const CHUNKED = makeChunkedSentences(12);

const cloze = (over = {}) =>
  buildSession({ lang: 'ja', words: [], sentences: CHUNKED, source: 'cloze', count: 5, ...over });

/**
 * 一題全部填對的答案陣列
 */
const rightAnswers = (q) => q.blanks.map((b) => b.answer);

/**
 * 候選區裡第一個不是答案的字，拿來當「填錯」用
 */
const aWrongWord = (q) => q.bank.find((t) => !q.blanks.some((b) => b.answer === t));

/* ── 題源與題型 ───────────────────────────────────────────── */

test('kindOf：只有 cloze 題源是填空題，其餘一律當選擇題', () => {
  assert.equal(kindOf('cloze'), 'cloze');
  for (const s of ['words', 'sentences', 'mixed', '沒見過的題源']) {
    assert.equal(kindOf(s), 'choice');
  }
});

test('poolOf：cloze 題源取的是句子而不是單字', () => {
  const words = [{ id: 'en-w-001' }];
  assert.deepEqual(poolOf('cloze', words, CHUNKED), CHUNKED);
});

test('buildSession：cloze 題源產出的每一題都是填空題', () => {
  for (const q of cloze().questions) {
    assert.equal(q.kind, 'cloze');
    assert.ok(Array.isArray(q.segments) && q.segments.length > 0);
    assert.ok(Array.isArray(q.blanks) && q.blanks.length > 0);
  }
});

/* ── 挖空的位置 ───────────────────────────────────────────── */

test('填空題：題面是中文整句，作答的是目標語言', () => {
  for (const q of cloze().questions) {
    assert.equal(q.direction, 'zh2target');
    assert.equal(q.promptLang, 'zh');
    assert.equal(q.optionLang, 'ja');
    assert.ok(q.prompt.startsWith('中文句'));
  }
});

test('填空題：把空格填回去要能還原成原句', () => {
  for (const q of cloze().questions) {
    const source = CHUNKED.find((s) => s.id === q.sourceId);
    const restored = q.segments
      .map((seg) => (seg.type === 'text' ? seg.text : q.blanks[seg.blankIndex].answer))
      .join('');
    assert.equal(restored, source.target);
  }
});

test('填空題：空格依序編號，不跳號也不重複', () => {
  for (const q of cloze().questions) {
    const indices = q.segments.filter((s) => s.type === 'blank').map((s) => s.blankIndex);
    assert.deepEqual(
      indices,
      indices.map((_, i) => i)
    );
    assert.equal(indices.length, q.blanks.length);
  }
});

test('填空題：至少留一塊不挖，不會整句都是空格', () => {
  for (const q of cloze().questions) {
    assert.ok(
      q.segments.some((s) => s.type === 'text'),
      `${q.sourceId} 整句都被挖空，已經不是填空而是重組`
    );
  }
});

test('填空題：六塊的句子挑得出不相鄰的空格', () => {
  for (const q of cloze().questions) {
    const at = [];
    q.segments.forEach((seg, i) => {
      if (seg.type === 'blank') at.push(i);
    });
    const adjacent = at.some((v, i) => i > 0 && v - at[i - 1] === 1);
    assert.ok(!adjacent, `${q.sourceId} 挖了相鄰的兩塊（位置 ${at.join(',')}），前後文會斷掉`);
  }
});

/* ── 候選詞 ───────────────────────────────────────────────── */

test('填空題：候選詞比空格多，不能靠刪去法全填對', () => {
  for (const q of cloze().questions) {
    assert.ok(
      q.bank.length > q.blanks.length,
      `${q.sourceId} 候選 ${q.bank.length} 個、空格 ${q.blanks.length} 個`
    );
  }
});

test('填空題：候選詞一定包含全部正確答案', () => {
  for (const q of cloze().questions) {
    for (const blank of q.blanks) {
      assert.ok(q.bank.includes(blank.answer), `候選區少了答案「${blank.answer}」，這題填不完`);
    }
  }
});

test('填空題：干擾詞優先取同一個語法角色', () => {
  for (const q of cloze().questions) {
    const answers = new Set(q.blanks.map((b) => b.answer));
    const roles = new Set(q.blanks.map((b) => b.role));
    for (const text of q.bank) {
      if (answers.has(text)) continue;
      const role = text.replace(/\d+$/, '');
      assert.ok(roles.has(role), `干擾詞「${text}」的角色不在 ${[...roles].join('/')} 之內，一眼就能刷掉`);
    }
  }
});

test('填空題：干擾詞不會取自本句，否則等於送分', () => {
  for (const q of cloze().questions) {
    const source = CHUNKED.find((s) => s.id === q.sourceId);
    const own = new Set(source.chunks.map((c) => c.target));
    const answers = new Set(q.blanks.map((b) => b.answer));
    for (const text of q.bank) {
      if (answers.has(text)) continue;
      assert.ok(!own.has(text), `干擾詞「${text}」來自本句`);
    }
  }
});

test('填空題：候選詞不重複，除非同一句真的要填兩個一樣的字', () => {
  for (const q of cloze().questions) {
    const needed = new Map();
    for (const b of q.blanks) needed.set(b.answer, (needed.get(b.answer) || 0) + 1);
    const seen = new Map();
    for (const t of q.bank) seen.set(t, (seen.get(t) || 0) + 1);
    for (const [text, n] of seen) {
      assert.ok(n <= Math.max(1, needed.get(text) || 0), `候選詞「${text}」重複了 ${n} 次`);
    }
  }
});

/* ── 初始狀態 ─────────────────────────────────────────────── */

test('填空題：初始每格都是空的，且尚未提交', () => {
  for (const q of cloze().questions) {
    assert.deepEqual(
      q.filled,
      q.blanks.map(() => null)
    );
    assert.equal(q.submitted, false);
  }
});

test('填空題：帶出語序說明，朗讀送的是假名不是漢字', () => {
  for (const q of cloze().questions) {
    assert.ok(q.note.startsWith('說明'));
    assert.ok(q.speakText.startsWith('よみ'));
  }
});

/**
 * 造一句只有一塊的句子——挖掉那一塊就不剩任何線索，填空題不能用
 */
const oneChunk = (n) => ({
  id: `ja-s-90${n}`,
  zh: `單塊${n}`,
  target: `x${n}`,
  reading: `x${n}`,
  patternId: 'ja-p-sov',
  chunks: [{ role: 'verb', zh: `單塊${n}`, target: `x${n}`, zhIndex: 0 }],
  note: null,
  category: 'daily',
  level: 1,
});

test('poolOf：只有一塊的句子在題池就先剔除，不會抽到才炸', () => {
  const mixedPool = [...CHUNKED, oneChunk(1), oneChunk(2)];
  const pool = poolOf('cloze', [], mixedPool);
  assert.equal(pool.length, CHUNKED.length);
  assert.ok(!pool.some((s) => s.id.startsWith('ja-s-90')));

  /* 同一批句子拿去出選擇題時不該被剔除——那邊不挖空，一塊也能出題 */
  assert.equal(poolOf('sentences', [], mixedPool).length, mixedPool.length);
});

test('填空題：全部句子都只有一塊時，錯誤訊息說得出是題庫不夠', () => {
  const pool = [oneChunk(1), oneChunk(2), oneChunk(3), oneChunk(4)];
  assert.throws(
    () => buildSession({ lang: 'ja', words: [], sentences: pool, source: 'cloze', count: 1 }),
    /題庫筆數不足/
  );
});

/* ── 作答判定 ─────────────────────────────────────────────── */

test('answer：填空題全部填對回傳 correct true', () => {
  const s = cloze({ count: 1 });
  const r = answer(s, 0, rightAnswers(s.questions[0]));
  assert.equal(r.correct, true);
  assert.ok(r.perBlank.every((b) => b.correct));
});

test('answer：只錯一格整題就算錯，但逐格結果分得出來', () => {
  const s = cloze({ count: 1 });
  const q = s.questions[0];
  const filled = rightAnswers(q);
  filled[0] = aWrongWord(q);

  const r = answer(s, 0, filled);
  assert.equal(r.correct, false);
  assert.equal(r.perBlank[0].correct, false);
  assert.equal(r.perBlank[0].chosen, filled[0]);
  assert.equal(r.perBlank[0].answer, q.blanks[0].answer);
  for (let i = 1; i < r.perBlank.length; i++) {
    assert.equal(r.perBlank[i].correct, true, '沒動到的格子不該被判錯');
  }
});

test('answer：重複提交不會改寫已記錄的答案', () => {
  const s = cloze({ count: 1 });
  const q = s.questions[0];
  answer(s, 0, rightAnswers(q));

  const again = answer(s, 0, q.bank.slice(0, q.blanks.length));
  assert.equal(again.alreadyAnswered, true);
  assert.equal(again.correct, true);
  assert.deepEqual(q.filled, rightAnswers(q));
});

test('answer：沒填滿就提交會拋錯，不會默默判錯', () => {
  const s = cloze({ count: 1 });
  const q = s.questions[0];
  const partial = rightAnswers(q);
  partial[0] = null;

  assert.throws(() => answer(s, 0, partial), /還有空格沒填/);
  assert.equal(q.submitted, false, '拋錯之後這題仍是未作答狀態');
});

test('answer：答案格數不符時拋錯', () => {
  const s = cloze({ count: 1 });
  assert.throws(() => answer(s, 0, ['只有一格']), /格式不符/);
  assert.throws(() => answer(s, 0, '不是陣列'), /格式不符/);
});

/* ── 與進度、統計的接縫 ───────────────────────────────────── */

test('isAnswered：填空題填滿但沒提交仍不算作答', () => {
  const s = cloze({ count: 1 });
  const q = s.questions[0];
  q.filled = rightAnswers(q);
  assert.equal(isAnswered(q), false, '沒按提交就不算完成，進度條不能先跑');

  answer(s, 0, rightAnswers(q));
  assert.equal(isAnswered(q), true);
});

test('isAnswered：空值不會炸開', () => {
  assert.equal(isAnswered(null), false);
  assert.equal(isAnswered(undefined), false);
});

test('isCorrect：未作答一律視為答錯', () => {
  assert.equal(isCorrect(cloze({ count: 1 }).questions[0]), false);
});

test('progressPercent：填空題未提交不計入進度', () => {
  const s = cloze({ count: 4 });
  s.questions[0].filled = rightAnswers(s.questions[0]);
  assert.equal(progressPercent(s), 0);

  answer(s, 0, rightAnswers(s.questions[0]));
  assert.equal(progressPercent(s), 25);
});

test('isComplete：填空題全部提交後才算完成一局', () => {
  const s = cloze({ count: 2 });
  answer(s, 0, rightAnswers(s.questions[0]));
  assert.equal(isComplete(s), false);

  answer(s, 1, rightAnswers(s.questions[1]));
  assert.equal(isComplete(s), true);
});

test('summarize：填空題答錯時把整句串起來給錯題檢討', () => {
  const s = cloze({ count: 1 });
  const q = s.questions[0];
  const filled = rightAnswers(q);
  filled[0] = aWrongWord(q);
  answer(s, 0, filled);

  const sum = summarize(s);
  assert.equal(sum.correct, 0);
  assert.equal(sum.wrongList.length, 1);
  assert.equal(sum.wrongList[0].correctText, rightAnswers(q).join(''));
  assert.equal(sum.wrongList[0].chosenText, filled.join(''));
});

test('summarize：填空題全對就不進錯題清單', () => {
  const s = cloze({ count: 1 });
  answer(s, 0, rightAnswers(s.questions[0]));

  const sum = summarize(s);
  assert.equal(sum.correct, 1);
  assert.equal(sum.accuracy, 100);
  assert.deepEqual(sum.wrongList, []);
});

test('summarize：填空題完全沒作答時 chosenText 為 null', () => {
  const s = cloze({ count: 1 });
  const sum = summarize(s);
  assert.equal(sum.wrongList[0].chosenText, null);
});
