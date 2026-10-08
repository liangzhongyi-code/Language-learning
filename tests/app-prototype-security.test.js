import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P00b/S20：網站來源、非原型頁面及 iframe 都在 invoke 前拒絕', async (t) => {
  const { runProbe } = await import('../app/prototype/probe.js');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  });
  for (const href of [
    'https://example.invalid/app/prototype/index.html',
    'http://localhost/app/prototype/index.html',
    'http://tauri.localhost/en/quiz.html',
    'tauri://localhost/index.html',
    'http://tauri.localhost:8080/app/prototype/index.html',
    'http://user@tauri.localhost/app/prototype/index.html',
    'file:///app/prototype/index.html',
  ]) {
    let calls = 0;
    const fake = { location: new URL(href), __TAURI_INTERNALS__: {},
      __TAURI__: { core: { invoke: () => { calls++; } } } };
    fake.top = fake;
    globalThis.window = fake;
    await assert.rejects(runProbe(), /原生|原型/);
    assert.equal(calls, 0, href);
  }
  let calls = 0;
  globalThis.window = { location: new URL('tauri://localhost/app/prototype/index.html'),
    top: {}, __TAURI_INTERNALS__: {}, __TAURI__: { core: { invoke: () => { calls++; } } } };
  await assert.rejects(runProbe(), /原生|原型/);
  assert.equal(calls, 0);
});

test('P00b/S20：兩頁本機 runtime 只呼叫無 payload 的 prototype_probe', async (t) => {
  const { runProbe } = await import('../app/prototype/probe.js');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  });
  const proof = { sqliteVersion: 'fixture-only', rollbackVerified: true, learningRepository: 'not-implemented' };
  for (const href of [
    'tauri://localhost/app/prototype/index.html',
    'http://tauri.localhost/app/prototype/second.html',
    'https://tauri.localhost/app/prototype/index.html',
  ]) {
    const fake = { location: new URL(href), __TAURI_INTERNALS__: {},
      __TAURI__: { core: { invoke: async (...args) => {
        assert.deepEqual(args, ['prototype_probe']);
        return proof;
      } } } };
    fake.top = fake;
    globalThis.window = fake;
    assert.deepEqual(await runProbe(), proof);
  }
});

test('P00b/S20：權限無 wildcard／remote／core default，CSP 禁止 frame 與外部程式', async () => {
  const config = JSON.parse(await readFile(new URL('../app/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const capability = JSON.parse(await readFile(new URL('../app/src-tauri/capabilities/prototype.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.app.security.capabilities, ['prototype']);
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.local, true);
  assert.deepEqual(capability.permissions, ['allow-prototype-probe']);
  assert.equal(capability.remote, undefined);
  assert.match(config.app.security.csp, /frame-src 'none'/);
  assert.match(config.app.security.csp, /frame-ancestors 'none'/);
  assert.match(config.app.security.csp, /script-src 'self'/);
  assert.doesNotMatch(config.app.security.csp, /unsafe-inline|unsafe-eval|\*/);
});
