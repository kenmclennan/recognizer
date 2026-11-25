use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core_client::CoreClient;

pub const OUTPUT_MARK: &str = "@@recognizer-output@@";

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

pub fn config_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hint_says_to_install_and_names_no_setting() {
        let hint = missing_hint();

        assert!(hint.contains("brew install --cask kenmclennan/tap/recognizer"));
        assert!(!hint.contains("recognizer_path"));
        assert!(!hint.contains("Settings"));
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
    fn config_file_sits_in_the_config_directory() {
        assert_eq!(
            config_file_in(Path::new("/cfg")),
            PathBuf::from("/cfg/config.json")
        );
    }
}
