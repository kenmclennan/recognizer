mod support;

use serde_json::json;
use support::*;

const SOURCE: &str = r#"
pub struct Pair { pub left: u32, right: Vec<
    String> }
pub struct Tuple(pub u8, String);
pub enum Mode { A, B }
pub trait Shape: Clone { fn area(&self) -> f64; fn name(&self) -> String { String::new() } fn make() -> Self; async fn later(&self); }
pub fn open(path: &str, count: u32) -> Result<(), String> { Ok(()) }
pub async fn wait() {}
pub const LIMIT: usize = 100;
static HIDDEN: &str = "hidden";
type Alias = u32;
union Raw { a: u32 }
macro_rules! shout { () => {}; }
impl Pair {
    pub fn new(left: u32) -> Pair { Pair { left, right: vec![] } }
    fn secret(&self) {}
    pub async fn fetch(&self) {}
}
impl Shape for Pair {
    fn area(&self) -> f64 { 0.0 }
    fn make() -> Self { Pair::new(0) }
    async fn later(&self) {}
}
pub(crate) fn crate_wide() {}
pub(super) fn super_wide() {}
pub(in crate::a) fn in_wide() {}
pub(self) fn self_only() {}
fn plain() {}
mod inner { pub struct Nested; }
"#;

fn document() -> serde_json::Value {
    krate(&[("src/lib.rs", SOURCE)])
}

#[test]
fn each_item_kind_becomes_its_member_kind() {
    let document = document();
    let kinds: Vec<(String, String)> = module(&document, "src/lib.rs")["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["name"].as_str().unwrap().to_string(),
                m["kind"].as_str().unwrap().to_string(),
            )
        })
        .collect();

    let expect = |name: &str, kind: &str| {
        assert!(
            kinds.contains(&(name.to_string(), kind.to_string())),
            "{name} {kind}"
        )
    };

    expect("Pair", "class");
    expect("Tuple", "class");
    expect("Mode", "class");
    expect("Shape", "interface");
    expect("open", "function");
    expect("wait", "function");
    expect("LIMIT", "constant");
    expect("HIDDEN", "constant");

    for absent in ["Alias", "Raw", "shout", "Nested", "inner"] {
        assert!(kinds.iter().all(|(name, _)| name != absent), "{absent}");
    }
}

#[test]
fn every_pub_form_is_exported_and_private_and_pub_self_are_not() {
    let document = document();

    for name in ["crate_wide", "super_wide", "in_wide", "open", "LIMIT"] {
        assert_eq!(
            member(&document, "src/lib.rs", name)["exported"],
            json!(true),
            "{name}"
        );
    }

    for name in ["self_only", "plain", "HIDDEN"] {
        assert_eq!(
            member(&document, "src/lib.rs", name)["exported"],
            json!(false),
            "{name}"
        );
    }

    assert!(member(&document, "src/lib.rs", "Pair")
        .get("visibility")
        .is_none());
}

#[test]
fn constant_values_are_cut_at_forty_characters() {
    let exact = format!("pub const A: &str = \"{}\";\n", "x".repeat(38));
    let over = format!("pub const B: &str = \"{}\";\n", "x".repeat(39));
    let document = krate(&[("src/lib.rs", &(exact + &over))]);
    let a = member(&document, "src/lib.rs", "A")["value"]
        .as_str()
        .unwrap()
        .to_string();
    let b = member(&document, "src/lib.rs", "B")["value"]
        .as_str()
        .unwrap()
        .to_string();

    assert_eq!(a.chars().count(), 40);
    assert!(!a.ends_with('…'));
    assert_eq!(b.chars().count(), 40);
    assert!(b.ends_with('…'));
}

#[test]
fn struct_fields_carry_types_lines_and_privacy() {
    let document = document();
    let pair = member(&document, "src/lib.rs", "Pair");

    assert_eq!(
        pair["fields"],
        json!([
            {"name": "left", "line": 2, "private": false, "type": "u32"},
            {"name": "right", "line": 2, "private": true, "type": "Vec< String>"},
        ])
    );
}

#[test]
fn a_tuple_struct_names_its_fields_by_position() {
    let document = document();
    let tuple = member(&document, "src/lib.rs", "Tuple");

    assert_eq!(tuple["fields"][0]["name"], json!("0"));
    assert_eq!(tuple["fields"][0]["private"], json!(false));
    assert_eq!(tuple["fields"][1]["name"], json!("1"));
    assert_eq!(tuple["fields"][1]["private"], json!(true));
}

#[test]
fn an_enum_has_methods_and_no_fields() {
    let document = document();

    assert!(member(&document, "src/lib.rs", "Mode")
        .get("fields")
        .is_none());
}

#[test]
fn a_type_spanning_two_lines_is_collapsed_to_one() {
    let document = krate(&[(
        "src/lib.rs",
        "pub fn take(\n    items: &'a Vec<\n        String>,\n) {}\n",
    )]);
    let take = member(&document, "src/lib.rs", "take");

    assert_eq!(take["params"][0]["type"], json!("&'a Vec< String>"));
}

#[test]
fn methods_come_from_every_impl_block_for_the_type() {
    let document = document();
    let methods = member(&document, "src/lib.rs", "Pair")["methods"]
        .as_array()
        .unwrap()
        .clone();
    let names: Vec<&str> = methods
        .iter()
        .map(|m| m["name"].as_str().unwrap())
        .collect();

    assert_eq!(
        names,
        vec!["new", "secret", "fetch", "area", "make", "later"]
    );
}

#[test]
fn method_privacy_tags_params_and_returns() {
    let document = document();
    let methods = member(&document, "src/lib.rs", "Pair")["methods"]
        .as_array()
        .unwrap()
        .clone();
    let by = |name: &str| methods.iter().find(|m| m["name"] == name).unwrap().clone();

    assert_eq!(by("new")["private"], json!(false));
    assert_eq!(by("new")["tags"], json!(["static"]));
    assert_eq!(
        by("new")["params"],
        json!([{"name": "left", "type": "u32"}])
    );
    assert_eq!(by("new")["returns"], json!("Pair"));
    assert_eq!(by("secret")["private"], json!(true));
    assert!(by("secret").get("tags").is_none());
    assert_eq!(by("fetch")["tags"], json!(["async"]));
    assert_eq!(by("area")["private"], json!(false));
    assert_eq!(by("make")["tags"], json!(["static"]));
    assert_eq!(by("later")["tags"], json!(["async"]));
}

#[test]
fn a_trait_lists_its_declarations_with_abstract_for_bodyless_ones() {
    let document = document();
    let shape = member(&document, "src/lib.rs", "Shape");
    let methods = shape["methods"].as_array().unwrap();
    let by = |name: &str| methods.iter().find(|m| m["name"] == name).unwrap().clone();

    assert_eq!(shape["bases"], json!(["Clone"]));
    assert_eq!(by("area")["tags"], json!(["abstract"]));
    assert!(by("name").get("tags").is_none());
    assert_eq!(by("make")["tags"], json!(["static", "abstract"]));
    assert_eq!(by("later")["tags"], json!(["abstract", "async"]));
}

#[test]
fn function_members_carry_params_returns_and_the_async_tag() {
    let document = document();
    let open = member(&document, "src/lib.rs", "open");

    assert_eq!(
        open["params"],
        json!([{"name": "path", "type": "&str"}, {"name": "count", "type": "u32"}])
    );
    assert_eq!(open["returns"], json!("Result<(), String>"));
    assert_eq!(
        member(&document, "src/lib.rs", "wait")["tags"],
        json!(["async"])
    );
}

#[test]
fn an_impl_for_a_type_in_another_file_contributes_nothing() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod b;\n"),
        ("src/a.rs", "pub struct Thing;\n"),
        (
            "src/b.rs",
            "use crate::a::Thing;\nimpl Thing { pub fn extra(&self) {} }\n",
        ),
    ]);

    assert_eq!(member(&document, "src/a.rs", "Thing")["methods"], json!([]));
    assert_eq!(module(&document, "src/b.rs")["members"], json!([]));
}

#[test]
fn a_module_is_an_interface_only_when_every_exported_member_is() {
    let document = krate(&[
        ("src/lib.rs", "mod ports;\nmod mixed;\nmod hidden;\n"),
        (
            "src/ports.rs",
            "pub trait A {}\npub trait B {}\nstruct Private;\n",
        ),
        ("src/mixed.rs", "pub trait A {}\npub struct S;\n"),
        ("src/hidden.rs", "trait A {}\n"),
    ]);

    assert_eq!(
        module(&document, "src/ports.rs")["kind"],
        json!("interface")
    );
    assert_eq!(module(&document, "src/mixed.rs")["kind"], json!("module"));
    assert_eq!(module(&document, "src/hidden.rs")["kind"], json!("module"));
    assert_eq!(module(&document, "src/ports.rs")["language"], json!("rust"));
}
