/**
 * 驗證只在明確指定的空白測試模擬器執行，禁止刪除既有 APP 來製造乾淨結果。
 */
export function assertVerificationTarget({ serial, emulator, avdName, installedPath }) {
  if (!/^emulator-\d+$/.test(serial || '') || emulator !== '1' || !/^LangLearn_QA_[A-Za-z0-9_]+$/.test(avdName || '')) {
    throw new Error('只允許指定 LangLearn_QA_ 開頭的測試模擬器；不操作個人裝置。');
  }
  if (installedPath.trim()) throw new Error('測試模擬器已有本 APP；保留既有資料，請另建空白測試模擬器。');
}

/**
 * CDP 只能連至 APP 的精確本機來源，拒絕遠端網址、帳密與非預設埠。
 */
export function isPackagedAppUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname === 'tauri.localhost'
      && !url.port && !url.username && !url.password;
  } catch { return false; }
}
