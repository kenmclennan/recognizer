use tauri::menu::{Menu, MenuEvent, MenuItem, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub mod fs_safe;
mod launch;
pub mod repository;
pub mod source_line;
pub mod windows;

use std::path::{Path, PathBuf};

use launch::{launch_for, Launch};
use repository::ScanReport;
use tauri_plugin_dialog::DialogExt;
use windows::{canonical_folder, cascade_from, label_number, pick_window, Claim, WindowState};

const APP_TITLE: &str = "Recognizer";

fn open_window(app: &AppHandle, label: &str, title: &str) -> tauri::Result<WebviewWindow> {
    let anchor = cascade_anchor(app);

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(960.0, 640.0);

    if let Some((x, y)) = anchor {
        builder = builder.position(x, y);
    }

    builder.build()
}

fn cascade_anchor(app: &AppHandle) -> Option<(f64, f64)> {
    let open: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| label_number(label) > 0)
        .collect();
    let order = app.state::<WindowState>().order();
    let previous = app.get_webview_window(&pick_window(&order, &open)?)?;
    let scale = previous.scale_factor().ok()?;
    let position = previous.outer_position().ok()?.to_logical::<f64>(scale);

    Some(cascade_from((position.x, position.y)))
}

fn folder_title(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| APP_TITLE.to_string())
}

fn focus_label(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_folder(app: &AppHandle, folder: Option<&Path>) -> Result<(), String> {
    let state = app.state::<WindowState>();
    let label = state.next_label();

    let Some(folder) = folder else {
        return open_window(app, &label, APP_TITLE)
            .map(|_| ())
            .map_err(|error| error.to_string());
    };

    let canonical = canonical_folder(folder)?;

    if let Claim::HeldBy(other) = state.claim(&label, &canonical) {
        state.closed(&label);
        focus_label(app, &other);

        return Ok(());
    }

    open_window(app, &label, &folder_title(&canonical))
        .map(|_| ())
        .map_err(|error| {
            state.closed(&label);

            error.to_string()
        })
}

fn spawn_open_folder(app: &AppHandle, folder: Option<PathBuf>) {
    let app = app.clone();

    std::thread::spawn(move || {
        if let Err(error) = open_folder(&app, folder.as_deref()) {
            eprintln!("recognizer: could not open a window: {error}");
        }
    });
}

fn spawn_open_window(app: &AppHandle) {
    spawn_open_folder(app, None);
}

fn take_folder(app: &AppHandle, label: &str, folder: &Path) -> Result<(), String> {
    let state = app.state::<WindowState>();
    let canonical = canonical_folder(folder)?;

    if state.folder_of(label).is_some() {
        return open_folder(app, Some(&canonical));
    }

    match state.claim(label, &canonical) {
        Claim::HeldBy(other) => focus_label(app, &other),
        Claim::Assigned => {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.set_title(&folder_title(&canonical));
            }

            let _ = app.emit_to(label, "folder-assigned", ());
        }
    }

    Ok(())
}

fn choose_for(app: &AppHandle, label: &str) -> Result<(), String> {
    match app.dialog().file().blocking_pick_folder() {
        None => Ok(()),
        Some(chosen) => {
            let path = chosen.into_path().map_err(|error| error.to_string())?;

            take_folder(app, label, &path)
        }
    }
}

fn focused_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();

    windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .map(|window| window.label().to_string())
        .or_else(|| {
            let open: Vec<String> = windows
                .into_keys()
                .filter(|label| label_number(label) > 0)
                .collect();

            pick_window(&app.state::<WindowState>().order(), &open)
        })
}

fn focus_latest(app: &AppHandle) {
    let open: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| label_number(label) > 0)
        .collect();
    let order = app.state::<WindowState>().order();

    match pick_window(&order, &open) {
        Some(label) => focus_label(app, &label),
        None => spawn_open_window(app),
    }
}

fn handle_second_launch(app: &AppHandle, args: Vec<String>, cwd: String) {
    match launch_for(args.into_iter().skip(1), Path::new(&cwd)) {
        Launch::Window {
            folder: Some(folder),
        } => spawn_open_folder(app, Some(folder)),
        _ => focus_latest(app),
    }
}

fn handle_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "new-window" => spawn_open_window(app),
        "open-folder" => {
            if let Some(label) = focused_label(app) {
                let app = app.clone();

                std::thread::spawn(move || {
                    if let Err(error) = choose_for(&app, &label) {
                        eprintln!("recognizer: could not open the folder: {error}");
                    }
                });
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    let state = window.app_handle().state::<WindowState>();

    match event {
        WindowEvent::Focused(true) => state.focused(window.label()),
        WindowEvent::Destroyed => state.closed(window.label()),
        _ => {}
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let quit = MenuItem::with_id(
        app,
        "quit",
        format!("Quit {APP_TITLE}"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let new_window = MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "open-folder", "Open...", true, Some("CmdOrCtrl+O"))?;
    let application = SubmenuBuilder::new(app, APP_TITLE)
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .item(&open)
        .separator()
        .close_window()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    Menu::with_items(app, &[&application, &file, &edit, &window])
}

fn window_label(window: &WebviewWindow) -> String {
    window.label().to_string()
}

#[tauri::command]
fn window_folder(app: AppHandle, window: WebviewWindow) -> Option<String> {
    app.state::<WindowState>()
        .folder_of(&window_label(&window))
        .map(|folder| folder_title(&folder))
}

#[tauri::command]
async fn choose_folder(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let label = window_label(&window);

    tauri::async_runtime::spawn_blocking(move || choose_for(&app, &label))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn read_source_line(
    app: AppHandle,
    window: WebviewWindow,
    relative: String,
    line: u32,
) -> Result<Option<String>, String> {
    let folder = app
        .state::<WindowState>()
        .folder_of(&window_label(&window))
        .ok_or_else(|| "this window holds no folder".to_string())?;

    source_line::read_line(&folder, &relative, line)
}

#[tauri::command]
async fn scan_folder(app: AppHandle, window: WebviewWindow) -> Result<ScanReport, String> {
    let folder = app
        .state::<WindowState>()
        .folder_of(&window_label(&window))
        .ok_or_else(|| "this window holds no folder".to_string())?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        repository::scan(&folder, &shell, &repository::config_file_in(&config_dir))
    })
    .await
    .map_err(|error| error.to_string())
}

pub fn run() {
    let context = tauri::generate_context!();
    let cwd = std::env::current_dir().unwrap_or_default();

    let initial = match launch_for(std::env::args().skip(1), &cwd) {
        Launch::Window { folder } => folder,
        Launch::Refuse { text } => {
            eprintln!("{text}");

            std::process::exit(2);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            handle_second_launch(app, args, cwd)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_menu_event(handle_menu)
        .on_window_event(handle_window_event)
        .setup(move |app| {
            let handle = app.handle().clone();

            app.manage(WindowState::default());
            app.set_menu(build_menu(&handle)?)?;
            open_folder(&handle, initial.as_deref())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_folder,
            read_source_line,
            scan_folder,
            window_folder
        ])
        .build(context)
        .expect("error while building the application")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    focus_latest(app);
                }
            }
            RunEvent::ExitRequested { code, api, .. } => match code {
                Some(_) => {}
                #[cfg(target_os = "macos")]
                None => api.prevent_exit(),
                #[cfg(not(target_os = "macos"))]
                None => {
                    let _ = api;
                }
            },
            _ => {
                let _ = app;
            }
        });
}
