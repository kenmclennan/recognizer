use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::fs_safe::write_atomic;
use crate::repository::{clean_output, missing_hint, RECOGNIZER_COMMAND};
use crate::tool_runner::{runner, Captured, ToolFault};

const CONFIG_DIR: &str = ".recognizer";
const CONFIG_FILE: &str = ".recognizer/config.yaml";
const SENSORS_COMMAND: &str = "recognizer-sensors";
const CLI_PREFIX: &str = "recognizer config: ";
const CHANGED: &str = "the config changed since it was read";

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConfigKeys {
    Ok { schema: serde_json::Value },
    Unavailable { reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Op {
    Set,
    Unset,
    AddSection,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Edit {
    pub op: Op,
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConfigWrite {
    Written { text: String },
    Refused { key: Option<String>, reason: String },
    Changed { reason: String },
    Unavailable { reason: String },
}

pub fn text_hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn key_ok(key: &str) -> bool {
    !key.is_empty()
        && !key.starts_with('-')
        && key.split('.').all(|part| !part.is_empty() && part != "..")
        && key.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '<' || c == '>'
        })
}

pub fn check_edits(edits: &[Edit]) -> Result<(), (String, String)> {
    for edit in edits {
        if !key_ok(&edit.key) {
            return Err((
                edit.key.clone(),
                format!("{} is not a config key", edit.key),
            ));
        }

        if edit.op == Op::Set && edit.value.is_none() {
            return Err((edit.key.clone(), "a set needs a value".to_string()));
        }
    }

    Ok(())
}

pub fn args_for(temp: &Path, edit: &Edit) -> Vec<String> {
    let mut args = vec![
        "config".to_string(),
        "--repository".to_string(),
        temp.display().to_string(),
    ];

    match edit.op {
        Op::Set => {
            args.push("--".to_string());
            args.push(edit.key.clone());
            args.push(edit.value.clone().unwrap_or_default());
        }
        Op::Unset => {
            args.push("--unset".to_string());
            args.push(edit.key.clone());
        }
        Op::AddSection => {
            args.push("--add-section".to_string());
            args.push(edit.key.clone());
        }
    }

    args
}

pub fn reason_of(key: &str, stderr: &str) -> String {
    let line = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let line = line.strip_prefix(CLI_PREFIX).unwrap_or(line);

    line.strip_prefix(&format!("{key}: "))
        .unwrap_or(line)
        .to_string()
}

pub fn write_with<F>(folder: &Path, edits: &[Edit], base_hash: &str, run: F) -> ConfigWrite
where
    F: Fn(&[String]) -> Result<Captured, ToolFault>,
{
    if let Err((key, reason)) = check_edits(edits) {
        return ConfigWrite::Refused {
            key: Some(key),
            reason,
        };
    }

    let target = folder.join(CONFIG_FILE);
    let current = match fs::read_to_string(&target) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return ConfigWrite::Refused {
                key: None,
                reason: error.to_string(),
            }
        }
    };

    if text_hash(current.as_deref().unwrap_or("")) != base_hash {
        return ConfigWrite::Changed {
            reason: CHANGED.to_string(),
        };
    }

    let temp = match tempfile_dir() {
        Ok(temp) => temp,
        Err(error) => {
            return ConfigWrite::Refused {
                key: None,
                reason: error,
            }
        }
    };
    let staged = temp.path().join(CONFIG_FILE);

    if let Some(text) = &current {
        if let Err(error) =
            fs::create_dir_all(temp.path().join(CONFIG_DIR)).and_then(|()| fs::write(&staged, text))
        {
            return ConfigWrite::Refused {
                key: None,
                reason: error.to_string(),
            };
        }
    }

    for edit in edits {
        match run(&args_for(temp.path(), edit)) {
            Err(fault) => {
                return match fault {
                    ToolFault::Missing { .. } => ConfigWrite::Unavailable {
                        reason: missing_hint(),
                    },
                    other => ConfigWrite::Unavailable {
                        reason: other.message(),
                    },
                }
            }
            Ok(Captured { code, stderr, .. }) => match code {
                Some(0) => {}
                Some(1) if edit.op == Op::Unset => {}
                _ => {
                    return ConfigWrite::Refused {
                        key: Some(edit.key.clone()),
                        reason: reason_of(&edit.key, &stderr),
                    }
                }
            },
        }
    }

    let text = fs::read_to_string(&staged).unwrap_or_default();

    match write_atomic(&target, &text) {
        Ok(()) => ConfigWrite::Written { text },
        Err(error) => ConfigWrite::Refused {
            key: None,
            reason: error.to_string(),
        },
    }
}

fn tempfile_dir() -> Result<StagingDir, String> {
    StagingDir::new().map_err(|error| error.to_string())
}

pub struct StagingDir {
    path: std::path::PathBuf,
}

impl StagingDir {
    fn new() -> std::io::Result<Self> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let path =
            std::env::temp_dir().join(format!("recognizer-config-{}-{stamp}", std::process::id()));

        fs::create_dir(&path)?;

        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub fn write_repository_config(folder: &Path, edits: &[Edit], base_hash: &str) -> ConfigWrite {
    write_with(folder, edits, base_hash, |args| {
        runner().capture(RECOGNIZER_COMMAND, args, false)
    })
}

pub fn read_config_keys_with<F>(run: F) -> ConfigKeys
where
    F: Fn(&[String]) -> Result<Captured, ToolFault>,
{
    let unavailable = |reason: String| ConfigKeys::Unavailable { reason };

    match run(&["--schema".to_string()]) {
        Err(fault) => unavailable(fault.message()),
        Ok(Captured {
            code,
            stdout,
            stderr,
        }) => match code {
            Some(127) => unavailable(missing_hint()),
            Some(0) => match serde_json::from_str(&clean_output(&stdout)) {
                Ok(schema) => ConfigKeys::Ok { schema },
                Err(_) => unavailable(
                    "recognizer-sensors printed something that is not a key schema".to_string(),
                ),
            },
            other => unavailable(format!(
                "recognizer-sensors exited {}: {}",
                other.map_or("without a status".to_string(), |code| code.to_string()),
                stderr.trim()
            )),
        },
    }
}

pub fn read_config_keys() -> ConfigKeys {
    read_config_keys_with(|args| runner().capture(SENSORS_COMMAND, args, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use tempfile::TempDir;

    fn set(key: &str, value: &str) -> Edit {
        Edit {
            op: Op::Set,
            key: key.to_string(),
            value: Some(value.to_string()),
        }
    }

    fn config_in(dir: &TempDir, text: &str) {
        fs::create_dir_all(dir.path().join(CONFIG_DIR)).unwrap();
        fs::write(dir.path().join(CONFIG_FILE), text).unwrap();
    }

    fn captured(code: i32, stderr: &str) -> Result<Captured, ToolFault> {
        Ok(Captured {
            code: Some(code),
            stdout: String::new(),
            stderr: stderr.to_string(),
        })
    }

    fn appending<'a>(
        calls: &'a RefCell<Vec<Vec<String>>>,
        refuse: Option<&'a str>,
    ) -> impl Fn(&[String]) -> Result<Captured, ToolFault> + 'a {
        move |args: &[String]| {
            calls.borrow_mut().push(args.to_vec());

            let temp = Path::new(&args[2]);
            let key = &args[args.len() - 2];

            if refuse == Some(key.as_str()) {
                return captured(
                    2,
                    &format!("recognizer config: {key}: must be at least 1\n"),
                );
            }

            let file = temp.join(CONFIG_FILE);
            let before = fs::read_to_string(&file).unwrap_or_default();

            fs::create_dir_all(temp.join(CONFIG_DIR)).unwrap();
            fs::write(
                &file,
                format!("{before}{}\n", args[args.len() - 2..].join(" ")),
            )
            .unwrap();

            captured(0, "")
        }
    }

    #[test]
    fn two_valid_edits_write_the_staged_file_once() {
        let dir = TempDir::new().unwrap();

        config_in(&dir, "sensors: {}\n");

        let base = text_hash("sensors: {}\n");
        let calls = RefCell::new(Vec::new());
        let outcome = write_with(
            dir.path(),
            &[set("sensors.crap.threshold", "25"), set("a.b", "1")],
            &base,
            appending(&calls, None),
        );

        let on_disk = fs::read_to_string(dir.path().join(CONFIG_FILE)).unwrap();

        assert_eq!(calls.borrow().len(), 2);
        assert!(on_disk.starts_with("sensors: {}\n"));
        assert!(on_disk.contains("sensors.crap.threshold 25"));
        assert_eq!(outcome, ConfigWrite::Written { text: on_disk });
    }

    #[test]
    fn a_refused_second_edit_leaves_the_real_file_byte_identical_and_names_the_key() {
        let dir = TempDir::new().unwrap();

        config_in(&dir, "a: 1\n");

        let calls = RefCell::new(Vec::new());
        let outcome = write_with(
            dir.path(),
            &[set("x.y", "1"), set("sensors.crap.threshold", "0")],
            &text_hash("a: 1\n"),
            appending(&calls, Some("sensors.crap.threshold")),
        );

        assert_eq!(
            fs::read_to_string(dir.path().join(CONFIG_FILE)).unwrap(),
            "a: 1\n"
        );
        assert_eq!(
            outcome,
            ConfigWrite::Refused {
                key: Some("sensors.crap.threshold".to_string()),
                reason: "must be at least 1".to_string()
            }
        );
    }

    #[test]
    fn a_stale_base_hash_refuses_before_any_process_starts() {
        let dir = TempDir::new().unwrap();

        config_in(&dir, "a: 1\n");

        let calls = RefCell::new(Vec::new());
        let outcome = write_with(
            dir.path(),
            &[set("x.y", "1")],
            &text_hash("a: 2\n"),
            appending(&calls, None),
        );

        assert!(calls.borrow().is_empty());
        assert_eq!(
            outcome,
            ConfigWrite::Changed {
                reason: "the config changed since it was read".to_string()
            }
        );
    }

    #[test]
    fn an_absent_file_with_one_set_creates_the_folder_and_file() {
        let dir = TempDir::new().unwrap();
        let calls = RefCell::new(Vec::new());
        let outcome = write_with(
            dir.path(),
            &[set("x.y", "1")],
            &text_hash(""),
            appending(&calls, None),
        );

        assert!(matches!(outcome, ConfigWrite::Written { .. }));
        assert!(fs::read_to_string(dir.path().join(CONFIG_FILE))
            .unwrap()
            .contains("x.y 1"));
    }

    #[test]
    fn a_key_with_a_separator_or_dots_is_refused_before_spawning() {
        let dir = TempDir::new().unwrap();

        for key in ["../x", "a/b", "a..b", "-x", "", "a b"] {
            let calls = RefCell::new(Vec::new());
            let outcome = write_with(
                dir.path(),
                &[set(key, "1")],
                &text_hash(""),
                appending(&calls, None),
            );

            assert!(calls.borrow().is_empty(), "{key}");
            assert!(matches!(outcome, ConfigWrite::Refused { .. }), "{key}");
        }
    }

    #[test]
    fn the_verbs_become_the_cli_arguments() {
        let temp = Path::new("/t");
        let unset = Edit {
            op: Op::Unset,
            key: "a.b".to_string(),
            value: None,
        };
        let add = Edit {
            op: Op::AddSection,
            key: "tests.x".to_string(),
            value: None,
        };

        assert_eq!(
            args_for(temp, &set("a.b", "-1")),
            ["config", "--repository", "/t", "--", "a.b", "-1"]
        );
        assert_eq!(
            args_for(temp, &unset),
            ["config", "--repository", "/t", "--unset", "a.b"]
        );
        assert_eq!(
            args_for(temp, &add),
            ["config", "--repository", "/t", "--add-section", "tests.x"]
        );
    }

    #[test]
    fn an_unset_of_an_absent_key_is_not_a_refusal() {
        let dir = TempDir::new().unwrap();

        config_in(&dir, "a: 1\n");

        let unset = Edit {
            op: Op::Unset,
            key: "a.b".to_string(),
            value: None,
        };
        let outcome = write_with(dir.path(), &[unset], &text_hash("a: 1\n"), |_| {
            captured(1, "")
        });

        assert!(matches!(outcome, ConfigWrite::Written { .. }));
    }

    #[test]
    fn the_reason_loses_the_command_and_key_prefix() {
        assert_eq!(
            reason_of("k.x", "recognizer config: k.x: must be an integer\n"),
            "must be an integer"
        );
        assert_eq!(reason_of("k.x", "boom"), "boom");
    }

    #[test]
    fn the_key_schema_is_read_from_the_sensors_package() {
        let ok = read_config_keys_with(|args| {
            assert_eq!(args, ["--schema"]);

            Ok(Captured {
                code: Some(0),
                stdout: "{\"keys_version\":1}".to_string(),
                stderr: String::new(),
            })
        });

        assert_eq!(
            ok,
            ConfigKeys::Ok {
                schema: serde_json::json!({"keys_version": 1})
            }
        );
        assert!(matches!(
            read_config_keys_with(|_| captured(3, "bad")),
            ConfigKeys::Unavailable { .. }
        ));
        assert_eq!(
            read_config_keys_with(|_| captured(127, "")),
            ConfigKeys::Unavailable {
                reason: missing_hint()
            }
        );
    }
}
