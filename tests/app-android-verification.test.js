import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVerificationTarget, isPackagedAppUrl } from '../app/scripts/android-verification.mjs';

test('Android 驗證只接受明確指定、全新且屬於本次測試的模擬器', () => {
  const safe = { serial: 'emulator-5580', emulator: '1', avdName: 'LangLearn_QA_20261008', installedPath: '' };
  assert.doesNotThrow(() => assertVerificationTarget(safe));
  for (const change of [
    { serial: undefined }, { serial: 'physical-device' }, { emulator: '0' },
    { avdName: 'Swift_2_Pro' }, { installedPath: 'package:/data/app/existing/base.apk' },
  ]) assert.throws(() => assertVerificationTarget({ ...safe, ...change }), /測試|既有/);
});

test('Android CDP 頁面必須是精確的 APP 本機來源', () => {
  for (const url of ['http://tauri.localhost/index.html', 'https://tauri.localhost/ja/daily.html']) {
    assert.equal(isPackagedAppUrl(url), true);
  }
  for (const url of ['https://tauri.localhost.evil.test/', 'http://user@tauri.localhost/',
    'http://tauri.localhost:9876/', 'https://example.com/', 'about:blank', 'garbage']) {
    assert.equal(isPackagedAppUrl(url), false);
  }
});
