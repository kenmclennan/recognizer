use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::fs_safe::checked_relative;

const SHELL_SCRIPT: &str = r#"command -v "$0" >/dev/null 2>&1 || exit 127; exec "$0" scan "$1""#;
const DESCRIBE_SCRIPT: &str = r#"command -v "$0" >/dev/null 2>&1 || exit 127; exec "$0" describe "$2" --json --repository "$1""#;
const VERSION_SCRIPT: &str = r#"command -v "$0" >/dev/null 2>&1 || exit 127; exec "$0" --version"#;
const CACHE: &str = ".recognizer/cache";
const POLICY: &str = ".recognizer/policy.yaml";
const BASELINE: &str = ".recognizer/baselines/violations.json";

#[derive(Debug, PartialEq, Serialize)]
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
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ToolsReport {
    Version { version: String },
    CommandMissing,
    Failed { exit_code: i32, stderr: String },
}

#[derive(Debug, Default, PartialEq)]
pub struct CacheRead {
    pub scans: Vec<ScanFile>,
    pub policy: Option<String>,
    pub baseline: Option<String>,
    pub refused: Vec<String>,
}

pub fn shell_invocation(shell: &str, command: &str, folder: &Path) -> (String, Vec<String>) {
    (
        shell.to_string(),
        vec![
            "-ilc".to_string(),
            SHELL_SCRIPT.to_string(),
            command.to_string(),
            folder.display().to_string(),
        ],
    )
}

pub fn describe_invocation(
    shell: &str,
    command: &str,
    folder: &Path,
    module: &str,
) -> (String, Vec<String>) {
    (
        shell.to_string(),
        vec![
            "-ilc".to_string(),
            DESCRIBE_SCRIPT.to_string(),
            command.to_string(),
            folder.display().to_string(),
            module.to_string(),
        ],
    )
}

pub fn version_invocation(shell: &str, command: &str) -> (String, Vec<String>) {
    (
        shell.to_string(),
        vec![
            "-ilc".to_string(),
            VERSION_SCRIPT.to_string(),
            command.to_string(),
        ],
    )
}

pub const RECOGNIZER_COMMAND: &str = "recognizer";

pub fn missing_hint() -> String {
    "recognizer was not found on your login shell's PATH. Install it with brew install kenmclennan/tap/recognizer.".to_string()
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

pub fn scan(folder: &Path, shell: &str) -> ScanReport {
    scan_with(folder, shell, RECOGNIZER_COMMAND)
}

pub fn scan_with(folder: &Path, shell: &str, command: &str) -> ScanReport {
    let (program, args) = shell_invocation(shell, command, folder);
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output();

    match output {
        Err(_) => ScanReport::CommandMissing {
            hint: missing_hint(),
        },
        Ok(output) => report_for(
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
            || read_cache(folder),
        ),
    }
}

pub fn tools_report_for(exit: Option<i32>, stdout: &str, stderr: String) -> ToolsReport {
    match exit {
        Some(127) => ToolsReport::CommandMissing,
        Some(0) if !stdout.trim().is_empty() => ToolsReport::Version {
            version: stdout.trim().to_string(),
        },
        other => ToolsReport::Failed {
            exit_code: other.unwrap_or(-1),
            stderr,
        },
    }
}

pub fn recognizer_version(shell: &str) -> ToolsReport {
    recognizer_version_with(shell, RECOGNIZER_COMMAND)
}

pub fn recognizer_version_with(shell: &str, command: &str) -> ToolsReport {
    let (program, args) = version_invocation(shell, command);
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output();

    match output {
        Err(_) => ToolsReport::CommandMissing,
        Ok(output) => tools_report_for(
            output.status.code(),
            &String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ),
    }
}

pub fn config_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn the_folder_is_an_argument_never_part_of_the_script() {
        let folder = Path::new("/tmp/it's a \"folder\" $(rm -rf x)");
        let (shell, args) = shell_invocation("/bin/zsh", "recognizer", folder);

        assert_eq!(shell, "/bin/zsh");
        assert_eq!(args[0], "-ilc");
        assert_eq!(args[1], SHELL_SCRIPT);
        assert!(!args[1].contains("folder"));
        assert_eq!(args[2], "recognizer");
        assert_eq!(args[3], folder.display().to_string());
    }

    #[test]
    fn the_module_is_a_positional_argument_never_part_of_the_describe_script() {
        let folder = Path::new("/tmp/repo");
        let (shell, args) = describe_invocation("/bin/zsh", "recognizer", folder, "a/$(x).py");

        assert_eq!(shell, "/bin/zsh");
        assert_eq!(args[0], "-ilc");
        assert_eq!(args[1], DESCRIBE_SCRIPT);
        assert!(!args[1].contains("a/"));
        assert_eq!(args[2..], ["recognizer", "/tmp/repo", "a/$(x).py"]);
    }

    #[test]
    fn the_hint_says_to_install_and_names_no_setting() {
        let hint = missing_hint();

        assert!(hint.contains("brew install kenmclennan/tap/recognizer"));
        assert!(!hint.contains("recognizer_path"));
        assert!(!hint.contains("Settings"));
    }

    #[test]
    fn scan_with_a_missing_command_reports_it_missing() {
        let dir = TempDir::new().unwrap();

        match scan_with(dir.path(), "/bin/sh", "/nonexistent/recognizer") {
            ScanReport::CommandMissing { .. } => {}
            other => panic!("{other:?}"),
        }
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
    fn the_version_invocation_is_the_script_and_the_command_only() {
        let (shell, args) = version_invocation("/bin/zsh", "recognizer");

        assert_eq!(shell, "/bin/zsh");
        assert_eq!(
            args,
            vec!["-ilc", VERSION_SCRIPT, "recognizer"]
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
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

    #[cfg(unix)]
    #[test]
    fn a_command_printing_a_version_gives_that_version() {
        let dir = TempDir::new().unwrap();
        let command = fake_command(dir.path(), r#"[ "$1" = "--version" ] && echo 0.3.1"#);

        assert_eq!(
            recognizer_version_with("/bin/sh", &command.display().to_string()),
            ToolsReport::Version {
                version: "0.3.1".to_string()
            }
        );
    }

    #[test]
    fn a_missing_command_is_reported_missing() {
        assert_eq!(
            recognizer_version_with("/bin/sh", "/nonexistent/recognizer"),
            ToolsReport::CommandMissing
        );
    }

    #[test]
    fn the_tools_exit_codes_map_to_reports() {
        assert_eq!(
            tools_report_for(Some(0), "0.3.1\n", String::new()),
            ToolsReport::Version {
                version: "0.3.1".to_string()
            }
        );
        assert_eq!(
            tools_report_for(Some(127), "", String::new()),
            ToolsReport::CommandMissing
        );
        assert_eq!(
            tools_report_for(Some(0), " \n", "e".to_string()),
            ToolsReport::Failed {
                exit_code: 0,
                stderr: "e".to_string()
            }
        );
        assert_eq!(
            tools_report_for(None, "", String::new()),
            ToolsReport::Failed {
                exit_code: -1,
                stderr: String::new()
            }
        );
    }

    #[test]
    fn the_tools_report_serialises_to_the_webview_contract() {
        assert_eq!(
            serde_json::to_value(ToolsReport::Version {
                version: "1.2.3".to_string()
            })
            .unwrap(),
            serde_json::json!({ "status": "version", "version": "1.2.3" })
        );
        assert_eq!(
            serde_json::to_value(ToolsReport::CommandMissing).unwrap(),
            serde_json::json!({ "status": "command-missing" })
        );
        assert_eq!(
            serde_json::to_value(ToolsReport::Failed {
                exit_code: 2,
                stderr: "x".to_string()
            })
            .unwrap(),
            serde_json::json!({ "status": "failed", "exitCode": 2, "stderr": "x" })
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
