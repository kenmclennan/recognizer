use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

pub fn label_for(number: u64) -> String {
    format!("w-{number}")
}

pub fn label_number(label: &str) -> u64 {
    label
        .strip_prefix("w-")
        .and_then(|number| number.parse().ok())
        .unwrap_or(0)
}

pub fn pick_window(focus_order: &[String], open: &[String]) -> Option<String> {
    focus_order
        .iter()
        .rev()
        .find(|label| open.contains(label))
        .or_else(|| open.iter().max_by_key(|label| label_number(label)))
        .cloned()
}

pub fn menu_target(
    focused: Option<&str>,
    focus_order: &[String],
    open: &[String],
) -> Option<String> {
    let documents: Vec<String> = open
        .iter()
        .filter(|label| label_number(label) > 0)
        .cloned()
        .collect();

    focused
        .filter(|label| documents.iter().any(|candidate| candidate == label))
        .map(str::to_string)
        .or_else(|| pick_window(focus_order, &documents))
}

const CASCADE_OFFSET: f64 = 28.0;

pub fn cascade_from((x, y): (f64, f64)) -> (f64, f64) {
    (x + CASCADE_OFFSET, y + CASCADE_OFFSET)
}

#[derive(Debug, PartialEq)]
pub enum Claim {
    Assigned,
    HeldBy(String),
}

pub fn canonical_folder(folder: &Path) -> Result<PathBuf, String> {
    let canonical =
        std::fs::canonicalize(folder).map_err(|error| format!("{}: {error}", folder.display()))?;

    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(format!("{} is not a folder", folder.display()))
    }
}

#[derive(Debug, PartialEq)]
pub enum Route {
    Existing(String),
    New,
}

pub fn route_for(folders: &HashMap<String, PathBuf>, canonical: &Path) -> Route {
    folders
        .iter()
        .filter(|(_, held)| held.as_path() == canonical)
        .map(|(label, _)| label.clone())
        .min_by_key(|label| label_number(label))
        .map_or(Route::New, Route::Existing)
}

#[derive(Default)]
pub struct WindowState {
    counter: AtomicU64,
    open_dialogs: AtomicUsize,
    focus_order: Mutex<Vec<String>>,
    folders: Mutex<HashMap<String, PathBuf>>,
    pending_views: Mutex<HashMap<String, String>>,
}

impl WindowState {
    pub fn next_label(&self) -> String {
        let label = label_for(self.counter.fetch_add(1, Ordering::SeqCst) + 1);

        self.focused(&label);

        label
    }

    pub fn focused(&self, label: &str) {
        let mut order = self.focus_order.lock().unwrap();

        order.retain(|existing| existing != label);
        order.push(label.to_string());
    }

    pub fn closed(&self, label: &str) {
        self.focus_order
            .lock()
            .unwrap()
            .retain(|existing| existing != label);
        self.folders.lock().unwrap().remove(label);
        self.pending_views.lock().unwrap().remove(label);
    }

    pub fn claim(&self, label: &str, folder: &Path) -> Claim {
        let canonical = canonical_folder(folder).unwrap_or_else(|_| folder.to_path_buf());
        let mut folders = self.folders.lock().unwrap();

        if let Some((other, _)) = folders
            .iter()
            .find(|(held_by, held)| held_by.as_str() != label && **held == canonical)
        {
            return Claim::HeldBy(other.clone());
        }

        folders.insert(label.to_string(), canonical);

        Claim::Assigned
    }

    pub fn folder_of(&self, label: &str) -> Option<PathBuf> {
        self.folders.lock().unwrap().get(label).cloned()
    }

    pub fn dialog_opened(&self) {
        self.open_dialogs.fetch_add(1, Ordering::SeqCst);
    }

    pub fn dialog_closed(&self) {
        self.open_dialogs.fetch_sub(1, Ordering::SeqCst);
    }

    pub fn dialogs_open(&self) -> bool {
        self.open_dialogs.load(Ordering::SeqCst) > 0
    }

    pub fn route(&self, canonical: &Path) -> Route {
        route_for(&self.folders.lock().unwrap(), canonical)
    }

    pub fn set_pending_view(&self, label: &str, view: &str) {
        self.pending_views
            .lock()
            .unwrap()
            .insert(label.to_string(), view.to_string());
    }

    pub fn take_pending_view(&self, label: &str) -> Option<String> {
        self.pending_views.lock().unwrap().remove(label)
    }

    pub fn folders(&self) -> Vec<(String, PathBuf)> {
        self.folders
            .lock()
            .unwrap()
            .iter()
            .map(|(label, folder)| (label.clone(), folder.clone()))
            .collect()
    }

    pub fn order(&self) -> Vec<String> {
        self.focus_order.lock().unwrap().clone()
    }
}

pub fn keeps_running(exit_code: Option<i32>, dialogs_open: bool, on_macos: bool) -> bool {
    exit_code.is_none() && (dialogs_open || on_macos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn a_refusal_dialog_keeps_the_app_running_until_it_is_dismissed() {
        let state = WindowState::default();

        assert!(!keeps_running(None, state.dialogs_open(), false));

        state.dialog_opened();

        assert!(keeps_running(None, state.dialogs_open(), false));

        state.dialog_closed();

        assert!(!keeps_running(None, state.dialogs_open(), false));
    }

    #[test]
    fn an_explicit_quit_is_never_prevented() {
        assert!(!keeps_running(Some(0), true, true));
    }

    #[test]
    fn macos_keeps_running_with_no_window() {
        assert!(keeps_running(None, false, true));
    }

    fn labels(list: &[&str]) -> Vec<String> {
        list.iter().map(|label| label.to_string()).collect()
    }

    #[test]
    fn next_label_counts_up_and_never_reuses_a_number() {
        let state = WindowState::default();

        assert_eq!(state.next_label(), "w-1");
        assert_eq!(state.next_label(), "w-2");

        state.closed("w-2");

        assert_eq!(state.next_label(), "w-3");
    }

    #[test]
    fn label_number_reads_window_labels_only() {
        assert_eq!(label_number("w-12"), 12);
        assert_eq!(label_number("main"), 0);
    }

    #[test]
    fn pick_window_prefers_the_last_focused_open_window() {
        let all = labels(&["w-1", "w-2", "w-3"]);

        assert_eq!(pick_window(&all, &all), Some("w-3".to_string()));
    }

    #[test]
    fn pick_window_skips_a_focused_window_that_has_closed() {
        assert_eq!(
            pick_window(&labels(&["w-1", "w-2"]), &labels(&["w-1"])),
            Some("w-1".to_string())
        );
    }

    #[test]
    fn pick_window_falls_back_to_the_highest_number() {
        assert_eq!(
            pick_window(&[], &labels(&["w-2", "w-4"])),
            Some("w-4".to_string())
        );
    }

    #[test]
    fn pick_window_handles_a_mix_of_open_and_closed_focus_entries() {
        assert_eq!(
            pick_window(
                &labels(&["w-3", "w-1", "w-2"]),
                &labels(&["w-1", "w-3", "w-5"])
            ),
            Some("w-1".to_string())
        );
    }

    #[test]
    fn pick_window_is_none_when_nothing_is_open() {
        assert_eq!(pick_window(&labels(&["w-1"]), &[]), None);
    }

    #[test]
    fn cascade_from_offsets_a_position_right_and_down_by_28() {
        assert_eq!(cascade_from((100.0, 60.0)), (128.0, 88.0));
    }

    #[test]
    fn next_label_records_the_new_window_as_most_recently_focused() {
        let state = WindowState::default();

        state.next_label();
        state.next_label();

        assert_eq!(state.order(), labels(&["w-1", "w-2"]));
    }

    #[test]
    fn focused_moves_an_existing_label_to_the_end() {
        let state = WindowState::default();

        state.focused("w-1");
        state.focused("w-2");
        state.focused("w-1");

        assert_eq!(state.order(), labels(&["w-2", "w-1"]));
    }

    #[test]
    fn a_folder_is_assigned_to_the_first_window_that_claims_it() {
        let dir = TempDir::new().unwrap();
        let state = WindowState::default();

        assert_eq!(state.claim("w-1", dir.path()), Claim::Assigned);
        assert_eq!(
            state.claim("w-2", dir.path()),
            Claim::HeldBy("w-1".to_string())
        );
        assert_eq!(
            state.folder_of("w-1"),
            Some(std::fs::canonicalize(dir.path()).unwrap())
        );
        assert_eq!(state.folder_of("w-2"), None);
    }

    #[test]
    fn the_holder_claiming_its_own_folder_again_is_assigned() {
        let dir = TempDir::new().unwrap();
        let state = WindowState::default();

        state.claim("w-1", dir.path());

        assert_eq!(state.claim("w-1", dir.path()), Claim::Assigned);
    }

    #[test]
    fn closing_a_window_releases_its_folder() {
        let dir = TempDir::new().unwrap();
        let state = WindowState::default();

        state.claim("w-1", dir.path());
        state.closed("w-1");

        assert_eq!(state.claim("w-2", dir.path()), Claim::Assigned);
    }

    #[test]
    fn a_trailing_slash_is_held_by_the_same_window() {
        let dir = TempDir::new().unwrap();
        let state = WindowState::default();
        let with_slash = PathBuf::from(format!("{}/", dir.path().display()));

        state.claim("w-1", dir.path());

        assert_eq!(
            state.claim("w-2", &with_slash),
            Claim::HeldBy("w-1".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_path_is_held_by_the_same_window() {
        let dir = TempDir::new().unwrap();
        let real = dir.path().join("real");
        let link = dir.path().join("link");

        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let state = WindowState::default();

        state.claim("w-1", &real);

        assert_eq!(state.claim("w-2", &link), Claim::HeldBy("w-1".to_string()));
    }

    #[test]
    fn canonical_folder_refuses_a_missing_path_and_a_file() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("a.txt");

        std::fs::write(&file, "x").unwrap();

        assert!(canonical_folder(&dir.path().join("missing")).is_err());
        assert!(canonical_folder(&file).is_err());
        assert!(canonical_folder(dir.path()).is_ok());
    }

    fn held(entries: &[(&str, &str)]) -> HashMap<String, PathBuf> {
        entries
            .iter()
            .map(|(label, folder)| (label.to_string(), PathBuf::from(folder)))
            .collect()
    }

    #[test]
    fn route_for_is_new_when_no_window_is_open() {
        assert_eq!(route_for(&HashMap::new(), Path::new("/a")), Route::New);
    }

    #[test]
    fn route_for_finds_the_window_holding_the_folder() {
        assert_eq!(
            route_for(&held(&[("w-1", "/b"), ("w-2", "/a")]), Path::new("/a")),
            Route::Existing("w-2".to_string())
        );
    }

    #[test]
    fn route_for_is_new_for_a_different_folder() {
        assert_eq!(
            route_for(&held(&[("w-1", "/b")]), Path::new("/a")),
            Route::New
        );
    }

    #[test]
    fn a_trailing_slash_or_symlink_routes_to_the_holder_through_canonical_folder() {
        let dir = TempDir::new().unwrap();
        let real = dir.path().join("real");
        let link = dir.path().join("link");

        std::fs::create_dir_all(&real).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &link).unwrap();
        #[cfg(not(unix))]
        std::fs::create_dir_all(&link).unwrap();

        let state = WindowState::default();

        state.claim("w-1", &real);

        let slash = PathBuf::from(format!("{}/", real.display()));

        assert_eq!(
            state.route(&canonical_folder(&slash).unwrap()),
            Route::Existing("w-1".to_string())
        );
        #[cfg(unix)]
        assert_eq!(
            state.route(&canonical_folder(&link).unwrap()),
            Route::Existing("w-1".to_string())
        );
    }

    #[test]
    fn routing_to_a_held_folder_allocates_no_label() {
        let dir = TempDir::new().unwrap();
        let state = WindowState::default();
        let label = state.next_label();

        state.claim(&label, dir.path());

        let canonical = canonical_folder(dir.path()).unwrap();

        assert_eq!(state.route(&canonical), Route::Existing(label));
        assert_eq!(state.next_label(), "w-2");
    }

    #[test]
    fn a_pending_view_is_stored_replaced_taken_once_and_dropped_on_close() {
        let state = WindowState::default();

        state.set_pending_view("w-1", "a");
        state.set_pending_view("w-1", "b");

        assert_eq!(state.take_pending_view("w-1"), Some("b".to_string()));
        assert_eq!(state.take_pending_view("w-1"), None);

        state.set_pending_view("w-2", "c");
        state.closed("w-2");

        assert_eq!(state.take_pending_view("w-2"), None);
    }

    #[test]
    fn menu_target_falls_back_from_the_settings_window_to_the_latest_document() {
        let open = labels(&["w-1", "w-2", "settings"]);

        assert_eq!(
            menu_target(
                Some("settings"),
                &labels(&["w-1", "w-2", "settings"]),
                &open
            ),
            Some("w-2".to_string())
        );
    }

    #[test]
    fn menu_target_keeps_a_focused_document_window() {
        let open = labels(&["w-1", "w-2"]);

        assert_eq!(
            menu_target(Some("w-1"), &labels(&["w-1", "w-2"]), &open),
            Some("w-1".to_string())
        );
    }

    #[test]
    fn menu_target_is_none_when_nothing_is_open() {
        assert_eq!(
            menu_target(Some("settings"), &[], &labels(&["settings"])),
            None
        );
        assert_eq!(menu_target(None, &[], &[]), None);
    }
}
