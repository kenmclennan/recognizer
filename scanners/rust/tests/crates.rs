mod support;

use support::*;

#[test]
fn a_path_dependency_to_a_present_package_is_in_repo() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nlocal = { path = \"local\" }\n",
        ),
        ("src/lib.rs", "use local::Thing;\n"),
        ("local/Cargo.toml", "[package]\nname = \"local\"\n"),
        ("local/src/lib.rs", "pub struct Thing;\n"),
    ];

    assert_has(&run(&files), "src/lib.rs -> local/src/lib.rs [Thing]");
}

#[test]
fn a_path_dependency_without_a_scanned_manifest_is_foreign() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n[dependencies]\nlocal = { path = \"../elsewhere\" }\nmissing = { path = \"nothing-here\" }\n"),
        ("src/lib.rs", "use local::Thing;\nuse missing::Other;\n"),
    ];
    let document = run(&files);

    assert_has(&document, "src/lib.rs -> foreign:local");
    assert_has(&document, "src/lib.rs -> foreign:missing");
}

#[test]
fn hyphens_become_underscores_in_package_and_dependency_names() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"my-app\"\n[dependencies]\nfancy-lib = \"1\"\nown-pricing = { path = \"pricing\" }\n",
        ),
        ("src/lib.rs", "use fancy_lib::A;\nuse own_pricing::B;\n"),
        ("pricing/Cargo.toml", "[package]\nname = \"own-pricing\"\n"),
        ("pricing/src/lib.rs", "pub struct B;\n"),
    ];
    let document = run(&files);

    assert_has(&document, "src/lib.rs -> foreign:fancy_lib");
    assert_has(&document, "src/lib.rs -> pricing/src/lib.rs [B]");
}

#[test]
fn a_package_can_use_its_own_library_by_name_from_a_binary_and_an_example() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"my-app\"\n"),
        ("src/lib.rs", "pub struct Api;\n"),
        ("src/main.rs", "use my_app::Api;\n"),
        ("examples/demo.rs", "use my_app::Api;\n"),
    ];
    let document = run(&files);

    assert_has(&document, "src/main.rs -> src/lib.rs [Api]");
    assert_has(&document, "examples/demo.rs -> src/lib.rs [Api]");
}

#[test]
fn a_library_name_override_is_the_use_name() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[lib]\nname = \"app_core\"\npath = \"src/core.rs\"\n",
        ),
        ("src/core.rs", "pub struct Api;\n"),
        ("src/main.rs", "use app_core::Api;\n"),
    ];

    assert_has(&run(&files), "src/main.rs -> src/core.rs [Api]");
}

#[test]
fn every_target_root_starts_a_module_tree() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n"),
        ("src/lib.rs", "mod from_lib;\n"),
        ("src/from_lib.rs", ""),
        ("src/main.rs", "mod from_main;\n"),
        ("src/from_main.rs", ""),
        ("src/bin/tool.rs", "mod helper;\n"),
        ("src/bin/helper.rs", ""),
        ("src/bin/multi/main.rs", "mod part;\n"),
        ("src/bin/multi/part.rs", ""),
        ("build.rs", "mod gen;\n"),
        ("gen.rs", ""),
        ("examples/demo.rs", "mod extra;\n"),
        ("examples/extra.rs", ""),
        ("benches/speed.rs", "mod data;\n"),
        ("benches/data.rs", ""),
    ];
    let scanned = run_scan(&files);

    assert_eq!(scanned.missing_mods, 0);

    for (from, to) in [
        ("src/lib.rs", "src/from_lib.rs"),
        ("src/main.rs", "src/from_main.rs"),
        ("src/bin/tool.rs", "src/bin/helper.rs"),
        ("src/bin/multi/main.rs", "src/bin/multi/part.rs"),
        ("build.rs", "gen.rs"),
        ("examples/demo.rs", "examples/extra.rs"),
        ("benches/speed.rs", "benches/data.rs"),
    ] {
        assert_has(&scanned.document, &format!("{from} ~> {to}"));
    }
}

#[test]
fn integration_test_files_are_not_scanned() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"my-app\"\n"),
        ("src/lib.rs", "pub struct Api;\n"),
        ("tests/it.rs", "use my_app::Api;\n"),
        ("tests/common/mod.rs", ""),
    ];
    let document = run(&files);

    let ids: Vec<&str> = document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();

    assert_eq!(ids, ["src/lib.rs"]);
}

#[test]
fn a_file_reachable_from_two_roots_resolves_crate_through_the_first() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n"),
        ("src/lib.rs", "mod shared;\npub struct Lib;\n"),
        ("src/main.rs", "mod shared;\npub struct Bin;\n"),
        ("src/shared.rs", "use crate::Lib;\n"),
    ];

    assert_has(&run(&files), "src/shared.rs -> src/lib.rs [Lib]");
}

fn listed(document: &serde_json::Value) -> Vec<String> {
    document["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["path"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn every_manifest_read_is_listed_with_the_hash_of_its_bytes() {
    use sha2::{Digest, Sha256};

    let manifest = "[package]\nname = \"app\"\n";
    let files = [
        ("Cargo.toml", manifest),
        ("src/lib.rs", "pub struct A;\n"),
        ("node_modules/x/Cargo.toml", "[package]\nname = \"x\"\n"),
    ];
    let document = run(&files);
    let expected: String = Sha256::digest(manifest.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let entry = document["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "Cargo.toml")
        .unwrap();

    assert_eq!(listed(&document), ["Cargo.toml", "src/lib.rs"]);
    assert_eq!(entry["hash"].as_str().unwrap(), expected);
}

#[test]
fn an_unparseable_manifest_is_listed_and_a_missing_path_dependency_is_not() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\ngone = { path = \"gone\" }\n",
        ),
        ("src/lib.rs", "pub struct A;\n"),
        ("broken/Cargo.toml", "[package\nname ="),
        ("broken/src/lib.rs", "pub struct B;\n"),
    ];
    let document = run(&files);
    let paths = listed(&document);

    assert!(paths.contains(&"broken/Cargo.toml".to_string()));
    assert!(paths.contains(&"Cargo.toml".to_string()));
    assert!(!paths.iter().any(|path| path.starts_with("gone")));

    let mut sorted = paths.clone();

    sorted.sort();
    sorted.dedup();

    assert_eq!(paths, sorted);
}

#[test]
fn a_mod_declaration_is_a_declares_edge_with_no_names_and_a_use_beside_it_stays_depends() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n"),
        ("src/lib.rs", "mod x;\nuse self::x::Thing;\n"),
        ("src/x.rs", "pub struct Thing;\n"),
    ];
    let document = run(&files);
    let all = document["edges"].as_array().unwrap();
    let declares: Vec<&serde_json::Value> =
        all.iter().filter(|e| e["kind"] == "declares").collect();

    assert_eq!(declares.len(), 1);
    assert_eq!(declares[0]["from"], "src/lib.rs");
    assert_eq!(declares[0]["to"], "src/x.rs");
    assert_eq!(declares[0]["line"], 1);

    for key in ["names", "via", "member", "to_member"] {
        assert!(declares[0].get(key).is_none(), "declares carries {key}");
    }

    assert_has(&document, "src/lib.rs ~> src/x.rs");
    assert_has(&document, "src/lib.rs -> src/x.rs [Thing]");
}

#[test]
fn only_the_declaration_naming_a_scanned_file_gets_a_declares_edge_and_the_other_is_counted() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"app\"\n"),
        ("src/lib.rs", "mod present;\nmod absent;\n"),
        ("src/present.rs", ""),
    ];
    let scanned = run_scan(&files);
    let declares: Vec<&serde_json::Value> = scanned.document["edges"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "declares")
        .collect();

    assert_eq!(declares.len(), 1);
    assert_eq!(declares[0]["to"], "src/present.rs");
    assert_eq!(scanned.missing_mods, 1);
}
