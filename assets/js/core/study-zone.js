/**
 * 學習日與可攜資料共用的具名時區政策；不讀取 OS 預設時區、不改寫既有名稱。
 * IANA tzdb backward／etcetera 的單段名稱，另須通過執行環境 Intl 支援檢查。
 */
const SINGLE_NAME_ZONES = new Set([
  'CET', 'CST6CDT', 'Cuba', 'EET', 'EST', 'EST5EDT', 'Egypt', 'Eire', 'Factory',
  'GB', 'GB-Eire', 'GMT', 'GMT+0', 'GMT-0', 'GMT0', 'Greenwich', 'HST', 'Hongkong',
  'Iceland', 'Iran', 'Israel', 'Jamaica', 'Japan', 'Kwajalein', 'Libya', 'MET', 'MST',
  'MST7MDT', 'NZ', 'NZ-CHAT', 'Navajo', 'PRC', 'PST8PDT', 'Poland', 'Portugal',
  'ROC', 'ROK', 'Singapore', 'Turkey', 'UCT', 'UTC', 'Universal', 'W-SU', 'WET', 'Zulu',
]);

/**
 * 建立固定公曆日期 formatter；拒絕數值 offset、非 IANA 縮寫及隱含預設。
 * trim 檢查亦阻擋正規表示式 $ 可能容許的尾端換行。
 */
export function studyDateFormatter(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.trim() !== timeZone
    || !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(timeZone)) {
    throw new RangeError('學習時區必須為合法 IANA 名稱');
  }
  if (!timeZone.includes('/') && !SINGLE_NAME_ZONES.has(timeZone)) {
    throw new RangeError('學習時區不可使用非 IANA 縮寫');
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', era: 'short',
  });
}

/**
 * 資料驗證採用相同政策，但以布林值回報，不外洩 Intl 的平台例外。
 */
export function isStudyTimeZone(timeZone) {
  try { studyDateFormatter(timeZone); return true; } catch { return false; }
}
