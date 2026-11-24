use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::fs_safe::checked_relative;

const RUN_LOG: &str = ".recognizer/cache/log";
const RUN_LOG_KEEP: usize = 50;
const RUN_RECORD_CAP: u64 = 2 * 1024 * 1024;
const POLICY: &str = ".recognizer/policy.yaml";
const CONFIG: &str = ".recognizer/config.yaml";
const BASELINE: &str = ".recognizer/baselines/violations.json";

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

#[derive(Debug, PartialEq, Serialize)]
pub struct SensorInputs {
    pub policy: Option<String>,
    pub config: Option<String>,
    pub baseline: Option<String>,
    pub refused: Vec<String>,
    pub analysis: bool,
}

impl Default for SensorInputs {
    fn default() -> Self {
        SensorInputs {
            policy: None,
            config: None,
            baseline: None,
            refused: Vec::new(),
            analysis: true,
        }
    }
}

pub fn modified_ms(path: &Path) -> Option<f64> {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as f64)
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
        analysis: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
    fn read_inputs_default_carries_analysis_true() {
        assert!(SensorInputs::default().analysis);
        assert!(read_inputs(TempDir::new().unwrap().path()).analysis);
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
}
