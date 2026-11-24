use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::fs_safe::{checked_relative, write_atomic};

const VIEWS: &str = ".recognizer/views";

#[derive(Debug, PartialEq, Serialize)]
pub struct ViewFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct ViewList {
    pub views: Vec<ViewFile>,
    pub refused: Vec<String>,
}

pub type Snapshot = Vec<(String, u128, u64)>;

pub fn valid_name(name: &str) -> bool {
    let mut characters = name.chars();

    name.len() <= 64
        && characters
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric())
        && characters.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn view_name(file: &str) -> Option<&str> {
    file.strip_suffix(".json").filter(|stem| valid_name(stem))
}

pub fn list_views(folder: &Path) -> ViewList {
    let mut list = ViewList::default();
    let mut names: Vec<String> = fs::read_dir(folder.join(VIEWS))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|file| view_name(file).is_some())
                .collect()
        })
        .unwrap_or_default();

    names.sort();

    for file in names {
        let relative = format!("{VIEWS}/{file}");

        match checked_relative(folder, &relative).and_then(|path| {
            fs::read_to_string(path).map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok(text) => list.views.push(ViewFile {
                name: file.trim_end_matches(".json").to_string(),
                text,
            }),
            Err(reason) => list.refused.push(reason),
        }
    }

    list
}

pub fn write_view(folder: &Path, name: &str, text: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    serde_json::from_str::<serde_json::Value>(text)
        .map_err(|error| format!("the view is not valid JSON: {error}"))?;

    write_atomic(&folder.join(VIEWS).join(format!("{name}.json")), text)
        .map_err(|error| error.to_string())
}

pub fn rename_view(folder: &Path, from: &str, to: &str) -> Result<(), String> {
    for name in [from, to] {
        if !valid_name(name) {
            return Err(format!("{name:?} is not a valid view name"));
        }
    }

    let views = folder.join(VIEWS);
    let source = views.join(format!("{from}.json"));
    let target = views.join(format!("{to}.json"));

    if !source.is_file() {
        return Err(format!("there is no view named {from}"));
    }

    if target.exists() {
        return Err(format!("{to} already exists"));
    }

    fs::rename(source, target).map_err(|error| error.to_string())
}

pub fn valid_ref(reference: &str) -> bool {
    let mut characters = reference.chars();

    !reference.contains("..")
        && characters
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric() || first == '_')
        && characters.all(|c| c.is_ascii_alphanumeric() || "_./@+-".contains(c))
}

#[derive(Debug, PartialEq, Serialize)]
pub struct FileChange {
    pub status: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

pub fn parse_name_status(output: &str) -> Vec<FileChange> {
    let mut fields = output.split('\0');
    let mut changes = Vec::new();

    while let Some(status) = fields.next() {
        if status.starts_with('R') {
            if let (Some(from), Some(path)) = (fields.next(), fields.next()) {
                changes.push(FileChange {
                    status: "R".to_string(),
                    path: path.to_string(),
                    from: Some(from.to_string()),
                });
            }

            continue;
        }

        let Some(path) = fields.next() else {
            break;
        };

        if matches!(status, "A" | "M" | "D" | "T") {
            changes.push(FileChange {
                status: status.to_string(),
                path: path.to_string(),
                from: None,
            });
        }
    }

    changes
}

pub fn remove_view(folder: &Path, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    let path = view_file(folder, name);
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| format!("there is no view named {name}"))?;

    if !metadata.is_file() {
        return Err(format!("{name} is not a plain view file"));
    }

    fs::remove_file(path).map_err(|error| error.to_string())
}

pub fn view_file(folder: &Path, name: &str) -> PathBuf {
    folder.join(VIEWS).join(format!("{name}.json"))
}

pub fn view_link(folder: &Path, name: &str) -> Result<String, String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    Ok(crate::link::build(folder, name))
}

pub fn snapshot(folder: &Path) -> Snapshot {
    let mut files: Snapshot = fs::read_dir(folder.join(VIEWS))
        .map(|entries| {
            entries
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    let name = entry.file_name().into_string().ok()?;
                    let metadata = entry.metadata().ok()?;
                    let modified = metadata
                        .modified()
                        .ok()?
                        .duration_since(UNIX_EPOCH)
                        .ok()?
                        .as_nanos();

                    Some((name, modified, metadata.len()))
                })
                .collect()
        })
        .unwrap_or_default();

    files.sort();

    files
}

pub fn snapshot_changed(previous: &Snapshot, next: &Snapshot) -> bool {
    previous != next
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(VIEWS)).unwrap();

        dir
    }

    #[test]
    fn names_that_could_leave_the_views_folder_are_rejected() {
        assert!(valid_name("overview"));
        assert!(valid_name("a_b-1"));
        assert!(valid_name(&"a".repeat(64)));
        assert!(!valid_name("../x"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(""));
        assert!(!valid_name(&"a".repeat(65)));
        assert!(!valid_name("-leading"));
        assert!(!valid_name("dot.json"));
    }

    #[test]
    fn write_view_rejects_a_bad_name_and_bad_json() {
        let dir = repo();

        assert!(write_view(dir.path(), "../x", "{}").is_err());
        assert!(write_view(dir.path(), "ok", "not json").is_err());
        assert!(!dir.path().join(VIEWS).join("ok.json").exists());
    }

    #[test]
    fn write_view_leaves_no_temporary_file() {
        let dir = repo();

        write_view(dir.path(), "overview", "{\"a\": 1}\n").unwrap();

        let names: Vec<String> = fs::read_dir(dir.path().join(VIEWS))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();

        assert_eq!(names, vec!["overview.json".to_string()]);
        assert_eq!(
            fs::read_to_string(dir.path().join(VIEWS).join("overview.json")).unwrap(),
            "{\"a\": 1}\n"
        );
    }

    #[test]
    fn rename_view_moves_the_file() {
        let dir = repo();

        write_view(dir.path(), "overview", "{\"a\": 1}\n").unwrap();
        rename_view(dir.path(), "overview", "summary").unwrap();

        assert!(!dir.path().join(VIEWS).join("overview.json").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join(VIEWS).join("summary.json")).unwrap(),
            "{\"a\": 1}\n"
        );
    }

    #[test]
    fn rename_view_rejects_bad_names_and_an_existing_target() {
        let dir = repo();

        write_view(dir.path(), "one", "{}").unwrap();
        write_view(dir.path(), "two", "{}").unwrap();

        assert!(rename_view(dir.path(), "one", "../x").is_err());
        assert!(rename_view(dir.path(), "../one", "three").is_err());
        assert!(rename_view(dir.path(), "one", "two").is_err());
        assert!(rename_view(dir.path(), "missing", "three").is_err());
        assert!(dir.path().join(VIEWS).join("one.json").exists());
        assert!(dir.path().join(VIEWS).join("two.json").exists());
    }

    #[test]
    fn list_views_reads_matching_names_only() {
        let dir = repo();
        let views = dir.path().join(VIEWS);

        fs::write(views.join("a.json"), "A").unwrap();
        fs::write(views.join("b.json"), "B").unwrap();
        fs::write(views.join("not a name.json"), "x").unwrap();
        fs::write(views.join("notes.txt"), "x").unwrap();

        let list = list_views(dir.path());

        assert_eq!(
            list.views,
            vec![
                ViewFile {
                    name: "a".to_string(),
                    text: "A".to_string()
                },
                ViewFile {
                    name: "b".to_string(),
                    text: "B".to_string()
                },
            ]
        );
        assert!(list.refused.is_empty());
    }

    #[test]
    fn no_views_folder_is_an_empty_list() {
        let dir = TempDir::new().unwrap();

        assert_eq!(list_views(dir.path()), ViewList::default());
    }

    #[cfg(unix)]
    #[test]
    fn list_views_skips_a_symlink_out_of_the_folder_and_names_it() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("repo");
        let views = root.join(VIEWS);

        fs::create_dir_all(&views).unwrap();
        fs::write(dir.path().join("secret.json"), "secret").unwrap();
        fs::write(views.join("a.json"), "A").unwrap();
        std::os::unix::fs::symlink(dir.path().join("secret.json"), views.join("evil.json"))
            .unwrap();

        let list = list_views(&root);

        assert_eq!(list.views.len(), 1);
        assert_eq!(list.refused.len(), 1);
        assert!(list.refused[0].contains("evil.json"));
    }

    #[test]
    fn view_link_names_the_folder_and_validates_the_view() {
        let dir = repo();
        let link = view_link(dir.path(), "overview").unwrap();

        assert!(link.starts_with("recognizer://open?repo=%2F"));
        assert!(link.ends_with("&view=overview"));
        assert!(view_link(dir.path(), "../x").is_err());
    }

    #[test]
    fn a_snapshot_changes_when_a_file_is_written_or_removed() {
        let dir = repo();
        let views = dir.path().join(VIEWS);
        let empty = snapshot(dir.path());

        fs::write(views.join("a.json"), "1").unwrap();

        let one = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &one));
        assert!(!snapshot_changed(&one, &snapshot(dir.path())));

        fs::write(views.join("a.json"), "12").unwrap();

        let longer = snapshot(dir.path());

        assert!(snapshot_changed(&one, &longer));

        fs::remove_file(views.join("a.json")).unwrap();

        assert!(snapshot_changed(&longer, &snapshot(dir.path())));
    }

    #[test]
    fn refs_agree_with_the_shared_fixture() {
        let text = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../fixtures/views/refs.json"
        ))
        .unwrap();
        let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();

        for key in ["accept", "reject"] {
            for entry in fixture[key].as_array().unwrap() {
                let reference = entry.as_str().unwrap();

                assert_eq!(valid_ref(reference), key == "accept", "{reference:?}");
            }
        }
    }

    #[test]
    fn name_status_parses_known_letters_only() {
        assert_eq!(
            parse_name_status("D\0src/b.py\0A\0src/c.py\0U\0x\0"),
            vec![
                FileChange {
                    status: "D".into(),
                    path: "src/b.py".into(),
                    from: None
                },
                FileChange {
                    status: "A".into(),
                    path: "src/c.py".into(),
                    from: None
                },
            ]
        );
        assert!(parse_name_status("").is_empty());
    }

    #[test]
    fn name_status_reads_a_rename_as_old_then_new_path() {
        assert_eq!(
            parse_name_status("R100\0old.py\0new.py\0M\0a.py\0"),
            vec![
                FileChange {
                    status: "R".into(),
                    path: "new.py".into(),
                    from: Some("old.py".into())
                },
                FileChange {
                    status: "M".into(),
                    path: "a.py".into(),
                    from: None
                },
            ]
        );
    }

    #[test]
    fn remove_view_deletes_the_file_and_refuses_the_rest() {
        let dir = repo();

        write_view(dir.path(), "a", "{}").unwrap();
        remove_view(dir.path(), "a").unwrap();

        assert!(!view_file(dir.path(), "a").exists());
        assert!(remove_view(dir.path(), "a").is_err());
        assert!(remove_view(dir.path(), "../a").is_err());

        #[cfg(unix)]
        {
            let target = dir.path().join("target.json");

            fs::write(&target, "{}").unwrap();
            std::os::unix::fs::symlink(&target, view_file(dir.path(), "link")).unwrap();

            assert!(remove_view(dir.path(), "link").is_err());
            assert!(target.exists());
        }
    }
}
