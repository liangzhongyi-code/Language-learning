//! 學習資料的窄命令橋接：只接受 main 視窗、且目前位於 APP 打包頁面時呼叫。
//! 命令只提供固定的讀寫動作，不接受 SQL、檔案路徑或任意集合；錯誤回傳 { code, message }。

use crate::storage::{database_path, InitOptions, OperationInput, Rows, Storage, StorageError};
use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::async_runtime::Mutex;
use tauri::{Manager, State, WebviewWindow};

#[derive(Default)]
pub struct StorageState(pub Mutex<Option<Storage>>);

type CommandResult<T> = Result<T, StorageError>;

fn guard(window: &WebviewWindow) -> CommandResult<()> {
    let url = window.url().map_err(|_| StorageError { code: "FORBIDDEN", message: "無法確認呼叫頁面。".into() })?;
    if window.label() != "main" || !crate::allowed_app_url(&url) || url.scheme() == "blob" {
        return Err(StorageError { code: "FORBIDDEN", message: "只允許 APP 本機頁面存取學習資料。".into() });
    }
    Ok(())
}

fn not_ready() -> StorageError {
    StorageError { code: "STORAGE_UNAVAILABLE", message: "學習資料庫尚未開啟。".into() }
}

macro_rules! with_storage {
    ($state:expr, $storage:ident => $body:expr) => {{
        let mut slot = $state.0.lock().await;
        let $storage = slot.as_mut().ok_or_else(not_ready)?;
        $body
    }};
}

#[tauri::command]
pub async fn storage_open(window: WebviewWindow, state: State<'_, StorageState>, init: InitOptions) -> CommandResult<Value> {
    guard(&window)?;
    let mut slot = state.0.lock().await;
    if slot.is_none() {
        let dir = window.app_handle().path().app_local_data_dir()
            .map_err(|_| StorageError { code: "STORAGE_UNAVAILABLE", message: "找不到 APP 私有資料目錄。".into() })?;
        std::fs::create_dir_all(&dir)
            .map_err(|_| StorageError { code: "STORAGE_UNAVAILABLE", message: "無法建立 APP 私有資料目錄。".into() })?;
        *slot = Some(Storage::open(&database_path(&dir), &init).await?);
    }
    slot.as_mut().unwrap().meta().await
}

#[tauri::command]
pub async fn storage_get(window: WebviewWindow, state: State<'_, StorageState>, store: String, key: String) -> CommandResult<Option<Value>> {
    guard(&window)?;
    with_storage!(state, storage => storage.get(&store, &key).await)
}

#[tauri::command]
pub async fn storage_read_all(window: WebviewWindow, state: State<'_, StorageState>, stores: Vec<String>) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.read_all(&stores).await)
}

#[tauri::command]
pub async fn storage_query(window: WebviewWindow, state: State<'_, StorageState>, query: Map<String, Value>) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.query_snapshot(&query).await)
}

#[tauri::command]
pub async fn storage_by_index(window: WebviewWindow, state: State<'_, StorageState>, store: String, index: String, key: Value) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.get_all_by_index(&store, &index, &key).await)
}

#[tauri::command]
pub async fn storage_list(window: WebviewWindow, state: State<'_, StorageState>, store: String, limit: i64,
    index: Option<String>, after: Option<Value>) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.list(&store, limit, index.as_deref(), after.as_ref()).await)
}

#[tauri::command]
pub async fn storage_commit(window: WebviewWindow, state: State<'_, StorageState>, operation: OperationInput,
    payload: String, large: bool) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.commit(&operation, &payload, large, None).await)
}

#[tauri::command]
pub async fn storage_clear(window: WebviewWindow, state: State<'_, StorageState>, operation: OperationInput, payload: String,
    fresh_epoch: String, history_started_at: i64, fresh: Rows) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.clear(&operation, &payload, &fresh_epoch, history_started_at, &fresh).await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreInput {
    rows: Rows,
    next_epoch: String,
    time_zone: String,
    history_started_at: i64,
    point_key: String,
    created_at: i64,
    reason: String,
    consume_point: Option<String>,
}

#[tauri::command]
pub async fn storage_restore(window: WebviewWindow, state: State<'_, StorageState>, operation: OperationInput, payload: String,
    input: RestoreInput) -> CommandResult<Value> {
    guard(&window)?;
    let consume = input.consume_point.as_deref();
    with_storage!(state, storage => storage.restore(&operation, &payload, &input.rows, &input.next_epoch, &input.time_zone,
        input.history_started_at, &input.point_key, input.created_at, &input.reason, consume).await)
}

#[tauri::command]
pub async fn storage_migrate(window: WebviewWindow, state: State<'_, StorageState>, expected_epoch: String, rows: Rows,
    overrides: Map<String, Value>) -> CommandResult<Value> {
    guard(&window)?;
    with_storage!(state, storage => storage.migrate(&expected_epoch, &rows, &overrides).await)
}
