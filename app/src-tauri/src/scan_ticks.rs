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
    #[serde(default)]
    pub measure: bool,
    #[serde(default)]
    pub overlays: Vec<String>,
    pub sensors: bool,
    pub ticked: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ScanTicks {
    pub describe: bool,
    pub measure: bool,
    pub overlays: Option<Vec<String>>,
    pub sensors: bool,
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
            measure: stored.measure,
            overlays: Some(stored.overlays),
            sensors: stored.sensors,
            ticked: Some(stored.ticked),
            remembered: true,
        },
        None => ScanTicks {
            describe: defaults.scanning.describe,
            measure: false,
            overlays: None,
            sensors: defaults.scanning.sensors,
            ticked: None,
            remembered: false,
        },
    }
}

pub fn write(path: &Path, folder: &Path, ticks: StoredTicks) -> Result<(), String> {
    check_names(&ticks.ticked)?;
    check_names(&ticks.overlays)?;

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

    fn defaults(describe: bool, sensors: bool) -> Settings {
        Settings {
            scanning: Scanning { describe, sensors },
            ..Settings::default()
        }
    }

    fn stored(describe: bool, sensors: bool, ticked: &[&str]) -> StoredTicks {
        StoredTicks {
            describe,
            measure: false,
            overlays: vec![],
            sensors,
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
    fn a_folder_with_no_entry_takes_the_settings_defaults_and_measure_off() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(true, false)),
            ScanTicks {
                describe: true,
                measure: false,
                overlays: None,
                sensors: false,
                ticked: None,
                remembered: false
            }
        );
    }

    #[test]
    fn a_written_entry_is_read_back_for_that_folder_only() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        write(&file, Path::new("/repo"), stored(true, true, &["a"])).unwrap();

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(false, false)),
            ScanTicks {
                describe: true,
                measure: false,
                overlays: Some(vec![]),
                sensors: true,
                ticked: Some(vec!["a".to_string()]),
                remembered: true
            }
        );
        assert!(!read(&file, Path::new("/other"), &defaults(false, false)).remembered);
    }

    #[test]
    fn measure_and_overlays_round_trip() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let mut ticks = stored(false, false, &[]);

        ticks.measure = true;
        ticks.overlays = vec!["mutate".to_string(), "coverage".to_string()];

        write(&file, Path::new("/repo"), ticks).unwrap();

        let read_back = read(&file, Path::new("/repo"), &defaults(false, false));

        assert!(read_back.measure);
        assert_eq!(
            read_back.overlays,
            Some(vec!["mutate".to_string(), "coverage".to_string()])
        );
    }

    #[test]
    fn a_file_written_before_measure_existed_reads_measure_off_with_no_overlays() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(
            &file,
            r#"{"/repo":{"describe":true,"sensors":true,"ticked":["a"]}}"#,
        )
        .unwrap();

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(false, false)),
            ScanTicks {
                describe: true,
                measure: false,
                overlays: Some(vec![]),
                sensors: true,
                ticked: Some(vec!["a".to_string()]),
                remembered: true
            }
        );
    }

    #[test]
    fn writing_another_folder_keeps_the_first_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        write(&file, Path::new("/a"), stored(true, false, &[])).unwrap();
        write(&file, Path::new("/b"), stored(false, true, &[])).unwrap();

        assert!(read(&file, Path::new("/a"), &defaults(false, false)).remembered);
        assert!(read(&file, Path::new("/b"), &defaults(false, false)).remembered);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_malformed_file_reads_empty_and_is_replaced_on_write() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        fs::write(&file, "not json").unwrap();

        assert!(!read(&file, Path::new("/repo"), &defaults(false, false)).remembered);

        write(&file, Path::new("/repo"), stored(false, false, &[])).unwrap();

        assert!(read(&file, Path::new("/repo"), &defaults(false, false)).remembered);
    }

    #[test]
    fn a_ticked_name_that_is_not_a_sensor_name_is_refused() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert!(write(&file, Path::new("/repo"), stored(false, false, &["$(x)"])).is_err());
        assert!(!file.exists());
    }

    #[test]
    fn an_overlay_name_that_is_not_a_name_is_refused_and_leaves_no_file() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let mut ticks = stored(false, false, &[]);

        ticks.overlays = vec!["$(x)".to_string()];

        assert!(write(&file, Path::new("/repo"), ticks).is_err());
        assert!(!file.exists());
    }
}
