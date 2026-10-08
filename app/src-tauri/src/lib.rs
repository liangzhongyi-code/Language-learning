mod probe;

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

/// 正式 APP 的識別碼；只有原型識別碼才使用兩頁限制，其餘一律套用網站頁面白名單。
const PROTOTYPE_IDENTIFIER: &str = "io.github.lang-learn.prototype";

/// 正式 APP 只允許本機打包的網站頁面：根目錄 index／help，以及 en、ja 下的單層 .html。
/// 不接受埠號、帳密、遠端網域或目錄穿越；blob: 僅供備份檔下載。
fn allowed_app_url(url: &tauri::Url) -> bool {
    if url.scheme() == "blob" {
        return url.path().starts_with("http://tauri.localhost/") || url.path().starts_with("tauri://localhost/");
    }
    let local = matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost"))
            | ("http", Some("tauri.localhost"))
            | ("https", Some("tauri.localhost"))
    );
    if !local || url.port().is_some() || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let path = url.path();
    if path == "/" || path == "/index.html" || path == "/help.html" {
        return true;
    }
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    parts.len() == 2
        && matches!(parts[0], "en" | "ja")
        && parts[1].ends_with(".html")
        && parts[1].len() > 5
        && parts[1][..parts[1].len() - 5].chars().all(|c| c.is_ascii_lowercase() || c == '-')
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
            let prototype = app.config().identifier == PROTOTYPE_IDENTIFIER;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(move |url| if prototype { allowed_prototype_url(url) } else { allowed_app_url(url) })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("無法啟動 P00b 本機原型");
}

#[cfg(test)]
mod tests {
    use super::{allowed_app_url, allowed_prototype_url};

    #[test]
    fn app_url_allows_only_packaged_site_pages() {
        for value in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "http://tauri.localhost/help.html#google-backup",
            "http://tauri.localhost/ja/daily.html",
            "https://tauri.localhost/en/practice.html?book=favorites",
            "blob:http://tauri.localhost/3f1c2b7e-0000-4000-8000-000000000000",
        ] {
            assert!(allowed_app_url(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "https://example.invalid/index.html",
            "https://liangzhongyi-code.github.io/Language-learning/index.html",
            "http://tauri.localhost:8080/index.html",
            "http://user@tauri.localhost/index.html",
            "http://tauri.localhost/app/prototype/index.html",
            "http://tauri.localhost/assets/js/ui/nav.js",
            "http://tauri.localhost/ja/../secret.html",
            "http://tauri.localhost/ja/sub/page.html",
            "http://tauri.localhost/fr/index.html",
            "file:///C:/index.html",
            "blob:https://example.invalid/abc",
        ] {
            assert!(!allowed_app_url(&value.parse().unwrap()), "{value}");
        }
    }

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
