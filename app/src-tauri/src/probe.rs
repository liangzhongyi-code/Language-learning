use serde::Serialize;
use sqlx::{Connection, SqliteConnection};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeProof {
    pub sqlite_version: String,
    pub rollback_verified: bool,
    pub learning_repository: &'static str,
}

pub async fn sqlite_rollback_proof() -> Result<ProbeProof, sqlx::Error> {
    // 每次獨立連線，沒有 pool／檔案路徑／持久資料，也不接受前端 SQL。
    let mut connection = SqliteConnection::connect("sqlite::memory:").await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS probe_state (id INTEGER PRIMARY KEY, value INTEGER NOT NULL CHECK (value >= 0))")
        .execute(&mut connection).await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS probe_events (id INTEGER PRIMARY KEY, marker TEXT NOT NULL)")
        .execute(&mut connection).await?;
    sqlx::query("INSERT INTO probe_state (id, value) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
        .execute(&mut connection).await?;
    let sqlite_version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&mut connection).await?;

    let mut transaction = connection.begin().await?;
    sqlx::query("UPDATE probe_state SET value = 1 WHERE id = 1")
        .execute(&mut *transaction).await?;
    sqlx::query("INSERT INTO probe_events (id, marker) VALUES (1, 'fixture-only') ON CONFLICT(id) DO NOTHING")
        .execute(&mut *transaction).await?;
    let during: (i64, i64) = sqlx::query_as("SELECT value, (SELECT COUNT(*) FROM probe_events) FROM probe_state WHERE id = 1")
        .fetch_one(&mut *transaction).await?;

    // 第二個集合已改動後注入 CHECK 故障；不是只 BEGIN／ROLLBACK 空交易。
    let failure = sqlx::query("UPDATE probe_state SET value = -1 WHERE id = 1")
        .execute(&mut *transaction).await;
    let expected_failure = matches!(failure, Err(sqlx::Error::Database(ref error)) if error.is_check_violation());
    transaction.rollback().await?;
    let after: (i64, i64) = sqlx::query_as("SELECT value, (SELECT COUNT(*) FROM probe_events) FROM probe_state WHERE id = 1")
        .fetch_one(&mut connection).await?;
    connection.close().await?;
    if during != (1, 1) || !expected_failure || after != (0, 0) {
        return Err(sqlx::Error::Protocol("未取得完整交易回滾證據".into()));
    }
    Ok(ProbeProof {
        sqlite_version,
        rollback_verified: true,
        learning_repository: "not-implemented",
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn sqlite_rollback_is_verified_on_fresh_connections() {
        tauri::async_runtime::block_on(async {
            for _ in 0..2 {
                let proof = super::sqlite_rollback_proof().await.unwrap();
                assert!(!proof.sqlite_version.is_empty());
                assert!(proof.rollback_verified);
                assert_eq!(proof.learning_repository, "not-implemented");
            }
        });
    }
}
