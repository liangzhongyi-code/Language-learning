/**
 * 每日提醒的純核心：狀態說明、outbox 意圖、跨裝置匯出入與下一次提醒時間。
 * 嚴格區分四件事：已保存設定（prefs.enabled）、通知權限（平台查詢）、
 * 已排程與已送達（皆由平台回報）。不讀時鐘、不碰平台 API，平台轉接器負責執行 outbox。
 */
import { LearningError } from './learning-errors.js';
import { validateLearningRecord } from './learning-schema.js';
import { isStudyTimeZone } from './study-zone.js';
import { localStudyDate } from './study-day.js';

const PERMISSIONS = Object.freeze(['granted', 'denied', 'default', 'unsupported']);
const PLATFORMS = Object.freeze(['web', 'native']);
const KINDS = Object.freeze(['schedule', 'cancel']);
const STATUSES = Object.freeze(['pending', 'scheduled', 'cancelled', 'failed', 'delivered']);
const OUTBOX_FIELDS = new Set(['outboxId', 'kind', 'generation', 'localTime', 'timeZone', 'createdAt', 'status',
  'platformJobId', 'failure', 'deliveredAt']);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OUTBOX_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const DAY_MS = 86400000;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message, details) => { throw new LearningError('INVALID_DATA', message, details); };
const isTimestamp = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isJobId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256
  && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) && !forbidden.has(value);

function checkPrefs(prefs) {
  const checked = validateLearningRecord('reminderPreferences', prefs);
  if (!checked.ok) invalid('提醒偏好不合法。', { errors: checked.errors });
  return prefs;
}

function checkTimestamp(value, name) {
  if (!isTimestamp(value)) invalid(`${name} 必須是有效的非負毫秒時間。`);
  return value;
}

/**
 * outbox 列形狀：待處理時只有意圖欄位；平台回報後才加上 platformJobId／failure／deliveredAt。
 */
function checkOutboxRow(row) {
  if (!object(row)) invalid('outbox 列必須是物件。');
  for (const key of Object.keys(row)) if (!OUTBOX_FIELDS.has(key)) invalid('outbox 列含未知欄位。');
  if (typeof row.outboxId !== 'string' || !OUTBOX_ID.test(row.outboxId) || forbidden.has(row.outboxId)) invalid('outboxId 必須是 1 至 128 字元的 ASCII 識別字。');
  if (!KINDS.includes(row.kind)) invalid('outbox 種類必須是 schedule 或 cancel。');
  if (!isCount(row.generation)) invalid('outbox generation 必須是非負安全整數。');
  if (typeof row.localTime !== 'string' || !TIME.test(row.localTime)) invalid('outbox 提醒時間須為 HH:mm。');
  if (!isStudyTimeZone(row.timeZone)) invalid('outbox 時區必須是受支援的 IANA 名稱。');
  checkTimestamp(row.createdAt, 'createdAt');
  if (!STATUSES.includes(row.status)) invalid('outbox 狀態不合法。');
  if (own(row, 'platformJobId') && row.platformJobId !== null && !isJobId(row.platformJobId)) invalid('平台工作 ID 不合法。');
  if (own(row, 'failure') && (typeof row.failure !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(row.failure))) invalid('失敗原因代碼不合法。');
  if (own(row, 'deliveredAt')) checkTimestamp(row.deliveredAt, 'deliveredAt');
  return row;
}

function checkRows(rows) {
  if (!Array.isArray(rows)) invalid('outbox 必須是陣列。');
  rows.forEach(checkOutboxRow);
  return rows;
}

/**
 * 同一世代理論上只有一筆意圖；萬一重複，以平台進度最遠者代表該世代。
 */
const PROGRESS = Object.freeze({ pending: 0, failed: 1, cancelled: 2, scheduled: 2, delivered: 3 });
function currentRow(rows, generation, kind) {
  return rows.filter((row) => row.generation === generation && row.kind === kind)
    .sort((a, b) => PROGRESS[b.status] - PROGRESS[a.status])[0] ?? null;
}

/**
 * 回傳 { message, lines, flags }。權限不是 granted 時絕不回報已排程；
 * 只採用與目前 prefs.generation 相同的 outbox 回報，舊世代晚到結果不算數。
 * web 平台一律明說關閉網頁後不會提醒。
 */
export function reminderStatus({ prefs, permission, platform, outboxRows = [] }) {
  checkPrefs(prefs);
  if (!PERMISSIONS.includes(permission)) invalid('通知權限狀態不合法。');
  if (!PLATFORMS.includes(platform)) invalid('平台必須是 web 或 native。');
  const rows = checkRows(outboxRows);
  const saved = prefs.enabled;
  const granted = permission === 'granted';
  const row = saved ? currentRow(rows, prefs.generation, 'schedule') : null;
  const platformScheduled = row !== null && ['scheduled', 'delivered'].includes(row.status);
  const flags = {
    saved,
    permission,
    permissionGranted: granted,
    scheduled: saved && granted && platformScheduled,
    delivered: row !== null && row.status === 'delivered',
    pending: saved && granted && row !== null && row.status === 'pending',
    failed: saved && row !== null && row.status === 'failed',
    needsPermission: saved && (permission === 'default' || permission === 'denied'),
    needsSchedule: false,
    closesWithPage: platform === 'web',
  };
  flags.needsSchedule = saved && granted && !flags.scheduled && !flags.pending;

  const lines = [];
  if (!saved) lines.push('提醒已關閉。');
  else if (permission === 'unsupported') lines.push('提醒設定已保存，但此裝置不支援通知，無法排程提醒。');
  else if (permission === 'denied') lines.push('提醒設定已保存，但通知權限被拒絕，目前沒有排程任何提醒；請到系統或瀏覽器設定允許通知。');
  else if (permission === 'default') lines.push('提醒設定已保存，尚未取得通知權限，請先允許通知。');
  else if (flags.scheduled) {
    lines.push(`已排程每日 ${prefs.localTime}（${prefs.timeZone}）提醒。`);
    if (flags.delivered) lines.push('最近一次提醒已送達。');
  } else if (flags.failed) lines.push('已取得通知權限，但排程失敗，可重試。');
  else if (flags.pending) lines.push('已取得通知權限，正在排程提醒…');
  else lines.push('已取得通知權限，尚未排程提醒。');
  if (platform === 'web') lines.push('網頁版只能在網頁開啟時提醒，關閉網頁後不會提醒。');
  else if (saved) lines.push('系統可能延後提醒，強制關閉 App 後也可能不會送達。');
  return { message: lines.join(''), lines, flags };
}

/**
 * 只取可攜的四個欄位並驗證；不帶 OS 工作 ID、權限或排程狀態。
 */
export function portableReminderPrefs(prefs) {
  if (!object(prefs)) invalid('提醒偏好必須是物件。');
  const { enabled, localTime, timeZone, generation } = prefs;
  return checkPrefs({ enabled, localTime, timeZone, generation });
}

/**
 * 依使用者的新設定產生 outbox 意圖與新 prefs（generation+1），回傳
 * { prefs, outbox, changed, deduped }。設定未變且未要求 reschedule 時不產生意圖。
 * schedule 意圖代表「以此世代取代所有較舊排程」；cancel 代表取消所有排程。
 * outboxRows 中已有同世代相同意圖時直接回傳該列（去重）；同世代不同意圖或
 * 已有更新世代，代表 prefs 已過期，拋出 REVISION_CONFLICT。
 */
export function planReminderChange({ prefs, nextPrefs, now, outboxId, outboxRows = [], reschedule = false }) {
  checkPrefs(prefs);
  checkTimestamp(now, 'now');
  if (typeof outboxId !== 'string' || !OUTBOX_ID.test(outboxId) || forbidden.has(outboxId)) invalid('outboxId 必須是 1 至 128 字元的 ASCII 識別字。');
  if (typeof reschedule !== 'boolean') invalid('reschedule 必須是布林值。');
  const rows = checkRows(outboxRows);
  if (!object(nextPrefs)) invalid('新的提醒設定必須是物件。');
  for (const key of Object.keys(nextPrefs)) if (!['enabled', 'localTime', 'timeZone', 'generation'].includes(key)) invalid('新的提醒設定含未知欄位。');
  const generation = prefs.generation + 1;
  const next = checkPrefs({ enabled: nextPrefs.enabled, localTime: nextPrefs.localTime, timeZone: nextPrefs.timeZone, generation });
  const changed = reschedule || next.enabled !== prefs.enabled || next.localTime !== prefs.localTime || next.timeZone !== prefs.timeZone;
  if (!changed) return { prefs: { ...prefs }, outbox: null, changed: false, deduped: false };

  const kind = next.enabled ? 'schedule' : 'cancel';
  if (rows.some((row) => row.generation > generation)) {
    throw new LearningError('REVISION_CONFLICT', '提醒設定已在其他地方更新，請重新讀取。');
  }
  const existing = rows.find((row) => row.generation === generation);
  if (existing) {
    if (existing.kind === kind && existing.localTime === next.localTime && existing.timeZone === next.timeZone) {
      return { prefs: next, outbox: { ...existing }, changed: true, deduped: true };
    }
    throw new LearningError('REVISION_CONFLICT', '同一世代已有不同的提醒意圖，請重新讀取。');
  }
  const outbox = { outboxId, kind, generation, localTime: next.localTime, timeZone: next.timeZone, createdAt: now, status: 'pending' };
  return { prefs: next, outbox: checkOutboxRow(outbox), changed: true, deduped: false };
}

/**
 * 平台回報只在世代相符且該列仍待處理／失敗時採用，回傳 { row, accepted }。
 */
function report(row, generation, allowed) {
  checkOutboxRow(row);
  if (!isCount(generation)) invalid('平台回報的 generation 必須是非負安全整數。');
  return generation === row.generation && allowed.includes(row.status);
}

/**
 * 平台確認已排程（schedule）或已取消（cancel）。舊世代晚到的回應忽略；重複確認冪等。
 * 排程確認必須帶平台工作 ID，該 ID 只存在本機，不隨匯出搬移。
 */
export function acknowledgeOutbox({ row, generation, platformJobId }) {
  if (platformJobId !== null && !isJobId(platformJobId)) invalid('平台工作 ID 不合法。');
  if (!report(row, generation, ['pending', 'failed'])) return { row: { ...row }, accepted: false };
  if (row.kind === 'schedule' && platformJobId === null) invalid('排程確認必須帶平台工作 ID。');
  const { failure, ...rest } = row;
  return { row: { ...rest, status: row.kind === 'schedule' ? 'scheduled' : 'cancelled', platformJobId }, accepted: true };
}

/**
 * 平台回報執行失敗（例如 permission-denied），列保持可重試；舊世代回報忽略。
 */
export function failOutbox({ row, generation, reason }) {
  if (typeof reason !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(reason)) invalid('失敗原因代碼不合法。');
  if (!report(row, generation, ['pending', 'failed'])) return { row: { ...row }, accepted: false };
  return { row: { ...row, status: 'failed', failure: reason }, accepted: true };
}

/**
 * 平台回報提醒已送達；只接受已排程的同世代 schedule 列，送達時間只會前進。
 */
export function markDelivered({ row, generation, deliveredAt }) {
  checkTimestamp(deliveredAt, 'deliveredAt');
  if (!report(row, generation, ['scheduled', 'delivered']) || row.kind !== 'schedule'
    || (row.status === 'delivered' && row.deliveredAt >= deliveredAt)) return { row: { ...row }, accepted: false };
  return { row: { ...row, status: 'delivered', deliveredAt }, accepted: true };
}

/**
 * 待處理或失敗的列可重試；給定目前世代時，已被新世代取代的列不再重試。
 */
export function retryable(row, currentGeneration) {
  checkOutboxRow(row);
  if (currentGeneration !== undefined) {
    if (!isCount(currentGeneration)) invalid('目前 generation 必須是非負安全整數。');
    if (row.generation !== currentGeneration) return false;
  }
  return row.status === 'pending' || row.status === 'failed';
}

/**
 * 匯入他處的提醒偏好：保留開關與時間，時區改用本機固定學習時區，
 * generation 重設為本機新值（localGeneration+1），使舊 outbox 與晚到回應全部失效。
 * 不搬移 OS 工作 ID 或權限；啟用者需在本機重新允許通知並排程（needsLocalSetup）。
 */
export function importReminderPrefs(imported, { timeZone, localGeneration = 0 } = {}) {
  if (!object(imported)) invalid('匯入的提醒偏好必須是物件。');
  if (!isStudyTimeZone(timeZone)) invalid('本機學習時區必須是受支援的 IANA 名稱。');
  if (!isCount(localGeneration)) invalid('本機 generation 必須是非負安全整數。');
  const prefs = checkPrefs({ enabled: imported.enabled, localTime: imported.localTime, timeZone, generation: localGeneration + 1 });
  return { prefs, needsLocalSetup: prefs.enabled, status: prefs.enabled ? 'needs-local-setup' : 'disabled' };
}

const formatters = new Map();
function wallFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

/**
 * 指定瞬間在時區內的 UTC 偏移（毫秒），以秒為單位比較。
 */
function offsetAt(instant, timeZone) {
  const parts = Object.fromEntries(wallFormatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * 將時區內的牆上時間轉為 epoch 毫秒。重複時刻（秋季回撥）取第一次；
 * 不存在的時刻（春季跳時）用跳時前的偏移換算，即順延為跳時後的同一瞬間。
 */
function wallToEpoch(localDate, hour, minute, timeZone) {
  const [year, month, day] = localDate.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetAt(guess - DAY_MS, timeZone);
  const offsets = new Set([before, offsetAt(guess, timeZone), offsetAt(guess + DAY_MS, timeZone)]);
  const valid = [...offsets].map((offset) => guess - offset).filter((instant) => instant + offsetAt(instant, timeZone) === guess);
  return valid.length ? Math.min(...valid) : guess - before;
}

function nextDate(localDate) {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * 下一次提醒的 epoch 毫秒：今天的提醒時間尚未到（嚴格晚於 now）用今天，否則用明天。
 * 以 Intl 依指定時區計算，處理 DST 跳時與回撥。
 */
export function nextFireTime({ localTime, timeZone, now }) {
  if (typeof localTime !== 'string' || !TIME.test(localTime)) invalid('提醒時間須為 HH:mm。');
  if (!isStudyTimeZone(timeZone)) invalid('提醒時區必須是受支援的 IANA 名稱。');
  checkTimestamp(now, 'now');
  const [hour, minute] = localTime.split(':').map(Number);
  let localDate;
  try {
    localDate = localStudyDate(now, timeZone);
  } catch {
    invalid('now 超出可計算的日期範圍。');
  }
  for (let i = 0; i < 3; i += 1) {
    const instant = wallToEpoch(localDate, hour, minute, timeZone);
    if (instant > now) return instant;
    localDate = nextDate(localDate);
  }
  invalid('無法計算下一次提醒時間。');
}
