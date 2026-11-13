/**
 * H05–H07 的判斷核心：目前 origin 對照雲端設定，決定 cloud（新網址）、legacy（舊站）或 off（不啟用）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudMode, normalizeOrigin, newSiteHref } from '../assets/js/core/cloud-origin.js';
import { CLOUD_CONFIG } from '../assets/js/config/cloud.js';

const CONFIG = {
  siteOrigin: 'https://lang-learn.example.workers.dev',
  legacyOrigins: ['https://someone.github.io'],
  newSiteUrl: 'https://lang-learn.example.workers.dev/',
};

test('H05 預設設定全空、凍結，任何 origin 都不啟用雲端', () => {
  assert.deepEqual(Object.keys(CLOUD_CONFIG).sort(), ['legacyOrigins', 'newSiteUrl', 'siteOrigin']);
  assert.equal(CLOUD_CONFIG.siteOrigin, '');
  assert.deepEqual(CLOUD_CONFIG.legacyOrigins, []);
  assert.equal(CLOUD_CONFIG.newSiteUrl, '');
  assert.ok(Object.isFrozen(CLOUD_CONFIG));
  assert.ok(Object.isFrozen(CLOUD_CONFIG.legacyOrigins));
  for (const origin of ['https://lang-learn.example.workers.dev', 'https://someone.github.io', 'http://localhost:3000', 'null', '']) {
    assert.equal(cloudMode(origin, CLOUD_CONFIG), 'off', origin);
  }
});

test('H05／H07 origin 完全相同才算新網址；子網域、相似網域、不同 port 或協定都不算', () => {
  assert.equal(cloudMode('https://lang-learn.example.workers.dev', CONFIG), 'cloud');
  assert.equal(cloudMode('HTTPS://Lang-Learn.Example.workers.dev', CONFIG), 'cloud');
  for (const origin of [
    'https://lang-learn.example.workers.dev.evil.test',
    'https://evil.lang-learn.example.workers.dev',
    'http://lang-learn.example.workers.dev',
    'https://lang-learn.example.workers.dev:8443',
    'http://127.0.0.1:8787',
  ]) assert.equal(cloudMode(origin, CONFIG), 'off', origin);
});

test('H06 舊站 origin 判為 legacy；設定裡帶路徑或結尾斜線的網址取其 origin 比對', () => {
  assert.equal(cloudMode('https://someone.github.io', CONFIG), 'legacy');
  assert.equal(cloudMode('https://someone.github.io', { ...CONFIG, legacyOrigins: ['https://someone.github.io/lang-learn/'] }), 'legacy');
  assert.equal(cloudMode('https://other.github.io', CONFIG), 'off');
  assert.equal(cloudMode('https://lang-learn.example.workers.dev', { ...CONFIG, siteOrigin: 'https://lang-learn.example.workers.dev/' }), 'cloud');
});

test('H07 同時列在新舊兩邊時以新網址為準，不顯示搬家提示', () => {
  assert.equal(cloudMode(CONFIG.siteOrigin, { ...CONFIG, legacyOrigins: [CONFIG.siteOrigin] }), 'cloud');
});

test('H05 壞設定或非 http(s) 的 origin 一律 off，不拋例外', () => {
  for (const config of [undefined, null, {}, { siteOrigin: 'not a url' }, { siteOrigin: 42, legacyOrigins: 'https://someone.github.io' },
    { siteOrigin: 'javascript:alert(1)' }, { legacyOrigins: [null, 7, 'ftp://someone.github.io'] }]) {
    assert.equal(cloudMode('https://someone.github.io', config), 'off', JSON.stringify(config));
  }
  for (const origin of ['null', 'file://', 'tauri://localhost', undefined]) {
    assert.equal(cloudMode(origin, { ...CONFIG, siteOrigin: 'tauri://localhost', legacyOrigins: ['tauri://localhost'] }), 'off', String(origin));
  }
  assert.equal(normalizeOrigin('https://A.example/x?y#z'), 'https://a.example');
  assert.equal(normalizeOrigin('ftp://a.example'), '');
  assert.equal(normalizeOrigin(''), '');
});

test('H06 搬家連結只接受 http(s) 網址，其他一律視為未設定', () => {
  assert.equal(newSiteHref(CONFIG), 'https://lang-learn.example.workers.dev/');
  assert.equal(newSiteHref({ newSiteUrl: 'https://new.example/app' }), 'https://new.example/app');
  for (const newSiteUrl of ['', 'javascript:alert(1)', 'data:text/html,x', '/relative', 'not a url', 42, null]) {
    assert.equal(newSiteHref({ newSiteUrl }), '', String(newSiteUrl));
  }
  assert.equal(newSiteHref(undefined), '');
});
