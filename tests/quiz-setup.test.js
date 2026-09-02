/**
 * 設定畫面的決策。
 *
 * 這一小塊有前科：題數的夾限曾經把使用者選的「10 題」永久改寫成「全部」，
 * 切一次小範圍再切回來就變成一局 7608 題，而畫面上看起來像是他自己選的。
 * 那個 bug 藏在 ui 層，從頭到尾沒有任何測試碰得到——這支檔案的存在
 * 就是為了讓它不會再發生一次。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sessionCount, countChip, scopeState, strandedReason } from '../assets/js/core/quiz-setup.js';

const MIN_POOL = 4;

/* ── 題數：顯示與實際不可分家 ────────────────────────────── */

test('選了固定題數而題庫夠大時，就出那麼多題', () => {
  assert.equal(sessionCount({ useAll: false, count: 10, limit: 7608 }), 10);
  assert.equal(countChip({ useAll: false, count: 10, limit: 7608 }), 10);
});

test('題庫比選的題數小時，顯示與實際一起退到「全部」', () => {
  assert.equal(sessionCount({ useAll: false, count: 10, limit: 6 }), 6);
  assert.equal(countChip({ useAll: false, count: 10, limit: 6 }), 'all');
});

test('明確選了「全部」就跟著上限走', () => {
  assert.equal(sessionCount({ useAll: true, count: 10, limit: 7608 }), 7608);
  assert.equal(countChip({ useAll: true, count: 10, limit: 7608 }), 'all');
});

test('切一次小範圍再切回來，使用者選的題數要回得去', () => {
  /**
   * 這一條就是那個阻擋項。
   * 舊版把上限寫回 config.useAll，翻成 true 之後沒有任何路徑收回，
   * 於是「10 題」變成「全部（7608）」而使用者從沒按過全部。
   */
  const chosen = { useAll: false, count: 10 };
  assert.equal(countChip({ ...chosen, limit: 7608 }), 10, '一開始是 10 題');
  assert.equal(countChip({ ...chosen, limit: 6 }), 'all', '切到只有 6 題的範圍');
  assert.equal(countChip({ ...chosen, limit: 7608 }), 10, '切回全部要回到 10 題');
  assert.equal(sessionCount({ ...chosen, limit: 7608 }), 10, '實際出的也要是 10 題');
});

test('顯示與實際永遠一致，而且不會超出上限', () => {
  const limits = [0, 1, 3, 4, 5, 6, 9, 10, 11, 19, 20, 21, 32, 147, 7608];
  for (const useAll of [false, true]) {
    for (const count of [10, 20]) {
      for (const limit of limits) {
        const cfg = { useAll, count, limit };
        const n = sessionCount(cfg);
        const chip = countChip(cfg);
        assert.equal(
          chip === 'all' ? n === limit : n === chip,
          true,
          `顯示 ${chip} 卻要出 ${n} 題（useAll=${useAll} count=${count} limit=${limit}）`
        );
        assert.ok(n <= limit, `出的題數 ${n} 超過上限 ${limit}`);
        /**
         * 亮起來的那顆必須是畫面上真的有的三顆之一。
         * 少了這條，countChip 回傳 limit 本身（例如 6）時 n === chip 仍成立、
         * 測試全綠，但 chips() 用字串比對找不到 6 這顆——題數那一排一顆都沒選取，
         * 正是 ?source 那邊剛修掉的同一種失敗模式。
         */
        assert.ok(chip === 'all' || [10, 20].includes(chip), `膠囊 ${chip} 不是畫面上有的選項`);
      }
    }
  }
});

/* ── 範圍那一排 ──────────────────────────────────────────── */

const state = (over) =>
  scopeState({
    sizes: { all: 7608, weak: 0, due: 0 },
    totals: { weak: 0, due: 0 },
    scope: 'all',
    minPool: MIN_POOL,
    ...over,
  });

test('沒有紀錄時整排不出現——不放按了會說「題庫不足」的死按鈕', () => {
  assert.deepEqual(state({}).choices, []);
});

test('湊得滿一局的範圍才出現', () => {
  const s = state({
    sizes: { all: 7608, weak: 4, due: 3 },
    totals: { weak: 4, due: 3 },
  });
  assert.deepEqual(s.choices, ['weak'], '剛好 4 題就出得了，3 題不行');
});

test('選著的範圍變得出不了題就退回全部', () => {
  const s = state({
    sizes: { all: 147, weak: 0, due: 0 },
    totals: { weak: 6, due: 6 },
    scope: 'weak',
  });
  assert.equal(s.scope, 'all', '換了題源之後那些 id 一個都不在，要退回全部');
  assert.equal(s.limit, 147, '上限要跟著退回去的範圍走');
});

test('範圍還出得了題就不要亂動使用者的選擇', () => {
  const s = state({
    sizes: { all: 7608, weak: 6, due: 0 },
    totals: { weak: 6, due: 0 },
    scope: 'weak',
  });
  assert.equal(s.scope, 'weak');
  assert.equal(s.limit, 6);
});

/* ── 被卡住的範圍要有交代 ────────────────────────────────── */

test('只要有一個範圍被卡住就要說，不是兩個都卡住才說', () => {
  /* 到期湊得滿、易錯湊不滿：舊版對被卡住的易錯完全沉默 */
  const s = state({
    sizes: { all: 7608, weak: 2, due: 5 },
    totals: { weak: 2, due: 5 },
    scope: 'all',
  });
  assert.deepEqual(s.choices, ['due']);
  assert.deepEqual(s.stranded, ['weak'], '被卡住的那個仍然要有交代');
});

test('整個語言都沒有的範圍不算被卡住', () => {
  const s = state({ sizes: { all: 7608, weak: 0, due: 0 }, totals: { weak: 0, due: 0 } });
  assert.deepEqual(s.stranded, [], '從來沒錯過的人不需要看到任何解釋');
});

test('湊得滿的範圍不算被卡住', () => {
  const s = state({
    sizes: { all: 7608, weak: 10, due: 10 },
    totals: { weak: 10, due: 10 },
  });
  assert.deepEqual(s.stranded, []);
});

test('卡住的兩種原因要分得開——建議完全相反', () => {
  /**
   * 題目就在這個題源裡、只是還不夠多 → 再練幾局（換題型只會更少）
   * 題目在別的題源裡 → 換題型才找得到
   * 分不清楚會叫一個「只錯過 3 個單字」的人去換題型，而他換過去是 0。
   */
  assert.equal(strandedReason({ here: 3, total: 3 }), 'short');
  assert.equal(strandedReason({ here: 0, total: 5 }), 'elsewhere');
  assert.equal(strandedReason({ here: 2, total: 5 }), 'elsewhere');
  assert.equal(strandedReason({ here: 0, total: 0 }), 'short', '兩邊都是 0 時不該說「在別處」');
  /**
   * here > total 在現行資料下不可達（需要同一個題庫出現重複 id），
   * 但這條把「真的發生時算 short」釘死——題目確實都在這個題源裡，
   * 「再練幾局」是對的建議，別讓它停在碰巧沒差的狀態。
   */
  assert.equal(strandedReason({ here: 2, total: 1 }), 'short', '交集比總數還多只可能是重複 id，題目仍在這裡');
});

test('壞掉或缺少的數字不會讓判斷炸掉', () => {
  const s = scopeState({ sizes: { all: 10 }, totals: {}, scope: 'weak', minPool: MIN_POOL });
  assert.deepEqual(s.choices, []);
  assert.equal(s.scope, 'all');
  assert.deepEqual(s.stranded, []);
  assert.equal(s.limit, 10);
});
