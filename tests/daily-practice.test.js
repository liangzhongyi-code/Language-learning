import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildDailyPracticeQuestion, DAILY_PRACTICE_UNAVAILABLE } from '../assets/js/core/daily-practice.js';
import { PRACTICE_MODES, buildPracticeQuestion } from '../assets/js/core/practice-engine.js';
import { reviewIdentity } from '../assets/js/core/review-events.js';
import { practice as en } from '../assets/js/data/en/practice.js';
import { practice as ja } from '../assets/js/data/ja/practice.js';

const all = [...en, ...ja];
const clone = value => JSON.parse(JSON.stringify(value));
const code = value => error => error.code === value;
function input(item) {
  const spec = PRACTICE_MODES[item.mode];
  const lang = item.id.slice(0, 2);
  const state = { sourceId: item.sourceId, ability: spec.ability, direction: spec.direction,
    skillKey: `${item.sourceId}:${spec.ability}:${spec.direction}` };
  return { items: all, entry: { sourceId: item.sourceId, skillKey: state.skillKey, questionSnapshot: null },
    state, lang, level: item.level, rng: () => 0.3 };
}

test('daily practice：人工題依來源、能力、方向、語言、級別匹配，可接 reviewIdentity', () => {
  for (const item of all) {
    const args = input(item);
    const question = buildDailyPracticeQuestion(args);
    const identity = reviewIdentity({ question });
    assert.equal(question.sourceId, item.sourceId);
    assert.equal(question.lang, args.lang);
    assert.equal(question.level, item.level);
    assert.equal(identity.skillKey, args.state.skillKey);
    assert.ok(question.answerKey);
    assert.notEqual(question.kind, 'choice');
  }
});

test('daily practice：canonical 方向別名與日文 N5 級別可匹配，反方向不可偷換', () => {
  for (const mode of ['typing', 'kana', 'listening', 'dictation', 'tiles', 'reorder', 'pos']) {
    const args = input(ja.find(item => item.mode === mode));
    args.level = 'N5';
    args.state.direction = args.state.direction === 'target2zh' ? 'ja-zh' : 'zh-ja';
    args.state.skillKey = `${args.state.sourceId}:${args.state.ability}:${args.state.direction}`;
    args.entry.skillKey = args.state.skillKey;
    assert.equal(buildDailyPracticeQuestion(args).ability, args.state.ability);
  }
  const args = input(en.find(item => item.mode === 'typing'));
  args.state.direction = 'target2zh';
  args.state.skillKey = `${args.state.sourceId}:production:target2zh`;
  args.entry.skillKey = args.state.skillKey;
  assert.throws(() => buildDailyPracticeQuestion(args), code(DAILY_PRACTICE_UNAVAILABLE));
});

test('daily practice：缺人工題、跨來源、跨語言或跨級都不以辨認題遞補', () => {
  const base = input(en.find(item => item.mode === 'typing'));
  for (const patch of [{ items: [] }, { items: ja }, { level: 2 },
    { items: [en.find(item => item.mode === 'typing' && item.sourceId !== base.entry.sourceId)] }]) {
    assert.throws(() => buildDailyPracticeQuestion({ ...base, ...patch }), code(DAILY_PRACTICE_UNAVAILABLE));
  }
  assert.throws(() => buildDailyPracticeQuestion({ ...base, lang: 'ja' }), code('INVALID_DATA'));
  assert.throws(() => buildDailyPracticeQuestion({ ...base, state: { ...base.state, sourceId: 'en-w-999' } }), code('INVALID_DATA'));
});

test('daily practice：同 source 的 assembly 多模式依穩定 id 選題，陣列排序不影響', () => {
  const tiles = clone(en.find(item => item.mode === 'tiles'));
  const reorder = { ...clone(en.find(item => item.mode === 'reorder')), id: 'en-x-000', sourceId: tiles.sourceId };
  const args = { ...input(tiles), items: [tiles, reorder] };
  const first = buildDailyPracticeQuestion(args);
  assert.equal(first.practiceMode, 'reorder');
  assert.equal(first.practiceId, reorder.id);
  assert.deepEqual(buildDailyPracticeQuestion({ ...args, items: [reorder, tiles] }), first);
});

test('daily practice：已保存題面不重選、不取 rng、不依賴仍存在的人工題，且回傳複本', () => {
  const item = en.find(row => row.mode === 'tiles');
  const args = input(item);
  const saved = buildPracticeQuestion(item, () => 0.7);
  args.entry.questionSnapshot = saved;
  args.items = [];
  args.rng = () => { throw new Error('不應重抽'); };
  const result = buildDailyPracticeQuestion(args);
  assert.deepEqual(result, saved);
  result.fragments[0].text = '不得改動原件';
  assert.notDeepEqual(result, saved);
});

test('daily practice：保存快照也必須匹配身份、級別與模式，不能偷偷修補成別題', () => {
  const args = input(en.find(row => row.mode === 'typing'));
  const saved = buildDailyPracticeQuestion(args);
  for (const patch of [{ sourceId: 'en-w-999' }, { lang: 'ja' }, { level: 2 },
    { ability: 'recognition' }, { direction: 'target2zh' }, { practiceMode: 'pos' }]) {
    assert.throws(() => buildDailyPracticeQuestion({ ...args,
      entry: { ...args.entry, questionSnapshot: { ...saved, ...patch } } }), code('INVALID_DATA'));
  }
});

test('daily practice：拒絕不一致的 state/entry skillKey、重複人工題 id 與偽造明示能力', () => {
  const item = en.find(row => row.mode === 'typing');
  const args = input(item);
  assert.throws(() => buildDailyPracticeQuestion({ ...args, entry: { ...args.entry, skillKey: 'wrong' } }), code('INVALID_DATA'));
  assert.throws(() => buildDailyPracticeQuestion({ ...args, state: { ...args.state, skillKey: 'wrong' } }), code('INVALID_DATA'));
  for (const patch of [{ lang: 'ja' }, { level: 2 }, { ability: 'recognition' }, { direction: 'target2zh' }]) {
    assert.throws(() => buildDailyPracticeQuestion({ ...args, entry: { ...args.entry, ...patch } }), code('INVALID_DATA'));
  }
  assert.throws(() => buildDailyPracticeQuestion({ ...args, items: [item, item] }), code('INVALID_DATA'));
  assert.throws(() => buildDailyPracticeQuestion({ ...args, items: [{ ...item, ability: 'recognition' }] }), code(DAILY_PRACTICE_UNAVAILABLE));
});

test('daily practice：新增執行期模組使用 ES2020 語法且沒有新於 ES2020 的已知 API', () => {
  const source = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  for (const file of ['../assets/js/core/daily-practice.js', '../assets/js/ui/daily-practice-question.js']) {
    const body = readFileSync(new URL(file, import.meta.url), 'utf8');
    sandbox.acorn.parse(body, { ecmaVersion: 2020, sourceType: 'module' });
    assert.doesNotMatch(body, /Object\.hasOwn|\.at\(|\.replaceAll\(|structuredClone\(/);
  }
});
