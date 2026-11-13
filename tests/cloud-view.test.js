import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudLoginHref, consumeCloudError, presentSyncState } from '../assets/js/ui/cloud-view.js';

test('登入連結只把本站路徑及查詢交給 Worker', () => {
  assert.equal(cloudLoginHref({ pathname: '/ja/quiz', search: '?level=2' }),
    '/api/auth/start?returnTo=%2Fja%2Fquiz%3Flevel%3D2');
});

test('只取已知的登入錯誤，清除回呼 hash 並保留查詢', () => {
  const location = { pathname: '/ja/', search: '?x=1', hash: '#cloud-error=NOT_ALLOWED' };
  const history = { state: { value: 1 }, replaceState: (...args) => {
    assert.deepEqual(args, [{ value: 1 }, '', '/ja/?x=1']);
  } };
  assert.match(consumeCloudError(location, history), /尚未開放/);
  assert.equal(consumeCloudError({ ...location, hash: '#lesson-2' }, history), '');
  assert.match(consumeCloudError({ ...location, hash: '#cloud-error=__proto__' }, history), /重試/);
});

test('衝突、已暫停、過大與登入失效各有可操作的狀態', () => {
  assert.deepEqual(presentSyncState({ status: 'conflict' }).actions, ['cloud', 'local', 'later']);
  assert.deepEqual(presentSyncState({ status: 'conflict', deferred: true }).actions, ['cloud', 'local']);
  assert.deepEqual(presentSyncState({ status: 'paused' }).actions, ['cloud', 'local']);
  assert.match(presentSyncState({ status: 'too-large' }).text, /備份檔/);
  assert.deepEqual(presentSyncState({ status: 'reauth' }).actions, ['login']);
});
