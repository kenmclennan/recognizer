mod support;

use std::collections::BTreeSet;
use std::fs;

use serde_json::Value;
use support::*;

const CONTRACT: &str = "src/contract.rs";

fn sample_scan() -> Value {
    recognizer_scan_rust::scan(
        &repository().join("fixtures/supertype-edges/rust/sample"),
        None,
        None,
    )
    .ok()
    .unwrap()
    .document
}

fn edges_between(document: &Value, from: &str, to: &str) -> Vec<Value> {
    document["edges"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["from"] == from && e["to"] == to)
        .cloned()
        .collect()
}

fn kinds(edges: &[Value]) -> Vec<&str> {
    edges.iter().map(|e| e["kind"].as_str().unwrap()).collect()
}

#[test]
fn sample_matches_expected_scan() {
    let document = sample_scan();
    let text =
        fs::read_to_string(repository().join("fixtures/supertype-edges/rust/expected-scan.json"))
            .unwrap();

    validate(&document);
    assert_eq!(document, serde_json::from_str::<Value>(&text).unwrap());
}

#[test]
fn a_supertype_only_reference_makes_only_the_supertype_edge() {
    let edges = edges_between(&sample_scan(), "src/default.rs", CONTRACT);

    assert!(!edges.is_empty());
    assert_eq!(kinds(&edges), vec!["implements"]);
}

#[test]
fn a_supertype_and_a_field_keep_both_edges() {
    let edges = edges_between(&sample_scan(), "src/logging.rs", CONTRACT);
    let mut found = kinds(&edges);

    found.sort();

    assert_eq!(found, vec!["depends", "implements"]);
}

#[test]
fn an_unused_import_keeps_its_depends_edge() {
    let edges = edges_between(&sample_scan(), "src/unused.rs", CONTRACT);

    assert_eq!(kinds(&edges), vec!["depends"]);
}

#[test]
fn the_set_of_file_pairs_is_unchanged_by_dropping_supertype_depends() {
    let document = sample_scan();
    let all = document["edges"].as_array().unwrap();
    let supertype: Vec<&Value> = all
        .iter()
        .filter(|e| e["kind"] == "implements" || e["kind"] == "inherits")
        .collect();

    assert!(supertype.len() >= 2);

    let pairs = |edges: Vec<&Value>| -> BTreeSet<(String, String)> {
        edges
            .iter()
            .map(|e| {
                (
                    e["from"].as_str().unwrap().to_string(),
                    e["to"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    };
    let present = pairs(all.iter().collect());
    let mut expected = pairs(
        all.iter()
            .filter(|e| e["kind"] != "implements" && e["kind"] != "inherits")
            .collect(),
    );

    expected.extend(pairs(supertype));

    assert_eq!(present, expected);
}
