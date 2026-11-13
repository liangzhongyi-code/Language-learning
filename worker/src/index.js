/**
 * Worker 入口：只有 /api/* 會進來（wrangler.jsonc 的 run_worker_first），
 * 其餘請求由靜態資源直接回應。路由表找不到的 API 一律回 404 JSON。
 * 寫入類請求在找路由與讀 body 之前先檢查 Origin（A11）。
 */
import { error } from './http.js';
import { handleStart, handleCallback, handleLogout } from './auth.js';
import { handleDeleteAccount, handleMeta, handleDownload, handleUpload } from './snapshot.js';
import { checkOrigin, handleMe } from './access.js';
import { handleListMembers, handleAddMember, handleUpdateMember, handleRemoveMember } from './admin.js';

/**
 * 路由表：key 為「方法 路徑」，value 為 (request, env, ctx, url, params) => Response。
 */
const routes = new Map([
  ['GET /api/auth/start', handleStart],
  ['GET /api/auth/callback', handleCallback],
  ['GET /api/me', handleMe],
  ['POST /api/auth/logout', handleLogout],
  ['DELETE /api/account', handleDeleteAccount],
  ['GET /api/snapshot/meta', handleMeta],
  ['GET /api/snapshot', handleDownload],
  ['PUT /api/snapshot', handleUpload],
  ['GET /api/admin/members', handleListMembers],
  ['POST /api/admin/members', handleAddMember],
]);

/**
 * 帶參數的路由：pattern 的具名群組會成為 params（尚未解碼，由 handler 自行處理）。
 */
const MEMBER_PATH = new RegExp('^/api/admin/members/(?<email>[^/]+)$');

const paramRoutes = [
  { method: 'PATCH', pattern: MEMBER_PATH, handler: handleUpdateMember },
  { method: 'DELETE', pattern: MEMBER_PATH, handler: handleRemoveMember },
];

/**
 * 依方法與路徑找出 handler 與參數；找不到回 null。
 */
function resolve(method, pathname) {
  const exact = routes.get(method + ' ' + pathname);
  if (exact) return { handler: exact, params: {} };
  for (const route of paramRoutes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (match) return { handler: route.handler, params: { ...match.groups } };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : error('NOT_FOUND', 404);
    }
    const badOrigin = checkOrigin(request, env);
    if (badOrigin) return badOrigin;
    const route = resolve(request.method, url.pathname);
    if (!route) return error('NOT_FOUND', 404);
    try {
      return await route.handler(request, env, ctx, url, route.params);
    } catch (cause) {
      console.error('worker: unhandled error', cause?.name ?? 'Error');
      return error('INTERNAL', 500);
    }
  },
};
