/**
 * T04：D1 schema 與存取層。
 * migration 可重複套用；角色只接受 owner／admin／member；資料庫最多一位擁有者（M13 資料庫那一半）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb, applySql, ROOT } from './helpers/worker-env.mjs';
import { findAllowed } from '../worker/src/db.js';

let ctx;
let DB;

before(async () => {
  ctx = await createTestDb();
  DB = ctx.env.DB;
});

after(async () => {
  await ctx?.dispose();
});

const MIGRATION = join(ROOT, 'worker', 'migrations', '0001_init.sql');

/**
 * 取得某張表的欄位名稱清單。
 */
async function columns(table) {
  const { results } = await DB.prepare(`PRAGMA table_info(${table})`).all();
  return results.map((row) => row.name);
}

test('migration 全部使用 IF NOT EXISTS，連續套用兩次不報錯', async () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const creates = sql.match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)/gi) ?? [];
  const guarded = sql.match(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/gi) ?? [];
  assert.ok(creates.length >= 8, '至少要有七張表與 one_owner 索引');
  assert.equal(guarded.length, creates.length);
  await applySql(DB, sql);
  await applySql(DB, sql);
});

test('七張表的欄位符合 design §4', async () => {
  assert.deepEqual(await columns('allowed_emails'), ['email', 'nickname', 'role', 'created_at', 'added_by']);
  assert.deepEqual(await columns('users'), ['id', 'google_sub', 'email', 'created_at', 'last_login_at']);
  assert.deepEqual(await columns('sessions'), ['token_hash', 'user_id', 'created_at', 'expires_at']);
  assert.deepEqual(await columns('login_states'), ['state_hash', 'code_verifier', 'return_to', 'expires_at']);
  assert.deepEqual(await columns('snapshots'), [
    'user_id', 'revision', 'upload_id', 'schema_version', 'byte_size', 'chunk_count', 'device_label', 'updated_at',
  ]);
  assert.deepEqual(await columns('snapshot_chunks'), ['user_id', 'revision', 'idx', 'data']);
  assert.deepEqual(await columns('upload_log'), ['user_id', 'at']);
});

test('role 預設為 member', async () => {
  await DB.prepare("INSERT INTO allowed_emails(email, created_at) VALUES ('default@example.test', 1)").run();
  const row = await DB.prepare("SELECT role FROM allowed_emails WHERE email = 'default@example.test'").first();
  assert.equal(row.role, 'member');
});

test('role 填錯值被 CHECK 拒絕', async () => {
  await assert.rejects(
    DB.prepare("INSERT INTO allowed_emails(email, role) VALUES ('bad-role@example.test', 'superuser')").run(),
    /CHECK constraint failed/,
  );
  const row = await DB.prepare("SELECT 1 AS hit FROM allowed_emails WHERE email = 'bad-role@example.test'").first();
  assert.equal(row, null);
});

test('M13（資料庫）：插入第二位擁有者被唯一索引拒絕', async () => {
  await DB.prepare("INSERT INTO allowed_emails(email, role) VALUES ('owner-one@example.test', 'owner')").run();
  await assert.rejects(
    DB.prepare("INSERT INTO allowed_emails(email, role) VALUES ('owner-two@example.test', 'owner')").run(),
    /UNIQUE constraint failed/,
  );
  await assert.rejects(
    DB.prepare("UPDATE allowed_emails SET role = 'owner' WHERE email = 'default@example.test'").run(),
    /UNIQUE constraint failed/,
  );
  const { results } = await DB.prepare("SELECT email FROM allowed_emails WHERE role = 'owner'").all();
  assert.deepEqual(results.map((row) => row.email), ['owner-one@example.test']);
});

test('多位管理員與成員不受唯一索引限制', async () => {
  await DB.prepare("INSERT INTO allowed_emails(email, role) VALUES ('admin-a@example.test', 'admin')").run();
  await DB.prepare("INSERT INTO allowed_emails(email, role) VALUES ('admin-b@example.test', 'admin')").run();
  const row = await DB.prepare("SELECT COUNT(*) AS n FROM allowed_emails WHERE role = 'admin'").first();
  assert.equal(row.n, 2);
});

test('snapshot_chunks 以 (user_id, revision, idx) 為主鍵', async () => {
  const insert = DB.prepare('INSERT INTO snapshot_chunks(user_id, revision, idx, data) VALUES (?, ?, ?, ?)');
  await insert.bind('u-pk', 1, 0, new Uint8Array([1, 2, 3])).run();
  await assert.rejects(insert.bind('u-pk', 1, 0, new Uint8Array([4])).run(), /UNIQUE constraint failed|PRIMARY KEY/);
});

test('存取層 findAllowed：比對前轉小寫並去除空白，查無回 null', async () => {
  const hit = await findAllowed(DB, '  Owner-One@Example.TEST ');
  assert.equal(hit.email, 'owner-one@example.test');
  assert.equal(hit.role, 'owner');
  assert.equal(await findAllowed(DB, 'nobody@example.test'), null);
});
