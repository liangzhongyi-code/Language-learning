-- 雲端同步的初始 schema（design §4）
-- 全部使用 IF NOT EXISTS，可重複執行
-- 時間欄位一律存 Unix 秒（與手冊的 unixepoch() 一致）
-- 測試工具以分號切句，本檔的註解與字串都不得含分號

CREATE TABLE IF NOT EXISTS allowed_emails (
  email TEXT PRIMARY KEY,
  nickname TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at INTEGER,
  added_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON allowed_emails(role) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT,
  return_to TEXT,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  upload_id TEXT,
  schema_version INTEGER,
  byte_size INTEGER,
  chunk_count INTEGER,
  device_label TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS snapshot_chunks (
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB,
  PRIMARY KEY (user_id, revision, idx)
);

CREATE TABLE IF NOT EXISTS upload_log (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_log_user_at ON upload_log(user_id, at);
