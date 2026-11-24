mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use support::*;

fn read(path: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(repository().join(path)).unwrap()).unwrap()
}

fn files_under(root: &Path, directory: &str, into: &mut Vec<String>) {
    let mut entries: Vec<_> = fs::read_dir(root.join(directory))
        .unwrap()
        .map(|entry| entry.unwrap())
        .collect();

    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = if directory.is_empty() {
            name.clone()
        } else {
            format!("{directory}/{name}")
        };

        if entry.file_type().unwrap().is_dir() {
            if name != "target" && name != "node_modules" && name != ".git" {
                files_under(root, &path, into);
            }
        } else {
            into.push(path);
        }
    }
}

fn answer_for(root: &Path, suites: Value) -> Value {
    let mut files = Vec::new();

    files_under(root, "", &mut files);

    let directory = tempfile::tempdir().unwrap();
    let request = directory.path().join("request.json");

    fs::write(
        &request,
        json!({ "root": root, "files": files, "suites": suites }).to_string(),
    )
    .unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
        .arg("survey")
        .arg(&request)
        .output()
        .unwrap();

    assert!(output.status.success(), "{:?}", output);
    assert!(output.stderr.is_empty());

    let answer: Value = serde_json::from_slice(&output.stdout).unwrap();
    let validator =
        jsonschema::draft202012::new(&read("schema/survey-answer.schema.json")).unwrap();

    assert!(validator.validate(&answer).is_ok(), "{answer}");

    answer
}

fn froms(answer: &Value) -> Vec<String> {
    answer["runners"]
        .as_array()
        .unwrap()
        .iter()
        .map(|runner| runner["from"].as_str().unwrap().to_string())
        .collect()
}

fn write(root: &Path, name: &str, text: &str) {
    let target = root.join(name);

    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, text).unwrap();
}

#[test]
fn a_package_manifest_gives_a_cargo_runner_with_the_placeholders_and_an_undo() {
    let root = tempfile::tempdir().unwrap();

    write(
        root.path(),
        "core/Cargo.toml",
        "[package]\nname = \"core\"\n",
    );

    let answer = answer_for(root.path(), json!([]));
    let runner = &answer["runners"][0];
    let tool = &answer["tools"][0];

    assert_eq!(froms(&answer), ["core/Cargo.toml"]);
    assert_eq!(runner["directory"], "core");
    assert_eq!(
        runner["command"],
        "cargo llvm-cov --lcov --output-path {up}.recognizer/cache/coverage/{slug}/lcov.info"
    );
    assert_eq!(
        runner["coverage"]["path"],
        ".recognizer/cache/coverage/{slug}/lcov.info"
    );
    assert_eq!(tool["name"], "cargo-llvm-cov");
    assert_eq!(tool["needed_by"], json!(["core/Cargo.toml"]));
    assert_eq!(
        tool["undo"],
        json!(["cargo", "uninstall", "cargo-llvm-cov"])
    );
    assert_eq!(tool["undo_note"], "cargo-llvm-cov was uninstalled");
}

#[test]
fn a_workspace_only_manifest_gives_no_runner() {
    let root = tempfile::tempdir().unwrap();

    write(root.path(), "Cargo.toml", "[workspace]\nmembers = []\n");

    let answer = answer_for(root.path(), json!([]));

    assert_eq!(answer["runners"], json!([]));
    assert_eq!(answer["tools"], json!([]));
}

#[test]
fn a_folder_a_configured_suite_covers_is_not_answered() {
    let root = tempfile::tempdir().unwrap();

    write(root.path(), "a/Cargo.toml", "[package]\nname = \"a\"\n");
    write(root.path(), "b/Cargo.toml", "[package]\nname = \"b\"\n");

    let answer = answer_for(
        root.path(),
        json!([{ "language": "rust", "directory": "a" }]),
    );

    assert_eq!(froms(&answer), ["b/Cargo.toml"]);
    assert_eq!(answer["tools"][0]["needed_by"], json!(["b/Cargo.toml"]));
}

#[test]
fn runners_are_ordered_by_directory() {
    let root = tempfile::tempdir().unwrap();

    write(root.path(), "z/Cargo.toml", "[package]\nname = \"z\"\n");
    write(root.path(), "Cargo.toml", "[package]\nname = \"root\"\n");
    write(root.path(), "m/Cargo.toml", "[package]\nname = \"m\"\n");

    assert_eq!(
        froms(&answer_for(root.path(), json!([]))),
        ["Cargo.toml", "m/Cargo.toml", "z/Cargo.toml"]
    );
}

#[test]
fn a_request_file_that_is_not_there_exits_2() {
    let output = Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
        .args(["survey", "/nonexistent/request.json"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn over_the_loom_fixture_the_answer_has_the_one_tauri_runner() {
    let answer = answer_for(&repository().join("fixtures/setup-loom"), json!([]));

    assert_eq!(froms(&answer), ["app/src-tauri/Cargo.toml"]);
}

#[test]
fn over_this_repository_the_answer_lists_the_app_crate_and_none_the_config_covers() {
    let root = repository();
    let config = fs::read_to_string(root.join(".recognizer/config.yaml")).unwrap();
    let mut suites = Vec::new();
    let mut language = None;
    let mut directory = None;

    for line in config.lines() {
        let line = line.trim();

        if let Some(value) = line.strip_prefix("language: ") {
            language = Some(value.to_string());
        }

        if let Some(value) = line.strip_prefix("directory: ") {
            directory = Some(value.to_string());
        }

        if let (Some(l), Some(d)) = (&language, &directory) {
            suites.push(json!({ "language": l, "directory": d }));
            language = None;
            directory = None;
        }
    }

    assert!(suites.iter().any(|suite| suite["language"] == "rust"));

    let answer = answer_for(&root, Value::Array(suites.clone()));
    let directories: Vec<&str> = answer["runners"]
        .as_array()
        .unwrap()
        .iter()
        .map(|runner| runner["directory"].as_str().unwrap())
        .collect();

    assert!(
        directories.contains(&"packages/app/src-tauri"),
        "{directories:?}"
    );

    for suite in suites.iter().filter(|suite| suite["language"] == "rust") {
        assert!(!directories.contains(&suite["directory"].as_str().unwrap()));
    }
}
