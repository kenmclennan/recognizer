use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SuiteTicks {
    pub ticked: Vec<String>,
    pub known: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredTicks {
    pub describe: bool,
    #[serde(default = "yes")]
    pub analysis: bool,
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
    pub analysis: bool,
    pub ticked: Option<Vec<String>>,
    #[serde(rename = "onlyView")]
    pub only_view: bool,
    pub remembered: bool,
    pub suites: BTreeMap<String, SuiteTicks>,
    pub folds: Vec<String>,
}

pub trait ScanTicksRepository {
    fn load(&self) -> BTreeMap<String, StoredTicks>;
    fn store(&self, all: &BTreeMap<String, StoredTicks>) -> Result<(), String>;
}

fn yes() -> bool {
    true
}

pub fn read(repository: &dyn ScanTicksRepository, folder: &Path) -> ScanTicks {
    match repository.load().remove(&folder.display().to_string()) {
        Some(stored) => ScanTicks {
            describe: stored.describe,
            analysis: stored.analysis,
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
            analysis: true,
            ticked: Some(Vec::new()),
            only_view: false,
            remembered: false,
            suites: BTreeMap::new(),
            folds: Vec::new(),
        },
    }
}

pub fn write(
    repository: &dyn ScanTicksRepository,
    folder: &Path,
    ticks: StoredTicks,
) -> Result<(), String> {
    let mut all = repository.load();

    all.insert(folder.display().to_string(), ticks);

    repository.store(&all)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::RefCell;

    pub fn stored(describe: bool, ticked: &[&str]) -> StoredTicks {
        StoredTicks {
            describe,
            analysis: true,
            measure: false,
            overlays: vec![],
            sensors: None,
            ticked: ticked.iter().map(|name| name.to_string()).collect(),
            only_view: false,
            suites: BTreeMap::new(),
            folds: Vec::new(),
        }
    }

    pub mod contract {
        use super::*;

        pub fn scan_ticks_repository(repository: &dyn ScanTicksRepository) {
            assert!(repository.load().is_empty());

            let mut first = BTreeMap::new();

            first.insert("/repo".to_string(), stored(true, &["a"]));
            repository.store(&first).unwrap();

            assert!(!repository.load().is_empty());
            assert_eq!(repository.load(), first);

            let mut second = BTreeMap::new();

            second.insert("/other".to_string(), stored(false, &["b"]));
            repository.store(&second).unwrap();

            assert_eq!(repository.load(), second);
        }
    }

    #[derive(Default)]
    struct FakeTicks {
        all: RefCell<BTreeMap<String, StoredTicks>>,
    }

    impl ScanTicksRepository for FakeTicks {
        fn load(&self) -> BTreeMap<String, StoredTicks> {
            self.all.borrow().clone()
        }

        fn store(&self, all: &BTreeMap<String, StoredTicks>) -> Result<(), String> {
            *self.all.borrow_mut() = all.clone();

            Ok(())
        }
    }

    fn holding(folder: &str, ticks: StoredTicks) -> FakeTicks {
        let fake = FakeTicks::default();

        fake.all.borrow_mut().insert(folder.to_string(), ticks);

        fake
    }

    #[test]
    fn the_fake_meets_the_scan_ticks_contract() {
        contract::scan_ticks_repository(&FakeTicks::default());
    }

    #[test]
    fn a_folder_with_no_entry_ticks_nothing() {
        let fake = holding("/elsewhere", stored(true, &["a"]));

        assert_eq!(
            read(&fake, Path::new("/repo")),
            ScanTicks {
                describe: false,
                analysis: true,
                ticked: Some(vec![]),
                only_view: false,
                remembered: false,
                suites: BTreeMap::new(),
                folds: Vec::new()
            }
        );
    }

    #[test]
    fn an_old_entry_with_sensors_off_reads_no_sensors_ticked() {
        let mut old = stored(true, &["a"]);

        old.measure = true;
        old.overlays = vec!["m".to_string()];
        old.sensors = Some(false);

        let fake = holding("/repo", old);

        assert_eq!(
            read(&fake, Path::new("/repo")),
            ScanTicks {
                describe: true,
                analysis: true,
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
        let mut old = stored(false, &["a"]);

        old.sensors = Some(true);

        let fake = holding("/repo", old);

        assert_eq!(
            read(&fake, Path::new("/repo")).ticked,
            Some(vec!["a".to_string()])
        );
    }

    #[test]
    fn writing_a_folder_keeps_the_entries_of_other_folders() {
        let fake = holding("/a", stored(true, &["x"]));

        write(&fake, Path::new("/b"), stored(false, &[])).unwrap();

        assert!(read(&fake, Path::new("/a")).remembered);
        assert!(read(&fake, Path::new("/b")).remembered);
        assert_eq!(fake.load().len(), 2);
    }
}
