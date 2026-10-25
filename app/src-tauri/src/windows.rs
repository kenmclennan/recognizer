use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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

#[derive(Default)]
pub struct WindowState {
    counter: AtomicU64,
    focus_order: Mutex<Vec<String>>,
    folders: Mutex<HashMap<String, PathBuf>>,
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

    pub fn order(&self) -> Vec<String> {
        self.focus_order.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
}
