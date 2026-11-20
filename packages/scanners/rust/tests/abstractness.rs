mod support;

use std::fs;

use support::*;

fn sample_scan() -> serde_json::Value {
    recognizer_scan_rust::scan(
        &repository().join("fixtures/abstractness/rust/sample"),
        None,
        None,
    )
    .ok()
    .unwrap()
    .document
}

fn member_kinds(document: &serde_json::Value) -> Vec<(String, String)> {
    document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|m| m["members"].as_array().unwrap().clone())
        .map(|m| {
            (
                m["name"].as_str().unwrap().to_string(),
                m["kind"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn the_sample_scan_equals_the_expected_scan_and_validates() {
    let document = sample_scan();
    let text =
        fs::read_to_string(repository().join("fixtures/abstractness/rust/expected-scan.json"))
            .unwrap();

    validate(&document);
    assert_eq!(
        document,
        serde_json::from_str::<serde_json::Value>(&text).unwrap()
    );
}

#[test]
fn traits_are_interfaces_and_type_aliases_are_not_members() {
    let kinds = member_kinds(&sample_scan());

    assert!(kinds.contains(&("Store".into(), "interface".into())));
    assert!(kinds.contains(&("Named".into(), "interface".into())));
    assert!(kinds
        .iter()
        .all(|(name, _)| name != "Id" && name != "Handler"));
}
