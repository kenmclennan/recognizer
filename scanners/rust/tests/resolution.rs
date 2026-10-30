mod support;

use support::*;

#[test]
fn r1_crate_starts_at_the_crate_root() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod b;\n"),
        ("src/a.rs", "use crate::b::X;\n"),
        ("src/b.rs", "pub struct X;\n"),
    ]);

    assert_has(&document, "src/a.rs -> src/b.rs [X]");
}

#[test]
fn r1_crate_in_an_orphan_file_resolves_to_nothing() {
    let document = krate(&[
        ("src/lib.rs", "pub struct Y;\n"),
        ("src/orphan.rs", "use crate::Y;\nuse std::fmt;\n"),
    ]);

    assert_lacks(&document, "src/orphan.rs -> src/lib.rs [Y]");
    assert_has(&document, "src/orphan.rs -> foreign:std");
}

#[test]
fn r1_self_starts_at_the_current_module() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\n"),
        ("src/a.rs", "mod c;\nuse self::c::Z;\n"),
        ("src/a/c.rs", "pub struct Z;\n"),
    ]);

    assert_has(&document, "src/a.rs -> src/a/c.rs [Z]");
}

#[test]
fn r1_super_starts_at_the_parent_and_chains_upward() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\npub struct W;\n"),
        ("src/a.rs", "mod c;\npub struct Q;\n"),
        ("src/a/c.rs", "use super::Q;\nuse super::super::W;\n"),
    ]);

    assert_has(&document, "src/a/c.rs -> src/a.rs [Q]");
    assert_has(&document, "src/a/c.rs -> src/lib.rs [W]");
}

#[test]
fn r1_super_above_the_root_resolves_to_nothing() {
    let document = krate(&[("src/lib.rs", "use super::X;\nuse super::super::Y;\n")]);

    assert_eq!(edges(&document), Vec::<String>::new());
}

#[test]
fn r1_a_leading_colon_names_a_dependency() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n[dependencies]\npricing = { path = \"pricing\" }\nserde = \"1\"\n"),
        ("src/lib.rs", "use ::pricing::discount;\nuse ::serde::Serialize;\nuse ::missing::X;\n"),
        ("pricing/Cargo.toml", "[package]\nname = \"pricing\"\n"),
        ("pricing/src/lib.rs", "pub fn discount() {}\n"),
    ];
    let document = run(&files);

    assert_has(&document, "src/lib.rs -> pricing/src/lib.rs [discount]");
    assert_has(&document, "src/lib.rs -> foreign:serde");
    assert_eq!(edges(&document).len(), 2);
}

#[test]
fn r1_an_in_repo_dependency_name_starts_at_its_library_root() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nmy-pricing = { path = \"pricing\" }\n",
        ),
        ("src/lib.rs", "use my_pricing::discount;\n"),
        ("pricing/Cargo.toml", "[package]\nname = \"my-pricing\"\n"),
        ("pricing/src/lib.rs", "pub fn discount() {}\n"),
    ];

    assert_has(&run(&files), "src/lib.rs -> pricing/src/lib.rs [discount]");
}

#[test]
fn r1_a_child_module_name_starts_the_path() {
    let document = krate(&[
        (
            "src/lib.rs",
            "mod a;\nuse a::X;\nmod inline { pub struct I; }\nuse inline::I;\n",
        ),
        ("src/a.rs", "pub struct X;\n"),
    ]);

    assert_has(&document, "src/lib.rs -> src/a.rs");
    assert_has(&document, "src/lib.rs -> src/a.rs [X]");
    assert_eq!(edges(&document).len(), 2);
}

#[test]
fn r2_a_module_leaf_has_no_names_and_an_item_leaf_has_them() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod b;\n"),
        ("src/a.rs", "use crate::b;\n"),
        ("src/b.rs", "use crate::a::Thing;\n"),
    ]);

    assert_has(&document, "src/a.rs -> src/b.rs");
    assert_lacks(&document, "src/a.rs -> src/b.rs [b]");
}

#[test]
fn r2_an_unmodelled_leaf_ends_at_the_module_holding_the_declaration() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod b;\n"),
        (
            "src/a.rs",
            "use crate::b::Status::Open;\nuse crate::b::Alias;\nuse crate::b::Gone;\n",
        ),
        (
            "src/b.rs",
            "pub enum Status { Open }\npub type Alias = u32;\n",
        ),
    ]);

    assert_has(&document, "src/a.rs -> src/b.rs [Status]");
    assert_has(&document, "src/a.rs -> src/b.rs [Alias]");
    assert_has(&document, "src/a.rs -> src/b.rs");
}

#[test]
fn r3_one_hop_records_the_re_exporting_file() {
    let document = krate(&[
        (
            "src/lib.rs",
            "mod orders;\nmod a;\npub use orders::Order;\n",
        ),
        ("src/orders.rs", "pub struct Order;\n"),
        ("src/a.rs", "use crate::Order;\n"),
    ]);

    assert_has(
        &document,
        "src/a.rs -> src/orders.rs [Order] via src/lib.rs",
    );
    assert_has(&document, "src/lib.rs -> src/orders.rs [Order]");
}

#[test]
fn r3_a_private_use_is_not_a_re_export() {
    let document = krate(&[
        ("src/lib.rs", "mod orders;\nmod a;\nuse orders::Order;\n"),
        ("src/orders.rs", "pub struct Order;\n"),
        ("src/a.rs", "use crate::Order;\n"),
    ]);

    assert_has(&document, "src/a.rs -> src/lib.rs");
    assert_lacks(
        &document,
        "src/a.rs -> src/orders.rs [Order] via src/lib.rs",
    );
}

#[test]
fn r3_two_hops_list_the_files_in_order() {
    let document = krate(&[
        ("src/lib.rs", "mod mid;\nmod a;\npub use mid::Order;\n"),
        ("src/mid.rs", "mod deep;\npub use deep::Order;\n"),
        ("src/mid/deep.rs", "pub struct Order;\n"),
        ("src/a.rs", "use crate::Order;\n"),
    ]);

    assert_has(
        &document,
        "src/a.rs -> src/mid/deep.rs [Order] via src/lib.rs,src/mid.rs",
    );
}

#[test]
fn r3_a_glob_re_export_is_searched_for_the_name() {
    let document = krate(&[
        ("src/lib.rs", "mod orders;\nmod a;\npub use orders::*;\n"),
        ("src/orders.rs", "pub struct Order;\n"),
        ("src/a.rs", "use crate::Order;\nuse crate::Missing;\n"),
    ]);

    assert_has(
        &document,
        "src/a.rs -> src/orders.rs [Order] via src/lib.rs",
    );
    assert_has(&document, "src/a.rs -> src/lib.rs");
}

#[test]
fn r3_a_cycle_of_re_exports_stops() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod c;\npub use a::X;\n"),
        ("src/a.rs", "pub use crate::X;\n"),
        ("src/c.rs", "use crate::X;\n"),
    ]);

    assert!(edges(&document)
        .iter()
        .any(|e| e.starts_with("src/c.rs -> src/")));
}

fn nested_chain(length: usize) -> Vec<(String, String)> {
    let mut files = vec![
        (
            "Cargo.toml".to_string(),
            "[package]\nname = \"app\"\n".to_string(),
        ),
        (
            "src/lib.rs".to_string(),
            "mod m1;\nmod consumer;\npub use m1::T;\n".to_string(),
        ),
        ("src/consumer.rs".to_string(), "use crate::T;\n".to_string()),
    ];
    let mut directory = "src".to_string();

    for step in 1..=length {
        let body = if step == length {
            "pub struct T;\n".to_string()
        } else {
            format!("mod m{};\npub use m{}::T;\n", step + 1, step + 1)
        };

        files.push((format!("{directory}/m{step}.rs"), body));
        directory = format!("{directory}/m{step}");
    }

    files
}

fn run_owned(files: Vec<(String, String)>) -> serde_json::Value {
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();

    run(&borrowed)
}

#[test]
fn r3_sixteen_hops_still_reach_the_defining_file() {
    let document = run_owned(nested_chain(16));
    let defining = "src/m1/m2/m3/m4/m5/m6/m7/m8/m9/m10/m11/m12/m13/m14/m15/m16.rs";

    assert!(edges(&document)
        .iter()
        .any(|e| e.starts_with(&format!("src/consumer.rs -> {defining} [T] via"))));
}

#[test]
fn r3_seventeen_hops_stop_before_the_defining_file() {
    let document = run_owned(nested_chain(17));
    let defining = "src/m1/m2/m3/m4/m5/m6/m7/m8/m9/m10/m11/m12/m13/m14/m15/m16/m17.rs";
    let listed = edges(&document);

    assert!(listed
        .iter()
        .any(|e| e.starts_with("src/consumer.rs -> src/m1/")));
    assert!(!listed
        .iter()
        .any(|e| e.starts_with(&format!("src/consumer.rs -> {defining}"))));
}

#[test]
fn r4_a_glob_points_at_the_module_with_no_names() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod b;\n"),
        ("src/a.rs", "use crate::b::*;\n"),
        ("src/b.rs", "pub struct X;\n"),
    ]);

    assert_has(&document, "src/a.rs -> src/b.rs");
}

#[test]
fn r4_a_glob_back_to_the_importing_file_emits_nothing() {
    let document = krate(&[(
        "src/lib.rs",
        "pub struct A;\n#[cfg(test)]\nmod tests {\n    use super::*;\n}\n",
    )]);

    assert_eq!(edges(&document), Vec::<String>::new());
}

#[test]
fn r5_a_mod_declaration_is_an_edge_and_an_inline_module_is_not() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\nmod inline { pub struct I; }\n"),
        ("src/a.rs", ""),
    ]);

    assert_eq!(edges(&document), vec!["src/lib.rs -> src/a.rs".to_string()]);
}

#[test]
fn r5_both_layouts_and_the_path_attribute_find_their_files() {
    let document = krate(&[
        (
            "src/lib.rs",
            "mod flat;\nmod nested;\n#[path = \"elsewhere/odd.rs\"]\nmod odd;\n",
        ),
        ("src/flat.rs", "mod inner;\n"),
        ("src/flat/inner.rs", ""),
        ("src/nested/mod.rs", "mod inner;\n"),
        ("src/nested/inner.rs", ""),
        ("src/elsewhere/odd.rs", ""),
    ]);

    assert_has(&document, "src/lib.rs -> src/flat.rs");
    assert_has(&document, "src/flat.rs -> src/flat/inner.rs");
    assert_has(&document, "src/lib.rs -> src/nested/mod.rs");
    assert_has(&document, "src/nested/mod.rs -> src/nested/inner.rs");
    assert_has(&document, "src/lib.rs -> src/elsewhere/odd.rs");
}

#[test]
fn r5_a_missing_file_is_no_edge_and_is_counted() {
    let files = with_manifest(&[
        (
            "src/lib.rs",
            "mod gone;\n#[cfg(windows)]\nmod windows;\nmod here;\n",
        ),
        ("src/here.rs", ""),
    ]);
    let borrowed: Vec<(&str, &str)> = files
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    let scanned = run_scan(&borrowed);

    assert_eq!(scanned.missing_mods, 2);
    assert_eq!(
        edges(&scanned.document),
        vec!["src/lib.rs -> src/here.rs".to_string()]
    );
}

#[test]
fn r5_a_mod_inside_an_inline_module_appends_its_name_to_the_directory() {
    let document = krate(&[
        ("src/lib.rs", "mod outer {\n    pub mod deeper;\n}\n"),
        ("src/outer/deeper.rs", ""),
    ]);

    assert_has(&document, "src/lib.rs -> src/outer/deeper.rs");
}

#[test]
fn r6_std_a_foreign_dependency_and_an_unresolvable_segment() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nserde = \"1\"\n",
        ),
        (
            "src/lib.rs",
            "use std::fmt;\nuse core::mem;\nuse serde::Serialize;\nuse undeclared::Thing;\n",
        ),
    ];
    let document = run(&files);

    assert_has(&document, "src/lib.rs -> foreign:std");
    assert_has(&document, "src/lib.rs -> foreign:core");
    assert_has(&document, "src/lib.rs -> foreign:serde");
    assert_eq!(edges(&document).len(), 3);
}

#[test]
fn r6_a_workspace_inherited_dependency_resolves_as_declared() {
    let files = [
        (
            "Cargo.toml",
            "[workspace]\nmembers = [\"app\", \"shared\"]\n[workspace.dependencies]\nserde = \"1\"\nshared = { path = \"shared\" }\n",
        ),
        (
            "app/Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nserde = { workspace = true }\nshared = { workspace = true }\n",
        ),
        ("app/src/lib.rs", "use serde::Serialize;\nuse shared::Thing;\n"),
        ("shared/Cargo.toml", "[package]\nname = \"shared\"\n"),
        ("shared/src/lib.rs", "pub struct Thing;\n"),
    ];
    let document = run(&files);

    assert_has(&document, "app/src/lib.rs -> foreign:serde");
    assert_has(&document, "app/src/lib.rs -> shared/src/lib.rs [Thing]");
}

#[test]
fn r7_an_in_repo_trait_makes_an_implements_edge() {
    let document = krate(&[
        ("src/lib.rs", "mod ports;\nmod store;\n"),
        ("src/ports.rs", "pub trait Store { fn save(&self); }\n"),
        (
            "src/store.rs",
            "use crate::ports::Store;\npub struct Mem;\nimpl Store for Mem { fn save(&self) {} }\n",
        ),
    ]);

    assert_has(&document, "src/store.rs => src/ports.rs Mem.Store");
}

#[test]
fn r7_a_trait_reached_by_a_path_or_a_glob_also_resolves() {
    let document = krate(&[
        ("src/lib.rs", "mod ports;\nmod a;\nmod b;\n"),
        ("src/ports.rs", "pub trait Store {}\n"),
        (
            "src/a.rs",
            "pub struct A;\nimpl crate::ports::Store for A {}\n",
        ),
        (
            "src/b.rs",
            "use crate::ports::*;\npub struct B;\nimpl Store for B {}\n",
        ),
    ]);

    assert_has(&document, "src/a.rs => src/ports.rs A.Store");
    assert_has(&document, "src/b.rs => src/ports.rs B.Store");
}

#[test]
fn r7_a_foreign_trait_and_a_same_file_trait_make_no_edge() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n[dependencies]\nserde = \"1\"\n"),
        (
            "src/lib.rs",
            "use serde::Serialize;\nuse std::fmt::Display;\npub struct A;\nimpl Serialize for A {}\nimpl Display for A {}\npub trait Local {}\nimpl Local for A {}\n",
        ),
    ];
    let document = run(&files);

    assert!(edges(&document).iter().all(|e| !e.contains("=>")));
}

#[test]
fn r7_supertraits_are_bases_and_not_edges() {
    let document = krate(&[
        ("src/lib.rs", "mod base;\nmod derived;\n"),
        ("src/base.rs", "pub trait Base {}\n"),
        (
            "src/derived.rs",
            "use crate::base::Base;\npub trait Derived: Base + Send {}\n",
        ),
    ]);
    let derived = member(&document, "src/derived.rs", "Derived");

    assert_eq!(derived["bases"], serde_json::json!(["Base", "Send"]));
    assert!(edges(&document).iter().all(|e| !e.contains("=>")));
    assert!(edges(&document).iter().all(|e| !e.contains("inherits")));
}

#[test]
fn a_use_tree_resolves_each_leaf_on_its_own() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nserde = \"1\"\n",
        ),
        (
            "src/lib.rs",
            "mod a;\nuse a::{Thing, Other as O};\nuse serde::Serialize;\nuse nowhere::{X, Y};\n",
        ),
        ("src/a.rs", "pub struct Thing;\npub struct Other;\n"),
    ];
    let scanned = run_scan(&files);

    assert_has(&scanned.document, "src/lib.rs -> src/a.rs [Thing,Other]");
    assert_has(&scanned.document, "src/lib.rs -> foreign:serde");
    assert_eq!(scanned.missing_mods, 0);
    assert_eq!(edges(&scanned.document).len(), 3);
}

#[test]
fn one_use_tree_with_an_in_repo_a_foreign_and_an_unresolved_leaf() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nserde = \"1\"\n",
        ),
        ("src/lib.rs", "mod a;\nmod user;\n"),
        ("src/a.rs", "pub struct Thing;\n"),
        (
            "src/user.rs",
            "use {crate::a::Thing, serde::Serialize, lost::Gone};\n",
        ),
    ];
    let scanned = run_scan(&files);
    let from_user: Vec<String> = edges(&scanned.document)
        .into_iter()
        .filter(|e| e.starts_with("src/user.rs"))
        .collect();

    assert_eq!(
        from_user,
        vec![
            "src/user.rs -> foreign:serde".to_string(),
            "src/user.rs -> src/a.rs [Thing]".to_string()
        ]
    );
    assert_eq!(scanned.missing_mods, 0);
}
