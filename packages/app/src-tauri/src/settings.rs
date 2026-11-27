use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::fs_safe::write_atomic;
use crate::settings_domain::SettingsRepository;

pub struct JsonSettingsFile {
    path: PathBuf,
}

impl JsonSettingsFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl SettingsRepository for JsonSettingsFile {
    fn load(&self) -> Result<Option<Map<String, Value>>, String> {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return Ok(None);
        };

        parse_object(&text).map(Some)
    }

    fn store(&self, object: Map<String, Value>) -> Result<(), String> {
        let mut text = serde_json::to_string_pretty(&Value::Object(object))
            .map_err(|error| error.to_string())?;

        text.push('\n');

        write_atomic(&self.path, &text).map_err(|error| format!("{}: {error}", self.path.display()))
    }
}

fn parse_object(text: &str) -> Result<Map<String, Value>, String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|error| format!("config.json is not valid JSON: {error}"))?;

    match value {
        Value::Object(object) => Ok(object),
        _ => Err("config.json must be a JSON object".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings_domain::tests::contract;
    use crate::settings_domain::{parse, read, save, Check, Describing, Settings, Setup, Stored};
    use std::path::Path;
    use tempfile::TempDir;

    fn accept(_: &Settings) -> Result<(), String> {
        Ok(())
    }

    fn baseline() -> Settings {
        Settings {
            editor: String::new(),
            describing: Describing {
                model: Some("alpha-model".to_string()),
                batch_size: 7,
                confirm_above_usd: 5.0,
            },
            setup: Setup {
                model: "beta-model".to_string(),
            },
        }
    }

    fn settings(editor: &str) -> Settings {
        Settings {
            editor: editor.to_string(),
            describing: Describing {
                model: Some("opus".to_string()),
                batch_size: 8,
                confirm_above_usd: 2.5,
            },
            setup: Setup {
                model: "opus".to_string(),
            },
        }
    }

    fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
        let check: Check = &accept;

        save(
            &JsonSettingsFile::new(path.to_path_buf()),
            settings,
            &baseline(),
            check,
        )
    }

    fn read_settings(path: &Path) -> Result<Stored, String> {
        read(&JsonSettingsFile::new(path.to_path_buf()))
    }

    fn file() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("cfg/config.json");

        (dir, path)
    }

    fn written(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn the_file_adapter_meets_the_settings_contract() {
        let (_dir, path) = file();

        contract::settings_repository(&JsonSettingsFile::new(path));
    }

    #[test]
    fn saving_an_editor_keeps_a_recognizer_path_and_unrelated_keys() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"recognizer_path": "/opt/bin/recognizer", "other": [1, 2]}"#,
        )
        .unwrap();

        save_settings(&path, &settings("Sublime Text")).unwrap();

        let value = written(&path);

        assert_eq!(value["recognizer_path"], "/opt/bin/recognizer");
        assert_eq!(value["editor"], "Sublime Text");
        assert_eq!(value["other"], serde_json::json!([1, 2]));
        assert!(fs::read_to_string(&path).unwrap().ends_with("}\n"));
    }

    #[test]
    fn saving_a_blank_editor_removes_its_key_from_the_file() {
        let (_dir, path) = file();

        save_settings(&path, &settings("code")).unwrap();
        save_settings(&path, &settings("")).unwrap();

        assert!(written(&path).get("editor").is_none());
    }

    #[test]
    fn saving_refuses_a_file_that_is_not_a_json_object_and_leaves_it() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "[1]").unwrap();

        assert!(save_settings(&path, &settings("")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1]");

        fs::write(&path, "not json").unwrap();

        assert!(save_settings(&path, &settings("")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
    }

    #[test]
    fn reading_a_file_that_is_not_a_json_object_is_an_error() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not json").unwrap();

        assert!(read_settings(&path)
            .unwrap_err()
            .starts_with("config.json is not valid JSON"));

        fs::write(&path, "[1]").unwrap();

        assert_eq!(
            read_settings(&path),
            Err("config.json must be a JSON object".to_string())
        );
    }

    #[test]
    fn save_writes_nothing_to_disk_when_validation_fails() {
        let (_dir, path) = file();

        assert!(save_settings(&path, &settings("code\nrm x")).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn save_then_read_round_trips_the_editor() {
        let (_dir, path) = file();

        save_settings(&path, &settings("code --goto")).unwrap();

        let stored = read_settings(&path).unwrap();

        assert_eq!(stored.editor, "code --goto");
        assert_eq!(stored.describing["model"], "opus");
        assert_eq!(stored.describing["batch_size"], 8);
        assert_eq!(stored.setup["model"], "opus");
    }

    #[test]
    fn reading_an_absent_file_stores_nothing() {
        let (_dir, path) = file();

        assert_eq!(read_settings(&path), Ok(Stored::default()));
        assert_eq!(parse(None), Ok(Stored::default()));
    }

    #[test]
    fn a_leftover_scanning_key_loads_and_is_dropped_on_the_next_save() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"editor": "code", "scanning": {"describe": true}, "recognizer_path": "/x"}"#,
        )
        .unwrap();

        assert_eq!(read_settings(&path).unwrap().editor, "code");

        save_settings(&path, &settings("code")).unwrap();

        let value = written(&path);

        assert!(value.get("scanning").is_none());
        assert_eq!(value["recognizer_path"], "/x");
    }
}
