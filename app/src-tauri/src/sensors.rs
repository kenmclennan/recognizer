use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::fs_safe::{checked_relative, write_atomic};
use crate::overlays::{overlay_names, OVERLAYS};

const FINDINGS: &str = ".recognizer/cache/findings";
const RUN_LOG: &str = ".recognizer/cache/log";
const RUN_LOG_KEEP: usize = 50;
const RUN_RECORD_CAP: u64 = 2 * 1024 * 1024;
const POLICY: &str = ".recognizer/policy.yaml";
const CONFIG: &str = ".recognizer/config.yaml";
const BASELINE: &str = ".recognizer/baselines/violations.json";

pub type Snapshot = Vec<(String, u128, u64)>;

#[derive(Debug, PartialEq, Serialize)]
pub struct FindingsFile {
    pub name: String,
    pub text: String,
    #[serde(rename = "modifiedMs")]
    pub modified_ms: Option<f64>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct FindingsRead {
    pub files: Vec<FindingsFile>,
    pub refused: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct RunRecordFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct RunRecordsRead {
    pub files: Vec<RunRecordFile>,
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
    match names.iter().find(|name| !sensor_name_ok(name)) {
        Some(name) => Err(format!("{name} is not a sensor name")),
        None => Ok(()),
    }
}

pub fn check_scan_names(measure: &[String], sense: &[String]) -> Result<(), String> {
    if let Some(name) = measure.iter().find(|name| !sensor_name_ok(name)) {
        return Err(format!("{name} is not an overlay name"));
    }

    check_names(sense)
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
            } else if fs::read_to_string(&target).is_ok_and(|existing| existing == text) {
                return Ok(());
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

pub fn modified_ms(path: &Path) -> Option<f64> {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as f64)
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
            let modified_ms = modified_ms(&path);

            fs::read_to_string(path)
                .map(|text| (text, modified_ms))
                .map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok((text, modified_ms)) => read.files.push(FindingsFile {
                name,
                text,
                modified_ms,
            }),
            Err(_) => read.refused.push(name),
        }
    }

    read
}

fn run_record_name_ok(file: &str) -> bool {
    let Some(stem) = file
        .strip_suffix("-scan.json")
        .or_else(|| file.strip_suffix("-sense.json"))
    else {
        return false;
    };
    let bytes = stem.as_bytes();

    bytes.len() == 19
        && bytes[8] == b'T'
        && bytes[18] == b'Z'
        && bytes[..8].iter().all(u8::is_ascii_digit)
        && bytes[9..18].iter().all(u8::is_ascii_digit)
}

pub fn read_run_records(folder: &Path) -> RunRecordsRead {
    let mut read = RunRecordsRead::default();
    let mut names: Vec<String> = fs::read_dir(folder.join(RUN_LOG))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|file| run_record_name_ok(file))
                .collect()
        })
        .unwrap_or_default();

    names.sort_by(|a, b| b.cmp(a));
    names.truncate(RUN_LOG_KEEP);

    for name in names {
        let relative = format!("{RUN_LOG}/{name}");

        match checked_relative(folder, &relative).and_then(|path| {
            let size = fs::metadata(&path)
                .map_err(|error| format!("{relative}: {error}"))?
                .len();

            if size > RUN_RECORD_CAP {
                return Err(format!("{relative}: over the size cap"));
            }

            fs::read_to_string(path).map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok(text) => read.files.push(RunRecordFile { name, text }),
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

fn stamp(folder: &Path, relative: &str) -> Option<(String, u128, u64)> {
    let metadata = fs::metadata(folder.join(relative)).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();

    Some((relative.to_string(), modified, metadata.len()))
}

pub fn snapshot(folder: &Path) -> Snapshot {
    let overlays = overlay_names(folder)
        .into_iter()
        .map(|name| format!("{OVERLAYS}/{name}.json"));

    let mut findings: Vec<String> = fs::read_dir(folder.join(FINDINGS))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|file| file.ends_with(".json"))
                .map(|file| format!("{FINDINGS}/{file}"))
                .collect()
        })
        .unwrap_or_default();

    findings.sort();

    [POLICY.to_string(), CONFIG.to_string()]
        .into_iter()
        .chain(overlays)
        .chain(findings)
        .filter_map(|relative| stamp(folder, &relative))
        .collect()
}

pub fn snapshot_changed(previous: &Snapshot, next: &Snapshot) -> bool {
    previous != next
}

#[cfg(test)]
mod tests {
    #[test]
    fn run_scan_refuses_a_bad_sensor_name_before_spawning_and_accepts_an_empty_list() {
        assert!(check_names(&[]).is_ok());
        assert_eq!(
            check_names(&["ok".to_string(), "-x".to_string()]),
            Err("-x is not a sensor name".to_string())
        );

        for bad in ["Bad Name", "a,b", "$(x)", "--extract", "", "-x", "a$(x)"] {
            assert_eq!(
                check_names(&[bad.to_string()]),
                Err(format!("{bad} is not a sensor name"))
            );
        }

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
    fn writing_the_same_structure_again_is_not_a_change() {
        let dir = TempDir::new().unwrap();

        write_structure(dir.path(), Some("{\"a\":1}")).unwrap();

        let target = dir.path().join(findings_relative("structure"));
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);

        fs::File::options()
            .write(true)
            .open(&target)
            .unwrap()
            .set_modified(old)
            .unwrap();

        let before = snapshot(dir.path());

        write_structure(dir.path(), Some("{\"a\":1}")).unwrap();

        assert!(!snapshot_changed(&before, &snapshot(dir.path())));

        write_structure(dir.path(), Some("{\"a\":2}")).unwrap();

        assert!(snapshot_changed(&before, &snapshot(dir.path())));
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

        assert!(read.files.iter().all(|file| file.modified_ms.is_some()));

        assert_eq!(
            read.files,
            vec![
                FindingsFile {
                    name: "lint".into(),
                    text: "two".into(),
                    modified_ms: read.files[0].modified_ms,
                },
                FindingsFile {
                    name: "structure".into(),
                    text: "one".into(),
                    modified_ms: read.files[1].modified_ms,
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

    fn record_name(index: usize, kind: &str) -> String {
        format!("20260101T0000{index:05}Z-{kind}.json")
    }

    #[test]
    fn read_run_records_keeps_scan_and_sense_records_newest_first() {
        let dir = TempDir::new().unwrap();
        let log = dir.path().join(RUN_LOG);

        fs::create_dir_all(&log).unwrap();

        for (index, kind) in [
            (1, "scan"),
            (2, "describe"),
            (3, "sense"),
            (4, "measure"),
            (5, "scan"),
            (6, "describe"),
            (7, "sense"),
        ] {
            fs::write(log.join(record_name(index, kind)), kind).unwrap();
        }

        fs::write(log.join("notes.json"), "no").unwrap();
        fs::write(log.join("20260101T000000001Z-scan.txt"), "no").unwrap();

        let read = read_run_records(dir.path());
        let names: Vec<&str> = read.files.iter().map(|file| file.name.as_str()).collect();

        assert_eq!(
            names,
            vec![
                record_name(7, "sense"),
                record_name(5, "scan"),
                record_name(3, "sense"),
                record_name(1, "scan"),
            ]
        );
        assert_eq!(read.files[1].text, "scan");
        assert!(read.refused.is_empty());
    }

    #[test]
    fn read_run_records_keeps_the_newest_fifty() {
        let dir = TempDir::new().unwrap();
        let log = dir.path().join(RUN_LOG);

        fs::create_dir_all(&log).unwrap();

        for index in 1..=53 {
            fs::write(log.join(record_name(index, "scan")), "x").unwrap();
        }

        let read = read_run_records(dir.path());

        assert_eq!(read.files.len(), 50);
        assert_eq!(read.files[0].name, record_name(53, "scan"));
        assert_eq!(read.files[49].name, record_name(4, "scan"));
    }

    #[test]
    fn read_run_records_refuses_a_symlink_out_and_an_oversized_file() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let log = dir.path().join(RUN_LOG);

        fs::create_dir_all(&log).unwrap();
        fs::write(outside.path().join("x.json"), "secret").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("x.json"),
            log.join(record_name(2, "scan")),
        )
        .unwrap();
        fs::write(
            log.join(record_name(3, "scan")),
            vec![b'a'; RUN_RECORD_CAP as usize + 1],
        )
        .unwrap();
        fs::write(log.join(record_name(1, "scan")), "ok").unwrap();

        let read = read_run_records(dir.path());

        assert_eq!(read.files.len(), 1);
        assert_eq!(read.files[0].text, "ok");
        assert_eq!(
            read.refused,
            vec![record_name(3, "scan"), record_name(2, "scan")]
        );
    }

    #[test]
    fn read_run_records_of_a_repository_without_the_folder_is_empty() {
        assert_eq!(
            read_run_records(TempDir::new().unwrap().path()),
            RunRecordsRead::default()
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

    #[test]
    fn the_snapshot_changes_when_an_overlay_is_added_rewritten_or_removed() {
        let dir = TempDir::new().unwrap();
        let empty = snapshot(dir.path());

        fs::create_dir_all(dir.path().join(OVERLAYS)).unwrap();

        let path = dir.path().join(OVERLAYS).join("crap.json");

        fs::write(&path, "one").unwrap();

        let added = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &added));

        fs::write(&path, "longer text").unwrap();

        let rewritten = snapshot(dir.path());

        assert!(snapshot_changed(&added, &rewritten));

        fs::remove_file(&path).unwrap();

        assert!(snapshot_changed(&rewritten, &snapshot(dir.path())));
        assert_eq!(snapshot(dir.path()), empty);
    }

    #[test]
    fn the_snapshot_changes_when_a_findings_file_is_added_replaced_or_removed() {
        let dir = TempDir::new().unwrap();
        let empty = snapshot(dir.path());

        fs::create_dir_all(dir.path().join(FINDINGS)).unwrap();

        let path = dir.path().join(FINDINGS).join("review.json");

        fs::write(&path, "one").unwrap();

        let added = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &added));
        assert!(!snapshot_changed(&added, &snapshot(dir.path())));

        fs::write(&path, "a longer report").unwrap();

        let replaced = snapshot(dir.path());

        assert!(snapshot_changed(&added, &replaced));

        fs::remove_file(&path).unwrap();

        assert!(snapshot_changed(&replaced, &snapshot(dir.path())));
        assert_eq!(snapshot(dir.path()), empty);
    }

    #[test]
    fn a_bad_measure_name_is_refused_before_anything_spawns() {
        let good = vec!["mutate".to_string()];
        let bad = vec!["$(rm -rf x)".to_string()];

        assert!(check_scan_names(&good, &good).is_ok());
        assert_eq!(
            check_scan_names(&bad, &good),
            Err("$(rm -rf x) is not an overlay name".to_string())
        );
        assert!(check_scan_names(&good, &bad).is_err());
    }
}
