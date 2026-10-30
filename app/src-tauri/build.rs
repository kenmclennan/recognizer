fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "adopt_scan",
        "choose_folder",
        "list_views",
        "open_folder_in_editor",
        "open_in_editor",
        "read_settings",
        "read_source_line",
        "recognizer_version",
        "rename_view",
        "renames_since",
        "scan_folder",
        "scans_at",
        "view_author",
        "view_path",
        "watch_changes",
        "watch_views",
        "window_folder",
        "write_current_view",
        "write_settings",
        "write_view",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(commands);

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}
