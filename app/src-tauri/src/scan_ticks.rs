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
    pub sensors: bool,
    pub ticked: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ScanTicks {
    pub describe: bool,
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
            sensors: stored.sensors,
            ticked: Some(stored.ticked),
            remembered: true,
        },
        None => ScanTicks {
            describe: defaults.scanning.describe,
            sensors: defaults.scanning.sensors,
            ticked: None,
            remembered: false,
        },
    }
}

pub fn write(
    path: &Path,
    folder: &Path,
    describe: bool,
    sensors: bool,
    ticked: Vec<String>,
) -> Result<(), String> {
    check_names(&ticked)?;

    let mut all = read_all(path);

    all.insert(
        folder.display().to_string(),
        StoredTicks {
            describe,
            sensors,
            ticked,
        },
    );

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

    #[test]
    fn the_file_sits_in_the_config_folder() {
        assert_eq!(
            ticks_file_in(Path::new("/cfg")),
            Path::new("/cfg/scan-ticks.json")
        );
    }

    #[test]
    fn a_folder_with_no_entry_takes_the_settings_defaults() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(true, false)),
            ScanTicks {
                describe: true,
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

        write(&file, Path::new("/repo"), true, true, vec!["a".to_string()]).unwrap();

        assert_eq!(
            read(&file, Path::new("/repo"), &defaults(false, false)),
            ScanTicks {
                describe: true,
                sensors: true,
                ticked: Some(vec!["a".to_string()]),
                remembered: true
            }
        );
        assert!(!read(&file, Path::new("/other"), &defaults(false, false)).remembered);
    }

    #[test]
    fn writing_another_folder_keeps_the_first_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        write(&file, Path::new("/a"), true, false, vec![]).unwrap();
        write(&file, Path::new("/b"), false, true, vec![]).unwrap();

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

        write(&file, Path::new("/repo"), false, false, vec![]).unwrap();

        assert!(read(&file, Path::new("/repo"), &defaults(false, false)).remembered);
    }

    #[test]
    fn a_ticked_name_that_is_not_a_sensor_name_is_refused() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());

        assert!(write(
            &file,
            Path::new("/repo"),
            false,
            false,
            vec!["$(x)".to_string()]
        )
        .is_err());
        assert!(!file.exists());
    }
}
