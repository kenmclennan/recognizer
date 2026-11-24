use tauri::menu::{Menu, MenuEvent, MenuItem, Submenu, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub mod changes;
pub mod commits;
pub mod config_write;
pub mod core_client;
pub mod editor;
pub mod fs_safe;
mod launch;
pub mod link;
pub mod overlays;
pub mod recent;
pub mod repository;
pub mod responsibilities;
pub mod scan_run;
pub mod scan_ticks;
pub mod sensors;
pub mod settings;
pub mod shutdown;
pub mod socket;
pub mod tool_runner;
pub mod views;
pub mod windows;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use changes::{Baseline, Changes, Origin, ScanOrigin};
use core_client::{Baselines, CoreClient, Sink};
use launch::{launch_for, Launch};
use recent::{open_target, OpenTarget};
use repository::ScanReport;
use socket::{Drives, Entry, Snapshots};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use windows::{
    canonical_folder, cascade_from, keeps_running, label_number, menu_target, pick_window,
    quit_question, Claim, Route, WindowState, CANCEL, CLOSE_QUESTION, STOP_AND_CLOSE,
    STOP_AND_QUIT,
};

const APP_TITLE: &str = "Recognizer";
const RECENT_PREFIX: &str = "recent:";
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

fn title_for(folder: Option<PathBuf>) -> String {
    folder
        .map(|folder| folder_title(&folder))
        .unwrap_or_else(|| APP_TITLE.to_string())
}

fn focus_label(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn deliver_view(app: &AppHandle, label: &str, view: Option<&str>) {
    if let Some(view) = view {
        app.state::<WindowState>().set_pending_view(label, view);

        let _ = app.emit_to(label, "view-link", ());
    }
}

fn open_folder(app: &AppHandle, folder: Option<&Path>, view: Option<&str>) -> Result<(), String> {
    let state = app.state::<WindowState>();
    let label = state.next_label();

    let Some(folder) = folder else {
        return open_window(app, &label, APP_TITLE)
            .map(|_| ())
            .map_err(|error| error.to_string());
    };

    let canonical = canonical_folder(folder)?;

    remember(app, &canonical);

    if let Claim::HeldBy(other) = state.claim(&label, &canonical) {
        state.closed(&label);
        focus_label(app, &other);
        deliver_view(app, &other, view);

        return Ok(());
    }

    if let Some(view) = view {
        state.set_pending_view(&label, view);
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
        if let Err(error) = open_folder(&app, folder.as_deref(), None) {
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
        return open_folder(app, Some(&canonical), None);
    }

    remember(app, &canonical);

    match state.claim(label, &canonical) {
        Claim::HeldBy(other) => focus_label(app, &other),
        Claim::Assigned => {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.set_title(&title_for(state.folder_of(label)));
            }

            let _ = app.emit_to(label, "folder-assigned", ());
        }
    }

    Ok(())
}

fn open_chosen(app: &AppHandle, folder: &Path) -> Result<(), String> {
    let focused = focused_label(app);
    let has_folder = focused
        .as_deref()
        .map(|label| app.state::<WindowState>().folder_of(label).is_some())
        .unwrap_or(false);

    match open_target(focused.as_deref(), has_folder) {
        OpenTarget::AssignTo(label) => take_folder(app, &label, folder),
        OpenTarget::NewWindow => open_folder(app, Some(folder), None),
    }
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

fn focused_target(app: &AppHandle) -> OpenTarget {
    let focused = focused_label(app);
    let has_folder = focused
        .as_deref()
        .map(|label| app.state::<WindowState>().folder_of(label).is_some())
        .unwrap_or(false);

    open_target(focused.as_deref(), has_folder)
}

fn choose_and_open(app: &AppHandle) {
    let picked = match focused_target(app) {
        OpenTarget::NewWindow => rfd::FileDialog::new().pick_folder(),
        OpenTarget::AssignTo(label) => {
            let dialog = app.dialog().file();
            let dialog = match app.get_webview_window(&label) {
                Some(window) => dialog.set_parent(&window),
                None => dialog,
            };

            match dialog
                .blocking_pick_folder()
                .map(|chosen| chosen.into_path())
            {
                Some(Ok(path)) => Some(path),
                Some(Err(error)) => {
                    eprintln!("recognizer: could not open the folder: {error}");

                    None
                }
                None => None,
            }
        }
    };

    if let Some(path) = picked {
        if let Err(error) = open_chosen(app, &path) {
            eprintln!("recognizer: could not open the folder: {error}");
        }
    }
}

static RECENT_LOCK: Mutex<()> = Mutex::new(());

fn recent_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| recent::recent_file_in(&dir))
        .map_err(|error| error.to_string())
}

fn ticks_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| scan_ticks::ticks_file_in(&dir))
        .map_err(|error| error.to_string())
}

fn update_recent(app: &AppHandle, change: impl FnOnce(&Path) -> Result<Vec<PathBuf>, String>) {
    let result = {
        let _guard = RECENT_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        recent_file(app).and_then(|file| change(&file))
    };

    if let Err(error) = result {
        eprintln!("recognizer: could not save the recent folders: {error}");

        return;
    }

    rebuild_menu(app);
}

fn remember(app: &AppHandle, folder: &Path) {
    update_recent(app, |file| recent::record(file, folder));
}

fn rebuild_menu(app: &AppHandle) {
    let handle = app.clone();

    let _ = app.run_on_main_thread(move || match build_menu(&handle) {
        Ok(menu) => {
            let _ = handle.set_menu(menu);
        }
        Err(error) => eprintln!("recognizer: could not rebuild the menu: {error}"),
    });
}

fn open_recent(app: &AppHandle, folder: &Path) {
    match canonical_folder(folder) {
        Ok(_) => {
            if let Err(error) = open_chosen(app, folder) {
                eprintln!("recognizer: could not open the folder: {error}");
            }
        }
        Err(message) => {
            update_recent(app, |file| recent::forget(file, folder));
            refuse(app, &message);
        }
    }
}

fn clear_recent(app: &AppHandle) {
    update_recent(app, |file| {
        recent::write(file, &[])?;

        Ok(Vec::new())
    });
}

fn recent_submenu(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let list = recent_file(app)
        .map(|file| recent::read(&file))
        .unwrap_or_default();
    let mut builder = SubmenuBuilder::new(app, "Open Recent");

    for (folder, label) in list.iter().zip(recent::labels(&list)) {
        let id = format!("{RECENT_PREFIX}{}", folder.to_string_lossy());
        let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;

        builder = builder.item(&item);
    }

    let clear = MenuItem::with_id(
        app,
        "recent-clear",
        "Clear Menu",
        !list.is_empty(),
        None::<&str>,
    )?;

    builder.separator().item(&clear).build()
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

struct AppSource {
    app: AppHandle,
}

impl socket::Source for AppSource {
    fn entries(&self) -> Vec<Entry> {
        let windows = self.app.state::<WindowState>();
        let snapshots = self.app.state::<Snapshots>();

        windows
            .folders()
            .into_iter()
            .map(|(label, folder)| Entry {
                state: snapshots.get(&label),
                label,
                folder,
            })
            .collect()
    }

    fn drive(&self, label: &str, request: serde_json::Value) -> Result<serde_json::Value, String> {
        let drives = self.app.state::<Drives>();
        let (number, receiver) = drives.register(label);
        let mut payload = request;

        payload["request"] = serde_json::json!(number);

        if let Err(error) = self.app.emit_to(label, "window-drive", payload) {
            drives.closed(label);

            return Err(format!("{label} could not be reached: {error}"));
        }

        drives.wait(label, number, &receiver, socket::DRIVE_WAIT)
    }
}

fn start_signal_listener(app: &AppHandle) {
    let handle = app.clone();

    let listening = shutdown::listen(move || {
        let state = handle.state::<WindowState>();
        let core = handle.state::<CoreClient>();

        shutdown::stop_for_signal(
            core.runs(),
            core.setups(),
            || core.shutdown(&state.folder_paths()),
            || state.confirm_quit(),
            || handle.exit(0),
        );
    });

    if let Err(error) = listening {
        eprintln!("recognizer: signal handling is not available: {error}");
    }
}

fn start_socket(app: &AppHandle) -> Option<socket::Server> {
    let started = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())
        .and_then(|dir| {
            socket::socket_path(&dir, std::env::var(socket::SOCKET_ENV).ok().as_deref())
        })
        .and_then(|path| socket::Server::start(&path, Arc::new(AppSource { app: app.clone() })));

    match started {
        Ok(server) => Some(server),
        Err(error) => {
            eprintln!("recognizer: the app socket is not available: {error}");

            None
        }
    }
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| repository::config_file_in(&dir))
        .map_err(|error| error.to_string())
}

fn launch_in_editor(app: &AppHandle, target: &Path, line: Option<u32>) -> Result<(), String> {
    let editor = settings::read(&config_file(app)?)?.editor;

    editor::launch(&editor, target, line)
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
        Launch::Link { .. } => {}
        _ => focus_latest(app),
    }
}

fn refuse_link(app: &AppHandle, message: &str) {
    eprintln!("recognizer: link refused: {message}");

    refuse(app, &format!("The link was refused: {message}"));
}

fn refuse(app: &AppHandle, message: &str) {
    let message = message.to_string();
    let shown = app.clone();

    app.state::<WindowState>().dialog_opened();

    let scheduled = app.run_on_main_thread(move || {
        let closed = shown.clone();

        shown
            .dialog()
            .message(message)
            .title(APP_TITLE)
            .kind(MessageDialogKind::Error)
            .show(move |_| link_dialog_closed(&closed));
    });

    if scheduled.is_err() {
        link_dialog_closed(app);
    }
}

fn link_dialog_closed(app: &AppHandle) {
    app.state::<WindowState>().dialog_closed();

    let documents = app
        .webview_windows()
        .into_keys()
        .any(|label| label_number(&label) > 0);

    if !documents && !cfg!(target_os = "macos") {
        app.exit(0);
    }
}

fn route_link(app: &AppHandle, url: &str) -> Result<(), String> {
    let link = link::parse(url)?;
    let folder = link::validate(&link)?;

    match app.state::<WindowState>().route(&folder) {
        Route::Existing(label) => {
            remember(app, &folder);
            focus_label(app, &label);
            deliver_view(app, &label, link.view.as_deref());

            Ok(())
        }
        Route::New => open_folder(app, Some(&folder), link.view.as_deref()),
    }
}

fn handle_link(app: &AppHandle, url: &str) {
    let app = app.clone();
    let url = url.to_string();

    std::thread::spawn(move || {
        if let Err(message) = route_link(&app, &url) {
            refuse_link(&app, &message);
        }
    });
}

fn handle_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "new-window" => spawn_open_window(app),
        "open-folder" => match focused_target(app) {
            OpenTarget::NewWindow => choose_and_open(app),
            OpenTarget::AssignTo(_) => {
                let app = app.clone();

                std::thread::spawn(move || choose_and_open(&app));
            }
        },
        "recent-clear" => {
            let app = app.clone();

            std::thread::spawn(move || clear_recent(&app));
        }
        id if id.starts_with(RECENT_PREFIX) => {
            let folder = PathBuf::from(&id[RECENT_PREFIX.len()..]);
            let app = app.clone();

            std::thread::spawn(move || open_recent(&app, &folder));
        }
        "rescan" => {
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, "rescan", ());
            }
        }
        "settings" => {
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, "open-settings", ());
            }
        }
        "open-in-editor" => {
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, "open-in-editor", ());
            }
        }
        "open-folder-in-editor" => {
            let folder =
                focused_label(app).and_then(|label| app.state::<WindowState>().folder_of(&label));

            if let Some(folder) = folder {
                if let Err(error) = launch_in_editor(app, &folder, None) {
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
        WindowEvent::CloseRequested { api, .. } => {
            if window
                .app_handle()
                .state::<CoreClient>()
                .in_progress(window.label())
            {
                api.prevent_close();
                ask_to_close(window);
            }
        }
        WindowEvent::Destroyed => {
            state.closed(window.label());
            window
                .app_handle()
                .state::<Snapshots>()
                .closed(window.label());
            window.app_handle().state::<Drives>().closed(window.label());
            window
                .app_handle()
                .state::<CoreClient>()
                .window_closed(window.label());
        }
        _ => {}
    }
}

fn ask_to_close(window: &tauri::Window) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let state = app.state::<WindowState>();

    if !state.begin_asking(&label) {
        return;
    }

    state.dialog_opened();

    let asked = window.clone();
    let scheduled = app.run_on_main_thread({
        let app = app.clone();

        move || {
            let answered = asked.clone();

            app.dialog()
                .message(CLOSE_QUESTION)
                .title(APP_TITLE)
                .kind(MessageDialogKind::Warning)
                .parent(&asked)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    STOP_AND_CLOSE.to_string(),
                    CANCEL.to_string(),
                ))
                .show(move |stop| {
                    let app = answered.app_handle().clone();

                    app.state::<WindowState>().end_asking(answered.label());
                    app.state::<WindowState>().dialog_closed();

                    if stop {
                        app.state::<CoreClient>().stop_window(answered.label());
                        let _ = answered.destroy();
                    }
                });
        }
    });

    if scheduled.is_err() {
        state.end_asking(&label);
        state.dialog_closed();
    }
}

fn ask_to_quit(app: &AppHandle, count: usize) {
    let state = app.state::<WindowState>();

    if !state.begin_quit_question() {
        return;
    }

    state.dialog_opened();

    let scheduled = app.run_on_main_thread({
        let app = app.clone();

        move || {
            let answered = app.clone();

            app.dialog()
                .message(quit_question(count))
                .title(APP_TITLE)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    STOP_AND_QUIT.to_string(),
                    CANCEL.to_string(),
                ))
                .show(move |stop| {
                    let state = answered.state::<WindowState>();

                    state.end_quit_question();
                    state.dialog_closed();

                    if stop {
                        let core = answered.state::<CoreClient>();

                        shutdown::stop_for_signal(
                            core.runs(),
                            core.setups(),
                            || core.shutdown(&state.folder_paths()),
                            || state.confirm_quit(),
                            || answered.exit(0),
                        );
                    }
                });
        }
    });

    if scheduled.is_err() {
        state.end_quit_question();
        state.dialog_closed();
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
    let recent = recent_submenu(app)?;
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
    let application = SubmenuBuilder::new(app, APP_TITLE)
        .about(None)
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
        .item(&recent)
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
async fn shipped_sensors() -> Result<repository::ShippedSensors, String> {
    tauri::async_runtime::spawn_blocking(repository::shipped_sensors)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn read_config_keys() -> Result<config_write::ConfigKeys, String> {
    tauri::async_runtime::spawn_blocking(config_write::read_config_keys)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn write_repository_config(
    app: AppHandle,
    window: WebviewWindow,
    edits: Vec<config_write::Edit>,
    base_hash: String,
) -> Result<config_write::ConfigWrite, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || {
        config_write::write_repository_config(&folder, &edits, &base_hash)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn shipped_describer(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<repository::ShippedDescriber, String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);
    let core = app.state::<CoreClient>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        repository::shipped_describer(&core, &label, &folder)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn core_call(
    app: AppHandle,
    window: WebviewWindow,
    op: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let folder = app.state::<WindowState>().folder_of(&window_label(&window));
    let label = window_label(&window);
    let core = app.state::<CoreClient>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || core.call(&label, folder.as_deref(), &op, args))
        .await
        .map_err(|error| error.to_string())?
}

struct WindowSink(AppHandle);

impl Sink for WindowSink {
    fn emit(&self, label: &str, item: &serde_json::Value) {
        let mut stamped = item.clone();

        if let Some(map) = stamped.as_object_mut() {
            map.insert("window".to_string(), serde_json::json!(label));
        }

        let _ = self.0.emit_to(label, core_client::SERVICE_EVENT, stamped);
    }
}

struct WindowBaselines(AppHandle);

impl Baselines for WindowBaselines {
    fn take(&self, label: &str, repository: &str) {
        let origin = changes::take_origin(Path::new(repository));

        let _ = self
            .0
            .state::<ScanBaselines>()
            .with(label, |window| window.pending = Some(origin));
    }

    fn clear(&self, label: &str) {
        let _ = self
            .0
            .state::<ScanBaselines>()
            .with(label, |window| window.pending = None);
    }
}

fn setup_environment() -> serde_json::Value {
    let pairs: serde_json::Map<String, serde_json::Value> = tool_runner::runner()
        .environment_pairs()
        .into_iter()
        .map(|(name, value)| (name, serde_json::Value::String(value)))
        .collect();

    serde_json::Value::Object(pairs)
}

fn run_setup_action(
    app: AppHandle,
    window: &WebviewWindow,
    action: &'static str,
    event: &'static str,
    mut args: serde_json::Value,
) -> impl std::future::Future<Output = Result<serde_json::Value, String>> {
    let folder = window_folder_path(&app, window);
    let label = window_label(window);

    async move {
        let folder = folder?;

        args["environment"] = setup_environment();

        tauri::async_runtime::spawn_blocking(move || {
            let core = app.state::<CoreClient>();

            core.run_setup(&label, &folder, action, args, |line| {
                let _ = app.emit_to(label.as_str(), event, line);
            })
        })
        .await
        .map_err(|error| error.to_string())
    }
}

#[tauri::command]
async fn setup_survey(
    app: AppHandle,
    window: WebviewWindow,
    extract: bool,
) -> Result<serde_json::Value, String> {
    run_setup_action(
        app,
        &window,
        "survey",
        "setup-survey-event",
        serde_json::json!({ "extract": extract }),
    )
    .await
}

#[tauri::command]
async fn setup_recommend(
    app: AppHandle,
    window: WebviewWindow,
    prompt: String,
    schema: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let model = settings::read(&config_file(&app)?)?.setup.model;

    run_setup_action(
        app,
        &window,
        "recommend",
        "setup-run-line",
        serde_json::json!({ "model": model, "prompt": prompt, "schema": schema }),
    )
    .await
}

#[tauri::command]
async fn setup_apply(
    app: AppHandle,
    window: WebviewWindow,
    choices: serde_json::Value,
) -> Result<serde_json::Value, String> {
    run_setup_action(
        app,
        &window,
        "apply",
        "setup-run-event",
        serde_json::json!({ "choices": choices }),
    )
    .await
}

#[tauri::command]
async fn setup_try(
    app: AppHandle,
    window: WebviewWindow,
    choices: serde_json::Value,
) -> Result<serde_json::Value, String> {
    run_setup_action(
        app,
        &window,
        "try",
        "setup-run-event",
        serde_json::json!({ "choices": choices }),
    )
    .await
}

#[tauri::command]
fn stop_setup(app: AppHandle, window: WebviewWindow) {
    app.state::<CoreClient>().stop_setup(&window_label(&window));
}

#[tauri::command]
fn read_scan_cache(app: AppHandle, window: WebviewWindow) -> Result<ScanReport, String> {
    let folder = window_folder_path(&app, &window)?;

    Ok(repository::report_for(Some(0), String::new(), || {
        repository::read_cache(&folder)
    }))
}

#[tauri::command]
fn read_scan_ticks(app: AppHandle, window: WebviewWindow) -> Result<scan_ticks::ScanTicks, String> {
    let folder = window_folder_path(&app, &window)?;

    Ok(scan_ticks::read(&ticks_file(&app)?, &folder))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn write_scan_ticks(
    app: AppHandle,
    window: WebviewWindow,
    describe: bool,
    analysis: Option<bool>,
    ticked: Vec<String>,
    only_view: bool,
    suites: Option<std::collections::BTreeMap<String, scan_ticks::SuiteTicks>>,
    folds: Option<Vec<String>>,
) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;

    scan_ticks::write(
        &ticks_file(&app)?,
        &folder,
        scan_ticks::StoredTicks {
            describe,
            analysis: analysis.unwrap_or(true),
            measure: false,
            overlays: Vec::new(),
            sensors: None,
            ticked,
            only_view,
            suites: suites.unwrap_or_default(),
            folds: folds.unwrap_or_default(),
        },
    )
}

#[tauri::command]
fn read_settings(app: AppHandle) -> Result<settings::Settings, String> {
    settings::read(&config_file(&app)?)
}

#[tauri::command]
fn write_settings(app: AppHandle, settings: settings::Settings) -> Result<(), String> {
    settings::save(&config_file(&app)?, &settings)?;

    let _ = app.emit("settings-changed", ());

    Ok(())
}

#[tauri::command]
fn read_describing(app: AppHandle) -> Result<settings::Describing, String> {
    Ok(settings::read(&config_file(&app)?)?.describing)
}

#[tauri::command]
fn open_in_editor(
    app: AppHandle,
    window: WebviewWindow,
    relative: String,
    line: Option<u32>,
) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let target = fs_safe::checked_relative_entry(&folder, &relative)?;

    launch_in_editor(&app, &target, line)
}

#[tauri::command]
fn open_folder_in_editor(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;

    launch_in_editor(&app, &folder, None)
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
static WATCHING_SENSOR_INPUTS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
static WATCHING_GIT: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
static GIT_GENERATION: AtomicU64 = AtomicU64::new(0);

fn git_watch_continues(held: u64, stored: Option<u64>) -> bool {
    stored == Some(held)
}

#[tauri::command]
fn watch_git(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);
    let held = GIT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    WATCHING_GIT
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_insert_with(HashMap::new)
        .insert(label.clone(), held);

    std::thread::spawn(move || {
        let mut settle = commits::Settle::new(commits::git_state_snapshot(&folder));

        loop {
            std::thread::sleep(Duration::from_millis(500));

            let stored = WATCHING_GIT
                .lock()
                .ok()
                .and_then(|watching| watching.as_ref().and_then(|map| map.get(&label).copied()));

            if !git_watch_continues(held, stored) || app.get_webview_window(&label).is_none() {
                break;
            }

            if settle.poll(commits::git_state_snapshot(&folder))
                && app.emit_to(&label, "git-changed", ()).is_err()
            {
                break;
            }
        }

        if let Ok(mut watching) = WATCHING_GIT.lock() {
            if let Some(map) = watching.as_mut() {
                if map.get(&label) == Some(&held) {
                    map.remove(&label);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn unwatch_git(window: WebviewWindow) -> Result<(), String> {
    if let Some(map) = WATCHING_GIT
        .lock()
        .map_err(|error| error.to_string())?
        .as_mut()
    {
        map.remove(&window_label(&window));
    }

    Ok(())
}

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
fn read_findings(app: AppHandle, window: WebviewWindow) -> Result<sensors::FindingsRead, String> {
    Ok(sensors::read_findings(&window_folder_path(&app, &window)?))
}

#[tauri::command]
fn read_run_records(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<sensors::RunRecordsRead, String> {
    Ok(sensors::read_run_records(&window_folder_path(
        &app, &window,
    )?))
}

#[tauri::command]
fn read_overlays(app: AppHandle, window: WebviewWindow) -> Result<overlays::OverlaysRead, String> {
    Ok(overlays::read_overlays(&window_folder_path(&app, &window)?))
}

#[tauri::command]
fn remove_findings(
    app: AppHandle,
    window: WebviewWindow,
    names: Vec<String>,
) -> Result<(), String> {
    sensors::remove_findings(&window_folder_path(&app, &window)?, &names)
}

#[tauri::command]
fn read_sensor_inputs(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<sensors::SensorInputs, String> {
    let folder = window_folder_path(&app, &window)?;
    let mut inputs = sensors::read_inputs(&folder);

    inputs.analysis = scan_ticks::read(&ticks_file(&app)?, &folder).analysis;

    Ok(inputs)
}

#[tauri::command]
fn watch_sensor_inputs(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let folder = window_folder_path(&app, &window)?;
    let label = window_label(&window);

    let first = WATCHING_SENSOR_INPUTS
        .lock()
        .map_err(|error| error.to_string())?
        .get_or_insert_with(HashSet::new)
        .insert(label.clone());

    if !first {
        return Ok(());
    }

    std::thread::spawn(move || {
        let mut last = sensors::snapshot(&folder);

        loop {
            std::thread::sleep(Duration::from_millis(500));

            if app.get_webview_window(&label).is_none() {
                break;
            }

            let next = sensors::snapshot(&folder);

            if sensors::snapshot_changed(&last, &next) {
                last = next;

                if app.emit_to(&label, "sensor-inputs-changed", ()).is_err() {
                    break;
                }
            }
        }

        if let Ok(mut watching) = WATCHING_SENSOR_INPUTS.lock() {
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

fn recent_views_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| recent::recent_views_file_in(&dir))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_view(app: AppHandle, window: WebviewWindow, name: String) -> Result<(), String> {
    views::remove_view(&window_folder_path(&app, &window)?, &name)
}

#[tauri::command]
fn read_recent_views(app: AppHandle, window: WebviewWindow) -> Result<Vec<String>, String> {
    Ok(recent::read_recent_views(
        &recent_views_file(&app)?,
        &window_folder_path(&app, &window)?,
    ))
}

#[tauri::command]
fn record_recent_view(app: AppHandle, window: WebviewWindow, name: String) -> Result<(), String> {
    recent::record_recent_view(
        &recent_views_file(&app)?,
        &window_folder_path(&app, &window)?,
        &name,
    )
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
fn publish_window_state(
    app: AppHandle,
    window: WebviewWindow,
    state: serde_json::Value,
) -> Result<(), String> {
    app.state::<Snapshots>()
        .publish(&window_label(&window), state)
}

#[tauri::command]
fn answer_window_drive(
    app: AppHandle,
    request: u64,
    answer: serde_json::Value,
) -> Result<(), String> {
    app.state::<Drives>().answer(request, &answer)
}

#[tauri::command]
fn view_link(app: AppHandle, window: WebviewWindow, name: String) -> Result<String, String> {
    views::view_link(&window_folder_path(&app, &window)?, &name)
}

#[tauri::command]
fn take_pending_view(app: AppHandle, window: WebviewWindow) -> Option<String> {
    app.state::<WindowState>()
        .take_pending_view(&window_label(&window))
}

#[tauri::command]
async fn list_history(app: AppHandle, window: WebviewWindow) -> Result<commits::History, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || commits::list_history(&folder))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_branches(app: AppHandle, window: WebviewWindow) -> Result<commits::Branches, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || commits::list_branches(&folder))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn ref_facts(
    app: AppHandle,
    window: WebviewWindow,
    refs: Vec<String>,
) -> Result<Vec<commits::RefFacts>, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || commits::ref_facts(&folder, &refs))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn change_detail(
    app: AppHandle,
    window: WebviewWindow,
    kind: String,
    reference: String,
) -> Result<commits::ChangeDetail, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || {
        commits::change_detail(tool_runner::runner(), &folder, &kind, &reference)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_pull_requests(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<commits::PullRequests, String> {
    let folder = window_folder_path(&app, &window)?;

    tauri::async_runtime::spawn_blocking(move || {
        commits::read_pull_requests(tool_runner::runner(), &folder)
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

    let (initial, initial_link) = match launch_for(std::env::args().skip(1), &cwd) {
        Launch::Window { folder } => (folder, None),
        Launch::Link { url } => (None, Some(url)),
        Launch::Refuse { text } => {
            eprintln!("{text}");

            std::process::exit(2);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            handle_second_launch(app, args, cwd)
        }))
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(handle_menu)
        .on_window_event(handle_window_event)
        .setup(move |app| {
            let handle = app.handle().clone();

            settings::seed(&config_file(&handle)?)?;
            app.manage(WindowState::default());
            app.manage(ScanBaselines::default());
            app.manage(CoreClient::new(
                core_client::runner_launcher(tool_runner::runner(), repository::RECOGNIZER_COMMAND),
                Arc::new(WindowSink(handle.clone())),
                Arc::new(WindowBaselines(handle.clone())),
            ));
            app.manage(Snapshots::default());
            app.manage(Drives::default());
            app.manage(Mutex::new(start_socket(&handle)));
            start_signal_listener(&handle);
            app.set_menu(build_menu(&handle)?)?;

            let opened_with = app
                .deep_link()
                .get_current()
                .ok()
                .flatten()
                .and_then(|urls| urls.first().map(|url| url.to_string()))
                .or(initial_link);

            match opened_with {
                Some(url) => handle_link(&handle, &url),
                None => open_folder(&handle, initial.as_deref(), None)?,
            }

            let for_links = handle.clone();

            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_link(&for_links, url.as_str());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            adopt_scan,
            core_call,
            answer_window_drive,
            choose_folder,
            list_views,
            open_folder_in_editor,
            open_in_editor,
            publish_window_state,
            read_findings,
            read_run_records,
            read_overlays,
            read_responsibilities,
            read_sensor_inputs,
            read_describing,
            read_config_keys,
            read_settings,
            record_recent_view,
            remove_findings,
            shipped_sensors,
            shipped_describer,
            remove_view,
            rename_view,
            read_recent_views,
            read_scan_cache,
            read_scan_ticks,
            list_history,
            list_branches,
            ref_facts,
            change_detail,
            read_pull_requests,
            setup_survey,
            setup_recommend,
            setup_apply,
            setup_try,
            stop_setup,
            take_pending_view,
            unwatch_git,
            view_link,
            watch_changes,
            watch_git,
            watch_responsibilities,
            watch_sensor_inputs,
            watch_views,
            window_folder,
            write_repository_config,
            write_scan_ticks,
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
            RunEvent::ExitRequested { code, api, .. } => {
                let running = app.state::<CoreClient>().in_progress_labels().len()
                    + app.state::<CoreClient>().setups_running();

                if running > 0 && !app.state::<WindowState>().quit_confirmed() {
                    api.prevent_exit();
                    ask_to_quit(app, running);

                    return;
                }

                if keeps_running(
                    code,
                    app.state::<WindowState>().dialogs_open(),
                    cfg!(target_os = "macos"),
                ) {
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => {
                if let Some(server) = app
                    .state::<Mutex<Option<socket::Server>>>()
                    .lock()
                    .unwrap()
                    .as_mut()
                {
                    server.shutdown();
                }
            }
            _ => {
                let _ = app;
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{folder_title, git_watch_continues, title_for, APP_TITLE};
    use crate::windows::WindowState;
    use tempfile::TempDir;

    fn read(relative: &str) -> String {
        std::fs::read_to_string(format!("{}/{relative}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    #[test]
    fn every_setup_command_is_registered_permitted_and_listed() {
        let build = read("build.rs");
        let app = read("permissions/app.toml");
        let lib = read("src/lib.rs");

        for name in [
            "setup_survey",
            "setup_recommend",
            "setup_apply",
            "setup_try",
            "stop_setup",
        ] {
            let allow = format!("allow-{}", name.replace('_', "-"));

            assert!(build.contains(&format!("\"{name}\"")), "build.rs {name}");
            assert!(app.contains(&format!("\"{allow}\"")), "app.toml {allow}");
            assert!(lib.contains(&format!("{name},")), "lib.rs {name}");
            assert!(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("permissions/autogenerated/{name}.toml"))
                    .exists(),
                "permission file {name}"
            );
        }

        for gone in ["read_doctor", "run_setup_check", "apply_setup"] {
            let hyphenated = gone.replace('_', "-");

            assert!(!build.contains(gone), "build.rs {gone}");
            assert!(!app.contains(&hyphenated), "app.toml {gone}");
            assert!(!lib.contains(&format!("{gone},")), "lib.rs {gone}");
            assert!(
                !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("permissions/autogenerated/{gone}.toml"))
                    .exists(),
                "permission file {gone}"
            );
        }
    }

    #[test]
    fn a_watch_continues_while_its_generation_is_the_stored_one() {
        assert!(git_watch_continues(1, Some(1)));
    }

    #[test]
    fn a_watch_stops_when_a_newer_generation_replaced_it() {
        assert!(!git_watch_continues(1, Some(2)));
    }

    #[test]
    fn a_watch_stops_once_unwatch_removed_its_generation() {
        assert!(!git_watch_continues(1, None));
    }

    #[test]
    fn a_window_with_no_folder_is_titled_with_the_app_name() {
        assert_eq!(title_for(None), APP_TITLE);
    }

    #[test]
    fn a_claimed_window_is_titled_with_its_own_folder() {
        let dir = TempDir::new().unwrap();
        let state = WindowState::default();

        state.claim("w-1", dir.path());

        let folder = state.folder_of("w-1").unwrap();

        assert_eq!(title_for(Some(folder.clone())), folder_title(&folder));
        assert_ne!(title_for(Some(folder)), APP_TITLE);
    }

    #[test]
    fn a_second_claim_leaves_the_first_windows_title_unchanged() {
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        let state = WindowState::default();

        state.claim("w-1", first.path());

        let before = title_for(state.folder_of("w-1"));

        state.claim("w-2", second.path());

        assert_eq!(title_for(state.folder_of("w-1")), before);
        assert_eq!(
            title_for(state.folder_of("w-2")),
            folder_title(&state.folder_of("w-2").unwrap())
        );
        assert_ne!(before, title_for(state.folder_of("w-2")));
    }
}
