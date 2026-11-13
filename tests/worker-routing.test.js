/**
 * H03／H04：Worker 只處理 /api/*，其餘交給靜態資源；未知 API 回 404 JSON。
 * 另檢查正式設定檔不含測試專用的 Google 端點覆寫（TD-8）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWranglerConfig, startLocalWorker } from './helpers/worker-env.mjs';
import worker from '../worker/src/index.js';

test('H03 設定：只有 /api/* 先進 Worker，靜態目錄為白名單複製出的 dist-site', () => {
  const config = readWranglerConfig();
  assert.equal(config.main, 'worker/src/index.js');
  assert.equal(config.assets.directory, './dist-site');
  assert.equal(config.build.command, 'node tools/build-site.mjs');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*']);
  assert.equal(config.assets.binding, 'ASSETS');
});

test('TD-8 正式設定不含測試覆寫', () => {
  const vars = readWranglerConfig().vars ?? {};
  assert.equal('GOOGLE_OAUTH_BASE' in vars, false);
  assert.notEqual(vars.ENVIRONMENT, 'test');
});

test('H04 未知 API 路徑回 404 JSON，不退回網站頁面', async () => {
  const response = await worker.fetch(new Request('https://site.test/api/no-such-thing'), {}, {});
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
});

test('H04 /api 根路徑同樣回 404 JSON', async () => {
  const response = await worker.fetch(new Request('https://site.test/api/'), {}, {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
});

test('H03 本機 Worker：頁面由靜態資源回應，/api 由 Worker 回應', async () => {
  const local = await startLocalWorker();
  try {
    const page = await local.fetch('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const api = await local.fetch('/api/no-such-thing');
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type'), /application\/json/);
  } finally {
    await local.dispose();
  }
});
