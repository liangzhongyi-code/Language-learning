/**
 * 管理 API（design TD-9、specs/cloud-admin.md）。
 * 每次請求都由 access.authenticate 重新讀取角色，再依 roles.js 的權限總表判斷；
 * 名單只回傳 email、暱稱、角色與時間資訊，不含 google_sub、使用者 id、session 或快照內容。
 */
import { json, error } from './http.js';
import { requireUser } from './access.js';
import { accessMode, nowSec } from './config.js';
import { can, isStaff } from './roles.js';
import * as db from './db.js';

/**
 * email 與暱稱的長度上限（暱稱以字元計）。
 */
const EMAIL_MAX = 254;
const NICKNAME_MAX = 40;

/**
 * 管理 API 請求 body 的大小上限（bytes）。
 */
const BODY_MAX = 4096;

/**
 * email 格式：一個 @、兩邊不含空白與控制字元、網域至少有一個點。
 */
const EMAIL_PATTERN = /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/;

/**
 * 只讓工作人員通過：成員（含開放模式下不在名單的人）一律 403 NOT_STAFF。
 */
export function requireStaff(handler) {
  return requireUser(async (request, env, ctx, url, auth) => {
    if (!isStaff(auth.user.role)) return error('NOT_STAFF', 403);
    return handler(request, env, ctx, url, auth);
  });
}

/**
 * 正規化並驗證 email；不合法回 null。
 */
export function parseEmail(value) {
  if (typeof value !== 'string') return null;
  const email = db.normalizeEmail(value);
  if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/**
 * 正規化並驗證暱稱：去除前後空白，空字串視為沒有暱稱；超過 40 字或不是字串回 { ok: false }。
 */
export function parseNickname(value) {
  if (value === undefined || value === null) return { ok: true, nickname: null };
  if (typeof value !== 'string') return { ok: false };
  const nickname = value.trim();
  if (Array.from(nickname).length > NICKNAME_MAX) return { ok: false };
  return { ok: true, nickname: nickname.length === 0 ? null : nickname };
}

/**
 * 讀取 JSON 物件 body；格式不符或過大回 null。
 */
export async function readJsonObject(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > BODY_MAX) return null;
  const text = await request.text();
  if (text.length > BODY_MAX) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 秒轉毫秒；null 維持 null。
 */
const ms = (seconds) => (seconds === null || seconds === undefined ? null : seconds * 1000);

/**
 * 把名單查詢結果轉成 API 欄位。不在白名單的人角色視為 member（與 /api/me 一致）。
 */
function toMember(row) {
  return {
    email: row.email,
    nickname: row.nickname ?? null,
    role: row.role ?? 'member',
    inAllowlist: Boolean(row.in_allowlist),
    createdAt: ms(row.created_at),
    addedBy: row.added_by_email ?? null,
    lastLoginAt: ms(row.last_login_at),
    activeSessions: row.active_sessions ?? 0,
    snapshotUpdatedAt: ms(row.snapshot_updated_at),
  };
}

/**
 * GET /api/admin/members：名單與登入狀態（M05、M06）。
 */
export const handleListMembers = requireStaff(async (request, env, ctx, url, { user }) => {
  if (!can(user.role, 'view', 'member')) return error('NOT_STAFF', 403);
  const rows = await db.listMembers(env.DB, { mode: accessMode(env), now: nowSec(env) });
  return json({ members: rows.map(toMember) });
});

/**
 * POST /api/admin/members：新增成員，角色固定 member，忽略請求夾帶的 role（M03、M04）。
 */
export const handleAddMember = requireStaff(async (request, env, ctx, url, { user }) => {
  if (!can(user.role, 'add', 'member')) return error('NOT_STAFF', 403);
  const body = await readJsonObject(request);
  if (!body) return error('BAD_REQUEST', 400);
  const email = parseEmail(body.email);
  if (!email) return error('INVALID_EMAIL', 400);
  const { ok, nickname } = parseNickname(body.nickname);
  if (!ok) return error('INVALID_NICKNAME', 400);
  const inserted = await db.insertMember(env.DB, { email, nickname, addedBy: user.id, now: nowSec(env) });
  if (!inserted) return error('ALREADY_EXISTS', 409);
  return json({ email, nickname, role: 'member' }, 201);
});
