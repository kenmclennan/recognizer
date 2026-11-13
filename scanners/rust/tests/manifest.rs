mod support;

use std::fs;
use std::process::{Command, Output};

use recognizer_scan_rust::manifest::{build, PROTOCOL};
use serde_json::Value;
use support::*;

fn manifest_in(directory: &std::path::Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
        .arg("manifest")
        .current_dir(directory)
        .output()
        .unwrap()
}

fn read(path: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(repository().join(path)).unwrap()).unwrap()
}

#[test]
fn the_protocol_is_the_shared_protocol_file() {
    assert_eq!(read("schema/protocol.json")["protocol"], PROTOCOL);
}

#[test]
fn the_manifest_verb_prints_a_valid_manifest_and_nothing_else() {
    let directory = tempfile::tempdir().unwrap();
    let output = manifest_in(directory.path());
    let text = String::from_utf8(output.stdout).unwrap();
    let validator = jsonschema::draft202012::new(&read("schema/manifest.schema.json")).unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert!(text.ends_with('\n') && !text.ends_with("\n\n"));
    assert!(validator
        .validate(&serde_json::from_str::<Value>(&text).unwrap())
        .is_ok());
}

#[test]
fn the_manifest_is_the_same_from_another_working_directory_and_touches_nothing() {
    let here = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();

    assert_eq!(
        manifest_in(here.path()).stdout,
        manifest_in(elsewhere.path()).stdout
    );
    assert_eq!(fs::read_dir(elsewhere.path()).unwrap().count(), 0);
}

#[test]
fn the_languages_equal_the_shared_table() {
    let table = read("fixtures/plugins/languages.json");
    let expected: Vec<&Value> = table
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["name"] == "rust")
        .collect();

    assert_eq!(
        build()["languages"]
            .as_array()
            .unwrap()
            .iter()
            .collect::<Vec<_>>(),
        expected
    );
}
