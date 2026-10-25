use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::fs_safe::checked_relative;

const SHELL_SCRIPT: &str = r#"command -v "$0" >/dev/null 2>&1 || exit 127; exec "$0" scan "$1""#;
const CACHE: &str = ".recognizer/cache";
const POLICY: &str = ".recognizer/policy.yaml";

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
    ConfigInvalid {
        message: String,
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
    },
}

#[derive(Debug, Default, PartialEq)]
pub struct CacheRead {
    pub scans: Vec<ScanFile>,
    pub policy: Option<String>,
    pub refused: Vec<String>,
}

pub fn parse_config(text: Option<&str>) -> Result<Option<String>, String> {
    let Some(text) = text else {
        return Ok(None);
    };

    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|error| format!("config.json is not valid JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "config.json must be a JSON object".to_string())?;

    match object.get("recognizer_path") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(path)) if Path::new(path).is_absolute() => {
            Ok(Some(path.clone()))
        }
        Some(_) => Err("recognizer_path in config.json must be an absolute path".to_string()),
    }
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

pub fn missing_hint(config_file: &Path) -> String {
    format!(
        "recognizer was not found on your login shell's PATH. Install it from a checkout of kenmclennan/recognizer (npm run build -w recognizer, then npm install --global ./check), or set recognizer_path in {}.",
        config_file.display()
    )
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

    read
}

pub fn report_for(
    exit: Option<i32>,
    stderr: String,
    config_file: &Path,
    read: impl FnOnce() -> CacheRead,
) -> ScanReport {
    match exit {
        Some(127) => ScanReport::CommandMissing {
            hint: missing_hint(config_file),
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
            }
        }
        other => ScanReport::ScanFailed {
            exit_code: other.unwrap_or(-1),
            stderr,
        },
    }
}

pub fn scan(folder: &Path, shell: &str, config_file: &Path) -> ScanReport {
    let configured = match parse_config(fs::read_to_string(config_file).ok().as_deref()) {
        Ok(path) => path,
        Err(message) => return ScanReport::ConfigInvalid { message },
    };
    let command = configured.unwrap_or_else(|| "recognizer".to_string());
    let (program, args) = shell_invocation(shell, &command, folder);
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output();

    match output {
        Err(_) => ScanReport::CommandMissing {
            hint: missing_hint(config_file),
        },
        Ok(output) => report_for(
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
            config_file,
            || read_cache(folder),
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
    fn an_absent_config_means_the_default_command() {
        assert_eq!(parse_config(None), Ok(None));
        assert_eq!(parse_config(Some("{}")), Ok(None));
    }

    #[test]
    fn an_absolute_recognizer_path_is_accepted() {
        assert_eq!(
            parse_config(Some(r#"{"recognizer_path": "/opt/bin/recognizer"}"#)),
            Ok(Some("/opt/bin/recognizer".to_string()))
        );
    }

    #[test]
    fn a_relative_recognizer_path_is_rejected() {
        assert!(parse_config(Some(r#"{"recognizer_path": "bin/recognizer"}"#)).is_err());
        assert!(parse_config(Some(r#"{"recognizer_path": 4}"#)).is_err());
    }

    #[test]
    fn a_malformed_config_is_rejected() {
        assert!(parse_config(Some("not json")).is_err());
        assert!(parse_config(Some("[1]")).is_err());
    }

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
    fn the_hint_names_the_config_file() {
        let hint = missing_hint(Path::new("/cfg/config.json"));

        assert!(hint.contains("npm install --global ./check"));
        assert!(hint.ends_with("set recognizer_path in /cfg/config.json."));
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

        dir
    }

    #[test]
    fn the_cache_reader_returns_scans_in_name_order_and_the_policy() {
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
        let report = report_for(Some(127), String::new(), Path::new("/c.json"), || {
            panic!("the cache must not be read")
        });

        assert!(matches!(report, ScanReport::CommandMissing { .. }));
    }

    #[test]
    fn exit_one_keeps_the_scans_and_carries_stderr() {
        let report = report_for(
            Some(1),
            "python failed\n".to_string(),
            Path::new("/c.json"),
            || CacheRead {
                scans: vec![ScanFile {
                    file: "scan.typescript.json".to_string(),
                    text: "ts".to_string(),
                }],
                policy: None,
                refused: vec!["x: leaves the folder".to_string()],
            },
        );

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
        let two = report_for(
            Some(2),
            "bad".to_string(),
            Path::new("/c.json"),
            CacheRead::default,
        );
        let signal = report_for(
            None,
            String::new(),
            Path::new("/c.json"),
            CacheRead::default,
        );

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
        })
        .unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "status": "scanned",
                "exitCode": 0,
                "stderr": "",
                "scans": [{ "file": "scan.python.json", "text": "{}" }],
                "policy": null
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
    fn config_file_sits_in_the_config_directory() {
        assert_eq!(
            config_file_in(Path::new("/cfg")),
            PathBuf::from("/cfg/config.json")
        );
    }
}
