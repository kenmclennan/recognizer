use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fs_safe::checked_relative;
use crate::tool_runner::{runner, Captured, ToolRunner};

pub const OUTPUT_MARK: &str = "@@recognizer-output@@";
const CACHE: &str = ".recognizer/cache";
const POLICY: &str = ".recognizer/policy.yaml";
const BASELINE: &str = ".recognizer/baselines/violations.json";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScanFile {
    pub file: String,
    pub text: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ScanReport {
    CommandMissing {
        hint: String,
    },
    ScanFailed {
        exit_code: i32,
        stderr: String,
    },
    Scanned {
        exit_code: i32,
        stderr: String,
        scans: Vec<ScanFile>,
        policy: Option<String>,
        baseline: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShippedSensor {
    pub name: String,
    #[serde(default)]
    pub display: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expansion: Option<String>,
    #[serde(default, rename = "runsTests", alias = "runs_tests")]
    pub runs_tests: bool,
    #[serde(default)]
    pub scoped: bool,
    #[serde(default = "listed_by_default")]
    pub listed: bool,
    #[serde(default)]
    pub metrics: Vec<ShippedMetric>,
    #[serde(default)]
    pub findings: Vec<serde_json::Value>,
    #[serde(default)]
    pub settings: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShippedMetric {
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub help: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub granularity: String,
    pub bad: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<ShippedPublished>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShippedPublished {
    pub value: f64,
    pub source: String,
}

fn listed_by_default() -> bool {
    true
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ShippedDescriber {
    Ok {
        command: Vec<String>,
        version: String,
        source: String,
    },
    Unavailable {
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
struct DescriberJson {
    command: Vec<String>,
    version: String,
    source: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ShippedSensors {
    Ok { sensors: Vec<ShippedSensor> },
    Unavailable { reason: String },
}

#[derive(Debug, Default, PartialEq)]
pub struct CacheRead {
    pub scans: Vec<ScanFile>,
    pub policy: Option<String>,
    pub baseline: Option<String>,
    pub refused: Vec<String>,
}

pub fn plain_scan_args(folder: &Path) -> Vec<String> {
    vec!["scan".to_string(), folder.display().to_string()]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Describe {
    Off,
    Stale,
    All,
}

impl Describe {
    pub fn from_flags(describe: bool, all: bool) -> Self {
        match (describe, all) {
            (false, _) => Describe::Off,
            (true, false) => Describe::Stale,
            (true, true) => Describe::All,
        }
    }
}

pub fn scan_flags(describe: Describe, sense: &[String]) -> Vec<String> {
    let mut flags = vec!["--json".to_string()];

    match describe {
        Describe::Off => {}
        Describe::Stale => flags.push("--describe".to_string()),
        Describe::All => flags.push("--describe=all".to_string()),
    }

    if !sense.is_empty() {
        flags.push("--sense".to_string());
        flags.push(sense.join(","));
    }

    flags
}

pub fn scan_args(folder: &Path, describe: Describe, sense: &[String]) -> Vec<String> {
    let mut args = plain_scan_args(folder);

    args.extend(scan_flags(describe, sense));

    args
}

pub fn sensors_args() -> Vec<String> {
    vec!["sensors".to_string(), "--json".to_string()]
}

pub fn describer_args(folder: &Path) -> Vec<String> {
    vec![
        "describe".to_string(),
        "--describer".to_string(),
        "--json".to_string(),
        "--repository".to_string(),
        folder.display().to_string(),
    ]
}

pub fn shipped_describer_for(exit: Option<i32>, stdout: &str, stderr: &str) -> ShippedDescriber {
    let unavailable = |reason: String| ShippedDescriber::Unavailable { reason };
    let stdout = clean_output(stdout);

    match exit {
        Some(127) => unavailable(missing_hint()),
        Some(0) => match serde_json::from_str::<DescriberJson>(stdout.trim()) {
            Ok(found) => ShippedDescriber::Ok {
                command: found.command,
                version: found.version,
                source: found.source,
            },
            Err(_) => unavailable(
                "recognizer describe --describer printed something that is not the describer"
                    .to_string(),
            ),
        },
        other => unavailable(format!(
            "recognizer describe --describer exited {}: {}",
            other.map_or("without a status".to_string(), |code| code.to_string()),
            stderr.trim()
        )),
    }
}

pub fn shipped_describer(folder: &Path) -> ShippedDescriber {
    shipped_describer_with(runner(), RECOGNIZER_COMMAND, folder)
}

pub fn shipped_describer_with(
    runner: &ToolRunner,
    command: &str,
    folder: &Path,
) -> ShippedDescriber {
    match runner.capture(command, &describer_args(folder), true) {
        Err(fault) => ShippedDescriber::Unavailable {
            reason: fault.message(),
        },
        Ok(Captured {
            code,
            stdout,
            stderr,
        }) => shipped_describer_for(code, &stdout, &stderr),
    }
}

pub const RECOGNIZER_COMMAND: &str = "recognizer";

pub fn missing_hint() -> String {
    "recognizer was not found on your login shell's PATH. Install it with brew install --cask kenmclennan/tap/recognizer.".to_string()
}

fn scan_file_name(name: &str) -> bool {
    name.strip_prefix("scan.")
        .and_then(|rest| rest.strip_suffix(".json"))
        .is_some_and(|language| !language.is_empty())
}

pub fn read_cache(folder: &Path) -> CacheRead {
    let mut read = CacheRead::default();
    let mut names: Vec<String> = fs::read_dir(folder.join(CACHE))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter(|name| scan_file_name(name))
                .collect()
        })
        .unwrap_or_default();

    names.sort();

    for name in names {
        let relative = format!("{CACHE}/{name}");

        match checked_relative(folder, &relative).and_then(|path| {
            fs::read_to_string(path).map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok(text) => read.scans.push(ScanFile { file: name, text }),
            Err(reason) => read.refused.push(reason),
        }
    }

    if fs::symlink_metadata(folder.join(POLICY)).is_ok() {
        match checked_relative(folder, POLICY)
            .and_then(|path| fs::read_to_string(path).map_err(|error| format!("{POLICY}: {error}")))
        {
            Ok(text) => read.policy = Some(text),
            Err(reason) => read.refused.push(reason),
        }
    }

    if fs::symlink_metadata(folder.join(BASELINE)).is_ok() {
        match checked_relative(folder, BASELINE).and_then(|path| {
            fs::read_to_string(path).map_err(|error| format!("{BASELINE}: {error}"))
        }) {
            Ok(text) => read.baseline = Some(text),
            Err(reason) => read.refused.push(reason),
        }
    }

    read
}

pub fn report_for(
    exit: Option<i32>,
    stderr: String,
    read: impl FnOnce() -> CacheRead,
) -> ScanReport {
    match exit {
        Some(127) => ScanReport::CommandMissing {
            hint: missing_hint(),
        },
        Some(code @ (0 | 1)) => {
            let cache = read();
            let mut stderr = stderr;

            for reason in cache.refused {
                stderr.push_str(&format!("refused {reason}\n"));
            }

            ScanReport::Scanned {
                exit_code: code,
                stderr,
                scans: cache.scans,
                policy: cache.policy,
                baseline: cache.baseline,
            }
        }
        other => ScanReport::ScanFailed {
            exit_code: other.unwrap_or(-1),
            stderr,
        },
    }
}

pub fn strip_escapes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.peek().copied() {
                Some('[') => {
                    chars.next();

                    for next in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();

                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }

                        if next == '\u{1b}' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }

                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            },
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }

    out
}

pub fn clean_output(stdout: &str) -> String {
    let body = match stdout.find(OUTPUT_MARK) {
        Some(at) => {
            let after = &stdout[at + OUTPUT_MARK.len()..];

            after.split_once('\n').map_or("", |(_, rest)| rest)
        }
        None => stdout,
    };

    strip_escapes(body)
}

pub fn shipped_sensors_for(exit: Option<i32>, stdout: &str, stderr: &str) -> ShippedSensors {
    let unavailable = |reason: String| ShippedSensors::Unavailable { reason };
    let stdout = clean_output(stdout);
    let stdout = stdout.as_str();

    match exit {
        Some(127) => unavailable(missing_hint()),
        Some(0) => match serde_json::from_str::<Vec<ShippedSensor>>(stdout) {
            Ok(sensors) => ShippedSensors::Ok { sensors },
            Err(_) => {
                unavailable("recognizer sensors printed something that is not the list".to_string())
            }
        },
        other => unavailable(format!(
            "recognizer sensors exited {}: {}",
            other.map_or("without a status".to_string(), |code| code.to_string()),
            stderr.trim()
        )),
    }
}

pub fn shipped_sensors() -> ShippedSensors {
    shipped_sensors_with(runner(), RECOGNIZER_COMMAND)
}

pub fn shipped_sensors_with(runner: &ToolRunner, command: &str) -> ShippedSensors {
    match runner.capture(command, &sensors_args(), true) {
        Err(fault) => ShippedSensors::Unavailable {
            reason: fault.message(),
        },
        Ok(Captured {
            code,
            stdout,
            stderr,
        }) => shipped_sensors_for(code, &stdout, &stderr),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlannedWork {
    pub unit: String,
    pub to_perform: u64,
}

pub fn work_args(
    folder: &Path,
    sensor: &str,
    modules_file: Option<&Path>,
    suites_file: Option<&Path>,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "sensors",
        "check",
        sensor,
        "--work",
        "--json",
        "--repository",
    ]
    .iter()
    .map(|part| part.to_string())
    .collect();

    args.push(folder.display().to_string());

    for (flag, file) in [("--modules", modules_file), ("--suites", suites_file)] {
        if let Some(path) = file {
            args.push(flag.to_string());
            args.push(path.display().to_string());
        }
    }

    args
}

pub fn planned_work_from(stdout: &str) -> Option<PlannedWork> {
    let document: serde_json::Value = serde_json::from_str(&clean_output(stdout)).ok()?;
    let work = document.get("sensors")?.as_array()?.first()?.get("work")?;

    Some(PlannedWork {
        unit: work
            .get("unit")?
            .as_str()
            .filter(|unit| !unit.is_empty())?
            .to_string(),
        to_perform: work.get("to_perform")?.as_u64()?,
    })
}

fn work_file(folder: &Path, kind: &str) -> PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let number = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    folder
        .join(CACHE)
        .join(format!("work-{kind}-{}-{number}.json", std::process::id()))
}

pub fn planned_work_with(
    runner: &ToolRunner,
    command: &str,
    folder: &Path,
    sensor: &str,
    modules: Option<&[String]>,
    suites: Option<&[String]>,
) -> Result<Option<PlannedWork>, String> {
    crate::sensors::check_names(&[sensor.to_string()])?;

    if let Some(ids) = modules {
        crate::scan_run::check_modules(ids)?;
    }

    if let Some(names) = suites {
        crate::scan_run::check_suites(&std::collections::BTreeMap::from([(
            sensor.to_string(),
            names.to_vec(),
        )]))?;
    }

    fs::create_dir_all(folder.join(CACHE)).map_err(|error| error.to_string())?;

    let mut files: Vec<PathBuf> = Vec::new();
    let mut staged = |kind: &str, text: String| -> Result<PathBuf, String> {
        let path = work_file(folder, kind);

        crate::fs_safe::write_atomic(&path, &text)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        files.push(path.clone());

        Ok(path)
    };

    let staged_files = (|| {
        let modules_path = modules
            .map(|ids| staged("modules", serde_json::to_string(ids).unwrap_or_default()))
            .transpose()?;
        let suites_path = suites
            .map(|names| staged("suites", serde_json::to_string(names).unwrap_or_default()))
            .transpose()?;

        Ok::<_, String>((modules_path, suites_path))
    })();

    let result = staged_files.and_then(|(modules_path, suites_path)| {
        let args = work_args(
            folder,
            sensor,
            modules_path.as_deref(),
            suites_path.as_deref(),
        );

        runner
            .capture(command, &args, false)
            .map_err(|fault| fault.message())
    });

    for path in &files {
        let _ = fs::remove_file(path);
    }

    let captured = result?;

    Ok(match captured.code {
        Some(0) | Some(1) => planned_work_from(&captured.stdout),
        _ => None,
    })
}

pub fn planned_work(
    folder: &Path,
    sensor: &str,
    modules: Option<&[String]>,
    suites: Option<&[String]>,
) -> Result<Option<PlannedWork>, String> {
    planned_work_with(
        runner(),
        RECOGNIZER_COMMAND,
        folder,
        sensor,
        modules,
        suites,
    )
}

pub const IGNORE_RETIRED_CONFIG: &str = "--ignore-retired-config";

pub fn historical_scan_args(folder: &Path) -> Vec<String> {
    let mut args = plain_scan_args(folder);

    args.push(IGNORE_RETIRED_CONFIG.to_string());

    args
}

pub fn scan_with(
    runner: &ToolRunner,
    folder: &Path,
    command: &str,
    historical: bool,
) -> ScanReport {
    let args = if historical {
        historical_scan_args(folder)
    } else {
        plain_scan_args(folder)
    };

    match runner.capture(command, &args, false) {
        Err(fault) => ScanReport::CommandMissing {
            hint: fault.message(),
        },
        Ok(Captured { code, stderr, .. }) => report_for(code, stderr, || read_cache(folder)),
    }
}

pub fn config_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_runner::tests::{runner_with, shell_with_path, working_runner};
    use std::time::Duration;
    use tempfile::TempDir;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn the_scan_folder_is_its_own_argv_entry() {
        let folder = Path::new("/tmp/it's a \"folder\" $(rm -rf x)");
        let args = plain_scan_args(folder);

        assert_eq!(args, ["scan", &folder.display().to_string()]);
        assert_eq!(args.len(), 2);
    }

    #[test]
    fn the_argv_agrees_with_the_shared_fixture() {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/views/historical-scan-args.json"
        ))
        .unwrap();
        let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
        let folder = Path::new(fixture["folder"].as_str().unwrap());
        let listed = |key: &str| -> Vec<String> {
            fixture[key]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| entry.as_str().unwrap().to_string())
                .collect()
        };

        assert_eq!(historical_scan_args(folder), listed("historical"));
        assert_eq!(scan_args(folder, Describe::Off, &[]), listed("open_folder"));
    }

    #[test]
    fn only_the_historical_argv_carries_the_ignore_retired_config_flag() {
        let folder = Path::new("/tmp/folder");

        assert_eq!(
            historical_scan_args(folder),
            ["scan", "/tmp/folder", "--ignore-retired-config"]
        );
        assert!(!plain_scan_args(folder).contains(&IGNORE_RETIRED_CONFIG.to_string()));

        for describe in [Describe::Off, Describe::Stale, Describe::All] {
            assert!(!scan_args(folder, describe, &names(&["a"]))
                .contains(&IGNORE_RETIRED_CONFIG.to_string()));
        }
    }

    #[test]
    fn scan_with_a_missing_command_reports_it_missing() {
        let dir = TempDir::new().unwrap();
        let runner = working_runner(dir.path());

        match scan_with(&runner, dir.path(), "/nonexistent/recognizer", false) {
            ScanReport::CommandMissing { .. } => {}
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_scan_flags_are_json_plus_what_was_asked_and_never_extract() {
        assert_eq!(scan_flags(Describe::Off, &[]), ["--json"]);
        assert_eq!(scan_flags(Describe::Stale, &[]), ["--json", "--describe"]);
        assert_eq!(scan_flags(Describe::All, &[]), ["--json", "--describe=all"]);
        assert_eq!(
            scan_flags(Describe::Off, &names(&["a", "b"])),
            ["--json", "--sense", "a,b"]
        );
        assert_eq!(
            scan_flags(Describe::Stale, &names(&["c"])),
            ["--json", "--describe", "--sense", "c"]
        );

        for describe in [Describe::Off, Describe::Stale, Describe::All] {
            for sense in [names(&[]), names(&["a"])] {
                assert!(!scan_flags(describe, &sense).contains(&"--extract".to_string()));
            }
        }
    }

    #[test]
    fn the_scan_flags_follow_the_folder_in_argv() {
        let folder = Path::new("/tmp/it's a \"folder\" $(rm -rf x)");
        let args = scan_args(folder, Describe::Stale, &names(&["$(rm -rf x)"]));

        assert_eq!(args[0], "scan");
        assert_eq!(args[1], folder.display().to_string());
        assert_eq!(
            args[2..],
            ["--json", "--describe", "--sense", "$(rm -rf x)"]
        );
    }

    #[test]
    fn the_describer_and_sensors_argv_carry_only_their_flags() {
        assert_eq!(
            describer_args(Path::new("/tmp/repo")),
            [
                "describe",
                "--describer",
                "--json",
                "--repository",
                "/tmp/repo"
            ]
        );
        assert_eq!(sensors_args(), ["sensors", "--json"]);
    }

    #[test]
    fn the_hint_says_to_install_and_names_no_setting() {
        let hint = missing_hint();

        assert!(hint.contains("brew install --cask kenmclennan/tap/recognizer"));
        assert!(!hint.contains("recognizer_path"));
        assert!(!hint.contains("Settings"));
    }

    fn cache_folder() -> TempDir {
        let dir = TempDir::new().unwrap();
        let cache = dir.path().join("repo/.recognizer/cache");

        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("scan.python.json"), "py").unwrap();
        fs::write(cache.join("scan.typescript.json"), "ts").unwrap();
        fs::write(cache.join("overlay.coverage.json"), "cov").unwrap();
        fs::write(
            dir.path().join("repo/.recognizer/policy.yaml"),
            "levels: []",
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("repo/.recognizer/baselines")).unwrap();
        fs::write(
            dir.path()
                .join("repo/.recognizer/baselines/violations.json"),
            "{}",
        )
        .unwrap();

        dir
    }

    #[test]
    fn the_cache_reader_returns_scans_in_name_order_the_policy_and_the_baseline() {
        let dir = cache_folder();
        let read = read_cache(&dir.path().join("repo"));

        assert_eq!(
            read.scans,
            vec![
                ScanFile {
                    file: "scan.python.json".to_string(),
                    text: "py".to_string()
                },
                ScanFile {
                    file: "scan.typescript.json".to_string(),
                    text: "ts".to_string()
                },
            ]
        );
        assert_eq!(read.policy.as_deref(), Some("levels: []"));
        assert_eq!(read.baseline.as_deref(), Some("{}"));
        assert!(read.refused.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_cache_is_not_read_and_is_reported() {
        let dir = cache_folder();
        let repo = dir.path().join("repo");

        fs::write(dir.path().join("secret.json"), "secret").unwrap();
        std::os::unix::fs::symlink(
            dir.path().join("secret.json"),
            repo.join(".recognizer/cache/scan.evil.json"),
        )
        .unwrap();

        let read = read_cache(&repo);

        assert_eq!(read.scans.len(), 2);
        assert!(read.scans.iter().all(|scan| scan.text != "secret"));
        assert_eq!(read.refused.len(), 1);
        assert!(read.refused[0].contains("scan.evil.json"));
    }

    #[test]
    fn a_folder_without_a_cache_reads_nothing() {
        let dir = TempDir::new().unwrap();

        assert_eq!(read_cache(dir.path()), CacheRead::default());
    }

    #[test]
    fn exit_127_is_a_missing_command_without_reading_the_cache() {
        let report = report_for(Some(127), String::new(), || {
            panic!("the cache must not be read")
        });

        assert!(matches!(report, ScanReport::CommandMissing { .. }));
    }

    #[test]
    fn exit_one_keeps_the_scans_and_carries_stderr() {
        let report = report_for(Some(1), "python failed\n".to_string(), || CacheRead {
            scans: vec![ScanFile {
                file: "scan.typescript.json".to_string(),
                text: "ts".to_string(),
            }],
            policy: None,
            baseline: None,
            refused: vec!["x: leaves the folder".to_string()],
        });

        match report {
            ScanReport::Scanned {
                exit_code,
                stderr,
                scans,
                ..
            } => {
                assert_eq!(exit_code, 1);
                assert!(stderr.starts_with("python failed\n"));
                assert!(stderr.contains("refused x: leaves the folder"));
                assert_eq!(scans.len(), 1);
            }
            other => panic!("expected scanned, got {other:?}"),
        }
    }

    #[test]
    fn exit_two_and_a_signal_are_scan_failed() {
        let two = report_for(Some(2), "bad".to_string(), CacheRead::default);
        let signal = report_for(None, String::new(), CacheRead::default);

        assert_eq!(
            two,
            ScanReport::ScanFailed {
                exit_code: 2,
                stderr: "bad".to_string()
            }
        );
        assert!(matches!(
            signal,
            ScanReport::ScanFailed { exit_code: -1, .. }
        ));
    }

    #[test]
    fn the_report_serialises_to_the_webview_contract() {
        let json = serde_json::to_value(ScanReport::Scanned {
            exit_code: 0,
            stderr: String::new(),
            scans: vec![ScanFile {
                file: "scan.python.json".to_string(),
                text: "{}".to_string(),
            }],
            policy: None,
            baseline: None,
        })
        .unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "status": "scanned",
                "exitCode": 0,
                "stderr": "",
                "scans": [{ "file": "scan.python.json", "text": "{}" }],
                "policy": null,
                "baseline": null
            })
        );
        assert_eq!(
            serde_json::to_value(ScanReport::CommandMissing {
                hint: "h".to_string()
            })
            .unwrap(),
            serde_json::json!({ "status": "command-missing", "hint": "h" })
        );
    }

    #[cfg(unix)]
    fn fake_command(dir: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.join("fake-recognizer");

        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        path
    }

    #[test]
    fn the_planned_work_is_read_from_the_sensor_check_and_every_failure_is_none() {
        let dir = TempDir::new().unwrap();
        let tools = TempDir::new().unwrap();
        let runner = working_runner(tools.path());
        let good = fake_command(
            tools.path(),
            r#"case "$*" in *--work*--modules*) echo '{"ready":true,"sensors":[{"name":"mutation","ready":true,"gaps":[],"notes":[],"work":{"unit":"functions","to_perform":7,"reusable":3}}]}';; *) exit 3;; esac"#,
        );
        let command = good.display().to_string();
        let modules = vec!["app/a.py".to_string()];

        assert_eq!(
            planned_work_with(
                &runner,
                &command,
                dir.path(),
                "mutation",
                Some(&modules),
                None
            ),
            Ok(Some(PlannedWork {
                unit: "functions".to_string(),
                to_perform: 7
            }))
        );
        assert_eq!(
            planned_work_with(&runner, &command, dir.path(), "mutation", None, None),
            Ok(None)
        );
        assert!(planned_work_with(
            &runner,
            "/nonexistent/recognizer",
            dir.path(),
            "mutation",
            None,
            None
        )
        .is_err());
        assert_eq!(
            planned_work_with(&runner, &command, dir.path(), "-x", None, None),
            Err("-x is not a sensor name".to_string())
        );
        assert!(
            planned_work_with(&runner, &command, dir.path(), "mutation", Some(&[]), None).is_err()
        );

        let left: Vec<_> = fs::read_dir(dir.path().join(".recognizer/cache"))
            .unwrap()
            .collect();

        assert!(left.is_empty());
    }

    #[test]
    fn the_planned_work_text_without_work_or_with_a_bad_count_is_none() {
        assert_eq!(planned_work_from(r#"{"sensors":[{"name":"crap"}]}"#), None);
        assert_eq!(
            planned_work_from(r#"{"sensors":[{"work":{"unit":"functions","to_perform":-1}}]}"#),
            None
        );
        assert_eq!(planned_work_from("nope"), None);
    }

    #[test]
    fn the_work_arguments_carry_the_files_only_when_given() {
        let folder = Path::new("/r");

        assert_eq!(
            work_args(folder, "mutation", None, None),
            [
                "sensors",
                "check",
                "mutation",
                "--work",
                "--json",
                "--repository",
                "/r"
            ]
        );
        assert_eq!(
            work_args(
                folder,
                "mutation",
                Some(Path::new("/m.json")),
                Some(Path::new("/s.json"))
            )[7..],
            ["--modules", "/m.json", "--suites", "/s.json"]
        );
    }

    #[test]
    fn the_shipped_list_is_read_from_the_command_and_failures_are_unavailable() {
        let dir = TempDir::new().unwrap();
        let good = fake_command(
            dir.path(),
            r#"echo '[{"name":"duplication","description":"d","metrics":[],"findings":[],"settings":[]}]'"#,
        );
        let other = TempDir::new().unwrap();
        let bad = fake_command(other.path(), "echo nope");

        let runner = working_runner(dir.path());

        match shipped_sensors_with(&runner, &good.display().to_string()) {
            ShippedSensors::Ok { sensors } => {
                assert_eq!(sensors.len(), 1);
                assert_eq!(sensors[0].name, "duplication");
            }
            other => panic!("{other:?}"),
        }

        assert!(matches!(
            shipped_sensors_with(&runner, &bad.display().to_string()),
            ShippedSensors::Unavailable { .. }
        ));
        assert!(matches!(
            shipped_sensors_with(&runner, "/nonexistent/recognizer"),
            ShippedSensors::Unavailable { .. }
        ));
        assert!(matches!(
            shipped_sensors_for(Some(2), "", "bad"),
            ShippedSensors::Unavailable { reason } if reason.contains("exited 2: bad")
        ));
    }

    #[cfg(unix)]
    fn fake_shell(dir: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.join("fake-shell");

        fs::write(
            &path,
            "#!/bin/sh\nprintf '\\033]1337;RemoteHost=ken@host\\007\\033]1337;CurrentDir=/tmp\\007\\033]1337;ShellIntegrationVersion=18;shell=zsh\\007'\nshift\nexec /bin/sh -c \"$@\"\n",
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        path
    }

    #[cfg(unix)]
    #[test]
    fn a_profile_that_prints_escape_sequences_first_still_resolves_the_environment() {
        let dir = TempDir::new().unwrap();
        let shell = fake_shell(dir.path());
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);
        let other = TempDir::new().unwrap();
        let sensors = fake_command(
            other.path(),
            r#"echo '[{"name":"duplication","description":"d","metrics":[],"findings":[],"settings":[]}]'"#,
        );

        assert!(matches!(
            shipped_sensors_with(&runner, &sensors.display().to_string()),
            ShippedSensors::Ok { sensors } if sensors.len() == 1
        ));
    }

    #[test]
    fn escape_sequences_and_controls_are_stripped_and_the_mark_drops_what_precedes_it() {
        assert_eq!(
            strip_escapes(
                "\u{1b}]1337;RemoteHost=a\u{7}\u{1b}[31mred\u{1b}[0m\u{1b}]0;t\u{1b}\\ok\u{8}\n"
            ),
            "redok\n"
        );
        assert_eq!(
            clean_output(&format!("junk without newline\n{OUTPUT_MARK}\n0.1.77\n")),
            "0.1.77\n"
        );
        assert_eq!(clean_output("0.3.1\n"), "0.3.1\n");
    }

    #[test]
    fn a_full_shipped_entry_passes_findings_and_settings_through_unchanged() {
        let findings = serde_json::json!([{"kind":"crap","group":{"name":"C.R.A.P.","means":"m","todo":"t"},"help":"h","sentence":{"requires":["a.b"],"parts":[[{"when":[{"has":"a.b"}],"text":"x {a.b|num}"}]]}}]);
        let settings = serde_json::json!([{"key":"threshold","type":"number","default":30,"description":"d","example":"e"}]);
        let list = serde_json::json!([{
            "name": "crap",
            "display": "C.R.A.P.",
            "description": "d",
            "expansion": "C.R.A.P.: Change Risk Anti-Patterns.",
            "runs_tests": true,
            "scoped": true,
            "listed": true,
            "metrics": [],
            "findings": findings,
            "settings": settings,
        }])
        .to_string();

        match shipped_sensors_for(Some(0), &list, "") {
            ShippedSensors::Ok { sensors } => {
                let out = serde_json::to_value(&sensors[0]).unwrap();

                assert_eq!(out["findings"], findings);
                assert_eq!(out["settings"], settings);
                assert_eq!(out["description"], "d");
                assert_eq!(out["expansion"], "C.R.A.P.: Change Risk Anti-Patterns.");
                assert_eq!(out["scoped"], true);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_entry_without_expansion_or_published_parses_and_a_defaults_key_is_dropped() {
        let list = r#"[{"name":"m","display":"M","description":"d","defaults":{"threshold":1},"runs_tests":false,"scoped":false,"listed":true,"metrics":[{"name":"k","label":"k","title":"K","help":"h","type":"count","granularity":"member","bad":"low"}],"findings":[],"settings":[]}]"#;

        match shipped_sensors_for(Some(0), list, "") {
            ShippedSensors::Ok { sensors } => {
                let out = serde_json::to_value(&sensors[0]).unwrap();

                assert!(sensors[0].expansion.is_none());
                assert!(sensors[0].metrics[0].published.is_none());
                assert!(out.get("defaults").is_none());
                assert!(out.get("expansion").is_none());
                assert!(out["metrics"][0].get("published").is_none());
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_shipped_list_keeps_display_runs_tests_and_listed() {
        let list = r#"[{"name":"crap","display":"C.R.A.P.","description":"d","runs_tests":true,"listed":true,"metrics":[{"name":"crap","label":"CRAP","title":"C.R.A.P.","help":"h","type":"number","granularity":"member","bad":"high","published":{"value":30.0,"source":"s"}}]},{"name":"thresholds","display":"T","description":"d","runs_tests":false,"listed":false,"metrics":[]}]"#;

        match shipped_sensors_for(Some(0), list, "") {
            ShippedSensors::Ok { sensors } => {
                assert_eq!(sensors[0].display, "C.R.A.P.");
                assert!(sensors[0].runs_tests);
                assert!(sensors[0].listed);
                assert!(!sensors[1].listed);
                assert_eq!(
                    serde_json::to_value(&sensors[0]).unwrap()["metrics"],
                    serde_json::json!([{"name":"crap","label":"CRAP","title":"C.R.A.P.","help":"h","type":"number","granularity":"member","bad":"high","published":{"value":30.0,"source":"s"}}])
                );
                assert_eq!(
                    serde_json::to_value(&sensors[0]).unwrap()["runsTests"],
                    serde_json::json!(true)
                );
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_shipped_describer_is_read_from_the_json_and_a_failure_is_unavailable() {
        let json = r#"{"command":["recognizer-describe-claude","{request}"],"version":"p1","source":"shipped"}"#;

        assert_eq!(
            shipped_describer_for(Some(0), json, ""),
            ShippedDescriber::Ok {
                command: vec![
                    "recognizer-describe-claude".to_string(),
                    "{request}".to_string()
                ],
                version: "p1".to_string(),
                source: "shipped".to_string()
            }
        );
        assert!(matches!(
            shipped_describer_for(Some(2), "", "no describer"),
            ShippedDescriber::Unavailable { reason } if reason.contains("exited 2: no describer")
        ));
        assert!(matches!(
            shipped_describer_for(Some(0), "nope", ""),
            ShippedDescriber::Unavailable { .. }
        ));
        assert!(matches!(
            shipped_describer_with(
                &working_runner(TempDir::new().unwrap().path()),
                "/nonexistent/recognizer",
                Path::new("/tmp")
            ),
            ShippedDescriber::Unavailable { .. }
        ));
    }

    #[test]
    fn the_shipped_list_serialises_to_the_webview_contract() {
        assert_eq!(
            serde_json::to_value(ShippedSensors::Unavailable {
                reason: "r".to_string()
            })
            .unwrap(),
            serde_json::json!({ "status": "unavailable", "reason": "r" })
        );
    }

    #[test]
    fn with_no_recognizer_on_the_resolved_path_every_verb_reports_it_missing() {
        let dir = TempDir::new().unwrap();
        let empty = TempDir::new().unwrap();
        let shell = shell_with_path(dir.path(), &empty.path().display().to_string());
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);

        assert!(matches!(
            scan_with(&runner, dir.path(), RECOGNIZER_COMMAND, false),
            ScanReport::CommandMissing { .. }
        ));
        assert_eq!(
            shipped_sensors_with(&runner, RECOGNIZER_COMMAND),
            ShippedSensors::Unavailable {
                reason: missing_hint()
            }
        );
        assert_eq!(
            shipped_describer_with(&runner, RECOGNIZER_COMMAND, dir.path()),
            ShippedDescriber::Unavailable {
                reason: missing_hint()
            }
        );
    }

    #[test]
    fn a_hung_profile_reports_the_unavailable_message() {
        let dir = TempDir::new().unwrap();
        let shell = crate::tool_runner::tests::script(dir.path(), "hung", "sleep 30");
        let runner = runner_with(
            &shell,
            Duration::from_millis(200),
            Duration::from_secs(30),
            4,
        );

        assert_eq!(
            shipped_sensors_with(&runner, RECOGNIZER_COMMAND),
            ShippedSensors::Unavailable {
                reason: missing_hint()
            }
        );
    }

    #[test]
    fn config_file_sits_in_the_config_directory() {
        assert_eq!(
            config_file_in(Path::new("/cfg")),
            PathBuf::from("/cfg/config.json")
        );
    }
}
