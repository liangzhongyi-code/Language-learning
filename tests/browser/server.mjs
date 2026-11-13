/**
 * 測試專用靜態站：只綁 loopback、只提供網站資源，不提供 repo 設定或使用者資料。
 * 兩種模式：fixture（預設，直接讀專案檔案）與 wrangler（轉送到本機 Worker，H01）。
 */
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/**
 * 每個套件起點的空白隔離頁；兩種伺服器都提供同一份。
 */
const HARNESS_HTML = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>測試隔離頁</title><body><main id="app"></main></body></html>';

/**
 * 在 127.0.0.1 隨機 port 開始監聽，回傳 origin。
 */
async function listen(server) {
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  return 'http://127.0.0.1:' + server.address().port;
}

const closeServer = (server) => new Promise((done, reject) => {
  server.close((error) => error ? reject(error) : done());
  server.closeAllConnections();
});

export async function startFixtureServer() {
  const absoluteRoot = await realpath(root);
  const server = createServer(async (request, response) => {
    const send = (status, content = '', type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
    };
    if (!['GET', 'HEAD'].includes(request.method)) { send(405); return; }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/__harness__') {
        send(200, HARNESS_HTML, types['.html']);
        return;
      }
      const name = pathname === '/' ? '/index.html' : pathname;
      if (!/^\/(?:index\.html$|help\.html$|assets\/|en\/|ja\/)/.test(name) ||
          name.includes('\\') || name.split('/').some((part) => part.startsWith('.'))) {
        send(403); return;
      }
      const path = await realpath(resolve(root, '.' + name));
      if (!path.startsWith(absoluteRoot + sep) || !(await stat(path)).isFile()) {
        send(403); return;
      }
      const mime = types[extname(path)];
      if (!mime) { send(403); return; }
      send(200, await readFile(path), mime);
    } catch {
      send(404);
    }
  });
  return { origin: await listen(server), close: () => closeServer(server) };
}

/**
 * 轉送時不往下傳的標頭：連線層標頭，以及會讓內容被壓縮、長度對不上的標頭。
 */
const HOP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'accept-encoding', 'content-length', 'content-encoding']);

/**
 * Worker 模式（H01）：在隨機 loopback port 啟動與正式設定相同的本機 Worker（白名單靜態資源加 /api），
 * 前面放一層只做轉送的伺服器，讓瀏覽器看到單一 origin：
 * - /__harness__ 由這一層提供（正式網站沒有這一頁）；
 * - 其餘請求原樣轉送，狀態碼、標頭、內容與 3xx 轉址都不改寫、不跟隨；
 * - 記錄每一次轉址（redirects）與 404（notFound），供 run.mjs 統計 auto-trailing-slash 的影響。
 * Worker 的 SITE_ORIGIN 設成這一層的 origin，與瀏覽器看到的一致。
 */
export async function startWorkerServer({ vars = {} } = {}) {
  const { startLocalWorker } = await import('../helpers/worker-env.mjs');
  const redirects = [];
  const notFound = [];
  let worker;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/__harness__') {
      response.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : HARNESS_HTML);
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = Object.entries(request.headers).filter(([name]) => !HOP_HEADERS.has(name))
        .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]);
      const target = url.pathname + url.search;
      const upstream = await worker.fetch(target, {
        method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const outHeaders = {};
      upstream.headers.forEach((value, name) => { if (!HOP_HEADERS.has(name) && name !== 'set-cookie') outHeaders[name] = value; });
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) outHeaders['set-cookie'] = cookies;
      if (upstream.status >= 300 && upstream.status < 400) {
        redirects.push({ from: target, status: upstream.status, location: upstream.headers.get('location') });
      }
      if (upstream.status === 404) notFound.push(target);
      const body = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, outHeaders);
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end();
    }
  });
  const origin = await listen(server);
  try {
    worker = await startLocalWorker({ vars: { SITE_ORIGIN: origin, ...vars } });
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  return {
    origin, redirects, notFound,
    async close() {
      await closeServer(server);
      await worker.dispose();
    },
  };
}
