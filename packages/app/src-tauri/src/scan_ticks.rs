use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_safe::write_atomic;
use crate::scan_ticks_domain::{ScanTicksRepository, StoredTicks};

pub fn ticks_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("scan-ticks.json")
}

pub struct JsonScanTicks {
    path: PathBuf,
}

impl JsonScanTicks {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl ScanTicksRepository for JsonScanTicks {
    fn load(&self) -> BTreeMap<String, StoredTicks> {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn store(&self, all: &BTreeMap<String, StoredTicks>) -> Result<(), String> {
        let mut text = serde_json::to_string_pretty(all).map_err(|error| error.to_string())?;

        text.push('\n');

        write_atomic(&self.path, &text).map_err(|error| format!("{}: {error}", self.path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan_ticks_domain::tests::{contract, stored};
    use crate::scan_ticks_domain::{read, write, ScanTicks, SuiteTicks};
    use tempfile::TempDir;

    #[test]
    fn the_file_adapter_meets_the_scan_ticks_contract() {
        let dir = TempDir::new().unwrap();

        contract::scan_ticks_repository(&JsonScanTicks::new(ticks_file_in(dir.path())));
    }

    #[test]
    fn reads_analysis_true_from_a_file_without_it() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());

        fs::write(&file, r#"{"/repo":{"describe":true,"ticked":["a"]}}"#).unwrap();

        assert!(read(&repository, Path::new("/repo")).analysis);
    }

    #[test]
    fn round_trips_analysis_false() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());
        let mut off = stored(false, &[]);

        off.analysis = false;

        write(&repository, Path::new("/repo"), off).unwrap();

        assert!(!read(&repository, Path::new("/repo")).analysis);
    }

    #[test]
    fn the_file_sits_in_the_config_folder() {
        assert_eq!(
            ticks_file_in(Path::new("/cfg")),
            Path::new("/cfg/scan-ticks.json")
        );
    }

    #[test]
    fn a_written_entry_is_read_back_for_that_folder_only() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());

        write(&repository, Path::new("/repo"), stored(true, &["a"])).unwrap();

        assert_eq!(
            read(&repository, Path::new("/repo")),
            ScanTicks {
                describe: true,
                analysis: true,
                ticked: Some(vec!["a".to_string()]),
                only_view: false,
                remembered: true,
                suites: BTreeMap::new(),
                folds: Vec::new()
            }
        );
        assert!(!read(&repository, Path::new("/other")).remembered);
    }

    #[test]
    fn an_old_entry_without_only_view_reads_false_and_a_written_one_reads_back() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());

        fs::write(&file, r#"{"/repo":{"describe":true,"ticked":["a"]}}"#).unwrap();

        assert!(!read(&repository, Path::new("/repo")).only_view);

        let mut ticks = stored(true, &["a"]);

        ticks.only_view = true;
        write(&repository, Path::new("/repo"), ticks).unwrap();

        assert!(read(&repository, Path::new("/repo")).only_view);
        assert!(
            serde_json::to_value(read(&repository, Path::new("/repo"))).unwrap()["onlyView"]
                .as_bool()
                .unwrap()
        );
    }

    #[test]
    fn write_never_stores_the_retired_fields() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());
        let mut ticks = stored(false, &["a"]);

        ticks.measure = true;
        ticks.overlays = vec!["mutate".to_string()];
        ticks.sensors = Some(true);

        write(&repository, Path::new("/repo"), ticks).unwrap();

        let text = fs::read_to_string(&file).unwrap();

        assert!(!text.contains("measure"));
        assert!(!text.contains("overlays"));
        assert!(!text.contains("sensors"));
    }

    #[test]
    fn writing_another_folder_keeps_the_first_and_leaves_no_temp_file() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());

        write(&repository, Path::new("/a"), stored(true, &[])).unwrap();
        write(&repository, Path::new("/b"), stored(false, &[])).unwrap();

        assert!(read(&repository, Path::new("/a")).remembered);
        assert!(read(&repository, Path::new("/b")).remembered);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_malformed_file_reads_empty_and_is_replaced_on_write() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());

        fs::write(&file, "not json").unwrap();

        assert!(!read(&repository, Path::new("/repo")).remembered);

        write(&repository, Path::new("/repo"), stored(false, &[])).unwrap();

        assert!(read(&repository, Path::new("/repo")).remembered);
    }

    #[test]
    fn suite_ticks_and_folds_round_trip_and_survive_a_second_write_of_the_same_entry() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());
        let mut ticks = stored(false, &[]);

        ticks.suites.insert(
            "crap".to_string(),
            SuiteTicks {
                ticked: vec!["unit".to_string()],
                known: vec!["unit".to_string(), "web".to_string()],
            },
        );
        ticks.folds = vec!["crap".to_string()];

        write(&repository, Path::new("/repo"), ticks.clone()).unwrap();

        let read_back = read(&repository, Path::new("/repo"));

        assert_eq!(read_back.suites, ticks.suites);
        assert_eq!(read_back.folds, ticks.folds);
    }

    #[test]
    fn an_old_file_without_suites_or_folds_reads_both_empty() {
        let dir = TempDir::new().unwrap();
        let file = ticks_file_in(dir.path());
        let repository = JsonScanTicks::new(file.clone());

        fs::write(&file, r#"{"/repo":{"describe":true,"ticked":["a"]}}"#).unwrap();

        let read_back = read(&repository, Path::new("/repo"));

        assert!(read_back.suites.is_empty());
        assert!(read_back.folds.is_empty());
    }
}
