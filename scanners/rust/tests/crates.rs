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
fn a_package_can_use_its_own_library_by_name_from_a_binary_and_a_test() {
    let files = [
        ("Cargo.toml", "[package]\nname = \"my-app\"\n"),
        ("src/lib.rs", "pub struct Api;\n"),
        ("src/main.rs", "use my_app::Api;\n"),
        ("tests/it.rs", "use my_app::Api;\n"),
    ];
    let document = run(&files);

    assert_has(&document, "src/main.rs -> src/lib.rs [Api]");
    assert_has(&document, "tests/it.rs -> src/lib.rs [Api]");
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
        ("tests/it.rs", "mod common;\n"),
        ("tests/common/mod.rs", ""),
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
        ("tests/it.rs", "tests/common/mod.rs"),
        ("examples/demo.rs", "examples/extra.rs"),
        ("benches/speed.rs", "benches/data.rs"),
    ] {
        assert_has(&scanned.document, &format!("{from} -> {to}"));
    }
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
