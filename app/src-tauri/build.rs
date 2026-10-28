fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "choose_folder",
        "list_views",
        "read_source_line",
        "rename_view",
        "renames_since",
        "scan_folder",
        "scans_at",
        "view_path",
        "watch_views",
        "window_folder",
        "write_current_view",
        "write_view",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(commands);

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}
