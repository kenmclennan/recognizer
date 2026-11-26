use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::fs_safe::write_atomic;

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub editor: String,
    pub describing: Describing,
    pub setup: Setup,
}

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Describing {
    pub model: Option<String>,
    #[serde(alias = "batch_size")]
    pub batch_size: u32,
    #[serde(alias = "confirm_above_usd")]
    pub confirm_above_usd: f64,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Stored {
    pub editor: String,
    pub describing: Map<String, Value>,
    pub setup: Map<String, Value>,
}

fn stored_object(
    object: &Map<String, Value>,
    key: &str,
    string_keys: &[&str],
    number_keys: &[&str],
) -> Result<Map<String, Value>, String> {
    let inner = match object.get(key) {
        None | Some(Value::Null) => return Ok(Map::new()),
        Some(Value::Object(inner)) => inner,
        Some(_) => return Err(format!("{key} in config.json must be an object")),
    };

    for name in string_keys {
        if let Some(value) = inner.get(*name) {
            if !value.is_string() {
                return Err(format!("{key}.{name} in config.json must be a string"));
            }
        }
    }

    for name in number_keys {
        if let Some(value) = inner.get(*name) {
            if !value.is_number() {
                return Err(format!("{key}.{name} in config.json must be a number"));
            }
        }
    }

    Ok(inner.clone())
}

fn parse_object(text: &str) -> Result<Map<String, Value>, String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|error| format!("config.json is not valid JSON: {error}"))?;

    match value {
        Value::Object(object) => Ok(object),
        _ => Err("config.json must be a JSON object".to_string()),
    }
}

pub fn parse(text: Option<&str>) -> Result<Stored, String> {
    let Some(text) = text else {
        return Ok(Stored::default());
    };

    let object = parse_object(text)?;

    let editor = match object.get("editor") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(editor)) => editor.trim().to_string(),
        Some(_) => return Err("editor in config.json must be a string".to_string()),
    };

    Ok(Stored {
        editor,
        describing: stored_object(
            &object,
            "describing",
            &["model"],
            &["batch_size", "confirm_above_usd"],
        )?,
        setup: stored_object(&object, "setup", &["model"], &[])?,
    })
}

pub fn from_values(editor: String, values: &Value) -> Result<Settings, String> {
    let describing = values
        .get("describing")
        .ok_or("the service answered without describing values")?;
    let setup = values
        .get("setup")
        .ok_or("the service answered without setup values")?;

    Ok(Settings {
        editor,
        describing: serde_json::from_value(describing.clone())
            .map_err(|error| format!("describing values: {error}"))?,
        setup: serde_json::from_value(setup.clone())
            .map_err(|error| format!("setup values: {error}"))?,
    })
}

pub fn validate(settings: &Settings) -> Result<(), String> {
    if settings.editor.contains('\n') || settings.editor.contains('\r') {
        return Err("the editor must be a single line".to_string());
    }

    Ok(())
}

pub type Check<'a> = &'a dyn Fn(&Settings) -> Result<(), String>;

pub fn describing_json(describing: &Describing) -> Value {
    let mut object = Map::new();

    if let Some(model) = &describing.model {
        object.insert("model".to_string(), Value::String(model.clone()));
    }

    object.insert("batch_size".to_string(), describing.batch_size.into());
    object.insert(
        "confirm_above_usd".to_string(),
        serde_json::json!(describing.confirm_above_usd),
    );

    Value::Object(object)
}

fn changed_keys(existing: Option<&Value>, given: &Value, baseline: &Value) -> Map<String, Value> {
    let stored = existing.and_then(Value::as_object);
    let mut kept = Map::new();

    for (key, value) in given.as_object().into_iter().flatten() {
        let is_stored = stored.is_some_and(|object| object.contains_key(key));

        if is_stored || baseline.get(key) != Some(value) {
            kept.insert(key.clone(), value.clone());
        }
    }

    kept
}

fn put_object(object: &mut Map<String, Value>, key: &str, value: Map<String, Value>) {
    if value.is_empty() {
        object.remove(key);
    } else {
        object.insert(key.to_string(), Value::Object(value));
    }
}

fn write_object(path: &Path, object: Map<String, Value>) -> Result<(), String> {
    let mut text =
        serde_json::to_string_pretty(&Value::Object(object)).map_err(|error| error.to_string())?;

    text.push('\n');

    write_atomic(path, &text).map_err(|error| format!("{}: {error}", path.display()))
}

pub fn read(path: &Path) -> Result<Stored, String> {
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

pub fn save(
    path: &Path,
    settings: &Settings,
    baseline: &Settings,
    check: Check,
) -> Result<(), String> {
    validate(settings)?;
    check(settings)?;

    let mut object = match fs::read_to_string(path) {
        Ok(text) => parse_object(&text)?,
        Err(_) => Map::new(),
    };

    set_or_remove(&mut object, "editor", &settings.editor);

    object.remove("scanning");

    let describing = changed_keys(
        object.get("describing"),
        &describing_json(&settings.describing),
        &describing_json(&baseline.describing),
    );
    let setup = changed_keys(
        object.get("setup"),
        &serde_json::json!({ "model": settings.setup.model }),
        &serde_json::json!({ "model": baseline.setup.model }),
    );

    put_object(&mut object, "describing", describing);
    put_object(&mut object, "setup", setup);

    write_object(path, object)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn accept(_: &Settings) -> Result<(), String> {
        Ok(())
    }

    fn read(path: &Path) -> Result<Stored, String> {
        super::read(path)
    }

    fn save(path: &Path, settings: &Settings) -> Result<(), String> {
        super::save(path, settings, &baseline(), &accept)
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

    fn refuse(_: &Settings) -> Result<(), String> {
        Err("describing.model must be a non-empty name".to_string())
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

    fn file() -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("cfg/config.json");

        (dir, path)
    }

    fn written(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn an_absent_config_stores_nothing() {
        assert_eq!(parse(None), Ok(Stored::default()));
        assert_eq!(parse(Some("{}")), Ok(Stored::default()));
    }

    #[test]
    fn a_config_stores_only_what_it_holds() {
        let stored = parse(Some(r#"{"describing": {"batch_size": 8}}"#)).unwrap();

        assert_eq!(stored.describing.len(), 1);
        assert_eq!(stored.describing["batch_size"], 8);
        assert!(stored.setup.is_empty());

        let nulls = parse(Some(r#"{"describing": null, "setup": null}"#)).unwrap();

        assert_eq!(nulls, Stored::default());
    }

    #[test]
    fn a_recognizer_path_in_the_config_is_ignored() {
        assert_eq!(
            parse(Some(r#"{"recognizer_path": "bin/recognizer"}"#)),
            Ok(Stored::default())
        );
        assert_eq!(
            parse(Some(r#"{"recognizer_path": 4}"#)),
            Ok(Stored::default())
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
        assert!(validate(&settings("code\nrm x")).is_err());
        assert!(validate(&settings("")).is_ok());
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

        save(&path, &settings("Sublime Text")).unwrap();

        let value = written(&path);

        assert_eq!(value["recognizer_path"], "/opt/bin/recognizer");
        assert_eq!(value["editor"], "Sublime Text");
        assert_eq!(value["other"], serde_json::json!([1, 2]));
        assert!(fs::read_to_string(&path).unwrap().ends_with("}\n"));
    }

    #[test]
    fn saving_a_blank_editor_removes_its_key() {
        let (_dir, path) = file();

        save(&path, &settings("code")).unwrap();
        save(&path, &settings("")).unwrap();

        assert!(written(&path).get("editor").is_none());
    }

    #[test]
    fn saving_refuses_a_file_that_is_not_a_json_object_and_leaves_it() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "[1]").unwrap();

        assert!(save(&path, &settings("")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1]");

        fs::write(&path, "not json").unwrap();

        assert!(save(&path, &settings("")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
    }

    #[test]
    fn saving_writes_nothing_when_validation_fails() {
        let (_dir, path) = file();

        assert!(save(&path, &settings("code\nrm x")).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn save_then_read_round_trips_the_editor() {
        let (_dir, path) = file();

        save(&path, &settings("code --goto")).unwrap();

        let stored = read(&path).unwrap();

        assert_eq!(stored.editor, "code --goto");
        assert_eq!(stored.describing["model"], "opus");
        assert_eq!(stored.describing["batch_size"], 8);
        assert_eq!(stored.setup["model"], "opus");
    }

    #[test]
    fn reading_an_absent_file_stores_nothing() {
        let (_dir, path) = file();

        assert_eq!(read(&path), Ok(Stored::default()));
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

        let stored = read(&path).unwrap();

        assert_eq!(stored.editor, "code");
        assert_eq!(parse(Some(r#"{"scanning": 3}"#)), Ok(Stored::default()));

        save(&path, &settings(&stored.editor)).unwrap();

        let value = written(&path);

        assert!(value.get("scanning").is_none());
        assert_eq!(value["editor"], "code");
        assert_eq!(value["recognizer_path"], "/x");
    }

    #[test]
    fn save_writes_describing_as_given_and_omits_an_unknown_model() {
        let (_dir, path) = file();

        save(&path, &settings("")).unwrap();

        assert_eq!(
            written(&path)["describing"],
            serde_json::json!({"model": "opus", "batch_size": 8, "confirm_above_usd": 2.5})
        );

        let mut unknown = settings("");

        unknown.describing.model = None;
        save(&path, &unknown).unwrap();

        assert_eq!(
            written(&path)["describing"],
            serde_json::json!({"batch_size": 8, "confirm_above_usd": 2.5})
        );
    }

    #[test]
    fn an_unknown_key_survives_a_save_that_changes_setup() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"other": [1], "setup": {"model": "alpha", "x": 1}}"#,
        )
        .unwrap();

        assert_eq!(read(&path).unwrap().setup["model"], "alpha");

        save(&path, &settings("")).unwrap();

        let value = written(&path);

        assert_eq!(value["other"], serde_json::json!([1]));
        assert_eq!(value["setup"], serde_json::json!({"model": "opus"}));
    }

    #[test]
    fn a_refusal_from_the_service_is_returned_by_save_and_save_writes_nothing() {
        let (_dir, path) = file();

        let error = super::save(&path, &settings(""), &baseline(), &refuse).unwrap_err();

        assert_eq!(error, "describing.model must be a non-empty name");
        assert!(!path.exists());
    }

    #[test]
    fn values_from_the_service_fill_every_field_and_an_unknown_model_is_null() {
        let values = serde_json::json!({
            "describing": {"model": null, "batch_size": 8, "confirm_above_usd": 2.5},
            "setup": {"model": "opus"},
        });
        let read = from_values("code".to_string(), &values).unwrap();

        assert_eq!(read.editor, "code");
        assert_eq!(read.describing.model, None);
        assert_eq!(read.describing.batch_size, 8);
        assert_eq!(read.setup.model, "opus");
        assert_eq!(
            serde_json::to_value(&read).unwrap()["describing"]["model"],
            Value::Null
        );
        assert!(from_values(String::new(), &serde_json::json!({})).is_err());
    }

    #[test]
    fn saving_one_changed_key_into_an_empty_config_writes_only_that_key() {
        let (_dir, path) = file();
        let mut changed = baseline();

        changed.describing.batch_size = 6;

        super::save(&path, &changed, &baseline(), &accept).unwrap();

        assert_eq!(
            written(&path),
            serde_json::json!({"describing": {"batch_size": 6}})
        );
    }

    #[test]
    fn saving_unchanged_values_into_an_empty_config_writes_no_keys() {
        let (_dir, path) = file();

        super::save(&path, &baseline(), &baseline(), &accept).unwrap();

        assert_eq!(written(&path), serde_json::json!({}));
    }

    #[test]
    fn a_stored_key_stays_when_it_equals_the_published_value() {
        let (_dir, path) = file();

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"describing": {"batch_size": 7}}"#).unwrap();

        super::save(&path, &baseline(), &baseline(), &accept).unwrap();

        assert_eq!(
            written(&path),
            serde_json::json!({"describing": {"batch_size": 7}})
        );
    }

    #[test]
    fn parse_checks_shape_only() {
        assert!(parse(Some(r#"{"describing": 3}"#)).is_err());
        assert!(parse(Some(r#"{"describing": {"model": 1}}"#)).is_err());
        assert!(parse(Some(
            r#"{"describing": {"model": "a", "confirm_above_usd": "9"}}"#
        ))
        .is_err());
        assert!(parse(Some(r#"{"setup": 3}"#)).is_err());
        assert!(parse(Some(r#"{"setup": {"model": 1}}"#)).is_err());
        assert!(parse(Some(r#"{"describing": {"model": "-x", "batch_size": 99}}"#)).is_ok());
    }
}
