#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use recognizer_scan_rust::{scan, Scan};
use serde_json::Value;

pub fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn schema() -> Value {
    let text = fs::read_to_string(repository().join("schema/scan.schema.json")).unwrap();

    serde_json::from_str(&text).unwrap()
}

pub fn validate(document: &Value) {
    let validator = jsonschema::draft202012::new(&schema()).unwrap();

    if let Err(error) = validator.validate(document) {
        panic!("schema: {error} at {}", error.instance_path);
    }

    let ids: Vec<&str> = document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    let foreign: Vec<&str> = document["foreign"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["id"].as_str().unwrap())
        .collect();
    let unique: std::collections::HashSet<&&str> = ids.iter().collect();

    assert_eq!(unique.len(), ids.len());

    for edge in document["edges"].as_array().unwrap() {
        assert!(ids.contains(&edge["from"].as_str().unwrap()));

        let to = edge["to"].as_str().unwrap();

        assert!(ids.contains(&to) || foreign.contains(&to), "edge to {to}");
    }

    for file in document["files"].as_array().unwrap() {
        assert!(ids.contains(&file["path"].as_str().unwrap()));
    }
}

pub fn write_tree(base: &Path, files: &[(&str, &str)]) {
    for (relative, content) in files {
        let path = base.join(relative);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
}

pub fn run_scan(files: &[(&str, &str)]) -> Scan {
    let directory = tempfile::tempdir().unwrap();

    write_tree(directory.path(), files);

    let scanned = match scan(directory.path(), None, None) {
        Ok(scanned) => scanned,
        Err(error) => panic!("scan failed: {:?}", error.problems),
    };

    validate(&scanned.document);

    scanned
}

pub fn run(files: &[(&str, &str)]) -> Value {
    run_scan(files).document
}

pub fn with_manifest(files: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut all = vec![(
        "Cargo.toml".to_string(),
        "[package]\nname = \"app\"\nversion = \"0.1.0\"\n".to_string(),
    )];

    all.extend(files.iter().map(|(a, b)| (a.to_string(), b.to_string())));

    all
}

pub fn krate(files: &[(&str, &str)]) -> Value {
    let all = with_manifest(files);
    let borrowed: Vec<(&str, &str)> = all.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();

    run(&borrowed)
}

pub fn edges(document: &Value) -> Vec<String> {
    document["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|edge| {
            let list = |key: &str| -> Vec<&str> {
                edge.get(key)
                    .and_then(Value::as_array)
                    .map(|items| items.iter().map(|i| i.as_str().unwrap()).collect())
                    .unwrap_or_default()
            };
            let mut text = format!(
                "{} {} {}",
                edge["from"].as_str().unwrap(),
                match edge["kind"].as_str().unwrap() {
                    "depends" => "->",
                    "implements" => "=>",
                    other => other,
                },
                edge["to"].as_str().unwrap()
            );

            if let Some(member) = edge.get("member") {
                text += &format!(
                    " {}.{}",
                    member.as_str().unwrap(),
                    edge["to_member"].as_str().unwrap()
                );
            }

            if !list("names").is_empty() {
                text += &format!(" [{}]", list("names").join(","));
            }

            if !list("via").is_empty() {
                text += &format!(" via {}", list("via").join(","));
            }

            text
        })
        .collect()
}

pub fn has(document: &Value, edge: &str) -> bool {
    edges(document).iter().any(|e| e == edge)
}

pub fn assert_has(document: &Value, edge: &str) {
    assert!(
        has(document, edge),
        "missing {edge} in {:#?}",
        edges(document)
    );
}

pub fn assert_lacks(document: &Value, edge: &str) {
    assert!(
        !has(document, edge),
        "unexpected {edge} in {:#?}",
        edges(document)
    );
}

pub fn member<'a>(document: &'a Value, module: &str, name: &str) -> &'a Value {
    document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == module)
        .unwrap_or_else(|| panic!("no module {module}"))["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"] == name)
        .unwrap_or_else(|| panic!("no member {name}"))
}

pub fn module<'a>(document: &'a Value, id: &str) -> &'a Value {
    document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == id)
        .unwrap()
}
