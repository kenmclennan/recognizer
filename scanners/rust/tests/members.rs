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

#[test]
fn functions_and_methods_record_the_last_line_of_the_declaration() {
    let source = "pub fn plain(a: u32) -> u32 {\n    let b = a;\n    b\n}\n\n#[inline]\npub fn attributed() {\n    println!();\n}\n\npub fn one() {}\n\npub struct C;\n\nimpl C {\n    pub fn method(&self) {\n        println!();\n    }\n}\n";
    let document = krate(&[("src/lib.rs", source)]);
    let members = module(&document, "src/lib.rs")["members"]
        .as_array()
        .unwrap()
        .clone();
    let span = |name: &str| {
        let found = members.iter().find(|m| m["name"] == name).unwrap();

        (
            found["line"].as_u64().unwrap(),
            found["end_line"].as_u64().unwrap(),
        )
    };

    assert_eq!(span("plain"), (1, 4));
    assert_eq!(span("attributed"), (7, 9));
    assert_eq!(span("one"), (11, 11));

    let class = members.iter().find(|m| m["name"] == "C").unwrap();
    let method = &class["methods"][0];

    assert_eq!(
        (
            method["line"].as_u64().unwrap(),
            method["end_line"].as_u64().unwrap()
        ),
        (16, 18)
    );
    assert!(class.get("end_line").is_none());
}

const GATES: &str = r#"
#[cfg(test)] fn g_test() {}
#[cfg(all(test, unix))] fn g_all() {}
#[cfg(all(unix, feature = "x", test))] fn g_all_late() {}
#[cfg( test )] fn g_spaced() {}
#[cfg(all(test,))] fn g_trailing() {}
#[cfg(all(unix, any(test, all(test, x))))] fn g_nested() {}
#[cfg(any(test, test))] fn g_any_test() {}
#[cfg(any(all(test, unix), test))] fn g_any_mixed() {}
#[cfg(any(test, unix))] fn k_any() {}
#[cfg(not(test))] fn k_not() {}
#[cfg(all(not(test), unix))] fn k_all_not() {}
#[cfg(all())] fn k_all_empty() {}
#[cfg(any())] fn k_any_empty() {}
#[cfg(feature = "testing")] fn k_feature() {}
fn k_plain() {}
"#;

#[test]
fn a_cfg_that_requires_test_drops_its_item_and_the_rest_stay() {
    let document = krate(&[("src/lib.rs", GATES)]);
    let mut names: Vec<String> = module(&document, "src/lib.rs")["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap().to_string())
        .collect();

    names.sort();

    assert_eq!(
        names,
        vec![
            "k_all_empty",
            "k_all_not",
            "k_any",
            "k_any_empty",
            "k_feature",
            "k_not",
            "k_plain"
        ]
    );
}

#[test]
fn an_impl_gated_on_all_test_adds_no_methods_and_an_any_test_impl_does() {
    let document = krate(&[(
        "src/lib.rs",
        "pub struct S;\n#[cfg(all(test, unix))]\nimpl S { fn a() {} }\n#[cfg(any(test, unix))]\nimpl S { fn b() {} }\n",
    )]);
    let names: Vec<&str> = member(&document, "src/lib.rs", "S")["methods"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap())
        .collect();

    assert_eq!(names, vec!["b"]);
}
