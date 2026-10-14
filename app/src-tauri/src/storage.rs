//! 原生學習資料儲存：單一 SQLite 檔、單一連線（以 Mutex 序列化），每個寫入都是一個
//! `BEGIN IMMEDIATE` 交易。交易內核對資料世代（dataEpoch）、revision 與操作收據，
//! 規則與網站 IndexedDB 版本相同；內容雜湊由 Rust 自行計算，不信任呼叫端提供的雜湊。
//! 前端不能傳 SQL、檔案路徑或任意集合名稱。

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};
use sqlx::{Connection, Row, SqliteConnection};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

/// 原生資料庫結構版本（PRAGMA user_version）；較新版本一律拒絕讀寫，不自動降級。
pub const NATIVE_SCHEMA_VERSION: i64 = 1;
const META_SCHEMA_VERSION: i64 = 2;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_PAYLOAD_BYTES: usize = 24 * 1024 * 1024;
const COLLECTIONS: [&str; 15] = [
    "stats", "progress", "itemStates", "reviewEvents", "dailyPlans", "dailyLedger",
    "sessions", "operations", "restorePoints", "books", "notes", "intents",
    "achievements", "reminders", "outbox",
];
/// 可攜學習群組（還原點與備份會包含的集合）。
const PORTABLE: [&str; 12] = [
    "stats", "progress", "itemStates", "reviewEvents", "dailyPlans", "dailyLedger",
    "sessions", "books", "notes", "intents", "achievements", "reminders",
];
/// 與網站 IndexedDB 相同的索引欄位；以 json_extract 運算式索引實作。
const INDEXES: [(&str, &[&str]); 6] = [
    ("itemStates", &["sourceId", "skillKey", "due"]),
    ("reviewEvents", &["sourceId", "skillKey", "answeredAt", "sessionId"]),
    ("dailyPlans", &["localDate", "lang"]),
    ("dailyLedger", &["localDate", "lang"]),
    ("sessions", &["lang", "status"]),
    ("restorePoints", &["createdAt"]),
];
const INDEX_FIELDS: [&str; 9] = [
    "sourceId", "skillKey", "due", "answeredAt", "sessionId", "localDate", "lang", "status", "createdAt",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StorageError {
    pub code: &'static str,
    pub message: String,
}

impl StorageError {
    fn new(code: &'static str, message: &str) -> Self {
        Self { code, message: message.into() }
    }
}

impl From<sqlx::Error> for StorageError {
    fn from(error: sqlx::Error) -> Self {
        let full = matches!(&error, sqlx::Error::Database(db) if db.message().contains("full"));
        if full {
            return StorageError::new("STORAGE_QUOTA", "裝置空間不足，這次沒有保存，請先備份。");
        }
        StorageError::new("STORAGE_ABORTED", "紀錄保存未完成，原資料保持不變；請重試。")
    }
}

type Result<T> = std::result::Result<T, StorageError>;

fn invalid(message: &str) -> StorageError {
    StorageError::new("INVALID_OPERATION", message)
}

fn is_collection(store: &str) -> bool {
    COLLECTIONS.contains(&store)
}

fn writable(store: &str) -> bool {
    is_collection(store) && store != "operations" && store != "restorePoints"
}

fn indexed(store: &str, field: &str) -> bool {
    INDEXES.iter().any(|(name, fields)| *name == store && fields.contains(&field))
}

fn safe_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 256 && !matches!(key, "__proto__" | "constructor" | "prototype")
}

fn transaction_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 128
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'.' | b'_' | b'-'))
        && !matches!(value, "__proto__" | "prototype" | "constructor")
}

fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 操作識別：與網站 learning-operations 的 checkOperation 相同欄位。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationInput {
    pub operation_id: String,
    pub epoch: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Change {
    pub store: String,
    pub key: String,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub delete: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitOptions {
    pub data_epoch: String,
    pub time_zone: String,
    pub now: i64,
}

/// rows：{ 集合: { key: value } }，由前端以既有核心驗證後產生。
pub type Rows = Map<String, Value>;

pub struct Storage {
    connection: SqliteConnection,
}

enum Decision {
    Replay(Value),
    Proceed(Map<String, Value>),
}

impl Storage {
    /// 開啟或建立資料庫。損毀或版本較新的檔案原樣保留並回報錯誤，不重建、不覆蓋。
    pub async fn open(path: &Path, init: &InitOptions) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .map_err(|_| StorageError::new("STORAGE_UNAVAILABLE", "無法開啟本機學習資料庫。"))?
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(5));
        let mut connection = SqliteConnection::connect_with(&options).await.map_err(|_| {
            StorageError::new("UNSUPPORTED_SCHEMA", "學習資料庫無法讀取或已損毀，已停止讀寫，請保留原檔。")
        })?;
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&mut connection)
            .await
            .map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "學習資料庫無法讀取或已損毀，已停止讀寫，請保留原檔。"))?;
        if version > NATIVE_SCHEMA_VERSION {
            return Err(StorageError::new("UNSUPPORTED_SCHEMA", "這份資料由較新版程式建立，請更新程式，不要清除紀錄。"));
        }
        let mut storage = Self { connection };
        storage.ensure_schema(version, init).await?;
        Ok(storage)
    }

    async fn ensure_schema(&mut self, version: i64, init: &InitOptions) -> Result<()> {
        sqlx::query("BEGIN IMMEDIATE").execute(&mut self.connection).await?;
        let outcome = self.ensure_schema_inner(version, init).await;
        self.finish(outcome).await
    }

    async fn ensure_schema_inner(&mut self, version: i64, init: &InitOptions) -> Result<()> {
        let c = &mut self.connection;
        sqlx::query("CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)")
            .execute(&mut *c).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS records (store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (store, key)) WITHOUT ROWID")
            .execute(&mut *c).await?;
        for field in INDEX_FIELDS {
            sqlx::query(&format!(
                "CREATE INDEX IF NOT EXISTS records_{field} ON records (store, json_extract(value, '$.{field}'), key)"
            ))
            .execute(&mut *c).await?;
        }
        let existing: Option<String> = sqlx::query_scalar("SELECT value FROM meta WHERE id = 1")
            .fetch_optional(&mut *c).await?;
        if existing.is_none() {
            if !transaction_id(&init.data_epoch) || init.now < 0 || init.time_zone.is_empty() {
                return Err(invalid("初始化參數不合法。"));
            }
            let meta = json!({
                "schemaVersion": META_SCHEMA_VERSION, "revision": 0, "dataEpoch": init.data_epoch,
                "migrationStatus": "pending", "historyStartedAt": init.now,
                "schedulerPolicyVersion": 1, "timeZone": init.time_zone,
            });
            sqlx::query("INSERT INTO meta (id, value) VALUES (1, ?)").bind(meta.to_string()).execute(&mut *c).await?;
        }
        if version < NATIVE_SCHEMA_VERSION {
            sqlx::query(&format!("PRAGMA user_version = {NATIVE_SCHEMA_VERSION}")).execute(&mut *c).await?;
        }
        Ok(())
    }

    /// 依結果 COMMIT 或 ROLLBACK；ROLLBACK 失敗也回報原錯誤，不宣稱已保存。
    async fn finish<T>(&mut self, outcome: Result<T>) -> Result<T> {
        match outcome {
            Ok(value) => {
                if let Err(error) = sqlx::query("COMMIT").execute(&mut self.connection).await {
                    let _ = sqlx::query("ROLLBACK").execute(&mut self.connection).await;
                    return Err(error.into());
                }
                Ok(value)
            }
            Err(error) => {
                let _ = sqlx::query("ROLLBACK").execute(&mut self.connection).await;
                Err(error)
            }
        }
    }

    async fn meta_in(c: &mut SqliteConnection) -> Result<Map<String, Value>> {
        let raw: Option<String> = sqlx::query_scalar("SELECT value FROM meta WHERE id = 1").fetch_optional(&mut *c).await?;
        let meta: Map<String, Value> = raw
            .and_then(|text| serde_json::from_str(&text).ok())
            .ok_or_else(|| StorageError::new("UNSUPPORTED_SCHEMA", "學習資料版本或結構不正確，已停止寫入，請保留原資料。"))?;
        let ok = meta.get("schemaVersion").and_then(Value::as_i64) == Some(META_SCHEMA_VERSION)
            && meta.get("revision").and_then(Value::as_i64).map_or(false, |r| r >= 0)
            && meta.get("dataEpoch").and_then(Value::as_str).map_or(false, transaction_id)
            && matches!(meta.get("migrationStatus").and_then(Value::as_str), Some("pending" | "complete" | "cleared"));
        if !ok {
            return Err(StorageError::new("UNSUPPORTED_SCHEMA", "學習資料版本或結構不正確，已停止寫入，請保留原資料。"));
        }
        Ok(meta)
    }

    pub async fn meta(&mut self) -> Result<Value> {
        Ok(Value::Object(Self::meta_in(&mut self.connection).await?))
    }

    async fn write_meta(c: &mut SqliteConnection, meta: &Map<String, Value>) -> Result<()> {
        sqlx::query("UPDATE meta SET value = ? WHERE id = 1")
            .bind(Value::Object(meta.clone()).to_string())
            .execute(&mut *c).await?;
        Ok(())
    }

    /// 網站 checkOperation 的移植：先擋 epoch，再驗同操作收據，最後才檢查 revision。
    async fn check(c: &mut SqliteConnection, op: &OperationInput, payload_hash: &str) -> Result<Decision> {
        let meta = Self::meta_in(&mut *c).await?;
        if !transaction_id(&op.operation_id) || !transaction_id(&op.epoch) || op.expected_revision < 0 {
            return Err(invalid("保存操作格式不正確，沒有更動紀錄。"));
        }
        let revision = meta["revision"].as_i64().unwrap_or(-1);
        if Some(op.epoch.as_str()) != meta["dataEpoch"].as_str() {
            return Err(StorageError::new("STALE_EPOCH", "資料已清除或還原，請重新開啟目前的練習。"));
        }
        let receipt_key = format!("{}:{}", op.epoch, op.operation_id);
        let receipt: Option<String> = sqlx::query_scalar("SELECT value FROM records WHERE store = 'operations' AND key = ?")
            .bind(&receipt_key).fetch_optional(&mut *c).await?;
        if let Some(text) = receipt {
            let receipt: Value = serde_json::from_str(&text).map_err(|_| StorageError::new("INVALID_RECEIPT", "保存收據不完整，請重新載入後檢查紀錄。"))?;
            let stored = receipt["result"]["revision"].as_i64().unwrap_or(0);
            if receipt["operationId"] != op.operation_id.as_str() || receipt["epoch"] != op.epoch.as_str()
                || stored <= 0 || stored > revision {
                return Err(StorageError::new("INVALID_RECEIPT", "保存收據不完整，請重新載入後檢查紀錄。"));
            }
            if receipt["payloadHash"] != payload_hash {
                return Err(StorageError::new("OPERATION_MISMATCH", "同一筆保存操作的內容已改變，不能重複使用。"));
            }
            return Ok(Decision::Replay(receipt["result"].clone()));
        }
        if op.expected_revision != revision {
            return Err(StorageError::new("REVISION_CONFLICT", "其他頁面已更新紀錄，請重讀後再試。"));
        }
        if revision >= MAX_SAFE_INTEGER {
            return Err(StorageError::new("REVISION_EXHAUSTED", "紀錄版本已達上限，請先匯出備份。"));
        }
        Ok(Decision::Proceed(meta))
    }

    async fn put(c: &mut SqliteConnection, store: &str, key: &str, value: &Value) -> Result<()> {
        sqlx::query("INSERT INTO records (store, key, value) VALUES (?, ?, ?) ON CONFLICT (store, key) DO UPDATE SET value = excluded.value")
            .bind(store).bind(key).bind(value.to_string())
            .execute(&mut *c).await?;
        Ok(())
    }

    fn parse_payload(payload: &str) -> Result<Value> {
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(invalid("單次保存內容過大。"));
        }
        serde_json::from_str(payload).map_err(|_| invalid("保存內容不是合法 JSON。"))
    }

    /// 一般逐題保存：payload 為 canonical JSON `{ changes: [...] }`。fail_after 只供測試注入故障。
    pub async fn commit(&mut self, op: &OperationInput, payload: &str, large: bool, fail_after: Option<usize>) -> Result<Value> {
        let parsed = Self::parse_payload(payload)?;
        let changes: Vec<Change> = serde_json::from_value(parsed.get("changes").cloned().unwrap_or(Value::Null))
            .map_err(|_| invalid("保存內容沒有合法的變更。"))?;
        let limit = if large { 60_000 } else { 1_000 };
        if changes.is_empty() || changes.len() > limit || (!large && payload.len() > 1024 * 1024) {
            return Err(invalid("保存內容沒有合法的變更。"));
        }
        for change in &changes {
            if !writable(&change.store) || !safe_key(&change.key) || (!change.delete && change.value.is_none()) {
                return Err(invalid("保存內容包含不支援的資料欄位。"));
            }
        }
        let hash = sha256_hex(payload);
        sqlx::query("BEGIN IMMEDIATE").execute(&mut self.connection).await?;
        let outcome = async {
            let c = &mut self.connection;
            let mut meta = match Self::check(&mut *c, op, &hash).await? {
                Decision::Replay(result) => return Ok(result),
                Decision::Proceed(meta) => meta,
            };
            for (index, change) in changes.iter().enumerate() {
                if fail_after == Some(index) {
                    return Err(StorageError::new("STORAGE_ABORTED", "測試注入的交易中斷。"));
                }
                if change.delete {
                    sqlx::query("DELETE FROM records WHERE store = ? AND key = ?").bind(&change.store).bind(&change.key).execute(&mut *c).await?;
                } else {
                    Self::put(&mut *c, &change.store, &change.key, change.value.as_ref().unwrap()).await?;
                }
            }
            let next = meta["revision"].as_i64().unwrap() + 1;
            meta.insert("revision".into(), json!(next));
            Self::write_meta(&mut *c, &meta).await?;
            let result = json!({ "revision": next });
            let receipt = json!({ "operationId": op.operation_id, "epoch": op.epoch, "payloadHash": hash, "result": result });
            Self::put(&mut *c, "operations", &format!("{}:{}", op.epoch, op.operation_id), &receipt).await?;
            Ok(result)
        }.await;
        self.finish(outcome).await
    }

    /// 清除全部學習資料：fresh 為前端以 emptyLearning 產生的合法空資料列與新 epoch。
    pub async fn clear(&mut self, op: &OperationInput, payload: &str, fresh_epoch: &str, history_started_at: i64, fresh: &Rows) -> Result<Value> {
        if !transaction_id(fresh_epoch) || history_started_at < 0 {
            return Err(invalid("清除參數不合法。"));
        }
        Self::check_rows(fresh)?;
        let hash = sha256_hex(payload);
        sqlx::query("BEGIN IMMEDIATE").execute(&mut self.connection).await?;
        let outcome = async {
            let c = &mut self.connection;
            let mut meta = match Self::check(&mut *c, op, &hash).await? {
                Decision::Replay(result) => return Ok(result),
                Decision::Proceed(meta) => meta,
            };
            sqlx::query("DELETE FROM records").execute(&mut *c).await?;
            Self::insert_rows(&mut *c, fresh).await?;
            let next = meta["revision"].as_i64().unwrap() + 1;
            meta.insert("revision".into(), json!(next));
            meta.insert("dataEpoch".into(), json!(fresh_epoch));
            meta.insert("migrationStatus".into(), json!("cleared"));
            meta.insert("historyStartedAt".into(), json!(history_started_at));
            Self::write_meta(&mut *c, &meta).await?;
            Ok(json!({ "revision": next }))
        }.await;
        self.finish(outcome).await
    }

    fn check_rows(rows: &Rows) -> Result<()> {
        for (store, values) in rows {
            let values = values.as_object().ok_or_else(|| invalid("資料列格式不正確。"))?;
            if !PORTABLE.contains(&store.as_str()) || values.keys().any(|key| !safe_key(key)) {
                return Err(invalid("資料列包含不支援的集合或 key。"));
            }
        }
        Ok(())
    }

    async fn insert_rows(c: &mut SqliteConnection, rows: &Rows) -> Result<()> {
        for (store, values) in rows {
            for (key, value) in values.as_object().unwrap() {
                Self::put(&mut *c, store, key, value).await?;
            }
        }
        Ok(())
    }

    async fn store_rows(c: &mut SqliteConnection, store: &str) -> Result<Map<String, Value>> {
        let rows = sqlx::query("SELECT key, value FROM records WHERE store = ? ORDER BY key").bind(store).fetch_all(&mut *c).await?;
        let mut out = Map::new();
        for row in rows {
            let key: String = row.get(0);
            let value: String = row.get(1);
            out.insert(key, serde_json::from_str(&value).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。"))?);
        }
        Ok(out)
    }

    /// 整組替換：同交易把目前資料存成還原點（保留最新三份）、換新 epoch、寫入新列。
    /// consume_point 為回到還原點時前端讀到的還原點 key；還原點寫入後不會被修改，
    /// 交易內只需確認它仍存在（未被刪除或修剪）。
    #[allow(clippy::too_many_arguments)]
    pub async fn restore(&mut self, op: &OperationInput, payload: &str, rows: &Rows, next_epoch: &str,
        time_zone: &str, history_started_at: i64, point_key: &str, created_at: i64, reason: &str,
        consume_point: Option<&str>) -> Result<Value> {
        if !transaction_id(next_epoch) || time_zone.is_empty() || history_started_at < 0 || created_at < 0
            || !point_key.starts_with("rp:") || !safe_key(point_key) || reason.len() > 40 {
            return Err(invalid("還原參數不合法。"));
        }
        Self::check_rows(rows)?;
        let hash = sha256_hex(payload);
        sqlx::query("BEGIN IMMEDIATE").execute(&mut self.connection).await?;
        let outcome = async {
            let c = &mut self.connection;
            let mut meta = match Self::check(&mut *c, op, &hash).await? {
                Decision::Replay(result) => return Ok(result),
                Decision::Proceed(meta) => meta,
            };
            if let Some(key) = consume_point {
                let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM records WHERE store = 'restorePoints' AND key = ?")
                    .bind(key).fetch_optional(&mut *c).await?;
                if exists.is_none() {
                    return Err(invalid("找不到指定的還原點，可能已被較新的還原取代。"));
                }
            }
            let mut snapshot = Map::new();
            for store in PORTABLE {
                snapshot.insert(store.into(), Value::Object(Self::store_rows(&mut *c, store).await?));
            }
            sqlx::query("DELETE FROM records WHERE store != 'restorePoints'").execute(&mut *c).await?;
            Self::insert_rows(&mut *c, rows).await?;
            let point = json!({ "createdAt": created_at, "reason": reason, "format": "native-rows-1",
                "meta": Value::Object(meta.clone()), "rows": Value::Object(snapshot) });
            let existing: Vec<String> = sqlx::query_scalar("SELECT key FROM records WHERE store = 'restorePoints' ORDER BY key DESC")
                .fetch_all(&mut *c).await?;
            for key in existing.iter().skip(2) {
                sqlx::query("DELETE FROM records WHERE store = 'restorePoints' AND key = ?").bind(key).execute(&mut *c).await?;
            }
            Self::put(&mut *c, "restorePoints", point_key, &point).await?;
            let next = meta["revision"].as_i64().unwrap() + 1;
            meta.insert("revision".into(), json!(next));
            meta.insert("dataEpoch".into(), json!(next_epoch));
            meta.insert("migrationStatus".into(), json!("complete"));
            meta.insert("timeZone".into(), json!(time_zone));
            meta.insert("historyStartedAt".into(), json!(history_started_at));
            Self::write_meta(&mut *c, &meta).await?;
            Ok(json!({ "revision": next, "dataEpoch": next_epoch, "restorePointKey": point_key }))
        }.await;
        self.finish(outcome).await
    }

    /// 首次遷移（網站舊 localStorage 或舊版 APP 的 WebView IndexedDB）：只在 pending、revision 0
    /// 且 epoch 相同時寫入，並與完成標記同交易；已完成或已清除時原樣回傳，不重灌。
    pub async fn migrate(&mut self, expected_epoch: &str, rows: &Rows, overrides: &Map<String, Value>) -> Result<Value> {
        Self::check_rows(rows)?;
        for key in overrides.keys() {
            if !matches!(key.as_str(), "timeZone" | "historyStartedAt") {
                return Err(invalid("遷移只可沿用時區與歷史起點。"));
            }
        }
        sqlx::query("BEGIN IMMEDIATE").execute(&mut self.connection).await?;
        let outcome = async {
            let c = &mut self.connection;
            let mut meta = Self::meta_in(&mut *c).await?;
            if meta["migrationStatus"] != "pending" {
                return Ok(Value::Object(meta));
            }
            if meta["revision"].as_i64() != Some(0) || meta["dataEpoch"] != expected_epoch {
                return Err(StorageError::new("MIGRATION_CONFLICT", "舊資料遷移前已有其他更新，請重新載入後檢查。"));
            }
            Self::insert_rows(&mut *c, rows).await?;
            for (key, value) in overrides {
                meta.insert(key.clone(), value.clone());
            }
            meta.insert("revision".into(), json!(1));
            meta.insert("migrationStatus".into(), json!("complete"));
            Self::write_meta(&mut *c, &meta).await?;
            Ok(Value::Object(meta))
        }.await;
        self.finish(outcome).await
    }

    pub async fn get(&mut self, store: &str, key: &str) -> Result<Option<Value>> {
        if store == "meta" {
            return Ok(Some(self.meta().await?));
        }
        if !is_collection(store) {
            return Err(StorageError::new("INVALID_STORE", "不支援的資料集合。"));
        }
        let raw: Option<String> = sqlx::query_scalar("SELECT value FROM records WHERE store = ? AND key = ?")
            .bind(store).bind(key).fetch_optional(&mut self.connection).await?;
        raw.map(|text| serde_json::from_str(&text).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。")))
            .transpose()
    }

    /// 同一連線依序讀取 meta 與多個集合；Mutex 序列化所有存取，讀取期間不會插入寫入。
    pub async fn read_all(&mut self, stores: &[String]) -> Result<Value> {
        if stores.iter().any(|store| !is_collection(store)) {
            return Err(StorageError::new("INVALID_STORE", "不支援的資料集合。"));
        }
        let meta = self.meta().await?;
        let mut rows = Map::new();
        for store in stores {
            rows.insert(store.clone(), Value::Object(Self::store_rows(&mut self.connection, store).await?));
        }
        Ok(json!({ "meta": meta, "rows": rows }))
    }

    async fn by_index(c: &mut SqliteConnection, store: &str, field: &str, key: &Value) -> Result<Map<String, Value>> {
        if !indexed(store, field) {
            return Err(StorageError::new("INVALID_QUERY", "讀取資料的範圍不正確。"));
        }
        let sql = format!("SELECT key, value FROM records WHERE store = ? AND json_extract(value, '$.{field}') = ? ORDER BY key");
        let query = sqlx::query(&sql).bind(store);
        let query = match key {
            Value::String(text) => query.bind(text.clone()),
            Value::Number(number) if number.is_i64() => query.bind(number.as_i64().unwrap()),
            Value::Number(number) => query.bind(number.as_f64().unwrap_or(f64::NAN)),
            _ => return Err(StorageError::new("INVALID_QUERY", "查詢條件不正確。")),
        };
        let mut out = Map::new();
        for row in query.fetch_all(&mut *c).await? {
            let primary: String = row.get(0);
            let value: String = row.get(1);
            out.insert(primary, serde_json::from_str(&value).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。"))?);
        }
        Ok(out)
    }

    pub async fn get_all_by_index(&mut self, store: &str, field: &str, key: &Value) -> Result<Value> {
        Ok(Value::Object(Self::by_index(&mut self.connection, store, field, key).await?))
    }

    /// 分頁讀取：依 key（或索引值＋key）排序，after 為上一頁最後一列的 continuation。
    pub async fn list(&mut self, store: &str, limit: i64, index: Option<&str>, after: Option<&Value>) -> Result<Value> {
        if !is_collection(store) || !(1..=1000).contains(&limit) || index.map_or(false, |field| !indexed(store, field)) {
            return Err(StorageError::new("INVALID_QUERY", "讀取資料的範圍不正確。"));
        }
        let expression = index.map(|field| format!("json_extract(value, '$.{field}')")).unwrap_or_else(|| "key".into());
        let rows = sqlx::query(&format!("SELECT key, value, {expression} AS idx FROM records WHERE store = ? ORDER BY idx, key"))
            .bind(store).fetch_all(&mut self.connection).await?;
        let mut out = Vec::new();
        let mut passed = after.is_none();
        for row in rows {
            let key: String = row.get(0);
            let value: String = row.get(1);
            let value: Value = serde_json::from_str(&value).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。"))?;
            let index_key = match index { Some(field) => value.get(field).cloned().unwrap_or(Value::Null), None => json!(key) };
            if !passed {
                let token = after.unwrap();
                if token.get("primaryKey") == Some(&json!(key)) && token.get("indexKey") == Some(&index_key) {
                    passed = true;
                }
                continue;
            }
            out.push(json!({ "key": key, "value": value, "indexKey": index_key,
                "continuation": { "indexKey": index_key, "primaryKey": key } }));
            if out.len() as i64 >= limit {
                break;
            }
        }
        if !passed {
            return Err(StorageError::new("INVALID_QUERY", "分頁續讀位置不正確，請重新讀取清單。"));
        }
        Ok(Value::Array(out))
    }

    /// bounded query：selector 已由前端 normalizeSnapshotQuery 驗證，這裡再檢查一次形狀。
    pub async fn query_snapshot(&mut self, query: &Map<String, Value>) -> Result<Value> {
        let meta = self.meta().await?;
        let c = &mut self.connection;
        let mut rows = Map::new();
        for (store, selector) in query {
            if !is_collection(store) {
                return Err(StorageError::new("INVALID_QUERY", "讀取資料的範圍不正確。"));
            }
            if selector.get("planRefs").is_some() {
                continue;
            }
            let mut found = Map::new();
            if let Some(prefix) = selector.get("prefix").and_then(Value::as_str) {
                if !matches!(prefix, "ja:" | "en:" | "ja-" | "en-") {
                    return Err(StorageError::new("INVALID_QUERY", "讀取資料的範圍不正確。"));
                }
                let mut upper = prefix.to_string();
                let last = upper.pop().unwrap();
                upper.push(char::from_u32(last as u32 + 1).unwrap());
                for row in sqlx::query("SELECT key, value FROM records WHERE store = ? AND key >= ? AND key < ? ORDER BY key")
                    .bind(store).bind(prefix).bind(&upper).fetch_all(&mut *c).await? {
                    let key: String = row.get(0);
                    let value: String = row.get(1);
                    found.insert(key, serde_json::from_str(&value).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。"))?);
                }
            } else if let (Some(field), Some(key)) = (selector.get("index").and_then(Value::as_str), selector.get("key")) {
                found = Self::by_index(&mut *c, store, field, key).await?;
            } else if let Some(key) = selector.get("key") {
                let key = match key { Value::String(text) => text.clone(), Value::Number(n) => n.to_string(), _ => return Err(StorageError::new("INVALID_QUERY", "查詢條件不正確。")) };
                let raw: Option<String> = sqlx::query_scalar("SELECT value FROM records WHERE store = ? AND key = ?")
                    .bind(store).bind(&key).fetch_optional(&mut *c).await?;
                if let Some(text) = raw {
                    found.insert(key, serde_json::from_str(&text).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。"))?);
                }
            } else {
                return Err(StorageError::new("INVALID_QUERY", "讀取資料的範圍不正確。"));
            }
            rows.insert(store.clone(), Value::Object(found));
        }
        if query.get("sessions").and_then(|s| s.get("planRefs")).is_some() {
            let mut sessions = Map::new();
            let plans = rows.get("dailyPlans").and_then(Value::as_object).cloned().unwrap_or_default();
            for plan in plans.values() {
                if let Some(id) = plan.get("sessionId").and_then(Value::as_str) {
                    if !safe_key(id) {
                        return Err(StorageError::new("UNSUPPORTED_SCHEMA", "每日清單的 session 引用不合法，請保留原資料。"));
                    }
                    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM records WHERE store = 'sessions' AND key = ?")
                        .bind(id).fetch_optional(&mut *c).await?;
                    if let Some(text) = raw {
                        sessions.insert(id.into(), serde_json::from_str(&text).map_err(|_| StorageError::new("UNSUPPORTED_SCHEMA", "資料庫內容損毀，已停止讀寫。"))?);
                    }
                }
            }
            rows.insert("sessions".into(), Value::Object(sessions));
        }
        Ok(json!({ "meta": meta, "rows": rows }))
    }
}

/// 固定的 APP 私有資料檔位置（各平台 app_local_data_dir 下）。
pub fn database_path(dir: &Path) -> PathBuf {
    dir.join("learning.sqlite3")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init() -> InitOptions {
        InitOptions { data_epoch: "epochA".into(), time_zone: "Asia/Taipei".into(), now: 1000 }
    }

    fn op(id: &str, epoch: &str, revision: i64) -> OperationInput {
        OperationInput { operation_id: id.into(), epoch: epoch.into(), expected_revision: revision }
    }

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lang-learn-storage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        database_path(&dir)
    }

    fn payload(changes: Value) -> String {
        json!({ "changes": changes }).to_string()
    }

    async fn migrated(path: &Path) -> Storage {
        let mut storage = Storage::open(path, &init()).await.unwrap();
        let rows: Rows = serde_json::from_value(json!({ "books": { "favorites": { "bookId": "favorites" } } })).unwrap();
        storage.migrate("epochA", &rows, &Map::new()).await.unwrap();
        storage
    }

    #[test]
    fn s05_s06_commit_replay_mismatch_and_conflict() {
        tauri::async_runtime::block_on(async {
            let mut storage = migrated(&temp_db("commit")).await;
            let body = payload(json!([{ "store": "stats", "key": "ja:daily", "value": { "answered": 1 } },
                { "store": "progress", "key": "ja-w-001", "value": { "n": 1, "w": 0 } }]));
            assert_eq!(storage.commit(&op("op1", "epochA", 1), &body, false, None).await.unwrap(), json!({ "revision": 2 }));
            assert_eq!(storage.commit(&op("op1", "epochA", 1), &body, false, None).await.unwrap(), json!({ "revision": 2 }), "同 ID 同內容回原收據");
            let other = payload(json!([{ "store": "stats", "key": "ja:daily", "value": { "answered": 9 } }]));
            assert_eq!(storage.commit(&op("op1", "epochA", 2), &other, false, None).await.unwrap_err().code, "OPERATION_MISMATCH");
            assert_eq!(storage.commit(&op("op2", "epochA", 1), &other, false, None).await.unwrap_err().code, "REVISION_CONFLICT");
            assert_eq!(storage.commit(&op("op3", "old", 2), &other, false, None).await.unwrap_err().code, "STALE_EPOCH");
            assert_eq!(storage.get("stats", "ja:daily").await.unwrap(), Some(json!({ "answered": 1 })));
        });
    }

    #[test]
    fn s05_s07_injected_failure_rolls_back_every_collection() {
        tauri::async_runtime::block_on(async {
            let mut storage = migrated(&temp_db("rollback")).await;
            let body = payload(json!([{ "store": "stats", "key": "ja:daily", "value": { "answered": 1 } },
                { "store": "progress", "key": "ja-w-001", "value": { "n": 1 } }]));
            assert_eq!(storage.commit(&op("op1", "epochA", 1), &body, false, Some(1)).await.unwrap_err().code, "STORAGE_ABORTED");
            assert_eq!(storage.get("stats", "ja:daily").await.unwrap(), None);
            assert_eq!(storage.meta().await.unwrap()["revision"], 1);
            assert_eq!(storage.get("operations", "epochA:op1").await.unwrap(), None, "失敗不留收據");
        });
    }

    #[test]
    fn s07_committed_data_survives_reopen() {
        tauri::async_runtime::block_on(async {
            let path = temp_db("reopen");
            {
                let mut storage = migrated(&path).await;
                let body = payload(json!([{ "store": "notes", "key": "ja-w-001", "value": { "text": "筆記" } }]));
                storage.commit(&op("op1", "epochA", 1), &body, false, None).await.unwrap();
            }
            let mut storage = Storage::open(&path, &InitOptions { data_epoch: "ignored".into(), ..init() }).await.unwrap();
            assert_eq!(storage.get("notes", "ja-w-001").await.unwrap(), Some(json!({ "text": "筆記" })));
            assert_eq!(storage.meta().await.unwrap()["dataEpoch"], "epochA", "重開不覆寫既有 meta");
        });
    }

    #[test]
    fn s08_future_schema_and_damaged_file_are_refused_untouched() {
        tauri::async_runtime::block_on(async {
            let path = temp_db("future");
            {
                let mut storage = migrated(&path).await;
                sqlx::query("PRAGMA user_version = 99").execute(&mut storage.connection).await.unwrap();
            }
            assert_eq!(Storage::open(&path, &init()).await.err().unwrap().code, "UNSUPPORTED_SCHEMA");
            let damaged = temp_db("damaged");
            std::fs::write(&damaged, b"not a sqlite database at all, keep me").unwrap();
            assert_eq!(Storage::open(&damaged, &init()).await.err().unwrap().code, "UNSUPPORTED_SCHEMA");
            assert_eq!(std::fs::read(&damaged).unwrap(), b"not a sqlite database at all, keep me");
        });
    }

    #[test]
    fn s09_migration_runs_once_and_rejects_conflicts() {
        tauri::async_runtime::block_on(async {
            let mut storage = Storage::open(&temp_db("migrate"), &init()).await.unwrap();
            let rows: Rows = serde_json::from_value(json!({ "progress": { "ja-w-001": { "n": 3, "w": 1 } } })).unwrap();
            assert_eq!(storage.migrate("other", &rows, &Map::new()).await.unwrap_err().code, "MIGRATION_CONFLICT");
            let first = storage.migrate("epochA", &rows, &Map::new()).await.unwrap();
            assert_eq!(first["migrationStatus"], "complete");
            let again = storage.migrate("epochA", &rows, &Map::new()).await.unwrap();
            assert_eq!(again["revision"], 1, "重跑不重灌");
            let bad: Rows = serde_json::from_value(json!({ "operations": { "x": {} } })).unwrap();
            assert_eq!(storage.migrate("epochA", &bad, &Map::new()).await.unwrap_err().code, "INVALID_OPERATION");
        });
    }

    #[test]
    fn s11_restore_keeps_three_points_and_changes_epoch() {
        tauri::async_runtime::block_on(async {
            let mut storage = migrated(&temp_db("restore")).await;
            let rows: Rows = serde_json::from_value(json!({ "progress": { "ja-w-009": { "n": 1, "w": 0 } } })).unwrap();
            let mut epoch = "epochA".to_string();
            let mut revision = 1;
            for i in 0..5 {
                let result = storage.restore(&op(&format!("r{i}"), &epoch, revision), &format!("{{\"n\":{i}}}"), &rows,
                    &format!("epoch{i}"), "Asia/Taipei", 1000, &format!("rp:{:016}:x", 2000 + i), 2000 + i, "restore", None).await.unwrap();
                epoch = result["dataEpoch"].as_str().unwrap().into();
                revision = result["revision"].as_i64().unwrap();
            }
            let points = storage.read_all(&["restorePoints".into()]).await.unwrap();
            assert_eq!(points["rows"]["restorePoints"].as_object().unwrap().len(), 3);
            assert_eq!(storage.get("progress", "ja-w-009").await.unwrap(), Some(json!({ "n": 1, "w": 0 })));
            assert_eq!(storage.get("books", "favorites").await.unwrap(), None, "整組替換不合併");
            let stale = payload(json!([{ "store": "stats", "key": "x", "value": {} }]));
            assert_eq!(storage.commit(&op("late", "epochA", revision), &stale, false, None).await.unwrap_err().code, "STALE_EPOCH");
        });
    }

    #[test]
    fn o18_clear_replaces_with_fresh_rows_and_marks_cleared() {
        tauri::async_runtime::block_on(async {
            let mut storage = migrated(&temp_db("clear")).await;
            let body = payload(json!([{ "store": "progress", "key": "ja-w-001", "value": { "n": 1 } }]));
            storage.commit(&op("op1", "epochA", 1), &body, false, None).await.unwrap();
            let fresh: Rows = serde_json::from_value(json!({ "books": { "favorites": { "bookId": "favorites", "wordIds": [] } } })).unwrap();
            let clear = json!({ "kind": "clear-learning" }).to_string();
            storage.clear(&op("clear1", "epochA", 2), &clear, "epochB", 5000, &fresh).await.unwrap();
            let meta = storage.meta().await.unwrap();
            assert_eq!((meta["migrationStatus"].as_str(), meta["dataEpoch"].as_str()), (Some("cleared"), Some("epochB")));
            assert_eq!(storage.get("progress", "ja-w-001").await.unwrap(), None);
            assert!(storage.get("books", "favorites").await.unwrap().is_some());
        });
    }

    #[test]
    fn s20_rejects_unknown_stores_keys_and_oversized_batches() {
        tauri::async_runtime::block_on(async {
            let mut storage = migrated(&temp_db("guard")).await;
            for change in [json!({ "store": "operations", "key": "x", "value": {} }), json!({ "store": "meta", "key": "current", "value": {} }),
                json!({ "store": "stats", "key": "__proto__", "value": {} }), json!({ "store": "stats; DROP TABLE records", "key": "x", "value": {} })] {
                assert_eq!(storage.commit(&op("g", "epochA", 1), &payload(json!([change])), false, None).await.unwrap_err().code, "INVALID_OPERATION");
            }
            let many: Vec<Value> = (0..1001).map(|i| json!({ "store": "stats", "key": format!("k{i}"), "value": {} })).collect();
            assert_eq!(storage.commit(&op("g", "epochA", 1), &payload(json!(many)), false, None).await.unwrap_err().code, "INVALID_OPERATION");
            assert_eq!(storage.get("nope", "x").await.unwrap_err().code, "INVALID_STORE");
        });
    }

    #[test]
    fn queries_match_web_repository_contract() {
        tauri::async_runtime::block_on(async {
            let mut storage = migrated(&temp_db("query")).await;
            let body = payload(json!([
                { "store": "progress", "key": "ja-w-001", "value": { "n": 1 } },
                { "store": "progress", "key": "en-w-001", "value": { "n": 2 } },
                { "store": "dailyPlans", "key": "p1", "value": { "lang": "ja", "sessionId": "s1", "localDate": "2026-10-14" } },
                { "store": "sessions", "key": "s1", "value": { "lang": "ja", "status": "active" } },
                { "store": "reviewEvents", "key": "r1", "value": { "sessionId": "s1", "answeredAt": 5 } },
            ]));
            storage.commit(&op("op1", "epochA", 1), &body, false, None).await.unwrap();
            let query: Map<String, Value> = serde_json::from_value(json!({ "progress": { "prefix": "ja-" },
                "dailyPlans": { "index": "lang", "key": "ja" }, "sessions": { "planRefs": "dailyPlans" } })).unwrap();
            let result = storage.query_snapshot(&query).await.unwrap();
            assert_eq!(result["rows"]["progress"].as_object().unwrap().keys().collect::<Vec<_>>(), vec!["ja-w-001"]);
            assert!(result["rows"]["sessions"]["s1"].is_object());
            let events = storage.get_all_by_index("reviewEvents", "answeredAt", &json!(5)).await.unwrap();
            assert!(events["r1"].is_object(), "數字索引值可查詢");
            let page = storage.list("progress", 1, None, None).await.unwrap();
            let next = storage.list("progress", 1, None, Some(&page[0]["continuation"])).await.unwrap();
            assert_eq!((page[0]["key"].as_str(), next[0]["key"].as_str()), (Some("en-w-001"), Some("ja-w-001")));
        });
    }
}
