mod support;

use std::collections::BTreeSet;

use serde_json::Value;
use support::*;

#[test]
fn the_scanner_marks_exactly_the_file_cases_test_files() {
    let text =
        std::fs::read_to_string(repository().join("fixtures/rust-test-gate/file-cases.json"))
            .unwrap();
    let cases: Vec<Value> = serde_json::from_str(&text).unwrap();

    assert!(cases.len() > 15);

    let roots: BTreeSet<&str> = ["src/lib.rs", "src/bin/tool/main.rs", "build.rs"].into();

    for case in &cases {
        let name = case["name"].as_str().unwrap();
        let mut files: Vec<(String, String)> = vec![(
            "Cargo.toml".to_string(),
            "[package]\nname = \"app\"\nversion = \"0.1.0\"\n".to_string(),
        )];

        for (path, content) in case["files"].as_object().unwrap() {
            files.push((path.clone(), content.as_str().unwrap().to_string()));
        }

        let borrowed: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let document = run(&borrowed);
        let found: BTreeSet<String> = document["modules"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m.get("entry_point") == Some(&Value::Bool(true)))
            .map(|m| m["id"].as_str().unwrap().to_string())
            .filter(|id| !roots.contains(id.as_str()))
            .collect();
        let want: BTreeSet<String> = case["test_files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| path.as_str().unwrap().to_string())
            .collect();

        assert_eq!(found, want, "{name}");
    }
}
