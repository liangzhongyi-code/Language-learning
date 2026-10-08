/**
 * 分支審查專屬回歸：網站與 APP 原型的 JS 必須能以 ES2020 解析。
 * 解析不等於 API 相容；成就另在缺少 Array.at 時執行，避免新版 Node 掩蓋問題。
 * 沿用既有 FSRS 測試所用的 Node 內建 Acorn，不安裝套件、不寫入使用者資料。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { computeStreak, evaluateAchievements } from '../assets/js/core/achievements.js';

function parser() {
  const source = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
  assert.equal(typeof source, 'string', '需要 Node 內建 Acorn；不能略過相容性閘門');
  const sandbox = {};
  runInNewContext(source, sandbox);
  return (text) => sandbox.acorn.parse(text, { ecmaVersion: 2020, sourceType: 'module' });
}

function runtimeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? runtimeFiles(url) : entry.name.endsWith('.js') ? [url] : [];
  });
}

test('審查／ES2020：解析器接受既有語法，確實拒絕 ES2021 語法', () => {
  const parse = parser();
  assert.doesNotThrow(() => parse('const x = input?.value ?? 86400000;'));
  for (const source of ['const x = 86_400_000;', 'x ??= y;', 'x ||= y;', 'x &&= y;']) {
    assert.throws(() => parse(source), { name: 'SyntaxError' });
  }
});

test('審查／ES2020：完整網站與 APP 原型執行期 JS 均可解析', (t) => {
  const parse = parser();
  const files = ['../assets/js/', '../app/prototype/'].flatMap((root) => runtimeFiles(new URL(root, import.meta.url)));
  assert.ok(files.some((file) => file.pathname.endsWith('/vendor/ts-fsrs.js')));
  assert.ok(files.some((file) => file.pathname.includes('/app/prototype/')));
  const failures = [];
  for (const file of files) {
    try { parse(readFileSync(file, 'utf8')); }
    catch (error) { failures.push(`${file.pathname}: ${error.message}`); }
  }
  t.diagnostic(`已以 ES2020 解析 ${files.length} 個執行期 JS（不含 Node 工具／測試）。`);
  assert.deepEqual(failures, []);
});

/**
 * 同步執行並在 finally 還原原型，避免影響 Node 測試 runner 或其他案例。
 */
function withoutArrayAt(check) {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'at');
  try {
    delete Array.prototype.at;
    check();
  } finally {
    if (descriptor) Object.defineProperty(Array.prototype, 'at', descriptor);
  }
}

test('審查／Array.at：非空、未排序及雙語日曆仍可計算連續天數與解鎖', () => {
  const calendarRows = [
    { localDate: '2026-10-08', lang: 'ja', reviewCount: 1, correctCount: 1 },
    { localDate: '2026-10-06', lang: 'en', reviewCount: 1, correctCount: 0 },
    { localDate: '2026-10-07', lang: 'en', reviewCount: 20, correctCount: 18 },
    { localDate: '2026-10-08', lang: 'en', reviewCount: 1, correctCount: 1 },
    { localDate: '2026-10-09', lang: 'en', reviewCount: 0, correctCount: 0 },
  ];
  withoutArrayAt(() => {
    assert.deepEqual(computeStreak({ calendarRows, todayLocalDate: '2026-10-09' }), {
      current: 3, longest: 3, totalDays: 3, totalReviews: 23, totalCorrect: 20, lastStudyDate: '2026-10-08',
    });
    const now = Date.UTC(2026, 9, 9);
    const unlocked = evaluateAchievements({ calendarRows, unlocked: {}, now, todayLocalDate: '2026-10-09' });
    assert.deepEqual(unlocked.map((row) => row.achievementId), ['first-review', 'streak-3', 'both-langs', 'accuracy-day']);
    assert.deepEqual(evaluateAchievements({ calendarRows, unlocked, now, todayLocalDate: '2026-10-09' }), []);
  });
});

test('審查／Array.at：空日曆維持 null 與零計數，不憑空解鎖', () => {
  withoutArrayAt(() => {
    assert.deepEqual(computeStreak({ calendarRows: [], todayLocalDate: '2026-10-08' }), {
      current: 0, longest: 0, totalDays: 0, totalReviews: 0, totalCorrect: 0, lastStudyDate: null,
    });
    assert.deepEqual(evaluateAchievements({ calendarRows: [], unlocked: {}, now: 0, todayLocalDate: '2026-10-08' }), []);
  });
});
