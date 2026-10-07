import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLearningRecord } from '../assets/js/core/learning-schema.js';
import { LearningError } from '../assets/js/core/learning-errors.js';
import {
  reminderStatus, planReminderChange, acknowledgeOutbox, failOutbox, markDelivered, retryable,
  portableReminderPrefs, importReminderPrefs, nextFireTime,
} from '../assets/js/core/reminders.js';

const at = Date.parse;
const TPE = 'Asia/Taipei';
const NY = 'America/New_York';
const prefs = (over = {}) => ({ enabled: true, localTime: '20:00', timeZone: TPE, generation: 3, ...over });
const isLearningError = (code) => (error) => error instanceof LearningError && error.code === code;

/**
 * 依序產生一筆已被平台確認排程的 outbox 列。
 */
function scheduledRow(generation = 3, platformJobId = 'job-3') {
  const plan = planReminderChange({ prefs: prefs({ generation: generation - 1, enabled: false }), nextPrefs: { enabled: true, localTime: '20:00', timeZone: TPE }, now: 10, outboxId: `ob-${generation}` });
  return acknowledgeOutbox({ row: plan.outbox, generation, platformJobId }).row;
}

test('O20 web 平台明說關閉網頁後不會提醒', () => {
  for (const permission of ['granted', 'denied', 'default', 'unsupported']) {
    const status = reminderStatus({ prefs: prefs(), permission, platform: 'web', outboxRows: [] });
    assert.match(status.message, /關閉網頁後不會提醒/, permission);
    assert.equal(status.flags.closesWithPage, true);
  }
  const off = reminderStatus({ prefs: prefs({ enabled: false }), permission: 'default', platform: 'web', outboxRows: [] });
  assert.match(off.message, /關閉網頁後不會提醒/);
  const native = reminderStatus({ prefs: prefs(), permission: 'granted', platform: 'native', outboxRows: [scheduledRow()] });
  assert.doesNotMatch(native.message, /關閉網頁/);
  assert.equal(native.flags.closesWithPage, false);
});

test('O20 權限拒絕時不可假報已排程成功', () => {
  const ghost = scheduledRow();
  for (const platform of ['web', 'native']) {
    const status = reminderStatus({ prefs: prefs(), permission: 'denied', platform, outboxRows: [ghost] });
    assert.equal(status.flags.saved, true);
    assert.equal(status.flags.permission, 'denied');
    assert.equal(status.flags.scheduled, false, '平台殘留列不可當成排程成功');
    assert.equal(status.flags.needsPermission, true);
    assert.match(status.message, /權限被拒絕/);
    assert.doesNotMatch(status.message, /已排程/);
  }
  const unsupported = reminderStatus({ prefs: prefs(), permission: 'unsupported', platform: 'native', outboxRows: [ghost] });
  assert.equal(unsupported.flags.scheduled, false);
  assert.match(unsupported.message, /不支援通知/);
});

test('O20 已保存設定、通知權限、平台排程、平台送達四件事分開呈現', () => {
  const savedOnly = reminderStatus({ prefs: prefs(), permission: 'default', platform: 'native', outboxRows: [] });
  assert.deepEqual([savedOnly.flags.saved, savedOnly.flags.scheduled, savedOnly.flags.delivered], [true, false, false]);
  assert.match(savedOnly.message, /尚未取得通知權限/);

  const plan = planReminderChange({ prefs: prefs({ generation: 2, enabled: false }), nextPrefs: { enabled: true, localTime: '20:00', timeZone: TPE }, now: 10, outboxId: 'ob-3' });
  const pending = reminderStatus({ prefs: plan.prefs, permission: 'granted', platform: 'native', outboxRows: [plan.outbox] });
  assert.deepEqual([pending.flags.permission, pending.flags.pending, pending.flags.scheduled], ['granted', true, false]);
  assert.match(pending.message, /正在排程/);

  const row = acknowledgeOutbox({ row: plan.outbox, generation: 3, platformJobId: 'job-3' }).row;
  const scheduled = reminderStatus({ prefs: plan.prefs, permission: 'granted', platform: 'native', outboxRows: [row] });
  assert.deepEqual([scheduled.flags.scheduled, scheduled.flags.delivered], [true, false]);
  assert.match(scheduled.message, /已排程每日 20:00/);

  const delivered = markDelivered({ row, generation: 3, deliveredAt: 99 }).row;
  const done = reminderStatus({ prefs: plan.prefs, permission: 'granted', platform: 'native', outboxRows: [delivered] });
  assert.deepEqual([done.flags.scheduled, done.flags.delivered], [true, true]);
  assert.match(done.message, /已送達/);

  const failed = failOutbox({ row: plan.outbox, generation: 3, reason: 'platform-error' }).row;
  const broken = reminderStatus({ prefs: plan.prefs, permission: 'granted', platform: 'native', outboxRows: [failed] });
  assert.deepEqual([broken.flags.failed, broken.flags.scheduled], [true, false]);
  assert.match(broken.message, /排程失敗/);

  const off = reminderStatus({ prefs: prefs({ enabled: false }), permission: 'granted', platform: 'native', outboxRows: [row] });
  assert.deepEqual([off.flags.saved, off.flags.scheduled], [false, false]);
  assert.match(off.message, /提醒已關閉/);
});

test('O20 舊世代的排程或送達回報不算目前狀態', () => {
  const old = markDelivered({ row: scheduledRow(2, 'job-2'), generation: 2, deliveredAt: 5 }).row;
  const status = reminderStatus({ prefs: prefs({ generation: 3 }), permission: 'granted', platform: 'native', outboxRows: [old] });
  assert.deepEqual([status.flags.scheduled, status.flags.delivered], [false, false]);
});

test('O20 planReminderChange 產生 outbox 意圖並遞增 generation，新 prefs 通過 schema', () => {
  const base = prefs({ generation: 3 });
  const change = planReminderChange({ prefs: base, nextPrefs: { enabled: true, localTime: '07:30', timeZone: TPE }, now: 1000, outboxId: 'ob-a' });
  assert.equal(change.changed, true);
  assert.equal(change.deduped, false);
  assert.deepEqual(change.prefs, { enabled: true, localTime: '07:30', timeZone: TPE, generation: 4 });
  assert.ok(validateLearningRecord('reminderPreferences', change.prefs).ok);
  assert.deepEqual(change.outbox, { outboxId: 'ob-a', kind: 'schedule', generation: 4, localTime: '07:30', timeZone: TPE, createdAt: 1000, status: 'pending' });
  const cancel = planReminderChange({ prefs: change.prefs, nextPrefs: { enabled: false, localTime: '07:30', timeZone: TPE }, now: 2000, outboxId: 'ob-b' });
  assert.equal(cancel.outbox.kind, 'cancel');
  assert.equal(cancel.prefs.generation, 5);
  assert.deepEqual(base, prefs({ generation: 3 }), '不修改輸入');
});

test('O20 設定沒有變更時不產生意圖；明示重新排程才遞增世代', () => {
  const same = planReminderChange({ prefs: prefs(), nextPrefs: { enabled: true, localTime: '20:00', timeZone: TPE }, now: 1, outboxId: 'ob-x' });
  assert.deepEqual(same, { prefs: prefs(), outbox: null, changed: false, deduped: false });
  const forced = planReminderChange({ prefs: prefs(), nextPrefs: { enabled: true, localTime: '20:00', timeZone: TPE }, now: 1, outboxId: 'ob-x', reschedule: true });
  assert.equal(forced.prefs.generation, 4);
  assert.equal(forced.outbox.kind, 'schedule');
});

test('O20 同 generation 重複意圖去重：重送同一變更回傳既有 outbox 列', () => {
  const input = { prefs: prefs(), nextPrefs: { enabled: true, localTime: '21:00', timeZone: TPE }, now: 1000 };
  const first = planReminderChange({ ...input, outboxId: 'ob-1' });
  const retry = planReminderChange({ ...input, now: 2000, outboxId: 'ob-2', outboxRows: [first.outbox] });
  assert.equal(retry.deduped, true);
  assert.deepEqual(retry.outbox, first.outbox, '不產生第二筆意圖');
  assert.deepEqual(retry.prefs, first.prefs);
  assert.throws(() => planReminderChange({ ...input, nextPrefs: { enabled: true, localTime: '22:00', timeZone: TPE }, outboxId: 'ob-3', outboxRows: [first.outbox] }),
    isLearningError('REVISION_CONFLICT'), '舊 prefs 撞上同世代不同意圖代表另一頁已改過');
});

test('O20 acknowledgeOutbox 只接受相同 generation，舊世代晚到回應忽略', () => {
  const plan = planReminderChange({ prefs: prefs(), nextPrefs: { enabled: true, localTime: '06:00', timeZone: TPE }, now: 5, outboxId: 'ob-4' });
  const late = acknowledgeOutbox({ row: plan.outbox, generation: 3, platformJobId: 'job-old' });
  assert.equal(late.accepted, false);
  assert.deepEqual(late.row, plan.outbox);
  const ok = acknowledgeOutbox({ row: plan.outbox, generation: 4, platformJobId: 'job-4' });
  assert.equal(ok.accepted, true);
  assert.equal(ok.row.status, 'scheduled');
  assert.equal(ok.row.platformJobId, 'job-4');
  const dup = acknowledgeOutbox({ row: ok.row, generation: 4, platformJobId: 'job-4' });
  assert.equal(dup.accepted, false, '重複確認冪等');
  assert.deepEqual(dup.row, ok.row);
  assert.equal(failOutbox({ row: plan.outbox, generation: 3, reason: 'x' }).accepted, false);
  assert.equal(markDelivered({ row: ok.row, generation: 3, deliveredAt: 9 }).accepted, false);
  const cancelPlan = planReminderChange({ prefs: plan.prefs, nextPrefs: { enabled: false, localTime: '06:00', timeZone: TPE }, now: 6, outboxId: 'ob-5' });
  const cancelled = acknowledgeOutbox({ row: cancelPlan.outbox, generation: 5, platformJobId: null });
  assert.deepEqual([cancelled.accepted, cancelled.row.status], [true, 'cancelled']);
  assert.throws(() => acknowledgeOutbox({ row: plan.outbox, generation: 4, platformJobId: null }), isLearningError('INVALID_DATA'),
    '排程確認必須帶平台工作 ID');
});

test('O20 retryable：待處理或失敗才可重試，舊世代與已完成不可重試', () => {
  const plan = planReminderChange({ prefs: prefs(), nextPrefs: { enabled: true, localTime: '06:00', timeZone: TPE }, now: 5, outboxId: 'ob-4' });
  assert.equal(retryable(plan.outbox), true);
  const failed = failOutbox({ row: plan.outbox, generation: 4, reason: 'permission-denied' }).row;
  assert.equal(failed.status, 'failed');
  assert.equal(retryable(failed), true);
  assert.equal(retryable(failed, 5), false, '已被新世代取代');
  assert.equal(retryable(acknowledgeOutbox({ row: plan.outbox, generation: 4, platformJobId: 'j' }).row), false);
});

test('O20 portableReminderPrefs 匯出不帶 OS 工作 ID 或權限狀態', () => {
  const local = { ...prefs(), platformJobId: 'os-123', permission: 'granted', scheduled: true };
  const portable = portableReminderPrefs(local);
  assert.deepEqual(portable, prefs());
  assert.ok(validateLearningRecord('reminderPreferences', portable).ok);
  assert.ok(!JSON.stringify(portable).includes('os-123'));
});

test('O20 importReminderPrefs：保留開關但需在本機重新允許與排程，generation 重設為本機新值', () => {
  const imported = { ...prefs({ generation: 42, timeZone: NY }), platformJobId: 'os-from-other-device' };
  const result = importReminderPrefs(imported, { timeZone: TPE, localGeneration: 7 });
  assert.deepEqual(result.prefs, { enabled: true, localTime: '20:00', timeZone: TPE, generation: 8 });
  assert.ok(validateLearningRecord('reminderPreferences', result.prefs).ok);
  assert.equal(result.needsLocalSetup, true);
  assert.ok(!JSON.stringify(result).includes('os-from-other-device'));
  const status = reminderStatus({ prefs: result.prefs, permission: 'default', platform: 'native', outboxRows: [] });
  assert.equal(status.flags.scheduled, false);
  const disabled = importReminderPrefs(prefs({ enabled: false }), { timeZone: TPE });
  assert.equal(disabled.needsLocalSetup, false);
  assert.equal(disabled.prefs.generation, 1);
  assert.throws(() => importReminderPrefs({ enabled: true, localTime: '25:00', timeZone: TPE, generation: 0 }, { timeZone: TPE }), isLearningError('INVALID_DATA'));
});

test('O20 nextFireTime：Asia/Taipei 今天未到用今天，已過或剛好到點用明天', () => {
  assert.equal(nextFireTime({ localTime: '20:00', timeZone: TPE, now: at('2026-10-07T11:00:00Z') }), at('2026-10-07T12:00:00Z'));
  assert.equal(nextFireTime({ localTime: '20:00', timeZone: TPE, now: at('2026-10-07T12:00:00Z') }), at('2026-10-08T12:00:00Z'));
  assert.equal(nextFireTime({ localTime: '20:00', timeZone: TPE, now: at('2026-10-07T12:30:00Z') }), at('2026-10-08T12:00:00Z'));
  assert.equal(nextFireTime({ localTime: '07:00', timeZone: TPE, now: at('2026-12-31T23:30:00Z') }), at('2027-01-01T23:00:00Z'));
  assert.equal(nextFireTime({ localTime: '00:00', timeZone: TPE, now: at('2026-10-07T15:59:00Z') }), at('2026-10-07T16:00:00Z'));
});

test('O20 nextFireTime：America/New_York 春季 DST 日（23 小時）與不存在的時刻', () => {
  assert.equal(nextFireTime({ localTime: '20:00', timeZone: NY, now: at('2026-03-08T02:00:00Z') }), at('2026-03-09T00:00:00Z'),
    '前一晚已過 20:00，下一次是 DST 當日 20:00 EDT');
  assert.equal(nextFireTime({ localTime: '20:00', timeZone: NY, now: at('2026-03-07T12:00:00Z') }), at('2026-03-08T01:00:00Z'));
  assert.equal(nextFireTime({ localTime: '02:30', timeZone: NY, now: at('2026-03-08T05:00:00Z') }), at('2026-03-08T07:30:00Z'),
    '02:30 不存在時順延為跳時後的同一瞬間（03:30 EDT）');
});

test('O20 nextFireTime：America/New_York 秋季 DST 日重複時刻取第一次', () => {
  assert.equal(nextFireTime({ localTime: '01:30', timeZone: NY, now: at('2026-11-01T04:00:00Z') }), at('2026-11-01T05:30:00Z'));
  assert.equal(nextFireTime({ localTime: '20:00', timeZone: NY, now: at('2026-11-01T04:00:00Z') }), at('2026-11-02T01:00:00Z'));
  assert.equal(nextFireTime({ localTime: '01:30', timeZone: NY, now: at('2026-11-01T05:30:00Z') }), at('2026-11-02T06:30:00Z'),
    '第一次 01:30 已觸發後不在重複小時再觸發，改明天 01:30 EST');
});

test('O20 不合法輸入以 LearningError 拒絕', () => {
  assert.throws(() => nextFireTime({ localTime: '8:00', timeZone: TPE, now: 0 }), isLearningError('INVALID_DATA'));
  assert.throws(() => nextFireTime({ localTime: '08:00', timeZone: 'EST-5', now: 0 }), isLearningError('INVALID_DATA'));
  assert.throws(() => nextFireTime({ localTime: '08:00', timeZone: TPE, now: Number.NaN }), isLearningError('INVALID_DATA'));
  assert.throws(() => reminderStatus({ prefs: prefs(), permission: 'maybe', platform: 'web', outboxRows: [] }), isLearningError('INVALID_DATA'));
  assert.throws(() => reminderStatus({ prefs: prefs(), permission: 'granted', platform: 'desktop', outboxRows: [] }), isLearningError('INVALID_DATA'));
  assert.throws(() => reminderStatus({ prefs: { ...prefs(), extra: 1 }, permission: 'granted', platform: 'web', outboxRows: [] }), isLearningError('INVALID_DATA'));
  assert.throws(() => planReminderChange({ prefs: prefs(), nextPrefs: { enabled: true, localTime: '20:00', timeZone: TPE }, now: 1, outboxId: 'bad id', reschedule: true }), isLearningError('INVALID_DATA'));
  assert.throws(() => planReminderChange({ prefs: prefs(), nextPrefs: { enabled: true, localTime: '99:00', timeZone: TPE }, now: 1, outboxId: 'ob' }), isLearningError('INVALID_DATA'));
});
