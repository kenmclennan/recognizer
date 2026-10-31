use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::fs_safe::{checked_relative, write_atomic};

const FINDINGS: &str = ".recognizer/cache/findings";
const POLICY: &str = ".recognizer/policy.yaml";
const CONFIG: &str = ".recognizer/config.yaml";
const BASELINE: &str = ".recognizer/baselines/violations.json";

pub type Snapshot = Vec<(String, u128, u64)>;

#[derive(Debug, PartialEq, Serialize)]
pub struct FindingsFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct FindingsRead {
    pub files: Vec<FindingsFile>,
    pub refused: Vec<String>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct SensorInputs {
    pub policy: Option<String>,
    pub config: Option<String>,
    pub baseline: Option<String>,
    pub refused: Vec<String>,
}

pub fn sensor_name_ok(name: &str) -> bool {
    let mut chars = name.chars();

    chars
        .next()
        .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

pub fn check_names(names: &[String]) -> Result<(), String> {
    if names.is_empty() {
        return Err("no sensor was named".to_string());
    }

    match names.iter().find(|name| !sensor_name_ok(name)) {
        Some(name) => Err(format!("{name} is not a sensor name")),
        None => Ok(()),
    }
}

fn findings_relative(name: &str) -> String {
    format!("{FINDINGS}/{name}.json")
}

pub fn write_structure(folder: &Path, document: Option<&str>) -> Result<(), String> {
    let target = folder.join(findings_relative("structure"));

    match document {
        Some(text) => {
            fs::create_dir_all(folder.join(FINDINGS)).map_err(|error| error.to_string())?;

            if fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
                fs::remove_file(&target).map_err(|error| error.to_string())?;
            }

            write_atomic(&target, text).map_err(|error| error.to_string())
        }
        None => match fs::remove_file(&target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

pub fn read_findings(folder: &Path) -> FindingsRead {
    let mut read = FindingsRead::default();
    let mut names: Vec<String> = fs::read_dir(folder.join(FINDINGS))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter_map(|file| file.strip_suffix(".json").map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    names.sort();

    for name in names {
        let relative = findings_relative(&name);

        match checked_relative(folder, &relative).and_then(|path| {
            fs::read_to_string(path).map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok(text) => read.files.push(FindingsFile { name, text }),
            Err(_) => read.refused.push(name),
        }
    }

    read
}

pub fn remove_findings(folder: &Path, names: &[String]) -> Result<(), String> {
    for name in names {
        if !sensor_name_ok(name) {
            return Err(format!("{name} is not a sensor name"));
        }
    }

    for name in names {
        match fs::remove_file(folder.join(findings_relative(name))) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("{name}: {error}")),
        }
    }

    Ok(())
}

fn read_input(folder: &Path, relative: &str, refused: &mut Vec<String>) -> Option<String> {
    fs::symlink_metadata(folder.join(relative)).ok()?;

    match checked_relative(folder, relative)
        .and_then(|path| fs::read_to_string(path).map_err(|error| format!("{relative}: {error}")))
    {
        Ok(text) => Some(text),
        Err(reason) => {
            refused.push(reason);

            None
        }
    }
}

pub fn read_inputs(folder: &Path) -> SensorInputs {
    let mut refused = Vec::new();
    let policy = read_input(folder, POLICY, &mut refused);
    let config = read_input(folder, CONFIG, &mut refused);
    let baseline = read_input(folder, BASELINE, &mut refused);

    SensorInputs {
        policy,
        config,
        baseline,
        refused,
    }
}

pub fn snapshot(folder: &Path) -> Snapshot {
    [POLICY, CONFIG]
        .iter()
        .filter_map(|relative| {
            let metadata = fs::metadata(folder.join(relative)).ok()?;
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos();

            Some((relative.to_string(), modified, metadata.len()))
        })
        .collect()
}

pub fn snapshot_changed(previous: &Snapshot, next: &Snapshot) -> bool {
    previous != next
}

#[cfg(test)]
mod tests {
    #[test]
    fn run_sensors_rejects_an_empty_list_and_a_bad_name_before_spawning() {
        assert!(check_names(&[]).is_err());
        assert_eq!(
            check_names(&["ok".to_string(), "-x".to_string()]),
            Err("-x is not a sensor name".to_string())
        );
        assert!(check_names(&["a$(x)".to_string()]).is_err());
        assert!(check_names(&["unused-exports".to_string()]).is_ok());
    }

    use super::*;
    use tempfile::TempDir;

    fn findings_path(dir: &TempDir, name: &str) -> std::path::PathBuf {
        dir.path().join(findings_relative(name))
    }

    #[test]
    fn write_structure_writes_the_file_and_none_removes_it() {
        let dir = TempDir::new().unwrap();

        write_structure(dir.path(), Some("{\"a\":1}")).unwrap();

        assert_eq!(
            fs::read_to_string(findings_path(&dir, "structure")).unwrap(),
            "{\"a\":1}"
        );
        assert!(!findings_path(&dir, "structure.json").exists());

        write_structure(dir.path(), None).unwrap();

        assert!(!findings_path(&dir, "structure").exists());
        write_structure(dir.path(), None).unwrap();
    }

    #[test]
    fn write_structure_replaces_a_symlink_without_writing_through_it() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("victim.json");

        fs::write(&target, "keep").unwrap();
        fs::create_dir_all(dir.path().join(FINDINGS)).unwrap();
        std::os::unix::fs::symlink(&target, findings_path(&dir, "structure")).unwrap();
        write_structure(dir.path(), Some("new")).unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "keep");
        assert_eq!(
            fs::read_to_string(findings_path(&dir, "structure")).unwrap(),
            "new"
        );
    }

    #[test]
    fn read_findings_returns_every_json_file_and_refuses_a_symlink_out() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(FINDINGS)).unwrap();
        fs::write(findings_path(&dir, "structure"), "one").unwrap();
        fs::write(findings_path(&dir, "lint"), "two").unwrap();
        fs::write(dir.path().join(FINDINGS).join("notes.txt"), "no").unwrap();
        fs::write(outside.path().join("x.json"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("x.json"), findings_path(&dir, "evil"))
            .unwrap();

        let read = read_findings(dir.path());

        assert_eq!(
            read.files,
            vec![
                FindingsFile {
                    name: "lint".into(),
                    text: "two".into()
                },
                FindingsFile {
                    name: "structure".into(),
                    text: "one".into()
                },
            ]
        );
        assert_eq!(read.refused, vec!["evil".to_string()]);
    }

    #[test]
    fn read_findings_of_a_repository_without_the_folder_is_empty() {
        assert_eq!(
            read_findings(TempDir::new().unwrap().path()),
            FindingsRead::default()
        );
    }

    #[test]
    fn remove_findings_deletes_only_the_named_files_and_refuses_a_bad_name() {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(FINDINGS)).unwrap();
        fs::write(findings_path(&dir, "a"), "1").unwrap();
        fs::write(findings_path(&dir, "b"), "2").unwrap();
        remove_findings(dir.path(), &["a".to_string(), "missing".to_string()]).unwrap();

        assert!(!findings_path(&dir, "a").exists());
        assert!(findings_path(&dir, "b").exists());

        for bad in ["../x", "A", "", "-a", "a/b", "a.b"] {
            assert!(remove_findings(dir.path(), &[bad.to_string()]).is_err());
        }

        assert!(findings_path(&dir, "b").exists());
    }

    #[test]
    fn inputs_are_read_fresh_and_missing_ones_are_none() {
        let dir = TempDir::new().unwrap();

        assert_eq!(read_inputs(dir.path()), SensorInputs::default());

        fs::create_dir_all(dir.path().join(".recognizer")).unwrap();
        fs::write(dir.path().join(POLICY), "p").unwrap();
        fs::write(dir.path().join(CONFIG), "c").unwrap();

        let read = read_inputs(dir.path());

        assert_eq!(read.policy.as_deref(), Some("p"));
        assert_eq!(read.config.as_deref(), Some("c"));
        assert_eq!(read.baseline, None);
    }

    #[test]
    fn the_snapshot_changes_with_either_input_and_not_with_others() {
        let dir = TempDir::new().unwrap();
        let empty = snapshot(dir.path());

        fs::create_dir_all(dir.path().join(".recognizer")).unwrap();
        fs::write(dir.path().join(POLICY), "p").unwrap();

        let one = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &one));
        assert!(!snapshot_changed(&one, &snapshot(dir.path())));

        fs::write(dir.path().join(CONFIG), "config").unwrap();

        assert!(snapshot_changed(&one, &snapshot(dir.path())));

        let two = snapshot(dir.path());

        fs::write(dir.path().join("other.txt"), "x").unwrap();

        assert!(!snapshot_changed(&two, &snapshot(dir.path())));
    }
}
