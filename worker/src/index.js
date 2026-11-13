/**
 * Worker 入口：只有 /api/* 會進來（wrangler.jsonc 的 run_worker_first），
 * 其餘請求由靜態資源直接回應。路由表找不到的 API 一律回 404 JSON。
 */
import { error } from './http.js';
import { handleStart } from './auth.js';

/**
 * 路由表：key 為「方法 路徑」，value 為 (request, env, ctx, url) => Response。
 */
const routes = new Map([
  ['GET /api/auth/start', handleStart],
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : error('NOT_FOUND', 404);
    }
    const handler = routes.get(request.method + ' ' + url.pathname);
    if (!handler) return error('NOT_FOUND', 404);
    return handler(request, env, ctx, url);
  },
};
