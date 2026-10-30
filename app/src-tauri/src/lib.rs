use tauri::menu::{Menu, MenuEvent, MenuItem, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub mod changes;
pub mod editor;
pub mod fs_safe;
mod launch;
pub mod repository;
pub mod responsibilities;
pub mod settings;
pub mod source_line;
pub mod views;
pub mod windows;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use changes::{Baseline, Changes, Origin, ScanOrigin};
use launch::{launch_for, Launch};
use repository::ScanReport;
use tauri_plugin_dialog::DialogExt;
use windows::{
    canonical_folder, cascade_from, label_number, menu_target, pick_window, Claim, WindowState,
};

const APP_TITLE: &str = "Recognizer";
const SETTINGS_LABEL: &str = "settings";
const CHANGES_POLL: Duration = Duration::from_secs(2);

#[derive(Default)]
struct WindowBaseline {
    pending: Option<Origin>,
    current: Option<Baseline>,
    last: Changes,
}

#[derive(Default)]
struct ScanBaselines(Mutex<HashMap<String, WindowBaseline>>);

impl ScanBaselines {
    fn with<T>(
        &self,
        label: &str,
        run: impl FnOnce(&mut WindowBaseline) -> T,
    ) -> Result<T, String> {
        let mut windows = self.0.lock().map_err(|error| error.to_string())?;

        Ok(run(windows.entry(label.to_string()).or_default()))
    }
}

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
    let focused = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .map(|window| window.label().to_string());
    let open: Vec<String> = windows.into_keys().collect();

    menu_target(
        focused.as_deref(),
        &app.state::<WindowState>().order(),
        &open,
    )
}

fn open_settings(app: &AppHandle) {
    if app.get_webview_window(SETTINGS_LABEL).is_some() {
        focus_label(app, SETTINGS_LABEL);

        return;
    }

    let built =
        WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
            .title("Settings")
            .inner_size(480.0, 300.0)
            .resizable(false)
            .build();

    if let Err(error) = built {
        eprintln!("recognizer: could not open settings: {error}");
    }
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| repository::config_file_in(&dir))
        .map_err(|error| error.to_string())
}

fn launch_in_editor(app: &AppHandle, target: &Path) -> Result<(), String> {
    let editor = settings::read(&config_file(app)?)?.editor;

    editor::launch(&editor, target)
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
        "check-updates" => {
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, "check-updates", ());
            }
        }
        "rescan" => {
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, "rescan", ());
            }
        }
        "settings" => open_settings(app),
        "open-in-editor" => {
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, "open-in-editor", ());
            }
        }
        "open-folder-in-editor" => {
            let folder =
                focused_label(app).and_then(|label| app.state::<WindowState>().folder_of(&label));

            if let Some(folder) = folder {
                if let Err(error) = launch_in_editor(app, &folder) {
                    eprintln!("recognizer: could not open the editor: {error}");
                }
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
    let rescan = MenuItem::with_id(app, "rescan", "Rescan", true, Some("CmdOrCtrl+R"))?;
    let open_in_editor = MenuItem::with_id(
        app,
        "open-in-editor",
        "Open in Editor",
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let open_folder_in_editor = MenuItem::with_id(
        app,
        "open-folder-in-editor",
        "Open Folder in Editor",
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let settings_item =
        MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
    let check_updates = MenuItem::with_id(
        app,
        "check-updates",
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    let application = SubmenuBuilder::new(app, APP_TITLE)
        .about(None)
        .item(&check_updates)
        .separator()
        .item(&settings_item)
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
        .item(&rescan)
        .separator()
        .item(&open_in_editor)
        .item(&open_folder_in_editor)
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
    let config_file = config_file(&app)?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let label = window_label(&window);

    tauri::async_runtime::spawn_blocking(move || {
        let origin = changes::take_origin(&folder);

        app.state::<ScanBaselines>()
            .with(&label, |window| window.pending = Some(origin))?;

        Ok(repository::scan(&folder, &shell, &config_file))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn read_settings(app: AppHandle) -> Result<settings::Settings, String> {
    settings::read(&config_file(&app)?)
}

#[tauri::command]
fn write_settings(app: AppHandle, settings: settings::Settings) -> Result<(), String> {
    settings::save(&config_file(&app)?, &settings)
}

#[tauri::command]
fn open_in_editor(app: AppHandle, window: WebviewWindow, relative: String) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let target = fs_safe::checked_relative_entry(&folder, &relative)?;

    launch_in_editor(&app, &target)
}

#[tauri::command]
fn open_folder_in_editor(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;

    launch_in_editor(&app, &folder)
}

#[tauri::command]
fn adopt_scan(app: AppHandle, window: WebviewWindow) -> Result<ScanOrigin, String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);

    app.state::<ScanBaselines>().with(&label, |state| {
        let pending = state
            .pending
            .take()
            .ok_or_else(|| "no scan is waiting to be adopted".to_string())?;
        let adopted = changes::adopt(&pending, &folder);
        let origin = changes::origin_of(&adopted);

        state.current = Some(adopted);
        state.last = Changes::default();

        Ok(origin)
    })?
}

#[tauri::command]
fn watch_changes(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);

    let first = WATCHING_CHANGES
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_insert_with(HashSet::new)
        .insert(label.clone());

    if !first {
        return Ok(());
    }

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(CHANGES_POLL);

            if app.get_webview_window(&label).is_none() {
                break;
            }

            let baseline = app
                .state::<ScanBaselines>()
                .with(&label, |state| state.current.clone())
                .ok()
                .flatten();
            let Some(baseline) = baseline else {
                continue;
            };
            let found = changes::compare(&folder, &baseline);
            let publish = app
                .state::<ScanBaselines>()
                .with(&label, |state| {
                    let unchanged = state.current.is_none() || state.last == found;

                    if !unchanged {
                        state.last = found.clone();
                    }

                    !unchanged
                })
                .unwrap_or(false);

            if publish && app.emit_to(&label, "changes-changed", &found).is_err() {
                break;
            }
        }

        if let Ok(mut watching) = WATCHING_CHANGES.lock() {
            if let Some(set) = watching.as_mut() {
                set.remove(&label);
            }
        }

        if let Ok(mut windows) = app.state::<ScanBaselines>().0.lock() {
            windows.remove(&label);
        }
    });

    Ok(())
}

fn window_folder_path(app: &AppHandle, window: &WebviewWindow) -> Result<PathBuf, String> {
    app.state::<WindowState>()
        .folder_of(&window_label(window))
        .ok_or_else(|| "this window holds no folder".to_string())
}

static WATCHING: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static WATCHING_CHANGES: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static WATCHING_RESPONSIBILITIES: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[tauri::command]
fn read_responsibilities(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<responsibilities::ResponsibilityFiles, String> {
    Ok(responsibilities::read_responsibilities(
        &window_folder_path(&app, &window)?,
    ))
}

#[tauri::command]
async fn describe_module(
    app: AppHandle,
    window: WebviewWindow,
    module: String,
) -> Result<responsibilities::DescribeResult, String> {
    let folder = window_folder_path(&app, &window)?;
    let config_file = config_file(&app)?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        responsibilities::describe(&folder, &module, &shell, &config_file)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn watch_responsibilities(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);

    let first = WATCHING_RESPONSIBILITIES
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_insert_with(HashSet::new)
        .insert(label.clone());

    if !first {
        return Ok(());
    }

    std::thread::spawn(move || {
        let mut last = responsibilities::snapshot(&folder);

        loop {
            std::thread::sleep(Duration::from_millis(500));

            if app.get_webview_window(&label).is_none() {
                break;
            }

            let next = responsibilities::snapshot(&folder);

            if responsibilities::snapshot_changed(&last, &next) {
                last = next;

                if app.emit_to(&label, "responsibilities-changed", ()).is_err() {
                    break;
                }
            }
        }

        if let Ok(mut watching) = WATCHING_RESPONSIBILITIES.lock() {
            if let Some(set) = watching.as_mut() {
                set.remove(&label);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn list_views(app: AppHandle, window: WebviewWindow) -> Result<views::ViewList, String> {
    Ok(views::list_views(&window_folder_path(&app, &window)?))
}

#[tauri::command]
fn write_view(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
    text: String,
) -> Result<(), String> {
    views::write_view(&window_folder_path(&app, &window)?, &name, &text)
}

#[tauri::command]
fn rename_view(
    app: AppHandle,
    window: WebviewWindow,
    from: String,
    to: String,
) -> Result<(), String> {
    views::rename_view(&window_folder_path(&app, &window)?, &from, &to)
}

#[tauri::command]
fn write_current_view(app: AppHandle, window: WebviewWindow, text: String) -> Result<(), String> {
    views::write_current_view(&window_folder_path(&app, &window)?, &text)
}

#[tauri::command]
fn view_path(app: AppHandle, window: WebviewWindow, name: String) -> Result<String, String> {
    views::view_path(&window_folder_path(&app, &window)?, &name)
}

#[tauri::command]
async fn renames_since(
    app: AppHandle,
    window: WebviewWindow,
    commit: String,
) -> Result<Vec<views::Rename>, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || views::renames_since(&folder, &commit))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn scans_at(
    app: AppHandle,
    window: WebviewWindow,
    commit: String,
) -> Result<Option<Vec<repository::ScanFile>>, String> {
    let folder = window_folder_path(&app, &window)?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        views::scans_at(
            &folder,
            &commit,
            &shell,
            &repository::config_file_in(&config_dir),
        )
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn watch_views(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);

    let first = WATCHING
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_insert_with(HashSet::new)
        .insert(label.clone());

    if !first {
        return Ok(());
    }

    std::thread::spawn(move || {
        let mut last = views::snapshot(&folder);

        loop {
            std::thread::sleep(Duration::from_millis(500));

            if app.get_webview_window(&label).is_none() {
                break;
            }

            let next = views::snapshot(&folder);

            if views::snapshot_changed(&last, &next) {
                last = next;

                if app.emit_to(&label, "views-changed", ()).is_err() {
                    break;
                }
            }
        }

        if let Ok(mut watching) = WATCHING.lock() {
            if let Some(set) = watching.as_mut() {
                set.remove(&label);
            }
        }
    });

    Ok(())
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
            app.manage(ScanBaselines::default());
            app.set_menu(build_menu(&handle)?)?;
            open_folder(&handle, initial.as_deref())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            adopt_scan,
            choose_folder,
            describe_module,
            list_views,
            open_folder_in_editor,
            open_in_editor,
            read_responsibilities,
            read_settings,
            read_source_line,
            rename_view,
            renames_since,
            scan_folder,
            scans_at,
            view_path,
            watch_changes,
            watch_responsibilities,
            watch_views,
            window_folder,
            write_current_view,
            write_settings,
            write_view
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
