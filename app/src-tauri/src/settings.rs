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
    pub describing: Describing,
}

pub const DEFAULT_MODEL: &str = "sonnet";
pub const DEFAULT_BATCH_SIZE: u32 = 4;
const MAX_BATCH_SIZE: u32 = 16;

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Describing {
    pub model: String,
    pub batch_size: u32,
}

impl Default for Describing {
    fn default() -> Self {
        Describing {
            model: DEFAULT_MODEL.to_string(),
            batch_size: DEFAULT_BATCH_SIZE,
        }
    }
}

fn describing_json(describing: &Describing) -> Value {
    serde_json::json!({
        "model": describing.model,
        "batch_size": describing.batch_size,
    })
}

pub fn validate_describing(describing: &Describing) -> Result<(), String> {
    let model = &describing.model;

    if model.is_empty() || model.starts_with('-') || model.chars().any(char::is_whitespace) {
        return Err(
            "describing.model must be a non-empty name with no whitespace and no leading -"
                .to_string(),
        );
    }

    if describing.batch_size < 1 || describing.batch_size > MAX_BATCH_SIZE {
        return Err(format!(
            "describing.batch_size must be a whole number from 1 to {MAX_BATCH_SIZE}"
        ));
    }

    Ok(())
}

fn parse_describing(value: &Value) -> Result<Describing, String> {
    let Value::Object(object) = value else {
        return Err("describing in config.json must be an object".to_string());
    };

    let model = match object.get("model") {
        Some(Value::String(model)) => model.clone(),
        _ => return Err("describing.model in config.json must be a string".to_string()),
    };

    let batch_size = match object.get("batch_size").and_then(Value::as_u64) {
        Some(size) if size <= u64::from(u32::MAX) => size as u32,
        _ => {
            return Err(format!(
                "describing.batch_size must be a whole number from 1 to {MAX_BATCH_SIZE}"
            ))
        }
    };

    let describing = Describing { model, batch_size };

    validate_describing(&describing)?;

    Ok(describing)
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

    let describing = match object.get("describing") {
        None | Some(Value::Null) => Describing::default(),
        Some(value) => parse_describing(value)?,
    };

    Ok(Settings { editor, describing })
}

pub fn validate(settings: &Settings) -> Result<(), String> {
    if settings.editor.contains('\n') || settings.editor.contains('\r') {
        return Err("the editor must be a single line".to_string());
    }

    validate_describing(&settings.describing)
}

pub fn seed(path: &Path) -> Result<(), String> {
    let mut object = match fs::read_to_string(path) {
        Ok(text) => parse_object(&text)?,
        Err(_) => Map::new(),
    };

    if object.contains_key("describing") {
        return Ok(());
    }

    object.insert(
        "describing".to_string(),
        describing_json(&Describing::default()),
    );

    write_object(path, object)
}

fn write_object(path: &Path, object: Map<String, Value>) -> Result<(), String> {
    let mut text =
        serde_json::to_string_pretty(&Value::Object(object)).map_err(|error| error.to_string())?;

    text.push('\n');

    write_atomic(path, &text).map_err(|error| format!("{}: {error}", path.display()))
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

    object.remove("scanning");

    object.insert(
        "describing".to_string(),
        describing_json(&settings.describing),
    );

    write_object(path, object)
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
    fn a_leftover_scanning_key_loads_and_is_dropped_on_the_next_save() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"editor": "code", "scanning": {"describe": true, "sensors": "yes"}, "recognizer_path": "/x"}"#,
        )
        .unwrap();

        let settings = read(&path).unwrap();

        assert_eq!(settings.editor, "code");
        assert_eq!(parse(Some(r#"{"scanning": 3}"#)), Ok(Settings::default()));

        save(&path, &settings).unwrap();

        let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert!(written.get("scanning").is_none());
        assert_eq!(written["editor"], "code");
        assert_eq!(written["recognizer_path"], "/x");
    }

    #[test]
    fn describing_defaults_to_the_seed_and_equals_the_shared_fixture() {
        let text = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/settings/describing-defaults.json"
        ))
        .unwrap();
        let fixture: Value = serde_json::from_str(&text).unwrap();
        let seed = Describing::default();

        assert_eq!(fixture["model"], seed.model);
        assert_eq!(fixture["batch_size"], seed.batch_size);
        assert_eq!(parse(None).unwrap().describing, seed);
        assert_eq!(parse(Some("{}")).unwrap().describing, seed);
    }

    #[test]
    fn describing_rejects_bad_values_naming_the_key() {
        for bad in [
            r#"{"describing": 3}"#,
            r#"{"describing": {"model": "-x", "batch_size": 4}}"#,
            r#"{"describing": {"model": "a b", "batch_size": 4}}"#,
            r#"{"describing": {"model": "", "batch_size": 4}}"#,
            r#"{"describing": {"model": "sonnet", "batch_size": 0}}"#,
            r#"{"describing": {"model": "sonnet", "batch_size": 17}}"#,
            r#"{"describing": {"model": "sonnet", "batch_size": 2.5}}"#,
            r#"{"describing": {"model": "sonnet", "batch_size": "4"}}"#,
        ] {
            let error = parse(Some(bad)).unwrap_err();

            assert!(error.contains("describing"), "{bad}: {error}");
        }
    }

    #[test]
    fn saving_rejects_a_bad_describing_and_writes_nothing() {
        let (_dir, path) = file();
        let bad = Settings {
            describing: Describing {
                model: "-x".to_string(),
                batch_size: 4,
            },
            ..Settings::default()
        };

        assert!(save(&path, &bad).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn save_always_writes_describing_and_round_trips_it() {
        let (_dir, path) = file();
        let settings = Settings {
            describing: Describing {
                model: "opus".to_string(),
                batch_size: 8,
            },
            ..Settings::default()
        };

        save(&path, &settings).unwrap();

        let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(
            written["describing"],
            serde_json::json!({"model": "opus", "batch_size": 8})
        );
        assert_eq!(read(&path), Ok(settings));

        save(&path, &Settings::default()).unwrap();

        let defaults: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(
            defaults["describing"],
            serde_json::json!({"model": "sonnet", "batch_size": 4})
        );
    }

    #[test]
    fn seed_writes_only_when_absent_and_keeps_other_keys() {
        let (_dir, path) = file();

        seed(&path).unwrap();

        let fresh: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(
            fresh["describing"],
            serde_json::json!({"model": "sonnet", "batch_size": 4})
        );

        fs::write(
            &path,
            r#"{"editor": "code", "recognizer_path": "/x", "other": 1}"#,
        )
        .unwrap();
        seed(&path).unwrap();

        let kept: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(kept["editor"], "code");
        assert_eq!(kept["recognizer_path"], "/x");
        assert_eq!(kept["other"], 1);
        assert_eq!(kept["describing"]["model"], "sonnet");

        fs::write(
            &path,
            r#"{"describing": {"model": "opus", "batch_size": 2}}"#,
        )
        .unwrap();
        seed(&path).unwrap();

        assert_eq!(read(&path).unwrap().describing.model, "opus");
    }
}
