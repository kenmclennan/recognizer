use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::core_client::CoreClient;

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConfigKeys {
    Ok { schema: serde_json::Value },
    Unavailable { reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Op {
    Set,
    Unset,
    AddSection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

fn text_of(value: &Value, name: &str) -> String {
    value
        .get(name)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn unavailable_reason(reply: &Value) -> String {
    if let Some(body) = reply.get("unavailable") {
        let hint = body.get("hint").or_else(|| body.get("reason"));

        return hint.and_then(Value::as_str).map_or_else(
            || "the recognizer service is not available".to_string(),
            str::to_string,
        );
    }

    match reply.get("error").and_then(Value::as_str) {
        Some(error) => error.to_string(),
        None => "the recognizer service gave no answer".to_string(),
    }
}

fn answer(reply: &Value) -> Option<&Value> {
    reply.get("ok")
}

pub fn read_config_keys_with<F>(call: F) -> ConfigKeys
where
    F: FnOnce(&str, Value) -> Value,
{
    let reply = call("config.keys", json!({}));

    match answer(&reply) {
        Some(body) => match body.get("status").and_then(Value::as_str) {
            Some("ok") => ConfigKeys::Ok {
                schema: body.get("schema").cloned().unwrap_or(Value::Null),
            },
            _ => ConfigKeys::Unavailable {
                reason: text_of(body, "reason"),
            },
        },
        None => ConfigKeys::Unavailable {
            reason: unavailable_reason(&reply),
        },
    }
}

pub fn write_config_with<F>(edits: &[Edit], base_hash: &str, call: F) -> ConfigWrite
where
    F: FnOnce(&str, Value) -> Value,
{
    let reply = call(
        "config.write",
        json!({ "edits": edits, "baseHash": base_hash }),
    );

    match answer(&reply) {
        Some(body) => match body.get("status").and_then(Value::as_str) {
            Some("written") => ConfigWrite::Written {
                text: text_of(body, "text"),
            },
            Some("refused") => ConfigWrite::Refused {
                key: body.get("key").and_then(Value::as_str).map(str::to_string),
                reason: text_of(body, "reason"),
            },
            Some("changed") => ConfigWrite::Changed {
                reason: text_of(body, "reason"),
            },
            _ => ConfigWrite::Unavailable {
                reason: text_of(body, "reason"),
            },
        },
        None => ConfigWrite::Unavailable {
            reason: unavailable_reason(&reply),
        },
    }
}

pub fn read_config_keys(core: &CoreClient, label: &str, folder: Option<&Path>) -> ConfigKeys {
    read_config_keys_with(|op, args| {
        core.call(label, folder, op, args)
            .unwrap_or_else(|e| json!({ "error": e }))
    })
}

pub fn write_repository_config(
    core: &CoreClient,
    label: &str,
    folder: &Path,
    edits: &[Edit],
    base_hash: &str,
) -> ConfigWrite {
    write_config_with(edits, base_hash, |op, args| {
        core.call(label, Some(folder), op, args)
            .unwrap_or_else(|e| json!({ "error": e }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::missing_hint;

    fn set(key: &str, value: &str) -> Edit {
        Edit {
            op: Op::Set,
            key: key.to_string(),
            value: Some(value.to_string()),
        }
    }

    #[test]
    fn a_forwarded_config_keys_answer_is_returned_as_read() {
        let keys = read_config_keys_with(|op, args| {
            assert_eq!(op, "config.keys");
            assert_eq!(args, json!({}));

            json!({ "ok": { "status": "ok", "schema": { "keys_version": 1 } } })
        });

        assert_eq!(
            keys,
            ConfigKeys::Ok {
                schema: json!({ "keys_version": 1 })
            }
        );
        assert_eq!(
            read_config_keys_with(|_, _| json!({
                "ok": { "status": "unavailable", "reason": "a sensor did not answer" }
            })),
            ConfigKeys::Unavailable {
                reason: "a sensor did not answer".to_string()
            }
        );
    }

    #[test]
    fn an_unavailable_service_names_the_reason() {
        let hint = missing_hint();

        assert_eq!(
            read_config_keys_with(|_, _| json!({
                "unavailable": { "kind": "missing", "hint": hint.clone() }
            })),
            ConfigKeys::Unavailable {
                reason: hint.clone()
            }
        );
        assert_eq!(
            write_config_with(&[set("a.b", "1")], "h", |_, _| json!({
                "unavailable": { "kind": "missing", "hint": hint.clone() }
            })),
            ConfigWrite::Unavailable { reason: hint }
        );
        assert_eq!(
            write_config_with(&[], "h", |_, _| json!({ "error": "boom" })),
            ConfigWrite::Unavailable {
                reason: "boom".to_string()
            }
        );
    }

    #[test]
    fn a_write_forwards_the_edits_and_the_base_hash() {
        let outcome = write_config_with(
            &[
                set("a.b", "1"),
                Edit {
                    op: Op::AddSection,
                    key: "tests.x".to_string(),
                    value: None,
                },
            ],
            "abc",
            |op, args| {
                assert_eq!(op, "config.write");
                assert_eq!(
                    args,
                    json!({
                        "edits": [
                            { "op": "set", "key": "a.b", "value": "1" },
                            { "op": "add-section", "key": "tests.x", "value": null }
                        ],
                        "baseHash": "abc"
                    })
                );

                json!({ "ok": { "status": "written", "text": "a: 1\n" } })
            },
        );

        assert_eq!(
            outcome,
            ConfigWrite::Written {
                text: "a: 1\n".to_string()
            }
        );
    }

    #[test]
    fn refused_and_changed_answers_are_returned_as_read() {
        assert_eq!(
            write_config_with(&[], "h", |_, _| json!({
                "ok": { "status": "refused", "key": "a.b", "reason": "must be at least 1" }
            })),
            ConfigWrite::Refused {
                key: Some("a.b".to_string()),
                reason: "must be at least 1".to_string()
            }
        );
        assert_eq!(
            write_config_with(&[], "h", |_, _| json!({
                "ok": { "status": "changed", "reason": "the config changed since it was read" }
            })),
            ConfigWrite::Changed {
                reason: "the config changed since it was read".to_string()
            }
        );
    }
}
