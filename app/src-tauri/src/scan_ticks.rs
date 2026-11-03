use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fs_safe::write_atomic;
use crate::sensors::check_names;
use crate::settings::Settings;

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
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ScanTicks {
    pub describe: bool,
    pub ticked: Option<Vec<String>>,
    pub remembered: bool,
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

pub fn read(path: &Path, folder: &Path, defaults: &Settings) -> ScanTicks {
    match read_all(path).remove(&folder.display().to_string()) {
        Some(stored) => ScanTicks {
            describe: stored.describe,
            ticked: Some(if stored.sensors == Some(false) {
                Vec::new()
            } else {
                stored.ticked
            }),
            remembered: true,
        },
        None => ScanTicks {
            describe: defaults.scanning.describe,
            ticked: if defaults.scanning.sensors {
                None
            } else {
                Some(Vec::new())
            },
            remembered: false,
        },
    }
}

pub fn write(path: &Path, folder: &Path, ticks: StoredTicks) -> Result<(), String> {
    check_names(&ticks.ticked)?;

    let mut all = read_all(path);

    all.insert(folder.display().to_string(), ticks);

    let mut text = serde_json::to_string_pretty(&all).map_err(|error| error.to_string())?;

    text.push('\n');

    write_atomic(path, &text).map_err(|error| format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Scanning;
    use tempfile::TempDir;

    fn defaults(describe: bool) -> Settings {
        defaults_with(describe, false)
    }

    fn defaults_with(describe: bool, sensors: bool) -> Settings {
        Settings {
            scanning: Scanning { describe, sensors },
            ..Settings::default()
        }
    }

    fn stored(describe: bool, ticked: &[&str]) -> StoredTicks {
        StoredTicks {
            describe,
            measure: false,
            overlays: vec![],
            sensors: None,
            ticked: ticked.iter().map(|name| name.to_string()).collect(),
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
    fn a_folder_with_no_entry_takes_the_describe_default_and_ticks_no_sensor() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(true)),
            ScanTicks {
                describe: true,
                ticked: Some(vec![]),
                remembered: false
            }
        );
    }

    #[test]
    fn a_folder_with_no_entry_ticks_every_plain_sensor_when_the_default_is_on() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults_with(false, true)).ticked,
            None
        );
    }

    #[test]
    fn a_written_entry_is_read_back_for_that_folder_only() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        write(&file, Path::new("/repo"), stored(true, &["a"])).unwrap();

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(false)),
            ScanTicks {
                describe: true,
                ticked: Some(vec!["a".to_string()]),
                remembered: true
            }
        );
        assert!(!read(&file, Path::new("/other"), &defaults(false)).remembered);
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
            read(&file, Path::new("/repo"), &defaults(false)),
            ScanTicks {
                describe: true,
                ticked: Some(vec![]),
                remembered: true
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
            read(&file, Path::new("/repo"), &defaults(false)).ticked,
            Some(vec!["a".to_string()])
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

        assert!(read(&file, Path::new("/a"), &defaults(false)).remembered);
        assert!(read(&file, Path::new("/b"), &defaults(false)).remembered);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_malformed_file_reads_empty_and_is_replaced_on_write() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(&file, "not json").unwrap();

        assert!(!read(&file, Path::new("/repo"), &defaults(false)).remembered);

        write(&file, Path::new("/repo"), stored(false, &[])).unwrap();

        assert!(read(&file, Path::new("/repo"), &defaults(false)).remembered);
    }

    #[test]
    fn a_ticked_name_that_is_not_a_sensor_name_is_refused() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert!(write(&file, Path::new("/repo"), stored(false, &["$(x)"])).is_err());
        assert!(!file.exists());
    }
}
