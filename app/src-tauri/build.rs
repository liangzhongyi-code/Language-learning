fn main() {
    // 自訂 commands 也納入 ACL，避免 invoke_handler 的預設廣域存取。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["prototype_probe"]),
        ),
    )
    .expect("無法建立原型 command 權限 manifest");
}
