fn main() {
    // 自訂 commands 也納入 ACL，避免 invoke_handler 的預設廣域存取。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "prototype_probe", "storage_open", "storage_get", "storage_read_all", "storage_query",
                "storage_by_index", "storage_list", "storage_commit", "storage_clear", "storage_restore", "storage_migrate",
            ]),
        ),
    )
    .expect("無法建立原型 command 權限 manifest");
}
