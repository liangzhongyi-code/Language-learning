mod probe;

use tauri::Manager;

fn allowed_prototype_url(url: &tauri::Url) -> bool {
    let local = matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost"))
            | ("http", Some("tauri.localhost"))
            | ("https", Some("tauri.localhost"))
    );
    local
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.path(),
            "/app/prototype/index.html" | "/app/prototype/second.html"
        )
}

#[tauri::command]
async fn prototype_probe(window: tauri::WebviewWindow) -> Result<probe::ProbeProof, String> {
    let url = window.url().map_err(|_| "無法確認原型頁面來源。")?;
    if window.label() != "main" || !allowed_prototype_url(&url) {
        return Err("只允許本機原型兩頁呼叫此命令。".into());
    }
    probe::sqlite_rollback_proof()
        .await
        .map_err(|_| "記憶體 SQLite 探針失敗；未取得回滾證據。".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![prototype_probe])
        .setup(|app| {
            let config = app.config().app.windows.iter()
                .find(|config| config.label == "main")
                .ok_or_else(|| std::io::Error::other("缺少 main 原型視窗設定"))?;
            // create:false 讓導覽限制在首次載入前就附加，不能另自動建立無限制視窗。
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(allowed_prototype_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("無法啟動 P00b 本機原型");
}

#[cfg(test)]
mod tests {
    use super::allowed_prototype_url;

    #[test]
    fn prototype_url_rejects_web_pages_remote_origins_and_credentials() {
        for value in [
            "https://example.invalid/app/prototype/index.html",
            "http://localhost/app/prototype/index.html",
            "http://tauri.localhost/en/quiz.html",
            "tauri://localhost/index.html",
            "http://tauri.localhost:8080/app/prototype/index.html",
            "http://user@tauri.localhost/app/prototype/index.html",
            "file:///app/prototype/index.html",
        ] {
            assert!(!allowed_prototype_url(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "tauri://localhost/app/prototype/index.html",
            "http://tauri.localhost/app/prototype/second.html",
            "https://tauri.localhost/app/prototype/index.html",
        ] {
            assert!(allowed_prototype_url(&value.parse().unwrap()), "{value}");
        }
    }
}
