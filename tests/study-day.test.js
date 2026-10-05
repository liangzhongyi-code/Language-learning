import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  localStudyDate, studyDayKey, studyPlanKey, createStudyDayState,
  requestStudyTimeZone, resolveStudyDay,
} from '../assets/js/core/study-day.js';

const at = Date.parse;
const state = (currentZone = 'Asia/Taipei', latestDay = '2026-10-05', pendingZone = null) =>
  ({ currentZone, pendingZone, latestDay });

test('D04 台北午夜前後與 UTC 跨日各依指定時區', () => {
  assert.equal(localStudyDate(at('2026-10-05T15:59:59.999Z'), 'Asia/Taipei'), '2026-10-05');
  assert.equal(localStudyDate(at('2026-10-05T16:00:00Z'), 'Asia/Taipei'), '2026-10-06');
  assert.equal(localStudyDate(at('2026-10-05T16:00:00Z'), 'UTC'), '2026-10-05');
  assert.equal(localStudyDate(at('2026-10-06T00:00:00Z'), 'UTC'), '2026-10-06');
});

test('D04 紐約午夜與跨年使用當地日期', () => {
  assert.equal(localStudyDate(at('2027-01-01T04:59:59.999Z'), 'America/New_York'), '2026-12-31');
  assert.equal(localStudyDate(at('2027-01-01T05:00:00Z'), 'America/New_York'), '2027-01-01');
});

test('D04 DST 春季跳時及 23 小時日不提前跨日', () => {
  for (const instant of ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-03-09T03:59:59Z']) {
    assert.equal(localStudyDate(at(instant), 'America/New_York'), '2026-03-08');
  }
  assert.equal(localStudyDate(at('2026-03-09T04:00:00Z'), 'America/New_York'), '2026-03-09');
});

test('D04 DST 秋季重複小時及 25 小時日不重領', () => {
  const fixed = state('America/New_York', '2026-11-01');
  for (const instant of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-02T04:59:59Z']) {
    assert.equal(localStudyDate(at(instant), fixed.currentZone), '2026-11-01');
    assert.equal(resolveStudyDay(fixed, at(instant)).isNewDay, false);
  }
  assert.equal(resolveStudyDay(fixed, at('2026-11-02T05:00:00Z')).localDate, '2026-11-02');
});

test('D04 閏日與四位年份保持 YYYY-MM-DD', () => {
  assert.equal(localStudyDate(at('2028-02-29T12:00:00Z'), 'UTC'), '2028-02-29');
  assert.equal(localStudyDate(at('0001-01-01T12:00:00Z'), 'UTC'), '0001-01-01');
});

test('D04 finite now 必須為有效 epoch 毫秒數值且結果為西元四位年', () => {
  for (const invalid of [undefined, null, '', '123', NaN, Infinity, -Infinity, new Date(), 8640000000000001]) {
    assert.throws(() => localStudyDate(invalid, 'UTC'), RangeError);
  }
  for (const instant of ['0000-12-31T12:00:00Z', '+010000-01-01T00:00:00Z']) {
    assert.throws(() => localStudyDate(at(instant), 'UTC'), RangeError);
  }
  assert.equal(localStudyDate(0, 'UTC'), '1970-01-01');
});

test('D04 缺省、非法 IANA 或數字 offset 拒絕且不 fallback OS', () => {
  for (const zone of [undefined, null, '', ' ', ' Asia/Taipei', 'Asia/Taipei ', 'Mars/Olympus', '+08:00', '-0800', 'UTC+8', 8, {}]) {
    assert.throws(() => localStudyDate(0, zone), RangeError);
    assert.throws(() => createStudyDayState(zone), RangeError);
    assert.throws(() => requestStudyTimeZone(state(), zone), RangeError);
  }
});

test('D04 合法 IANA 別名及 Etc 時區可使用', () => {
  assert.equal(localStudyDate(0, 'US/Eastern'), '1969-12-31');
  assert.equal(localStudyDate(0, 'Etc/GMT+8'), '1969-12-31');
  assert.equal(localStudyDate(0, 'Etc/UTC'), '1970-01-01');
});

test('D04 拒絕 Intl 寬鬆接受但不屬 IANA 的三字縮寫', () => {
  for (const zone of ['PST', 'CST', 'ACT', 'AET']) {
    assert.throws(() => localStudyDate(0, zone), RangeError);
  }
  assert.equal(localStudyDate(0, 'Japan'), '1970-01-01');
  assert.equal(localStudyDate(0, 'GMT'), '1970-01-01');
});

test('review regression: fixed study zones accept numeric IANA aliases without accepting offsets', () => {
  for (const zone of ['EST5EDT', 'CST6CDT', 'PST8PDT']) {
    const initial = createStudyDayState(zone);
    assert.equal(resolveStudyDay(initial, at('2026-10-05T12:00:00Z')).timeZone, zone);
    assert.equal(requestStudyTimeZone(state(), zone).pendingZone, zone);
  }
  for (const zone of ['UTC\n', 'Asia/Taipei\n', 'EST5EDT\n', '+08:00', 'PST']) {
    assert.throws(() => createStudyDayState(zone), RangeError);
    assert.throws(() => localStudyDate(0, zone), RangeError);
  }
});

test('D04 日鍵組件拒絕尾端換行，不能讓錨點接受隱藏字元', () => {
  assert.throws(() => studyDayKey('2026-10-05', 'ja\n'), RangeError);
  assert.throws(() => studyPlanKey('2026-10-05', 'ja', 'N5\n'), RangeError);
});

test('D04 OS timezone 改變不影響固定日期與 policy', () => {
  const moduleUrl = new URL('../assets/js/core/study-day.js', import.meta.url).href;
  const script = `import { localStudyDate, resolveStudyDay } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([localStudyDate(${at('2026-10-05T16:00:00Z')}, 'Asia/Taipei'),
      resolveStudyDay(${JSON.stringify(state())}, ${at('2026-10-05T16:00:00Z')})]));`;
  for (const TZ of ['UTC', 'America/New_York', 'Pacific/Honolulu']) {
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, TZ },
    }));
    assert.equal(result[0], '2026-10-06');
    assert.equal(result[1].localDate, '2026-10-06');
    assert.equal(result[1].timeZone, 'Asia/Taipei');
  }
});

test('D04 day key 跨級共用且 plan key 按語言級別區分', () => {
  assert.equal(studyDayKey('2026-10-05', 'ja'), '2026-10-05:ja');
  assert.equal(studyDayKey('2026-10-05', 'en'), '2026-10-05:en');
  assert.equal(studyPlanKey('2026-10-05', 'ja', 'N5'), '2026-10-05:ja:N5');
  assert.equal(studyPlanKey('2026-10-05', 'ja', 'N4'), '2026-10-05:ja:N4');
});

test('D04 key 拒絕不合法日期及會造成碰撞的組件', () => {
  for (const date of ['', '2026-2-03', '2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01', null]) {
    assert.throws(() => studyDayKey(date, 'ja'), RangeError);
  }
  for (const part of ['', undefined, 'ja:N5', ' ja', 1]) {
    assert.throws(() => studyDayKey('2026-10-05', part), RangeError);
    assert.throws(() => studyPlanKey('2026-10-05', 'ja', part), RangeError);
  }
  assert.equal(studyDayKey('2028-02-29', 'ja'), '2028-02-29:ja');
});

test('D04 初次使用由 UI 提供時區，首次建立日回傳可保存的新 state', () => {
  const initial = createStudyDayState('Asia/Taipei');
  assert.deepEqual(initial, state('Asia/Taipei', null));
  assert.deepEqual(resolveStudyDay(initial, at('2026-10-05T00:00:00Z')), {
    localDate: '2026-10-05', timeZone: 'Asia/Taipei', isNewDay: true,
    clockMovedBack: false, state: state(),
  });
  assert.equal(initial.latestDay, null);
});

test('D04 同日重開保持既有 day，正常隔日才推進 latestDay', () => {
  const same = resolveStudyDay(state(), at('2026-10-05T01:00:00Z'));
  assert.equal(same.isNewDay, false);
  assert.deepEqual(same.state, state());
  const next = resolveStudyDay(same.state, at('2026-10-05T16:00:00Z'));
  assert.equal(next.isNewDay, true);
  assert.equal(next.state.latestDay, '2026-10-06');
  assert.equal(resolveStudyDay(next.state, at('2026-10-05T16:00:00Z')).isNewDay, false);
});

test('D04 時鐘倒退及恢復已建日都不重領，只有超越 latestDay 才有新日', () => {
  const fixed = Object.freeze(state());
  const back = resolveStudyDay(fixed, at('2026-10-02T00:00:00Z'));
  assert.equal(back.localDate, '2026-10-05');
  assert.equal(back.isNewDay, false);
  assert.equal(back.clockMovedBack, true);
  assert.deepEqual(back.state, fixed);
  assert.equal(resolveStudyDay(back.state, at('2026-10-05T00:00:00Z')).isNewDay, false);
  assert.equal(resolveStudyDay(back.state, at('2026-10-06T00:00:00Z')).isNewDay, true);
});

test('D04 往未來跳多日只建立觀察到的新日，不補發中間日期', () => {
  const future = resolveStudyDay(state(), at('2026-10-10T00:00:00Z'));
  assert.equal(future.localDate, '2026-10-10');
  assert.equal(resolveStudyDay(future.state, at('2026-10-06T00:00:00Z')).isNewDay, false);
});

test('D04 手動時區變動先 pending，既有日不改寫', () => {
  const original = Object.freeze(state());
  const requested = requestStudyTimeZone(original, 'America/New_York');
  assert.deepEqual(requested, state('Asia/Taipei', '2026-10-05', 'America/New_York'));
  const today = resolveStudyDay(requested, at('2026-10-05T12:00:00Z'));
  assert.equal(today.localDate, '2026-10-05');
  assert.equal(today.timeZone, 'Asia/Taipei');
  assert.equal(today.isNewDay, false);
  assert.deepEqual(original, state());
});

test('D04 向西改時區尚在已建日期時延後，到雙方新日才採用', () => {
  const requested = state('Asia/Taipei', '2026-10-05', 'America/New_York');
  const waiting = resolveStudyDay(requested, at('2026-10-05T16:00:00Z'));
  assert.equal(waiting.localDate, '2026-10-05');
  assert.equal(waiting.timeZone, 'Asia/Taipei');
  assert.equal(waiting.isNewDay, false);
  assert.deepEqual(waiting.state, requested);
  const next = resolveStudyDay(waiting.state, at('2026-10-06T04:00:00Z'));
  assert.equal(next.localDate, '2026-10-06');
  assert.equal(next.timeZone, 'America/New_York');
  assert.equal(next.isNewDay, true);
  assert.deepEqual(next.state, state('America/New_York', '2026-10-06'));
});

test('D04 向東改時區不能在原時區當日立刻多領', () => {
  const requested = state('America/New_York', '2026-10-05', 'Asia/Taipei');
  assert.equal(resolveStudyDay(requested, at('2026-10-05T20:00:00Z')).isNewDay, false);
  const next = resolveStudyDay(requested, at('2026-10-06T04:00:00Z'));
  assert.equal(next.localDate, '2026-10-06');
  assert.equal(next.timeZone, 'Asia/Taipei');
  assert.equal(next.state.pendingZone, null);
});

test('D04 反覆改區可替換或取消 pending，未建首日可立即選區', () => {
  const requested = requestStudyTimeZone(state(), 'America/New_York');
  assert.equal(requestStudyTimeZone(requested, 'Europe/London').pendingZone, 'Europe/London');
  assert.equal(requestStudyTimeZone(requested, 'Asia/Taipei').pendingZone, null);
  assert.deepEqual(requestStudyTimeZone(createStudyDayState('UTC'), 'Asia/Taipei'), state('Asia/Taipei', null));
});

test('D04 pending 時鐘倒退保留原 zone 與 latestDay', () => {
  const requested = state('Asia/Taipei', '2026-10-05', 'America/New_York');
  const back = resolveStudyDay(requested, at('2026-10-01T00:00:00Z'));
  assert.equal(back.clockMovedBack, true);
  assert.equal(back.isNewDay, false);
  assert.deepEqual(back.state, requested);
});

test('D04 state 結構、日期、current/pending zone 均驗證且錯誤不修改輸入', () => {
  for (const invalid of [null, [], {}, state('Mars/Nope'), state('UTC', '2026-02-30'), state('UTC', undefined, 'Mars/Nope'),
    { currentZone: 'UTC', latestDay: null }, { currentZone: 'UTC', pendingZone: null }]) {
    assert.throws(() => resolveStudyDay(invalid, 0), RangeError);
    assert.throws(() => requestStudyTimeZone(invalid, 'UTC'), RangeError);
  }
  const fixed = Object.freeze(state());
  assert.throws(() => resolveStudyDay(fixed, NaN), RangeError);
  assert.deepEqual(fixed, state());
});
