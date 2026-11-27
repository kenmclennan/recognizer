use serde::Serialize;
use serde_json::{Map, Value};

pub trait SettingsRepository {
    fn load(&self) -> Result<Option<Map<String, Value>>, String>;
    fn store(&self, object: Map<String, Value>) -> Result<(), String>;
}

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

pub fn parse(object: Option<&Map<String, Value>>) -> Result<Stored, String> {
    let Some(object) = object else {
        return Ok(Stored::default());
    };

    let editor = match object.get("editor") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(editor)) => editor.trim().to_string(),
        Some(_) => return Err("editor in config.json must be a string".to_string()),
    };

    Ok(Stored {
        editor,
        describing: stored_object(
            object,
            "describing",
            &["model"],
            &["batch_size", "confirm_above_usd"],
        )?,
        setup: stored_object(object, "setup", &["model"], &[])?,
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

fn set_or_remove(object: &mut Map<String, Value>, key: &str, value: &str) {
    let value = value.trim();

    if value.is_empty() {
        object.remove(key);
    } else {
        object.insert(key.to_string(), Value::String(value.to_string()));
    }
}

pub fn read(repository: &dyn SettingsRepository) -> Result<Stored, String> {
    parse(repository.load()?.as_ref())
}

pub fn save(
    repository: &dyn SettingsRepository,
    settings: &Settings,
    baseline: &Settings,
    check: Check,
) -> Result<(), String> {
    validate(settings)?;
    check(settings)?;

    let mut object = repository.load()?.unwrap_or_default();

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

    repository.store(object)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    pub mod contract {
        use super::*;

        pub fn settings_repository(repository: &dyn SettingsRepository) {
            assert_eq!(repository.load(), Ok(None));

            let first = serde_json::json!({"editor": "code", "other": [1]});
            let first = first.as_object().unwrap().clone();

            repository.store(first.clone()).unwrap();

            assert!(repository.load().unwrap().is_some());
            assert_eq!(repository.load(), Ok(Some(first)));

            let second = serde_json::json!({"describing": {"batch_size": 3}});
            let second = second.as_object().unwrap().clone();

            repository.store(second.clone()).unwrap();

            assert_eq!(repository.load(), Ok(Some(second)));
        }
    }

    #[derive(Default)]
    struct FakeSettings {
        object: RefCell<Option<Map<String, Value>>>,
        stores: Cell<usize>,
    }

    impl FakeSettings {
        fn holding(text: &str) -> Self {
            let fake = Self::default();

            *fake.object.borrow_mut() = Some(object(text));

            fake
        }

        fn written(&self) -> Value {
            Value::Object(self.object.borrow().clone().unwrap())
        }
    }

    impl SettingsRepository for FakeSettings {
        fn load(&self) -> Result<Option<Map<String, Value>>, String> {
            Ok(self.object.borrow().clone())
        }

        fn store(&self, object: Map<String, Value>) -> Result<(), String> {
            *self.object.borrow_mut() = Some(object);
            self.stores.set(self.stores.get() + 1);

            Ok(())
        }
    }

    fn object(text: &str) -> Map<String, Value> {
        serde_json::from_str::<Value>(text)
            .unwrap()
            .as_object()
            .unwrap()
            .clone()
    }

    fn accept(_: &Settings) -> Result<(), String> {
        Ok(())
    }

    fn save(repository: &dyn SettingsRepository, settings: &Settings) -> Result<(), String> {
        super::save(repository, settings, &baseline(), &accept)
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

    #[test]
    fn the_fake_meets_the_settings_contract() {
        contract::settings_repository(&FakeSettings::default());
    }

    #[test]
    fn an_absent_config_stores_nothing() {
        assert_eq!(parse(None), Ok(Stored::default()));
        assert_eq!(parse(Some(&object("{}"))), Ok(Stored::default()));
    }

    #[test]
    fn a_config_stores_only_what_it_holds() {
        let stored = parse(Some(&object(r#"{"describing": {"batch_size": 8}}"#))).unwrap();

        assert_eq!(stored.describing.len(), 1);
        assert_eq!(stored.describing["batch_size"], 8);
        assert!(stored.setup.is_empty());

        let nulls = parse(Some(&object(r#"{"describing": null, "setup": null}"#))).unwrap();

        assert_eq!(nulls, Stored::default());
    }

    #[test]
    fn a_recognizer_path_in_the_config_is_ignored() {
        assert_eq!(
            parse(Some(&object(r#"{"recognizer_path": "bin/recognizer"}"#))),
            Ok(Stored::default())
        );
        assert_eq!(
            parse(Some(&object(r#"{"recognizer_path": 4}"#))),
            Ok(Stored::default())
        );
    }

    #[test]
    fn a_malformed_config_is_rejected() {
        assert!(parse(Some(&object(r#"{"editor": 3}"#))).is_err());
        assert!(read(&FakeSettings::holding(r#"{"editor": 3}"#)).is_err());
    }

    #[test]
    fn the_editor_is_trimmed() {
        assert_eq!(
            parse(Some(&object(r#"{"editor": "  Sublime Text "}"#)))
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
    fn saving_a_blank_editor_removes_its_key() {
        let fake = FakeSettings::holding(r#"{"editor": "code"}"#);

        save(&fake, &settings("")).unwrap();

        assert_eq!(fake.stores.get(), 1);
        assert!(fake.written().get("editor").is_none());
    }

    #[test]
    fn saving_writes_nothing_when_validation_fails() {
        let fake = FakeSettings::holding(r#"{"editor": "code"}"#);

        assert!(save(&fake, &settings("code\nrm x")).is_err());
        assert_eq!(fake.stores.get(), 0);
        assert_eq!(fake.written(), serde_json::json!({"editor": "code"}));
    }

    #[test]
    fn the_editor_is_trimmed_when_saved() {
        let fake = FakeSettings::holding(r#"{"other": 1}"#);

        save(&fake, &settings("  code ")).unwrap();

        assert_eq!(fake.written()["editor"], "code");
        assert_eq!(fake.written()["other"], 1);
    }

    #[test]
    fn a_refusal_from_the_service_is_returned_by_save_and_save_writes_nothing() {
        let fake = FakeSettings::holding(r#"{"editor": "code"}"#);

        let error = super::save(&fake, &settings(""), &baseline(), &refuse).unwrap_err();

        assert_eq!(error, "describing.model must be a non-empty name");
        assert_eq!(fake.stores.get(), 0);
        assert_eq!(fake.written(), serde_json::json!({"editor": "code"}));
    }

    #[test]
    fn save_writes_describing_as_given_and_omits_an_unknown_model() {
        let fake = FakeSettings::holding(r#"{"editor": "code"}"#);

        save(&fake, &settings("")).unwrap();

        assert_eq!(
            fake.written()["describing"],
            serde_json::json!({"model": "opus", "batch_size": 8, "confirm_above_usd": 2.5})
        );

        let mut unknown = settings("");

        unknown.describing.model = None;
        save(&fake, &unknown).unwrap();

        assert_eq!(
            fake.written()["describing"],
            serde_json::json!({"batch_size": 8, "confirm_above_usd": 2.5})
        );
    }

    #[test]
    fn an_unknown_key_survives_a_save_that_changes_setup() {
        let fake = FakeSettings::holding(r#"{"other": [1], "setup": {"model": "alpha", "x": 1}}"#);

        assert_eq!(read(&fake).unwrap().setup["model"], "alpha");

        save(&fake, &settings("")).unwrap();

        let value = fake.written();

        assert_eq!(value["other"], serde_json::json!([1]));
        assert_eq!(value["setup"], serde_json::json!({"model": "opus"}));
    }

    #[test]
    fn a_leftover_scanning_key_is_dropped_on_save() {
        let fake = FakeSettings::holding(
            r#"{"editor": "code", "scanning": {"describe": true, "sensors": "yes"}, "recognizer_path": "/x"}"#,
        );

        assert_eq!(read(&fake).unwrap().editor, "code");
        assert_eq!(
            parse(Some(&object(r#"{"scanning": 3}"#))),
            Ok(Stored::default())
        );

        save(&fake, &settings("code")).unwrap();

        let value = fake.written();

        assert!(value.get("scanning").is_none());
        assert_eq!(value["editor"], "code");
        assert_eq!(value["recognizer_path"], "/x");
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
        let fake = FakeSettings::default();
        let mut changed = baseline();

        changed.describing.batch_size = 6;

        super::save(&fake, &changed, &baseline(), &accept).unwrap();

        assert_eq!(
            fake.written(),
            serde_json::json!({"describing": {"batch_size": 6}})
        );
    }

    #[test]
    fn saving_unchanged_values_into_an_empty_config_writes_no_keys() {
        let fake = FakeSettings::default();

        super::save(&fake, &baseline(), &baseline(), &accept).unwrap();

        assert_eq!(fake.stores.get(), 1);
        assert_eq!(fake.written(), serde_json::json!({}));
    }

    #[test]
    fn a_stored_key_stays_when_it_equals_the_published_value() {
        let fake = FakeSettings::holding(r#"{"describing": {"batch_size": 7}}"#);

        super::save(&fake, &baseline(), &baseline(), &accept).unwrap();

        assert_eq!(
            fake.written(),
            serde_json::json!({"describing": {"batch_size": 7}})
        );
    }

    #[test]
    fn parse_checks_shape_only() {
        let shaped = |text: &str| parse(Some(&object(text)));

        assert!(shaped(r#"{"describing": 3}"#).is_err());
        assert!(shaped(r#"{"describing": {"model": 1}}"#).is_err());
        assert!(shaped(r#"{"describing": {"model": "a", "confirm_above_usd": "9"}}"#).is_err());
        assert!(shaped(r#"{"setup": 3}"#).is_err());
        assert!(shaped(r#"{"setup": {"model": 1}}"#).is_err());
        assert!(shaped(r#"{"describing": {"model": "-x", "batch_size": 99}}"#).is_ok());
    }
}
