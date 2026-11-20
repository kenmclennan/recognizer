mod support;

use serde_json::Value;
use support::*;

#[test]
fn the_scanner_drops_exactly_the_shared_table_rows_that_require_test() {
    let text =
        std::fs::read_to_string(repository().join("fixtures/rust-test-gate/cases.json")).unwrap();
    let cases: Vec<Value> = serde_json::from_str(&text).unwrap();

    assert!(cases.len() > 20);

    let mut source = String::new();
    let mut want: Vec<String> = Vec::new();

    for (n, case) in cases.iter().enumerate() {
        source.push_str(&format!(
            "{}\nfn c{n}() {{}}\n",
            case["attribute"].as_str().unwrap()
        ));

        if !case["test"].as_bool().unwrap() {
            want.push(format!("c{n}"));
        }
    }

    let document = krate(&[("src/lib.rs", source.as_str())]);
    let mut found: Vec<String> = module(&document, "src/lib.rs")["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap().to_string())
        .collect();

    found.sort();
    want.sort();

    assert_eq!(found, want);
}
