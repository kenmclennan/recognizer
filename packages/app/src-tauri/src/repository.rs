use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core_client::CoreClient;
use crate::fs_safe::checked_relative;
use crate::tool_runner::{Captured, ToolRunner};

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

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum DescriberInEffect {
    Ok {
        command: Vec<String>,
        version: String,
    },
    Unavailable {
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
struct DescriberJson {
    command: Vec<String>,
    version: String,
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

pub fn describer_in_effect_from(reply: Result<serde_json::Value, String>) -> DescriberInEffect {
    let unavailable = |reason: String| DescriberInEffect::Unavailable { reason };

    let value = match reply {
        Ok(value) => value,
        Err(message) => return unavailable(message),
    };

    if let Some(ok) = value.get("ok") {
        return match serde_json::from_value::<DescriberJson>(ok.clone()) {
            Ok(found) => DescriberInEffect::Ok {
                command: found.command,
                version: found.version,
            },
            Err(_) => {
                unavailable("the service answered something that is not the describer".to_string())
            }
        };
    }

    if let Some(error) = value.get("error").and_then(serde_json::Value::as_str) {
        return unavailable(error.to_string());
    }

    match value.get("unavailable") {
        Some(body) => unavailable(
            ["hint", "reason", "kind"]
                .iter()
                .find_map(|key| body.get(key).and_then(serde_json::Value::as_str))
                .unwrap_or("the service is unavailable")
                .to_string(),
        ),
        None => unavailable("the service gave no answer".to_string()),
    }
}

pub fn describer_in_effect(core: &CoreClient, label: &str, folder: &Path) -> DescriberInEffect {
    describer_in_effect_from(core.call(
        label,
        Some(folder),
        "describer.read",
        serde_json::json!({}),
    ))
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

pub fn scan_with(runner: &ToolRunner, folder: &Path, command: &str) -> ScanReport {
    match runner.capture(command, &plain_scan_args(folder), false) {
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

    #[test]
    fn the_scan_folder_is_its_own_argv_entry() {
        let folder = Path::new("/tmp/it's a \"folder\" $(rm -rf x)");
        let args = plain_scan_args(folder);

        assert_eq!(args, ["scan", &folder.display().to_string()]);
        assert_eq!(args.len(), 2);
    }

    #[test]
    fn scan_with_a_missing_command_reports_it_missing() {
        let dir = TempDir::new().unwrap();
        let runner = working_runner(dir.path());

        match scan_with(&runner, dir.path(), "/nonexistent/recognizer") {
            ScanReport::CommandMissing { .. } => {}
            other => panic!("{other:?}"),
        }
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
    fn the_describer_in_effect_is_read_from_the_service_reply_and_a_failure_is_unavailable() {
        let ok = serde_json::json!({
            "id": 1,
            "ok": {"command": ["recognizer-describe-claude", "{request}"], "version": "p1"}
        });

        assert_eq!(
            describer_in_effect_from(Ok(ok)),
            DescriberInEffect::Ok {
                command: vec![
                    "recognizer-describe-claude".to_string(),
                    "{request}".to_string()
                ],
                version: "p1".to_string()
            }
        );
        assert_eq!(
            describer_in_effect_from(Ok(
                serde_json::json!({"id": 1, "error": "no describer is registered"})
            )),
            DescriberInEffect::Unavailable {
                reason: "no describer is registered".to_string()
            }
        );
        assert_eq!(
            describer_in_effect_from(Ok(
                serde_json::json!({"unavailable": {"kind": "missing", "hint": "install it"}})
            )),
            DescriberInEffect::Unavailable {
                reason: "install it".to_string()
            }
        );
        assert_eq!(
            describer_in_effect_from(Err("the arguments are not an object".to_string())),
            DescriberInEffect::Unavailable {
                reason: "the arguments are not an object".to_string()
            }
        );
        assert!(matches!(
            describer_in_effect_from(Ok(serde_json::json!({"id": 1, "ok": "nope"}))),
            DescriberInEffect::Unavailable { .. }
        ));
        assert!(matches!(
            describer_in_effect_from(Ok(serde_json::json!({}))),
            DescriberInEffect::Unavailable { .. }
        ));
    }

    #[test]
    fn with_no_recognizer_on_the_resolved_path_every_verb_reports_it_missing() {
        let dir = TempDir::new().unwrap();
        let empty = TempDir::new().unwrap();
        let shell = shell_with_path(dir.path(), &empty.path().display().to_string());
        let runner = runner_with(&shell, Duration::from_secs(10), Duration::from_secs(30), 4);

        assert!(matches!(
            scan_with(&runner, dir.path(), RECOGNIZER_COMMAND),
            ScanReport::CommandMissing { .. }
        ));
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

        assert!(matches!(
            scan_with(&runner, dir.path(), RECOGNIZER_COMMAND),
            ScanReport::CommandMissing { hint } if hint == missing_hint()
        ));
    }

    #[test]
    fn config_file_sits_in_the_config_directory() {
        assert_eq!(
            config_file_in(Path::new("/cfg")),
            PathBuf::from("/cfg/config.json")
        );
    }
}
