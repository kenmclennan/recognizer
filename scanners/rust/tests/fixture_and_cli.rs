mod support;

use std::fs;

use recognizer_scan_rust::{render, scan};
use support::*;

fn fixture_scan() -> serde_json::Value {
    scan(&repository().join("fixtures/rust/sample"), None, None)
        .ok()
        .unwrap()
        .document
}

#[test]
fn the_fixture_scan_equals_the_expected_scan_and_validates() {
    let document = fixture_scan();
    let text = fs::read_to_string(repository().join("fixtures/rust/expected-scan.json")).unwrap();

    validate(&document);
    assert_eq!(
        document,
        serde_json::from_str::<serde_json::Value>(&text).unwrap()
    );
    assert!(render(&document).ends_with("}\n"));
}

#[test]
fn the_fixture_holds_every_relationship_the_design_lists() {
    let document = fixture_scan();
    let lib = "shop/src/lib.rs";
    let ports = "shop/src/ports/mod.rs";
    let orders = "shop/src/orders.rs";

    assert_has(&document, &format!("{lib} -> {orders}"));
    assert_has(&document, &format!("{lib} -> {ports}"));
    assert_has(&document, &format!("{lib} -> shop/src/adapters.rs"));
    assert_has(&document, &format!("{ports} -> shop/src/ports/memory.rs"));
    assert_has(
        &document,
        "shop/src/adapters.rs -> shop/src/adapters/sql.rs",
    );
    assert_has(
        &document,
        &format!("{orders} -> pricing/src/lib.rs [discount]"),
    );
    assert_has(&document, &format!("{orders} -> foreign:serde"));
    assert_has(&document, &format!("{orders} -> {ports} [Store]"));
    assert_has(&document, &format!("{lib} -> {orders} [Order]"));
    assert_has(
        &document,
        &format!("shop/src/ports/memory.rs -> {ports} [Store]"),
    );
    assert_has(
        &document,
        &format!("shop/src/ports/memory.rs -> {orders} [Order] via {lib}"),
    );
    assert_has(
        &document,
        &format!("shop/src/adapters/sql.rs -> {ports} [Store]"),
    );
    assert_has(&document, "shop/src/adapters/sql.rs -> foreign:std");
    assert_has(
        &document,
        &format!("shop/src/ports/memory.rs => {ports} MemoryStore.Store"),
    );
    assert_has(
        &document,
        &format!("shop/src/adapters/sql.rs => {ports} SqlStore.Store"),
    );
}

#[test]
fn the_fixture_has_no_edge_it_should_not() {
    let document = fixture_scan();
    let listed = edges(&document);

    assert!(listed.iter().all(|e| !e.starts_with("pricing/src/lib.rs")));
    assert!(listed
        .iter()
        .all(|e| e != "shop/src/adapters/sql.rs -> shop/src/adapters/sql.rs"));
    assert!(listed
        .iter()
        .all(|e| !(e.contains("serde") && e.contains("=>"))));
}

#[test]
fn the_fixture_members_cover_each_kind_and_both_visibilities() {
    let document = fixture_scan();
    let exported = |module: &str, name: &str| {
        member(&document, module, name)["exported"]
            .as_bool()
            .unwrap()
    };

    assert_eq!(
        member(&document, "shop/src/orders.rs", "Order")["kind"],
        "class"
    );
    assert_eq!(
        member(&document, "shop/src/orders.rs", "Status")["kind"],
        "class"
    );
    assert_eq!(
        member(&document, "shop/src/ports/mod.rs", "Store")["kind"],
        "interface"
    );
    assert_eq!(
        member(&document, "shop/src/lib.rs", "open")["kind"],
        "function"
    );
    assert_eq!(
        member(&document, "pricing/src/lib.rs", "RATE")["kind"],
        "constant"
    );
    assert!(exported("shop/src/lib.rs", "MAX_LINES"));
    assert!(exported("pricing/src/lib.rs", "RATE"));
    assert!(!exported("pricing/src/lib.rs", "round"));
    assert!(!exported("shop/src/lib.rs", "REGISTRY"));
    assert_eq!(
        module(&document, "shop/src/ports/mod.rs")["kind"],
        "interface"
    );

    let methods = member(&document, "shop/src/orders.rs", "Order")["methods"]
        .as_array()
        .unwrap()
        .clone();

    assert_eq!(methods[0]["name"], "new");
    assert_eq!(methods[0]["tags"], serde_json::json!(["static"]));
    assert_eq!(methods[1]["name"], "subtotal");
    assert_eq!(methods[1]["private"], true);
}
