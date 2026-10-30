mod support;

use std::fs;

use recognizer_scan_rust::discovery::selection;
use serde_json::{json, Value};
use support::*;

#[test]
fn the_selection_is_the_binding_list() {
    assert_eq!(
        selection(),
        json!({
            "extensions": [".rs"],
            "skip_directory_names": ["target", "node_modules"],
            "skip_directory_prefixes": ["."],
            "skip_directory_suffixes": [],
            "skip_directories_containing": [],
            "skip_file_globs": []
        })
    );
}

#[test]
fn the_parity_tree_gives_exactly_the_accepted_list() {
    let text = fs::read_to_string(repository().join("fixtures/selection-parity.json")).unwrap();
    let parity: Value = serde_json::from_str(&text).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let tree: Vec<&str> = parity["rust"]["tree"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    let files: Vec<(&str, &str)> = tree.iter().map(|path| (*path, "")).collect();

    write_tree(directory.path(), &files);

    let accepted = recognizer_scan_rust::discovery::source_files(directory.path());
    let wanted: Vec<String> = parity["rust"]["accepted"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect();

    assert_eq!(accepted, wanted);
}

#[test]
fn test_code_and_build_scripts_are_scanned() {
    let document = run(&[
        ("tests/it.rs", ""),
        ("benches/b.rs", ""),
        ("examples/e.rs", ""),
        ("build.rs", ""),
    ]);

    assert_eq!(document["files"].as_array().unwrap().len(), 4);
}

#[test]
fn every_valid_example_validates_and_every_invalid_one_is_refused() {
    let validator = jsonschema::draft202012::new(&schema()).unwrap();
    let examples = repository().join("schema/examples");

    for entry in fs::read_dir(examples.join("valid")).unwrap() {
        let path = entry.unwrap().path();
        let document: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert!(validator.validate(&document).is_ok(), "{}", path.display());
    }

    for entry in fs::read_dir(examples.join("invalid")).unwrap() {
        let path = entry.unwrap().path();
        let document: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        assert!(validator.validate(&document).is_err(), "{}", path.display());
    }
}

#[test]
fn the_rust_example_carries_the_rust_language() {
    let text =
        fs::read_to_string(repository().join("schema/examples/valid/rust-module.json")).unwrap();
    let document: Value = serde_json::from_str(&text).unwrap();

    assert_eq!(document["modules"][0]["language"], "rust");
}

#[test]
fn a_module_with_an_unknown_language_is_still_refused() {
    let text =
        fs::read_to_string(repository().join("schema/examples/valid/rust-module.json")).unwrap();
    let mut document: Value = serde_json::from_str(&text).unwrap();

    document["modules"][0]["language"] = json!("cobol");

    let validator = jsonschema::draft202012::new(&schema()).unwrap();

    assert!(validator.validate(&document).is_err());
}
