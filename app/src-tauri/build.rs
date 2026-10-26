fn main() {
    let commands = tauri_build::AppManifest::new().commands(&[
        "choose_folder",
        "read_source_line",
        "scan_folder",
        "window_folder",
    ]);
    let attributes = tauri_build::Attributes::new().app_manifest(commands);

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}
