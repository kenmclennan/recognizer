fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "adopt_scan",
        "answer_window_drive",
        "choose_folder",
        "list_views",
        "open_folder_in_editor",
        "open_in_editor",
        "publish_window_state",
        "read_findings",
        "read_sensor_inputs",
        "read_settings",
        "read_source_line",
        "recognizer_version",
        "remove_findings",
        "rename_view",
        "renames_since",
        "scan_folder",
        "scans_at",
        "take_pending_view",
        "view_author",
        "view_link",
        "watch_changes",
        "watch_sensor_inputs",
        "watch_views",
        "window_folder",
        "write_settings",
        "write_structure",
        "write_view",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(commands);

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}
