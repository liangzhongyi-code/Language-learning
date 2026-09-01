/**
 * 逐題學習紀錄與間隔重複排程。
 *
 * 這一份資料的價值全在「排程是對的」——排錯了不會有任何錯誤訊息，
 * 只會讓使用者在錯的時間看到錯的題目，而且他不會發現。
 * 所以盒號與到期時間逐條驗。
 *
 * 時間一律用固定的數字餵進去，不呼叫 Date.now()：
 * 依賴真實時鐘的測試會在某些時刻無預警地紅一次。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyProgress,
  normalizeProgress,
  loadProgress,
  saveProgress,
  clearProgress,
  recordSession,
  weakest,
  dueIds,
  progressOfLang,
  PROGRESS_KEY,
} from '../assets/js/core/progress.js';
import {
  nextBox,
  dueAfter,
  isDue,
  isGraduated,
  BOX_DAYS,
  MAX_BOX,
  GRADUATED_BOX,
} from '../assets/js/core/srs.js';

const DAY = 86400000;
const T0 = 1756700000000;

/**
 * 驗證一個到期時間落在「from 那天的 N 天後」那一天。
 *
 * 不寫成 `T0 + N × DAY`：到期時間對齊日界之後，那個算式只有在
 * T0 剛好是午夜時才成立。也不用原始毫秒相加去推——那在有日光節約
 * 的時區會偏一小時，測試會在某幾週莫名其妙變紅。
 *
 * 只驗「落在哪一天」，不驗「幾點幾分」：深夜作答時最短間隔那道地板
 * 會把時刻往後推離午夜（見 srs.js 的 MIN_GAP_MS），而排程真正在意的
 * 本來就是日期。時刻的下限由另一條測試單獨顧。
 */
function assertDueOn(due, from, days, label) {
  const expected = new Date(from);
  expected.setHours(0, 0, 0, 0);
  expected.setDate(expected.getDate() + days);
  const at = new Date(due);
  assert.equal(
    at.toDateString(),
    new Date(expected.getTime()).toDateString(),
    `${label}：應該排在 ${days} 天後的那一天，實際 ${at.toLocaleString()}`
  );
  assert.ok(due >= expected.getTime(), `${label}：不可以早於那一天的開始`);
}

/**
 * 造一局已作答完畢的選擇題。answers 是每一題答對與否
 */
const sessionOf = (pairs) => ({
  questions: pairs.map(([sourceId, ok], i) => ({
    kind: 'choice',
    sourceId,
    options: [{ text: 'a' }, { text: 'b' }],
    correctIndex: 0,
    answeredIndex: ok ? 0 : 1,
    _i: i,
  })),
});

/**
 * 可以注入失敗的假 storage
 */
function fakeStorage({ failWrite = false, value = null } = {}) {
  let stored = value;
  return {
    getItem: () => stored,
    setItem: (_k, v) => {
      if (failWrite) throw new Error('quota');
      stored = v;
    },
    removeItem: () => {
      stored = null;
    },
    peek: () => stored,
  };
}

/* ── Leitner 盒子 ────────────────────────────────────────── */

test('答對往上一盒，答錯一律打回第一盒', () => {
  assert.equal(nextBox(1, true), 2);
  assert.equal(nextBox(3, true), 4);
  assert.equal(nextBox(4, false), 1, '答錯不是退一盒，是回到第一盒');
  assert.equal(nextBox(1, false), 1);
});

test('盒號到頂之後停住，不會無限往上加', () => {
  assert.equal(nextBox(MAX_BOX, true), MAX_BOX);
  assert.equal(nextBox(MAX_BOX + 5, true), MAX_BOX, '超出範圍的盒號要夾回來');
});

test('壞掉的盒號一律當成第一盒——這份資料是使用者可以匯入的', () => {
  for (const bad of [0, -3, 1.5, null, undefined, 'x', NaN]) {
    assert.equal(nextBox(bad, false), 1);
    assertDueOn(dueAfter(bad, T0), T0, BOX_DAYS[0], `盒號 ${bad} 應該按第一盒算間隔`);
  }
});

test('各盒的到期時間就是它的間隔天數', () => {
  BOX_DAYS.forEach((days, i) => {
    assertDueOn(dueAfter(i + 1, T0), T0, days, `第 ${i + 1} 盒`);
  });
});

test('到期時間對齊日界：晚上答錯的題，隔天一早就該出現', () => {
  /**
   * 這一條是「加 N × 24 小時」與「排到 N 天後那一天」的分水嶺。
   * 前者會讓 22:00 答錯的題目要等到隔天 22:00 才到期，
   * 習慣早上練的人整個上午都看不到它，而且這個延遲每天都會再累積一次。
   */
  const night = new Date(2026, 8, 1, 22, 0, 0).getTime();
  const due = dueAfter(1, night);
  assert.equal(isDue({ due }, new Date(2026, 8, 2, 9, 0, 0).getTime()), true, '隔天早上就該到期');
  assert.equal(isDue({ due }, new Date(2026, 8, 1, 23, 59, 0).getTime()), false, '當天深夜還不算');
});

test('同一天的不同時刻答完，排到的是同一天', () => {
  /* 排程的單位是「天」，早上答完與晚上答完不該落在不同的到期日 */
  const morning = dueAfter(3, new Date(2026, 8, 1, 8, 30, 0).getTime());
  const evening = dueAfter(3, new Date(2026, 8, 1, 23, 15, 0).getTime());
  assert.equal(new Date(morning).toDateString(), new Date(evening).toDateString());
});

test('深夜答錯的題目不會在同一個晚上又出現', () => {
  /**
   * 對齊日界會讓 23:50 答錯的題目排到「隔天 00:00」＝十分鐘後，
   * 使用者按一下「再玩一局」就又看到它——srs.js 檔頭那條
   * 「不是同一局立刻再考一次」被自己違反。這一條把那道地板釘住。
   */
  const HOUR = 3600000;
  for (const hour of [19, 20, 22, 23]) {
    const at = new Date(2026, 8, 1, hour, 50, 0).getTime();
    const gap = dueAfter(1, at) - at;
    assert.ok(gap >= 6 * HOUR, `${hour}:50 答錯只隔了 ${(gap / HOUR).toFixed(1)} 小時`);
  }
});

test('地板不會拖累早上練習的人，也不影響第二盒之後', () => {
  const morning = new Date(2026, 8, 1, 8, 50, 0).getTime();
  assertDueOn(dueAfter(1, morning), morning, 1, '早上答錯');

  /* 第二盒起間隔至少三天，永遠比六小時的地板遠，時刻應該仍在日界上 */
  const night = new Date(2026, 8, 1, 23, 50, 0).getTime();
  for (let box = 2; box <= MAX_BOX; box++) {
    const at = new Date(dueAfter(box, night));
    assert.equal(
      `${at.getHours()}:${at.getMinutes()}`,
      '0:0',
      `第 ${box} 盒不該被最短間隔那道地板推離日界`
    );
  }
});

test('isGraduated：到第 4 盒算學會，壞資料不算', () => {
  assert.equal(isGraduated({ box: GRADUATED_BOX }), true);
  assert.equal(isGraduated({ box: GRADUATED_BOX - 1 }), false);
  assert.equal(isGraduated({ box: MAX_BOX }), true);
  for (const bad of [undefined, null, {}, { box: 'x' }, { box: NaN }, { box: null }]) {
    assert.equal(isGraduated(bad), false, `${JSON.stringify(bad)} 不該算學會`);
  }
});

test('isDue：到期當下算到期，沒有 due 的也算', () => {
  assert.equal(isDue({ due: T0 }, T0), true, '剛好到期就是到期');
  assert.equal(isDue({ due: T0 + 1 }, T0), false);
  assert.equal(isDue({ due: T0 - 1 }, T0), true);
  assert.equal(isDue({}, T0), true, '沒有 due 的讓它出現一次重新排程');
});

/* ── 讀寫與降級 ──────────────────────────────────────────── */

test('讀不到、壞掉、版本不符一律回到空的紀錄', () => {
  assert.deepEqual(loadProgress(fakeStorage()), emptyProgress());
  assert.deepEqual(loadProgress(fakeStorage({ value: '{' })), emptyProgress());
  assert.deepEqual(loadProgress(fakeStorage({ value: 'null' })), emptyProgress());
  assert.deepEqual(loadProgress(fakeStorage({ value: '[]' })), emptyProgress());
  assert.deepEqual(
    loadProgress(fakeStorage({ value: JSON.stringify({ schemaVersion: 99, items: {} }) })),
    emptyProgress()
  );
  assert.deepEqual(
    loadProgress(fakeStorage({ value: JSON.stringify({ schemaVersion: 1, items: [] }) })),
    emptyProgress(),
    'items 是陣列也不合格'
  );
});

test('storage 整個不能用時不拋錯', () => {
  const broken = {
    getItem: () => {
      throw new Error('disabled');
    },
  };
  assert.deepEqual(loadProgress(broken), emptyProgress());
  assert.equal(saveProgress(broken, emptyProgress()), false);
  assert.equal(loadProgress(undefined).items && true, true);
});

test('寫入失敗回傳 false 而不是拋錯', () => {
  assert.equal(saveProgress(fakeStorage({ failWrite: true }), emptyProgress()), false);
  assert.equal(saveProgress(fakeStorage(), emptyProgress()), true);
});

test('normalizeProgress 不合格回傳 null，合格則複製一份', () => {
  assert.equal(normalizeProgress({ schemaVersion: 1, items: 3 }), null);
  const src = { schemaVersion: 1, items: { 'ja-w-001': { n: 1 } } };
  const out = normalizeProgress(src);
  out.items['ja-w-002'] = { n: 1 };
  assert.deepEqual(Object.keys(src.items), ['ja-w-001'], '不可就地改動來源');
});

test('clearProgress 之後讀回來是空的', () => {
  const store = fakeStorage();
  saveProgress(store, recordSession(emptyProgress(), sessionOf([['ja-w-001', true]]), T0));
  assert.equal(Object.keys(loadProgress(store).items).length, 1);
  clearProgress(store);
  assert.deepEqual(loadProgress(store), emptyProgress());
});

test('存進去的鑰匙就是匯出的那一把', () => {
  const store = fakeStorage();
  let usedKey = null;
  store.setItem = (k) => {
    usedKey = k;
  };
  saveProgress(store, emptyProgress());
  assert.equal(usedKey, PROGRESS_KEY);
});

/* ── 一局作答之後 ────────────────────────────────────────── */

test('第一次答對：次數 1、沒錯過、進第二盒', () => {
  const p = recordSession(emptyProgress(), sessionOf([['ja-w-001', true]]), T0);
  const r = p.items['ja-w-001'];
  assert.deepEqual({ n: r.n, w: r.w, box: r.box, last: r.last }, { n: 1, w: 0, box: 2, last: T0 });
  assertDueOn(r.due, T0, BOX_DAYS[1], '第一次答對');
});

test('第一次答錯：留在第一盒，隔天再見', () => {
  const p = recordSession(emptyProgress(), sessionOf([['ja-w-001', false]]), T0);
  const r = p.items['ja-w-001'];
  assert.deepEqual({ n: r.n, w: r.w, box: r.box, last: r.last }, { n: 1, w: 1, box: 1, last: T0 });
  assertDueOn(r.due, T0, 1, '第一次答錯');
});

test('連續答對會一路往上，間隔跟著拉長', () => {
  let p = emptyProgress();
  const seen = [];
  for (let i = 0; i < 6; i++) {
    p = recordSession(p, sessionOf([['ja-w-001', true]]), T0 + i * DAY);
    seen.push(p.items['ja-w-001'].box);
  }
  assert.deepEqual(seen, [2, 3, 4, 5, 5, 5], '到頂之後停在最高盒');
  assert.equal(p.items['ja-w-001'].n, 6);
  assert.equal(p.items['ja-w-001'].w, 0);
});

test('答錯把累積的進度打回原點，但作答次數繼續累加', () => {
  let p = recordSession(emptyProgress(), sessionOf([['ja-w-001', true]]), T0);
  p = recordSession(p, sessionOf([['ja-w-001', true]]), T0 + DAY);
  assert.equal(p.items['ja-w-001'].box, 3);
  p = recordSession(p, sessionOf([['ja-w-001', false]]), T0 + 2 * DAY);
  assert.equal(p.items['ja-w-001'].box, 1);
  assert.equal(p.items['ja-w-001'].n, 3, '次數不會因為答錯而重置');
  assert.equal(p.items['ja-w-001'].w, 1);
});

test('未作答的題目不進紀錄——沒作答不代表不會', () => {
  const session = {
    questions: [
      { kind: 'choice', sourceId: 'ja-w-001', options: [{}], correctIndex: 0, answeredIndex: 0 },
      { kind: 'choice', sourceId: 'ja-w-002', options: [{}], correctIndex: 0, answeredIndex: null },
    ],
  };
  const p = recordSession(emptyProgress(), session, T0);
  assert.deepEqual(Object.keys(p.items), ['ja-w-001']);
});

test('填空題照樣記錄，對錯由 quiz-engine 判定', () => {
  const cloze = (filled) => ({
    questions: [
      {
        kind: 'cloze',
        sourceId: 'ja-s-001',
        submitted: true,
        blanks: [{ answer: 'わたし' }, { answer: 'を' }],
        filled,
      },
    ],
  });
  assert.equal(recordSession(emptyProgress(), cloze(['わたし', 'を']), T0).items['ja-s-001'].w, 0);
  assert.equal(recordSession(emptyProgress(), cloze(['わたし', 'は']), T0).items['ja-s-001'].w, 1);
});

test('不就地改動傳進來的紀錄', () => {
  const before = recordSession(emptyProgress(), sessionOf([['ja-w-001', true]]), T0);
  const snapshot = JSON.stringify(before);
  recordSession(before, sessionOf([['ja-w-002', true]]), T0);
  assert.equal(JSON.stringify(before), snapshot);
});

/* ── 易錯與到期 ──────────────────────────────────────────── */

test('weakest：只收錯過的，錯得最兇的排前面', () => {
  const p = {
    schemaVersion: 1,
    items: {
      'ja-w-001': { n: 10, w: 8, last: T0 },
      'ja-w-002': { n: 10, w: 1, last: T0 },
      'ja-w-003': { n: 10, w: 0, last: T0 },
      'ja-w-004': { n: 2, w: 2, last: T0 },
    },
  };
  assert.deepEqual(weakest(p, { lang: 'ja' }), ['ja-w-004', 'ja-w-001', 'ja-w-002']);
  assert.deepEqual(weakest(p, { lang: 'ja', limit: 2 }), ['ja-w-004', 'ja-w-001']);
});

test('weakest：練熟了就離開清單，再錯一次又回來', () => {
  /**
   * 這份清單要有出口。錯誤次數只增不減，少了畢業門檻的話
   * 一個字錯過一次就永遠留在裡面，練到全對數字也不會掉。
   */
  let p = recordSession(emptyProgress(), sessionOf([['ja-w-001', false]]), T0);
  assert.deepEqual(weakest(p, { lang: 'ja' }), ['ja-w-001'], '剛答錯，在清單裡');

  /* 連續答對三次爬到第 4 盒 */
  for (let i = 1; i <= 3; i++) {
    p = recordSession(p, sessionOf([['ja-w-001', true]]), T0 + i * DAY);
  }
  assert.equal(p.items['ja-w-001'].box, GRADUATED_BOX);
  assert.equal(p.items['ja-w-001'].w, 1, '答錯次數本身不會被抹掉');
  assert.deepEqual(weakest(p, { lang: 'ja' }), [], '練熟了就該離開清單');

  p = recordSession(p, sessionOf([['ja-w-001', false]]), T0 + 9 * DAY);
  assert.deepEqual(weakest(p, { lang: 'ja' }), ['ja-w-001'], '再錯一次就回來');
});

test('weakest：缺 n 的紀錄不會汙染排序', () => {
  /**
   * 匯入的備份不做逐筆驗證，這種紀錄真的進得來。
   * 寫成 w / Math.max(n, 1) 的話，缺 n 會讓比較函式回傳 NaN，
   * 排序既不判大於也不判小於，那一筆就默默停在插入順序上——
   * 錯 1 次的會排到 100% 錯誤率的前面，而且完全沒有錯誤訊息。
   */
  const p = {
    schemaVersion: 1,
    items: {
      'ja-w-001': { w: 1 },
      'ja-w-002': { n: 10, w: 9 },
      'ja-w-003': { n: 2, w: 2 },
    },
  };
  const order = weakest(p, { lang: 'ja' });
  assert.equal(order.length, 3);
  assert.ok(
    order.indexOf('ja-w-003') < order.indexOf('ja-w-002'),
    `100% 錯誤率要排在 90% 前面，實際順序：${order.join(' → ')}`
  );
  assert.ok(order.every((id) => typeof id === 'string'));
});

test('progressOfLang 的易錯數與 weakest 用同一組條件', () => {
  /* 兩邊分家的話，首頁顯示的數字會跟測驗頁那顆膠囊對不起來 */
  let p = recordSession(emptyProgress(), sessionOf([['ja-w-001', false], ['ja-w-002', false]]), T0);
  for (let i = 1; i <= 3; i++) {
    p = recordSession(p, sessionOf([['ja-w-001', true]]), T0 + i * DAY);
  }
  assert.equal(progressOfLang(p, 'ja', T0).weak, weakest(p, { lang: 'ja' }).length);
  assert.equal(progressOfLang(p, 'ja', T0).weak, 1);
});

test('weakest：錯誤率一樣時，錯得多的優先', () => {
  const p = {
    schemaVersion: 1,
    items: {
      'ja-w-001': { n: 2, w: 1, last: T0 },
      'ja-w-002': { n: 8, w: 4, last: T0 },
    },
  };
  assert.deepEqual(weakest(p, { lang: 'ja' }), ['ja-w-002', 'ja-w-001']);
});

test('weakest 與 dueIds 只看自己那個語言', () => {
  const p = {
    schemaVersion: 1,
    items: {
      'ja-w-001': { n: 1, w: 1, last: T0, due: T0 },
      'en-w-001': { n: 1, w: 1, last: T0, due: T0 },
    },
  };
  assert.deepEqual(weakest(p, { lang: 'ja' }), ['ja-w-001']);
  assert.deepEqual(weakest(p, { lang: 'en' }), ['en-w-001']);
  assert.deepEqual(dueIds(p, 'ja', T0), ['ja-w-001']);
});

test('dueIds：時間還沒到的不出現，到了才出現', () => {
  const p = recordSession(emptyProgress(), sessionOf([['ja-w-001', true]]), T0);
  const due = p.items['ja-w-001'].due;
  assert.deepEqual(dueIds(p, 'ja', due - 1), [], '還沒到期');
  assert.deepEqual(dueIds(p, 'ja', due), ['ja-w-001'], '剛好到期就該出現');
});

test('沒作答過的題目不會出現在複習清單裡', () => {
  const p = recordSession(emptyProgress(), sessionOf([['ja-w-001', false]]), T0);
  const ids = dueIds(p, 'ja', T0 + 400 * DAY);
  assert.deepEqual(ids, ['ja-w-001'], '只有記錄過的才會被排程');
});

test('progressOfLang：追蹤數、易錯數、到期數', () => {
  let p = recordSession(emptyProgress(), sessionOf([['ja-w-001', false], ['ja-w-002', true]]), T0);
  assert.deepEqual(progressOfLang(p, 'ja', T0), { tracked: 2, weak: 1, due: 0 });
  assert.deepEqual(progressOfLang(p, 'ja', T0 + 2 * DAY), { tracked: 2, weak: 1, due: 1 });
  assert.deepEqual(progressOfLang(p, 'en', T0), { tracked: 0, weak: 0, due: 0 });
});
