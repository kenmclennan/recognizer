mod support;

use std::fs;

use recognizer_scan_rust::scan;
use serde_json::Value;
use support::*;

const TAURI: &str = "app/src-tauri/";

fn tauri_files() -> Vec<String> {
    let mut found = Vec::new();

    fn visit(directory: &std::path::Path, prefix: &str, found: &mut Vec<String>) {
        for entry in fs::read_dir(directory).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();

            if path.is_dir() {
                if name != "target" && !name.starts_with('.') && name != "node_modules" {
                    visit(&path, &format!("{prefix}{name}/"), found);
                }
            } else if name.ends_with(".rs") || name == "Cargo.toml" {
                found.push(format!("{prefix}{name}"));
            }
        }
    }

    visit(&repository().join(TAURI), TAURI, &mut found);
    found.sort();

    found
}

fn in_tauri(value: &Value) -> bool {
    value.as_str().unwrap().starts_with(TAURI)
}

#[test]
fn this_repositorys_tauri_crate_scans_to_the_recorded_shape() {
    let scanned = scan(&repository(), None, None)
        .ok()
        .expect("the repository scans");
    let document = scanned.document;
    let baseline: Value = serde_json::from_str(
        &fs::read_to_string(repository().join("fixtures/rust/recognizer-baseline.json")).unwrap(),
    )
    .unwrap();

    validate(&document);

    let wanted = tauri_files();
    let files: Vec<&str> = document["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .filter(|p| p.starts_with(TAURI))
        .collect();
    let modules = document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| in_tauri(&m["id"]))
        .count();
    let tauri_edges: Vec<&Value> = document["edges"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| in_tauri(&e["from"]))
        .collect();
    let implements = tauri_edges
        .iter()
        .filter(|e| e["kind"] == "implements")
        .count();
    let declares = tauri_edges
        .iter()
        .filter(|e| e["kind"] == "declares")
        .count();

    assert_eq!(files, wanted);
    assert_eq!(files.len() as u64, baseline["files"]);
    assert_eq!(modules as u64, baseline["modules"]);
    assert_eq!(tauri_edges.len() as u64, baseline["edges"]);
    assert_eq!(implements as u64, baseline["implements"]);
    assert_eq!(declares as u64, baseline["declares"]);

    let build = document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "app/src-tauri/build.rs")
        .expect("the build script is a module");

    assert_eq!(build["entry_point"], true);
}

#[test]
fn lib_declares_each_module_file_and_imports_the_changes_names() {
    let document = scan(&repository(), None, None).ok().unwrap().document;
    let lib = format!("{TAURI}src/lib.rs");
    let declared = fs::read_to_string(repository().join(&lib)).unwrap();
    let mods: Vec<String> = declared
        .lines()
        .filter_map(|line| {
            let rest = line
                .strip_prefix("pub mod ")
                .or_else(|| line.strip_prefix("mod "))?;

            rest.strip_suffix(';')
                .map(|name| format!("{TAURI}src/{name}.rs"))
        })
        .collect();
    let mut edge_targets: Vec<String> = document["edges"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["from"] == lib.as_str() && e["kind"] == "declares")
        .map(|e| e["to"].as_str().unwrap().to_string())
        .filter(|to| to.starts_with(TAURI))
        .collect();

    edge_targets.sort();

    let mut expected = mods.clone();

    expected.sort();

    assert_eq!(mods.len(), 20);
    assert_eq!(edge_targets, expected);

    let changes = document["edges"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| {
            e["from"] == lib.as_str()
                && e["to"] == format!("{TAURI}src/changes.rs").as_str()
                && e.get("names").is_some()
        })
        .expect("a depends edge naming changes members");

    assert!(changes["names"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n == "Baseline"));

    let foreign: Vec<&str> = document["foreign"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();

    assert!(foreign.contains(&"tauri"));
    assert!(foreign.contains(&"serde"));
}

#[test]
fn this_repositorys_tauri_library_root_is_an_entry_point() {
    let document = scan(&repository(), None, None).ok().unwrap().document;
    let lib = format!("{TAURI}src/lib.rs");
    let module = document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == lib.as_str())
        .unwrap();

    assert_eq!(module["entry_point"], Value::Bool(true));
}

#[test]
fn a_tauri_edge_names_something_no_use_item_in_its_file_records() {
    let document = scan(&repository(), None, None).ok().unwrap().document;
    let mut found = 0;

    for edge in document["edges"].as_array().unwrap() {
        let from = edge["from"].as_str().unwrap();

        if !in_tauri(&edge["from"]) || edge["kind"] != "depends" || edge.get("names").is_none() {
            continue;
        }

        let source = fs::read_to_string(repository().join(from)).unwrap();
        let uses: String = source
            .lines()
            .filter(|line| line.trim_start().starts_with("use ") || line.contains("pub use "))
            .collect::<Vec<_>>()
            .join("\n");

        if edge["names"]
            .as_array()
            .unwrap()
            .iter()
            .any(|name| !uses.contains(name.as_str().unwrap()))
        {
            found += 1;
        }
    }

    assert!(found > 0);
}
