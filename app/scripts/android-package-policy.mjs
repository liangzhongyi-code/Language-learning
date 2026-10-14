/**
 * Android Debug 補包的純判定函式；不讀寫檔案，也不執行外部命令。
 */
export function mergeConfig(base, overlay) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('非法 config key');
    if (value === null) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeConfig(result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? result[key] : {}, value);
    } else result[key] = structuredClone(value);
  }
  return result;
}

export function expectedIdentity(config) {
  const android = config.bundle?.android ?? {};
  if (android.autoIncrementVersionCode || android.debugApplicationIdSuffix) {
    throw new Error('測試補包不支援自動遞增版本或 debugApplicationIdSuffix，請使用明確版本與識別碼');
  }
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(config.version);
  if (!version) throw new Error('版本必須是明確 semver，不能是檔案路徑');
  const versionCode = android.versionCode ?? Number(version[1]) * 1000000 + Number(version[2]) * 1000 + Number(version[3]);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('非法 Android versionCode 版本');
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(config.identifier)) throw new Error('非法 Android 識別碼');
  return { identifier: config.identifier, versionName: config.version, versionCode };
}

export function checkProperties(text, expected) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*(?:#|!|\/\/)/.test(line)) continue;
    const match = /^\s*(tauri\.android\.version(?:Name|Code))\s*=\s*(\S+)\s*$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) throw new Error('tauri.properties 格式錯誤或重複版本');
    values[match[1]] = match[2];
  }
  if (values['tauri.android.versionName'] !== expected.versionName || values['tauri.android.versionCode'] !== String(expected.versionCode)) {
    throw new Error('tauri.properties 版本與本次 config 不符或缺少版本');
  }
}

export function assertSame(before, after, label) {
  const stable = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  if (stable(before) !== stable(after)) throw new Error(`${label}在建置期間異動，拒絕混合來源補包，請重新執行`);
}

export function acceptBuild({ result, platform, source, destination, fresh }) {
  if (!fresh) throw new Error('缺少隔離目錄中的當次原生庫，拒絕沿用舊庫');
  if (result.error || result.signal) throw new Error('建置程序啟動失敗或被中斷');
  if (result.status === 0) return 'tauri-success';
  const log = (result.log ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const finished = /Finished\s+`release` profile[^\n]*target\(s\)[^\n]*\n/.exec(log);
  const reject = () => { throw new Error('建置失敗不是可補救的當次 Windows symlink 最後一步錯誤'); };
  if (platform !== 'win32' || result.status !== 1 || !finished ||
      /error\[E\d+\]|could not compile|FAILURE:|BUILD FAILED|execution failed for task|panicked at/i.test(log)) return reject();
  const tail = log.slice(finished.index + finished[0].length);
  const normalize = value => value.replace(/\\+/g, '/').toLowerCase();
  const expectedLink = `Failed to create a symbolic link from ${JSON.stringify(source)} to file ${JSON.stringify(destination)} (file clobbering enabled):`;
  if (!normalize(tail).includes(normalize(expectedLink)) || !/failed to build Android app/i.test(tail)) return reject();
  // cargo-mobile2 對 1314 會轉成特定英文說明；其他存取／刪除／缺檔錯誤均不能放行。
  const cause = tail.slice(tail.indexOf('(file clobbering enabled):') + '(file clobbering enabled):'.length);
  if (!/^\s*(?:Creation symbolic link is not allowed for this system\.|IO error:[^\n]*\(os error 1314\))/.test(cause)) return reject();
  const errorLines = tail.split('\n').filter(line => /^\s*error\b/i.test(line));
  if (errorLines.some(line => !/failed to build Android app.*Failed to create a symbolic link/i.test(line))) return reject();
  return 'windows-symlink-fallback';
}
