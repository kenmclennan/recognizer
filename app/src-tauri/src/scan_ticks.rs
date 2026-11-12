use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fs_safe::write_atomic;
use crate::sensors::check_names;

const SUITE_NAME_LIMIT: usize = 200;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SuiteTicks {
    pub ticked: Vec<String>,
    pub known: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredTicks {
    pub describe: bool,
    #[serde(default, skip_serializing)]
    pub measure: bool,
    #[serde(default, skip_serializing)]
    pub overlays: Vec<String>,
    #[serde(default, skip_serializing)]
    pub sensors: Option<bool>,
    pub ticked: Vec<String>,
    #[serde(default)]
    pub only_view: bool,
    #[serde(default)]
    pub suites: BTreeMap<String, SuiteTicks>,
    #[serde(default)]
    pub folds: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ScanTicks {
    pub describe: bool,
    pub ticked: Option<Vec<String>>,
    #[serde(rename = "onlyView")]
    pub only_view: bool,
    pub remembered: bool,
    pub suites: BTreeMap<String, SuiteTicks>,
    pub folds: Vec<String>,
}

pub fn ticks_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("scan-ticks.json")
}

fn read_all(path: &Path) -> BTreeMap<String, StoredTicks> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn read(path: &Path, folder: &Path) -> ScanTicks {
    match read_all(path).remove(&folder.display().to_string()) {
        Some(stored) => ScanTicks {
            describe: stored.describe,
            ticked: Some(if stored.sensors == Some(false) {
                Vec::new()
            } else {
                stored.ticked
            }),
            only_view: stored.only_view,
            remembered: true,
            suites: stored.suites,
            folds: stored.folds,
        },
        None => ScanTicks {
            describe: false,
            ticked: Some(Vec::new()),
            only_view: false,
            remembered: false,
            suites: BTreeMap::new(),
            folds: Vec::new(),
        },
    }
}

fn check_suites(suites: &BTreeMap<String, SuiteTicks>) -> Result<(), String> {
    let sensors: Vec<String> = suites.keys().cloned().collect();

    check_names(&sensors)?;

    for entry in suites.values() {
        for name in entry.ticked.iter().chain(entry.known.iter()) {
            if name.is_empty() || name.chars().count() > SUITE_NAME_LIMIT {
                return Err("a suite name is empty or over 200 characters".to_string());
            }
        }
    }

    Ok(())
}

pub fn write(path: &Path, folder: &Path, ticks: StoredTicks) -> Result<(), String> {
    check_names(&ticks.ticked)?;
    check_suites(&ticks.suites)?;
    check_names(&ticks.folds)?;

    let mut all = read_all(path);

    all.insert(folder.display().to_string(), ticks);

    let mut text = serde_json::to_string_pretty(&all).map_err(|error| error.to_string())?;

    text.push('\n');

    write_atomic(path, &text).map_err(|error| format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn stored(describe: bool, ticked: &[&str]) -> StoredTicks {
        StoredTicks {
            describe,
            measure: false,
            overlays: vec![],
            sensors: None,
            ticked: ticked.iter().map(|name| name.to_string()).collect(),
            only_view: false,
            suites: BTreeMap::new(),
            folds: Vec::new(),
        }
    }

    #[test]
    fn the_file_sits_in_the_config_folder() {
        assert_eq!(
            ticks_file_in(Path::new("/cfg")),
            Path::new("/cfg/scan-ticks.json")
        );
    }

    #[test]
    fn a_folder_with_no_entry_ticks_nothing() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert_eq!(
            read(&file, Path::new("/repo")),
            ScanTicks {
                describe: false,
                ticked: Some(vec![]),
                only_view: false,
                remembered: false,
                suites: BTreeMap::new(),
                folds: Vec::new()
            }
        );
    }

    #[test]
    fn a_written_entry_is_read_back_for_that_folder_only() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        write(&file, Path::new("/repo"), stored(true, &["a"])).unwrap();

        assert_eq!(
            read(&file, Path::new("/repo")),
            ScanTicks {
                describe: true,
                ticked: Some(vec!["a".to_string()]),
                only_view: false,
                remembered: true,
                suites: BTreeMap::new(),
                folds: Vec::new()
            }
        );
        assert!(!read(&file, Path::new("/other")).remembered);
    }

    #[test]
    fn an_old_entry_with_sensors_off_reads_no_sensors_ticked() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(
            &file,
            r#"{"/repo":{"describe":true,"measure":true,"overlays":["m"],"sensors":false,"ticked":["a"]}}"#,
        )
        .unwrap();

        assert_eq!(
            read(&file, Path::new("/repo")),
            ScanTicks {
                describe: true,
                ticked: Some(vec![]),
                only_view: false,
                remembered: true,
                suites: BTreeMap::new(),
                folds: Vec::new()
            }
        );
    }

    #[test]
    fn an_old_entry_with_sensors_on_keeps_its_ticked_names() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(
            &file,
            r#"{"/repo":{"describe":false,"sensors":true,"ticked":["a"]}}"#,
        )
        .unwrap();

        assert_eq!(
            read(&file, Path::new("/repo")).ticked,
            Some(vec!["a".to_string()])
        );
    }

    #[test]
    fn an_old_entry_without_only_view_reads_false_and_a_written_one_reads_back() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(&file, r#"{"/repo":{"describe":true,"ticked":["a"]}}"#).unwrap();

        assert!(!read(&file, Path::new("/repo")).only_view);

        let mut ticks = stored(true, &["a"]);

        ticks.only_view = true;
        write(&file, Path::new("/repo"), ticks).unwrap();

        assert!(read(&file, Path::new("/repo")).only_view);
        assert!(
            serde_json::to_value(read(&file, Path::new("/repo"))).unwrap()["onlyView"]
                .as_bool()
                .unwrap()
        );
    }

    #[test]
    fn write_never_stores_the_retired_fields() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let mut ticks = stored(false, &["a"]);

        ticks.measure = true;
        ticks.overlays = vec!["mutate".to_string()];
        ticks.sensors = Some(true);

        write(&file, Path::new("/repo"), ticks).unwrap();

        let text = fs::read_to_string(&file).unwrap();

        assert!(!text.contains("measure"));
        assert!(!text.contains("overlays"));
        assert!(!text.contains("sensors"));
    }

    #[test]
    fn writing_another_folder_keeps_the_first_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        write(&file, Path::new("/a"), stored(true, &[])).unwrap();
        write(&file, Path::new("/b"), stored(false, &[])).unwrap();

        assert!(read(&file, Path::new("/a")).remembered);
        assert!(read(&file, Path::new("/b")).remembered);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_malformed_file_reads_empty_and_is_replaced_on_write() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(&file, "not json").unwrap();

        assert!(!read(&file, Path::new("/repo")).remembered);

        write(&file, Path::new("/repo"), stored(false, &[])).unwrap();

        assert!(read(&file, Path::new("/repo")).remembered);
    }

    #[test]
    fn a_ticked_name_that_is_not_a_sensor_name_is_refused() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert!(write(&file, Path::new("/repo"), stored(false, &["$(x)"])).is_err());
        assert!(!file.exists());
    }

    #[test]
    fn suite_ticks_and_folds_round_trip_and_survive_a_second_write_of_the_same_entry() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let mut ticks = stored(false, &[]);

        ticks.suites.insert(
            "crap".to_string(),
            SuiteTicks {
                ticked: vec!["unit".to_string()],
                known: vec!["unit".to_string(), "web".to_string()],
            },
        );
        ticks.folds = vec!["crap".to_string()];

        write(&file, Path::new("/repo"), ticks.clone()).unwrap();

        let read_back = read(&file, Path::new("/repo"));

        assert_eq!(read_back.suites, ticks.suites);
        assert_eq!(read_back.folds, ticks.folds);
    }

    #[test]
    fn an_old_file_without_suites_or_folds_reads_both_empty() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(&file, r#"{"/repo":{"describe":true,"ticked":["a"]}}"#).unwrap();

        let read_back = read(&file, Path::new("/repo"));

        assert!(read_back.suites.is_empty());
        assert!(read_back.folds.is_empty());
    }

    #[test]
    fn an_empty_or_overlong_suite_name_or_a_bad_sensor_key_is_refused() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        for (sensor, name) in [
            ("crap", String::new()),
            ("crap", "x".repeat(201)),
            ("$(x)", "unit".to_string()),
        ] {
            let mut ticks = stored(false, &[]);

            ticks.suites.insert(
                sensor.to_string(),
                SuiteTicks {
                    ticked: vec![name],
                    known: vec![],
                },
            );

            assert!(write(&file, Path::new("/repo"), ticks).is_err());
        }

        assert!(!file.exists());
    }
}
