/**
 * 測試專用靜態站：只綁 loopback、只提供網站資源，不提供 repo 設定或使用者資料。
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
        send(200, '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>測試隔離頁</title><body><main id="app"></main></body></html>', types['.html']);
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
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((done, reject) => {
      server.close((error) => error ? reject(error) : done());
      server.closeAllConnections();
    }),
  };
}
