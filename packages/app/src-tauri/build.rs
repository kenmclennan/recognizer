fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "adopt_scan",
        "answer_window_drive",
        "choose_folder",
        "core_call",
        "list_views",
        "open_folder_in_editor",
        "open_in_editor",
        "publish_window_state",
        "read_describing",
        "read_recent_views",
        "read_config_keys",
        "read_settings",
        "record_recent_view",
        "remove_view",
        "rename_view",
        "read_scan_ticks",
        "describer_in_effect",
        "take_pending_view",
        "view_link",
        "watch_changes",
        "watch_views",
        "window_folder",
        "write_scan_ticks",
        "write_repository_config",
        "write_settings",
        "write_view",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(commands);

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}
