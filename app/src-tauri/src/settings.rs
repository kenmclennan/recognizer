use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::fs_safe::write_atomic;

#[derive(Debug, Default, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub editor: String,
    #[serde(default)]
    pub scanning: Scanning,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, serde::Deserialize)]
pub struct Scanning {
    pub describe: bool,
    pub sensors: bool,
}

fn parse_flag(scanning: &Map<String, Value>, key: &str) -> Result<bool, String> {
    match scanning.get(key) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(format!("scanning.{key} in config.json must be a boolean")),
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

pub fn parse(text: Option<&str>) -> Result<Settings, String> {
    let Some(text) = text else {
        return Ok(Settings::default());
    };

    let object = parse_object(text)?;

    let editor = match object.get("editor") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(editor)) => editor.trim().to_string(),
        Some(_) => return Err("editor in config.json must be a string".to_string()),
    };

    let scanning = match object.get("scanning") {
        None | Some(Value::Null) => Scanning::default(),
        Some(Value::Object(scanning)) => Scanning {
            describe: parse_flag(scanning, "describe")?,
            sensors: parse_flag(scanning, "sensors")?,
        },
        Some(_) => return Err("scanning in config.json must be an object".to_string()),
    };

    Ok(Settings { editor, scanning })
}

pub fn validate(settings: &Settings) -> Result<(), String> {
    if settings.editor.contains('\n') || settings.editor.contains('\r') {
        return Err("the editor must be a single line".to_string());
    }

    Ok(())
}

pub fn read(path: &Path) -> Result<Settings, String> {
    parse(fs::read_to_string(path).ok().as_deref())
}

fn set_or_remove(object: &mut Map<String, Value>, key: &str, value: &str) {
    let value = value.trim();

    if value.is_empty() {
        object.remove(key);
    } else {
        object.insert(key.to_string(), Value::String(value.to_string()));
    }
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    validate(settings)?;

    let mut object = match fs::read_to_string(path) {
        Ok(text) => parse_object(&text)?,
        Err(_) => Map::new(),
    };

    set_or_remove(&mut object, "editor", &settings.editor);

    if settings.scanning.describe || settings.scanning.sensors {
        object.insert(
            "scanning".to_string(),
            serde_json::json!({
                "describe": settings.scanning.describe,
                "sensors": settings.scanning.sensors,
            }),
        );
    } else {
        object.remove("scanning");
    }

    let mut text =
        serde_json::to_string_pretty(&Value::Object(object)).map_err(|error| error.to_string())?;

    text.push('\n');

    write_atomic(path, &text).map_err(|error| format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn file() -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("cfg/config.json");

        (dir, path)
    }

    #[test]
    fn an_absent_config_means_the_defaults() {
        assert_eq!(parse(None), Ok(Settings::default()));
        assert_eq!(parse(Some("{}")), Ok(Settings::default()));
    }

    #[test]
    fn a_recognizer_path_in_the_config_is_ignored() {
        assert_eq!(
            parse(Some(r#"{"recognizer_path": "bin/recognizer"}"#)),
            Ok(Settings::default())
        );
        assert_eq!(
            parse(Some(r#"{"recognizer_path": 4}"#)),
            Ok(Settings::default())
        );
    }

    #[test]
    fn a_malformed_config_is_rejected() {
        assert!(parse(Some("not json")).is_err());
        assert!(parse(Some("[1]")).is_err());
        assert!(parse(Some(r#"{"editor": 3}"#)).is_err());
    }

    #[test]
    fn the_editor_is_trimmed() {
        assert_eq!(
            parse(Some(r#"{"editor": "  Sublime Text "}"#))
                .unwrap()
                .editor,
            "Sublime Text"
        );
    }

    #[test]
    fn a_multi_line_editor_fails_validation() {
        let multi = Settings {
            editor: "code\nrm x".to_string(),
            ..Settings::default()
        };

        assert!(validate(&multi).is_err());
        assert!(validate(&Settings::default()).is_ok());
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

        let mut settings = read(&path).unwrap();

        settings.editor = "Sublime Text".to_string();
        save(&path, &settings).unwrap();

        let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(written["recognizer_path"], "/opt/bin/recognizer");
        assert_eq!(written["editor"], "Sublime Text");
        assert_eq!(written["other"], serde_json::json!([1, 2]));
        assert!(fs::read_to_string(&path).unwrap().ends_with("}\n"));
    }

    #[test]
    fn saving_a_blank_editor_removes_its_key() {
        let (_dir, path) = file();

        save(
            &path,
            &Settings {
                editor: "code".to_string(),
                ..Settings::default()
            },
        )
        .unwrap();
        save(
            &path,
            &Settings {
                editor: String::new(),
                ..Settings::default()
            },
        )
        .unwrap();

        let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert!(written.get("editor").is_none());
    }

    #[test]
    fn saving_refuses_a_file_that_is_not_a_json_object_and_leaves_it() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "[1]").unwrap();

        assert!(save(&path, &Settings::default()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1]");

        fs::write(&path, "not json").unwrap();

        assert!(save(&path, &Settings::default()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
    }

    #[test]
    fn saving_writes_nothing_when_validation_fails() {
        let (_dir, path) = file();

        let bad = Settings {
            editor: "code\nrm x".to_string(),
            ..Settings::default()
        };

        assert!(save(&path, &bad).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn save_then_read_round_trips_the_editor() {
        let (_dir, path) = file();
        let settings = Settings {
            editor: "code --goto".to_string(),
            ..Settings::default()
        };

        save(&path, &settings).unwrap();

        assert_eq!(read(&path), Ok(settings));
    }

    #[test]
    fn reading_an_absent_file_gives_the_defaults() {
        let (_dir, path) = file();

        assert_eq!(read(&path), Ok(Settings::default()));
    }

    #[test]
    fn scanning_defaults_to_both_off_and_rejects_a_bad_shape() {
        assert_eq!(parse(Some("{}")).unwrap().scanning, Scanning::default());
        assert!(parse(Some(r#"{"scanning": 3}"#)).is_err());
        assert!(parse(Some(r#"{"scanning": {"describe": "yes"}}"#)).is_err());
        assert_eq!(
            parse(Some(r#"{"scanning": {"sensors": true}}"#))
                .unwrap()
                .scanning,
            Scanning {
                describe: false,
                sensors: true
            }
        );
    }

    #[test]
    fn saving_scanning_writes_the_key_only_when_one_is_on_and_keeps_other_keys() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"recognizer_path": "/x", "other": 1}"#).unwrap();

        let mut settings = read(&path).unwrap();

        settings.scanning.describe = true;
        save(&path, &settings).unwrap();

        let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(
            written["scanning"],
            serde_json::json!({"describe": true, "sensors": false})
        );
        assert_eq!(written["recognizer_path"], "/x");
        assert_eq!(written["other"], 1);
        assert_eq!(read(&path).unwrap().scanning, settings.scanning);

        settings.scanning = Scanning::default();
        save(&path, &settings).unwrap();

        let cleared: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert!(cleared.get("scanning").is_none());
        assert_eq!(cleared["recognizer_path"], "/x");
    }
}
