use std::path::{Path, PathBuf};

pub const LIMIT: usize = 10;

pub fn recent_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("recent.json")
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

pub fn with_opened(list: &[PathBuf], folder: &Path) -> Vec<PathBuf> {
    let mut next = vec![folder.to_path_buf()];

    next.extend(
        list.iter()
            .filter(|entry| entry.as_path() != folder)
            .cloned(),
    );
    next.truncate(LIMIT);

    next
}

pub fn without(list: &[PathBuf], folder: &Path) -> Vec<PathBuf> {
    list.iter()
        .filter(|entry| entry.as_path() != folder)
        .cloned()
        .collect()
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

pub fn read(path: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(entries) = serde_json::from_str::<Vec<String>>(&text) else {
        return Vec::new();
    };

    let mut list = Vec::new();

    for entry in entries {
        let entry = PathBuf::from(entry);

        if !list.contains(&entry) {
            list.push(entry);
        }
    }

    list.truncate(LIMIT);

    list
}

pub fn write(path: &Path, list: &[PathBuf]) -> Result<(), String> {
    let entries: Vec<String> = list
        .iter()
        .map(|entry| entry.to_string_lossy().into_owned())
        .collect();
    let text = serde_json::to_string_pretty(&entries).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    std::fs::write(&temp, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, path).map_err(|error| error.to_string())
}

pub fn record(path: &Path, folder: &Path) -> Result<Vec<PathBuf>, String> {
    let next = with_opened(&read(path), folder);

    write(path, &next)?;

    Ok(next)
}

pub fn forget(path: &Path, folder: &Path) -> Result<Vec<PathBuf>, String> {
    let next = without(&read(path), folder);

    write(path, &next)?;

    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn recent_file_sits_in_the_config_folder() {
        assert_eq!(
            recent_file_in(Path::new("/cfg")),
            PathBuf::from("/cfg/recent.json")
        );
    }

    #[test]
    fn an_opened_folder_goes_first() {
        assert_eq!(
            with_opened(&paths(&["/a", "/b"]), Path::new("/c")),
            paths(&["/c", "/a", "/b"])
        );
    }

    #[test]
    fn reopening_a_folder_moves_it_first_without_a_duplicate() {
        assert_eq!(
            with_opened(&paths(&["/a", "/b", "/c"]), Path::new("/c")),
            paths(&["/c", "/a", "/b"])
        );
    }

    #[test]
    fn the_list_holds_the_last_ten() {
        let full: Vec<PathBuf> = (0..LIMIT)
            .map(|n| PathBuf::from(format!("/f{n}")))
            .collect();
        let next = with_opened(&full, Path::new("/new"));

        assert_eq!(next.len(), LIMIT);
        assert_eq!(next[0], PathBuf::from("/new"));
        assert!(!next.contains(&PathBuf::from(format!("/f{}", LIMIT - 1))));
    }

    #[test]
    fn removing_drops_only_that_folder() {
        assert_eq!(
            without(&paths(&["/a", "/b", "/c"]), Path::new("/b")),
            paths(&["/a", "/c"])
        );
    }

    #[test]
    fn a_missing_file_reads_as_empty() {
        let dir = TempDir::new().unwrap();

        assert!(read(&dir.path().join("recent.json")).is_empty());
    }

    #[test]
    fn an_unreadable_file_reads_as_empty() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("recent.json");

        std::fs::write(&file, "not json").unwrap();

        assert!(read(&file).is_empty());
    }

    #[test]
    fn recording_persists_in_most_recent_first_order_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let file = recent_file_in(dir.path());

        record(&file, Path::new("/a")).unwrap();
        record(&file, Path::new("/b")).unwrap();
        record(&file, Path::new("/a")).unwrap();

        assert_eq!(read(&file), paths(&["/a", "/b"]));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn forgetting_removes_the_entry_from_the_file() {
        let dir = TempDir::new().unwrap();
        let file = recent_file_in(dir.path());

        record(&file, Path::new("/a")).unwrap();
        record(&file, Path::new("/b")).unwrap();
        forget(&file, Path::new("/a")).unwrap();

        assert_eq!(read(&file), paths(&["/b"]));
    }

    #[test]
    fn a_stored_list_with_duplicates_and_excess_is_normalised_on_read() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("recent.json");
        let mut entries: Vec<String> = (0..15).map(|n| format!("/f{n}")).collect();

        entries.insert(1, "/f0".to_string());
        std::fs::write(&file, serde_json::to_string(&entries).unwrap()).unwrap();

        let list = read(&file);

        assert_eq!(list.len(), LIMIT);
        assert_eq!(list[0], PathBuf::from("/f0"));
        assert_eq!(list[1], PathBuf::from("/f1"));
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
