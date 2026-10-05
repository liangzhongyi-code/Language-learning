/**
 * 固定學習時區與單調學習日政策。時間與首次時區由呼叫端注入，不讀取 OS 預設值。
 * 回傳的 state 是交易候選值，須與日帳本／計畫同時保存後才能視為建立成功。
 */

import { studyDateFormatter as dateFormatter } from './study-zone.js';

/**
 * 將有限 epoch 毫秒數轉成指定時區的西元 YYYY-MM-DD；不接受 Date 或字串隱式轉型。
 */
export function localStudyDate(now, timeZone) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new RangeError('now 必須為有效且有限的 epoch 毫秒數');
  }
  const parts = Object.fromEntries(dateFormatter(timeZone).formatToParts(now).map(part => [part.type, part.value]));
  const year = Number(parts.year);
  if (parts.era !== 'AD' || year < 1 || year > 9999) {
    throw new RangeError('學習日期必須介於西元 0001 至 9999 年');
  }
  return `${String(year).padStart(4, '0')}-${parts.month}-${parts.day}`;
}

/**
 * 驗證可字典排序的真實公曆日期，避免二月三十日被 Date 自動進位。
 */
function requireDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    throw new RangeError('學習日必須為 YYYY-MM-DD');
  }
  const instant = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) {
    throw new RangeError('學習日不是有效公曆日期');
  }
  return value;
}

/**
 * 鍵值組件僅接受非空 ASCII 識別字，不容許分隔符或空白造成碰撞。
 */
function requireKeyPart(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RangeError('日鍵的語言與級別必須為非空識別字');
  }
  return value;
}

/**
 * 每日語言額度共用鍵，不含級別或時區；日界政策先由 resolveStudyDay 處理。
 */
export function studyDayKey(localDate, lang) {
  return `${requireDate(localDate)}:${requireKeyPart(lang)}`;
}

/**
 * 固定清單按學習日、語言與級別保存，不以時區變更建立另一份同日額度。
 */
export function studyPlanKey(localDate, lang, level) {
  return `${studyDayKey(localDate, lang)}:${requireKeyPart(level)}`;
}

/**
 * 驗證持久化政策，不將缺欄位或壞日期默默重設成可重新領額度的初始狀態。
 */
function requireState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || !['currentZone', 'pendingZone', 'latestDay'].every(key => Object.prototype.hasOwnProperty.call(state, key))) {
    throw new RangeError('缺少有效學習日政策');
  }
  dateFormatter(state.currentZone);
  if (state.pendingZone !== null) dateFormatter(state.pendingZone);
  if (state.latestDay !== null) requireDate(state.latestDay);
}

/**
 * 首次時區必須由 UI 提供；null latestDay 表示尚未建立任何學習日。
 */
export function createStudyDayState(timeZone) {
  dateFormatter(timeZone);
  return { currentZone: timeZone, pendingZone: null, latestDay: null };
}

/**
 * 已建日的改區只排入 pending；再次選擇目前時區可取消，首日建立前可立即換區。
 */
export function requestStudyTimeZone(state, timeZone) {
  requireState(state);
  dateFormatter(timeZone);
  if (state.latestDay === null) return createStudyDayState(timeZone);
  const sameZone = dateFormatter(timeZone).resolvedOptions().timeZone
    === dateFormatter(state.currentZone).resolvedOptions().timeZone;
  return { ...state, pendingZone: sameZone ? null : timeZone };
}

/**
 * 回傳 { localDate, timeZone, isNewDay, clockMovedBack, state }，不修改輸入。
 * latestDay 是已建立日期的最大值；倒退沿用該日，不另發額度。
 * 改區須等目前與待用時區的日期都超越 latestDay，才在新日原子採用。
 * clockMovedBack 只偵測目前固定時區的日期倒退，不追蹤同日秒數倒退。
 */
export function resolveStudyDay(state, now) {
  requireState(state);
  const currentDate = localStudyDate(now, state.currentZone);
  const clockMovedBack = state.latestDay !== null && currentDate < state.latestDay;
  const result = {
    localDate: state.latestDay ?? currentDate,
    timeZone: state.currentZone, isNewDay: false, clockMovedBack, state: { ...state },
  };
  if (state.latestDay !== null && currentDate <= state.latestDay) return result;

  const timeZone = state.pendingZone ?? state.currentZone;
  const nextDate = timeZone === state.currentZone ? currentDate : localStudyDate(now, timeZone);
  if (state.latestDay !== null && nextDate <= state.latestDay) return result;

  return {
    localDate: nextDate, timeZone, isNewDay: true, clockMovedBack,
    state: { ...state, currentZone: timeZone, pendingZone: null, latestDay: nextDate },
  };
}
