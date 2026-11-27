use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_safe::write_atomic;
use crate::recent_domain::{RecentFoldersRepository, RecentViewsRepository};

pub fn recent_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("recent.json")
}

pub fn recent_views_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("recent-views.json")
}

pub struct JsonRecentFolders {
    path: PathBuf,
}

impl JsonRecentFolders {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl RecentFoldersRepository for JsonRecentFolders {
    fn load(&self) -> Vec<PathBuf> {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        let Ok(entries) = serde_json::from_str::<Vec<String>>(&text) else {
            return Vec::new();
        };

        entries.into_iter().map(PathBuf::from).collect()
    }

    fn store(&self, list: &[PathBuf]) -> Result<(), String> {
        let entries: Vec<String> = list
            .iter()
            .map(|entry| entry.to_string_lossy().into_owned())
            .collect();
        let mut text = serde_json::to_string_pretty(&entries).map_err(|error| error.to_string())?;

        text.push('\n');

        write_atomic(&self.path, &text).map_err(|error| format!("{}: {error}", self.path.display()))
    }
}

pub struct JsonRecentViews {
    path: PathBuf,
}

impl JsonRecentViews {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl RecentViewsRepository for JsonRecentViews {
    fn load(&self) -> BTreeMap<String, Vec<String>> {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn store(&self, all: &BTreeMap<String, Vec<String>>) -> Result<(), String> {
        let mut text = serde_json::to_string_pretty(all).map_err(|error| error.to_string())?;

        text.push('\n');

        write_atomic(&self.path, &text).map_err(|error| format!("{}: {error}", self.path.display()))
    }
}

#[derive(Debug, PartialEq)]
pub enum OpenTarget {
    AssignTo(String),
    NewWindow,
}

pub fn open_target(focused: Option<&str>, focused_has_folder: bool) -> OpenTarget {
    match focused {
        Some(label) if !focused_has_folder => OpenTarget::AssignTo(label.to_string()),
        _ => OpenTarget::NewWindow,
    }
}

pub fn labels(list: &[PathBuf]) -> Vec<String> {
    let name = |folder: &PathBuf| {
        folder
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| folder.to_string_lossy().into_owned())
    };
    let parent = |folder: &PathBuf| {
        folder
            .parent()
            .and_then(|parent| parent.file_name())
            .map(|name| name.to_string_lossy().into_owned())
    };

    list.iter()
        .map(|folder| {
            let own = name(folder);
            let shared = list.iter().filter(|other| name(other) == own).count() > 1;

            match parent(folder) {
                Some(parent) if shared => format!("{own} ({parent})"),
                _ => own,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recent_domain::tests::contract;
    use crate::recent_domain::{
        forget, read_recent_views, recent_folders, record, record_recent_view,
    };
    use tempfile::TempDir;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn the_file_adapter_meets_the_recent_folders_contract() {
        let dir = TempDir::new().unwrap();

        contract::recent_folders_repository(&JsonRecentFolders::new(recent_file_in(dir.path())));
    }

    #[test]
    fn the_file_adapter_meets_the_recent_views_contract() {
        let dir = TempDir::new().unwrap();

        contract::recent_views_repository(&JsonRecentViews::new(recent_views_file_in(dir.path())));
    }

    #[test]
    fn recent_views_record_dedupe_cap_and_key_by_folder() {
        let dir = TempDir::new().unwrap();
        let repository = JsonRecentViews::new(recent_views_file_in(dir.path()));
        let one = Path::new("/one");
        let two = Path::new("/two");

        for name in ["a", "b", "c", "d", "e", "f", "c"] {
            record_recent_view(&repository, one, name).unwrap();
        }

        record_recent_view(&repository, two, "z").unwrap();

        assert_eq!(
            read_recent_views(&repository, one),
            ["c", "f", "e", "d", "b"]
        );
        assert_eq!(read_recent_views(&repository, two), ["z"]);
        assert!(record_recent_view(&repository, one, "../x").is_err());
    }

    #[test]
    fn concurrent_recent_view_writers_to_different_folders_both_survive() {
        let dir = TempDir::new().unwrap();
        let repository = JsonRecentViews::new(recent_views_file_in(dir.path()));

        std::thread::scope(|scope| {
            for round in 0..40 {
                let repository = &repository;

                scope.spawn(move || {
                    record_recent_view(repository, Path::new(&format!("/repo-{round}")), "v")
                        .unwrap();
                });
            }
        });

        for round in 0..40 {
            assert_eq!(
                read_recent_views(&repository, Path::new(&format!("/repo-{round}"))),
                ["v"]
            );
        }
    }

    #[test]
    fn an_unreadable_recent_views_file_reads_as_empty() {
        let dir = TempDir::new().unwrap();
        let file = recent_views_file_in(dir.path());
        let repository = JsonRecentViews::new(file.clone());

        assert!(read_recent_views(&repository, Path::new("/one")).is_empty());

        fs::write(&file, "not json").unwrap();

        assert!(read_recent_views(&repository, Path::new("/one")).is_empty());
        record_recent_view(&repository, Path::new("/one"), "a").unwrap();
        assert_eq!(read_recent_views(&repository, Path::new("/one")), ["a"]);
        assert!(fs::read_to_string(&file).unwrap().ends_with("}\n"));
    }

    #[test]
    fn recent_file_sits_in_the_config_folder() {
        assert_eq!(
            recent_file_in(Path::new("/cfg")),
            PathBuf::from("/cfg/recent.json")
        );
    }

    #[test]
    fn a_missing_file_reads_as_empty() {
        let dir = TempDir::new().unwrap();

        assert!(recent_folders(&JsonRecentFolders::new(dir.path().join("recent.json"))).is_empty());
    }

    #[test]
    fn an_unreadable_file_reads_as_empty() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("recent.json");

        fs::write(&file, "not json").unwrap();

        assert!(recent_folders(&JsonRecentFolders::new(file)).is_empty());
    }

    #[test]
    fn recording_persists_in_most_recent_first_order_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let repository = JsonRecentFolders::new(recent_file_in(dir.path()));

        record(&repository, Path::new("/a")).unwrap();
        record(&repository, Path::new("/b")).unwrap();
        record(&repository, Path::new("/a")).unwrap();

        assert_eq!(recent_folders(&repository), paths(&["/a", "/b"]));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn forgetting_removes_the_entry_from_the_file() {
        let dir = TempDir::new().unwrap();
        let repository = JsonRecentFolders::new(recent_file_in(dir.path()));

        record(&repository, Path::new("/a")).unwrap();
        record(&repository, Path::new("/b")).unwrap();
        forget(&repository, Path::new("/a")).unwrap();

        assert_eq!(recent_folders(&repository), paths(&["/b"]));
    }

    #[test]
    fn distinct_folder_names_show_bare() {
        assert_eq!(
            labels(&paths(&["/work/shop/web", "/work/shop/api"])),
            vec!["web", "api"]
        );
    }

    #[test]
    fn colliding_folder_names_show_their_parent() {
        assert_eq!(
            labels(&paths(&[
                "/work/shop/api",
                "/work/billing/api",
                "/work/web"
            ])),
            vec!["api (shop)", "api (billing)", "web"]
        );
    }

    #[test]
    fn no_focused_window_opens_a_new_one() {
        assert_eq!(open_target(None, false), OpenTarget::NewWindow);
    }

    #[test]
    fn a_focused_window_without_a_folder_takes_the_choice() {
        assert_eq!(
            open_target(Some("w-1"), false),
            OpenTarget::AssignTo("w-1".to_string())
        );
    }

    #[test]
    fn a_focused_window_with_a_folder_opens_a_new_one() {
        assert_eq!(open_target(Some("w-1"), true), OpenTarget::NewWindow);
    }
}
