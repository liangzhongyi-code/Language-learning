import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { LearningError } from '../assets/js/core/learning-errors.js';
import { buildFsrsVendor, SOURCE_SHA256 } from '../tools/build-fsrs.mjs';
import * as vendor from '../assets/js/vendor/ts-fsrs.js';
import { scheduleFsrs, FSRS_VERSION } from '../assets/js/core/fsrs-adapter.js';
import { scheduleReview, initializeItemState } from '../assets/js/core/scheduler.js';
import { createReviewEvent, applyReview } from '../assets/js/core/review-events.js';
import { validateLearningRecord } from '../assets/js/core/learning-schema.js';

const T0 = Date.UTC(2026, 9, 7, 1, 0);
const DAY = 86_400_000;
const fresh = initializeItemState({ sourceId: 'ja-w-001', ability: 'recognition', direction: 'target2zh', initialization: { kind: 'new' } });

function choiceEvent({ correct = true, at = T0, reviewId = 'rv-1', entryId = 'e1', sessionId = 's1', hintUsed = false,
  retry = false, reinforcement = false, replayCount = 0, responseMs = null } = {}) {
  return createReviewEvent({ sessionId, entryId, planId: null, lang: 'ja', source: 'daily', now: at, reviewId,
    question: { sourceId: 'ja-w-001', kind: 'choice', direction: 'target2zh', options: [{ text: 'a' }, { text: 'b' }],
      correctIndex: 0, answeredIndex: correct ? 0 : 1 },
    answerContext: { submitted: true, hintUsed, retry, reinforcement, replayCount, responseMs } });
}

test('F40：非法 FSRS 記憶／計數／時間／未知欄位不能進入上游計算', () => {
  const state = { ...fresh, ...scheduleFsrs({ previousState: fresh, rating: 'Good', at: T0 }) };
  for (const patch of [
    { stability: -1 }, { difficulty: 11 }, { elapsedDays: -1 }, { scheduledDays: 0.5 },
    { reps: -1 }, { reps: 0.5 }, { lapses: 2 }, { learningSteps: 1 }, { state: 99 },
    { lastReview: null }, { lastReview: T0 + DAY }, { extra: 1 },
  ]) {
    const previousState = { ...state, schedulerState: { ...state.schedulerState, ...patch } };
    const original = structuredClone(previousState);
    assert.throws(() => scheduleFsrs({ previousState, rating: 'Good', at: T0 }),
      (e) => e instanceof LearningError && e.code === 'INVALID_DATA', JSON.stringify(patch));
    assert.deepEqual(previousState, original);
  }
  assert.throws(() => scheduleFsrs({ previousState: state, rating: 'Good', at: 8_640_000_000_000_001 }),
    (e) => e.code === 'INVALID_DATA');
});

test('F40：Date 極限與非法輸入都回傳 typed error，不產生損壞排程', () => {
  for (const at of [-1, 0.5, NaN, Infinity, 8_640_000_000_000_000, 8_640_000_000_000_001]) {
    assert.throws(() => scheduleFsrs({ previousState: fresh, rating: 'Good', at }),
      (e) => e instanceof LearningError && e.code === 'INVALID_DATA');
  }
  for (const previousState of [null, {}, { ...fresh, schedulerName: 'future' }]) {
    assert.throws(() => scheduleFsrs({ previousState, rating: 'Good', at: T0 }),
      (e) => e instanceof LearningError && e.code === 'INVALID_DATA');
  }
});

test('F40：未知版本／損壞狀態在非到期與補強路徑也必須拒絕', () => {
  const state = { ...fresh, ...scheduleFsrs({ previousState: fresh, rating: 'Good', at: T0 }) };
  for (const reinforcement of [false, true]) {
    assert.throws(() => scheduleReview({ event: choiceEvent({ reinforcement }),
      previousState: { ...state, schedulerVersion: 'ts-fsrs-future' }, policy: 'fsrs' }),
    (e) => e.code === 'UNSUPPORTED_VERSION');
    assert.throws(() => scheduleReview({ event: choiceEvent({ reinforcement }),
      previousState: { ...state, schedulerState: { ...state.schedulerState, reps: -1 } }, policy: 'fsrs' }),
    (e) => e.code === 'INVALID_DATA');
  }
});

test('F40/D16：鎖定版本預設參數的 golden 輸出（Good 3 天、Again 1 天、第二次 Good 14 天）', () => {
  const good = scheduleFsrs({ previousState: fresh, rating: 'Good', at: T0 });
  assert.equal(good.due, T0 + 3 * DAY);
  assert.equal(good.schedulerState.stability, 2.3065);
  assert.equal(good.schedulerVersion, FSRS_VERSION);
  const again = scheduleFsrs({ previousState: fresh, rating: 'Again', at: T0 });
  assert.equal(again.due, T0 + DAY);
  assert.equal(again.schedulerState.stability, 0.212);
  const second = scheduleFsrs({ previousState: { ...fresh, ...good }, rating: 'Good', at: good.due });
  assert.equal(second.due, good.due + 14 * DAY);
  assert.equal(second.schedulerState.stability, 13.82690327);
  assert.ok(validateLearningRecord('itemStates', { ...fresh, ...second }).ok, 'FSRS 狀態可通過 schema');
});

test('F40/D16：與上游 ts-fsrs 套件逐步輸出一致；不臆測 Hard／Easy', async (t) => {
  if (!existsSync(new URL('../node_modules/ts-fsrs/dist/index.mjs', import.meta.url))) { t.skip('未安裝開發依賴 ts-fsrs'); return; }
  const upstream = await import('ts-fsrs');
  const f = upstream.fsrs(upstream.generatorParameters({ enable_fuzz: false, enable_short_term: false }));
  let card = upstream.createEmptyCard(new Date(T0));
  let state = fresh;
  let at = T0;
  for (const rating of ['Good', 'Again', 'Good', 'Good']) {
    card = f.next(card, new Date(at), upstream.Rating[rating]).card;
    state = { ...state, ...scheduleFsrs({ previousState: state, rating, at }) };
    assert.equal(state.due, card.due.getTime());
    assert.equal(state.schedulerState.stability, card.stability);
    at = state.due;
  }
  assert.throws(() => scheduleFsrs({ previousState: fresh, rating: 'Easy', at: T0 }), (e) => e.code === 'INVALID_DATA');
});

test('F40/D16：2,000 次持久化轉換與固定 5.4.2 上游所有卡片欄位完全一致', async (t) => {
  if (!existsSync(new URL('../node_modules/ts-fsrs/dist/index.mjs', import.meta.url))) { t.skip('未安裝開發依賴 ts-fsrs'); return; }
  const pkg = JSON.parse(readFileSync(new URL('../node_modules/ts-fsrs/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '5.4.2');
  const upstream = await import('ts-fsrs');
  const f = upstream.fsrs(upstream.generatorParameters({ enable_fuzz: false, enable_short_term: false }));
  let seed = 542;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let trial = 0; trial < 100; trial++) {
    let state = structuredClone(fresh);
    let at = T0 + trial * DAY;
    let card = upstream.createEmptyCard(new Date(at));
    for (let step = 0; step < 20; step++) {
      const rating = random() % 4 === 0 ? 'Again' : 'Good';
      const original = structuredClone(state);
      const beforeCard = structuredClone(card);
      const next = f.next(card, new Date(at), upstream.Rating[rating]).card;
      const scheduled = scheduleFsrs({ previousState: state, rating, at });
      assert.deepEqual(state, original, 'adapter 不改動傳入的持久化狀態');
      assert.deepEqual(card, beforeCard, '上游也以新卡片回傳');
      assert.deepEqual(scheduled.schedulerState, {
        stability: next.stability, difficulty: next.difficulty, elapsedDays: next.elapsed_days,
        scheduledDays: next.scheduled_days, reps: next.reps, lapses: next.lapses,
        learningSteps: next.learning_steps, state: next.state, lastReview: next.last_review.getTime(),
      }, `trial ${trial} step ${step}`);
      assert.equal(scheduled.due, next.due.getTime());
      assert.equal(scheduled.lastEligibleReviewAt, at);
      state = JSON.parse(JSON.stringify({ ...state, ...scheduled }));
      assert.ok(validateLearningRecord('itemStates', state).ok);
      card = next;
      const gap = random() % 4;
      at = gap === 0 ? at : gap === 1 ? at + DAY : state.due + (gap === 3 ? 30 * DAY : 0);
    }
  }
});

test('F17：vendor 必須能以 ES2020 模組語法解析', (t) => {
  const parserSource = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
  if (!parserSource) { t.skip('此 Node 未提供內建 Acorn；須另行執行 ES2020 解析驗證'); return; }
  const sandbox = {};
  runInNewContext(parserSource, sandbox);
  sandbox.acorn.parse(readFileSync(new URL('../assets/js/vendor/ts-fsrs.js', import.meta.url), 'utf8'),
    { ecmaVersion: 2020, sourceType: 'module' });
});

test('F40/D17：舊摘要保留，未到期答對不轉換；第一次合格複習才建立 FSRS 狀態', () => {
  const legacy = initializeItemState({ sourceId: 'ja-w-001', ability: 'recognition', direction: 'target2zh',
    initialization: { kind: 'legacy', progress: { n: 5, w: 1, box: 3, last: T0 - DAY, due: T0 + 5 * DAY } } });
  const early = scheduleReview({ event: choiceEvent({ at: T0 }), previousState: legacy, policy: 'fsrs' });
  assert.equal(early.scheduleEligible, false);
  assert.equal(early.itemState.schedulerName, 'legacy', '未到期答對不推遠、不轉換');
  const due = scheduleReview({ event: choiceEvent({ at: T0 + 6 * DAY, reviewId: 'rv-2', entryId: 'e2' }), previousState: legacy, policy: 'fsrs' });
  assert.equal(due.scheduleEligible, true);
  assert.equal(due.itemState.schedulerName, 'fsrs');
  assert.deepEqual(due.itemState.legacySummary, legacy.legacySummary, 'legacySummary 原樣保留');
});

test('F40/O09：用了提示的答對以 Again 排程；FSRS 狀態不可被 Leitner 政策改寫', () => {
  const hinted = scheduleReview({ event: choiceEvent({ hintUsed: true }), previousState: fresh, policy: 'fsrs' });
  assert.equal(hinted.rating, 'Again');
  assert.equal(hinted.itemState.due, T0 + DAY);
  assert.throws(() => scheduleReview({ event: choiceEvent({ at: T0 + 5 * DAY, reviewId: 'rv-9', entryId: 'e9' }),
    previousState: hinted.itemState, policy: 'leitner' }), (e) => e.code === 'UNSUPPORTED');
});

test('F40：applyReview 在 FSRS 下同步逐題摘要 due，舊盒號保留', () => {
  const event = choiceEvent();
  const applied = applyReview({ event, initialization: { kind: 'legacy', progress: { n: 2, w: 0, box: 2, last: T0 - 3 * DAY, due: T0 - DAY } },
    sourceProgress: { n: 2, w: 0, box: 2, last: T0 - 3 * DAY, due: T0 - DAY }, policy: 'fsrs' });
  assert.equal(applied.progress.box, 2);
  assert.equal(applied.progress.due, applied.itemState.due);
  assert.equal(applied.itemState.schedulerName, 'fsrs');
});

test('F17：網站 vendor 可重現固定上游 ES2020 建置，檔頭保留完整 MIT 授權', (t) => {
  const bundled = readFileSync(new URL('../assets/js/vendor/ts-fsrs.js', import.meta.url), 'utf8');
  assert.match(bundled, /ts-fsrs 5\.4\.2/);
  assert.match(bundled, /MIT License/);
  const upstreamPath = new URL('../node_modules/ts-fsrs/dist/index.mjs', import.meta.url);
  if (!existsSync(upstreamPath)) { t.skip('未安裝開發依賴 ts-fsrs'); return; }
  const upstream = readFileSync(upstreamPath, 'utf8');
  const hash = createHash('sha256').update(upstream).digest('hex');
  const pkg = JSON.parse(readFileSync(new URL('../node_modules/ts-fsrs/package.json', import.meta.url), 'utf8'));
  const license = readFileSync(new URL('../node_modules/ts-fsrs/LICENSE', import.meta.url), 'utf8');
  assert.equal(hash, SOURCE_SHA256);
  assert.ok(bundled.includes(`source sha256 ${hash}`));
  assert.ok(bundled.includes(license.trim().split('\n').map((line) => ` * ${line}`.trimEnd()).join('\n')));
  assert.equal(bundled, buildFsrsVendor({ pkg, source: upstream, license }));
  assert.throws(() => buildFsrsVendor({ pkg: { ...pkg, version: 'future' }, source: upstream, license }));
  assert.throws(() => buildFsrsVendor({ pkg, source: `${upstream}\n`, license }));
  assert.throws(() => buildFsrsVendor({ pkg, source: upstream, license: '' }));
});

test('F17：ES2020 轉換保留上游 own-property descriptor、短期排程與四種 rating 輸出', async (t) => {
  if (!existsSync(new URL('../node_modules/ts-fsrs/dist/index.mjs', import.meta.url))) { t.skip('未安裝開發依賴 ts-fsrs'); return; }
  const upstream = await import('ts-fsrs');
  for (const enable_short_term of [false, true]) {
    const options = { enable_fuzz: false, enable_short_term };
    const actual = vendor.fsrs(vendor.generatorParameters(options));
    const expected = upstream.fsrs(upstream.generatorParameters(options));
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of Object.keys(expected)) {
      const a = Object.getOwnPropertyDescriptor(actual, key);
      const e = Object.getOwnPropertyDescriptor(expected, key);
      assert.deepEqual([a.writable, a.enumerable, a.configurable], [e.writable, e.enumerable, e.configurable]);
    }
    let aCard = vendor.createEmptyCard(new Date(T0));
    let eCard = upstream.createEmptyCard(new Date(T0));
    let at = T0;
    for (let step = 0; step < 40; step++) {
      for (const rating of ['Again', 'Hard', 'Good', 'Easy']) {
        assert.deepEqual(actual.next(aCard, new Date(at), vendor.Rating[rating]),
          expected.next(eCard, new Date(at), upstream.Rating[rating]));
      }
      const rating = step % 3 === 0 ? 'Again' : 'Good';
      aCard = actual.next(aCard, new Date(at), vendor.Rating[rating]).card;
      eCard = expected.next(eCard, new Date(at), upstream.Rating[rating]).card;
      at = aCard.due.getTime();
    }
  }
});

/**
 * 突變只匯入記憶體中的 data URL，不改工作區；沿用上述 GREEN 的斷言證明會抓到迴歸。
 */
async function mutatedModule(relativePath, before, after) {
  const url = new URL(relativePath, import.meta.url);
  const source = readFileSync(url, 'utf8');
  assert.ok(source.includes(before), '突變目標必須存在');
  const changed = source.replace(before, after).replace(/(from\s+['"])(\.[^'"]+)(['"])/g,
    (_, prefix, specifier, suffix) => `${prefix}${new URL(specifier, url).href}${suffix}`);
  return import(`data:text/javascript;base64,${Buffer.from(changed).toString('base64')}`);
}

test('F40/V：既有 GREEN golden、legacy 未到期與摘要盒號斷言都能殺死突變', async () => {
  const golden = (fn) => assert.equal(fn({ previousState: fresh, rating: 'Good', at: T0 }).due, T0 + 3 * DAY);
  golden(scheduleFsrs);
  const changedDue = await mutatedModule('../assets/js/core/fsrs-adapter.js',
    'due: next.due.getTime(),', 'due: next.due.getTime() + 86_400_000,');
  assert.throws(() => golden(changedDue.scheduleFsrs), assert.AssertionError);

  const legacy = initializeItemState({ sourceId: 'ja-w-001', ability: 'recognition', direction: 'target2zh',
    initialization: { kind: 'legacy', progress: { n: 5, w: 1, box: 3, last: T0 - DAY, due: T0 + 5 * DAY } } });
  const early = (fn) => assert.equal(fn({ event: choiceEvent(), previousState: legacy, policy: 'fsrs' }).scheduleEligible, false);
  early(scheduleReview);
  const changedEligibility = await mutatedModule('../assets/js/core/scheduler.js',
    'previousState.due <= event.answeredAt', 'true');
  assert.throws(() => early(changedEligibility.scheduleReview), assert.AssertionError);

  const preservedBox = (fn) => assert.equal(fn({ event: choiceEvent(),
    initialization: { kind: 'legacy', progress: { n: 2, w: 0, box: 2, last: T0 - 3 * DAY, due: T0 - DAY } },
    sourceProgress: { n: 2, w: 0, box: 2, last: T0 - 3 * DAY, due: T0 - DAY }, policy: 'fsrs' }).progress.box, 2);
  preservedBox(applyReview);
  const changedBox = await mutatedModule('../assets/js/core/review-events.js',
    'progress.due = scheduled.itemState.due;', 'progress.box = 1; progress.due = scheduled.itemState.due;');
  assert.throws(() => preservedBox(changedBox.applyReview), assert.AssertionError);
});
