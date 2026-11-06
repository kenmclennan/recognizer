mod support;

use std::fs;

use serde_json::Value;
use support::*;

fn marked(document: &Value) -> Vec<String> {
    let mut found: Vec<String> = document["modules"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m.get("entry_point") == Some(&Value::Bool(true)))
        .map(|m| m["id"].as_str().unwrap().to_string())
        .collect();

    found.sort();

    found
}

fn is_marked(document: &Value, id: &str) -> bool {
    marked(document).iter().any(|m| m == id)
}

fn assert_entry(manifest_extra: &str, files: &[(&str, &str)], entry: &str) {
    let manifest = format!("[package]\nname = \"app\"\n{manifest_extra}");
    let mut all = vec![
        ("Cargo.toml", manifest.as_str()),
        ("src/lib.rs", "mod plain;\n"),
        ("src/plain.rs", "pub struct P;\n"),
    ];

    all.extend_from_slice(files);

    let document = run(&all);

    assert!(
        is_marked(&document, entry),
        "{entry} in {:?}",
        marked(&document)
    );
    assert!(!is_marked(&document, "src/plain.rs"));
    assert!(!is_marked(&document, "src/lib.rs"));
}

#[test]
fn build_rs_is_marked() {
    assert_entry("", &[("build.rs", "fn main() {}\n")], "build.rs");
}

#[test]
fn a_declared_build_path_is_marked_and_build_rs_is_not() {
    let document = run(&[
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\nbuild = \"tools/gen.rs\"\n",
        ),
        ("tools/gen.rs", "fn main() {}\n"),
        ("build.rs", "fn main() {}\n"),
    ]);

    assert_eq!(marked(&document), vec!["tools/gen.rs"]);
}

#[test]
fn build_false_marks_no_build_root() {
    let document = run(&[
        ("Cargo.toml", "[package]\nname = \"app\"\nbuild = false\n"),
        ("build.rs", "fn main() {}\n"),
    ]);

    assert!(marked(&document).is_empty());
}

#[test]
fn main_rs_is_marked() {
    assert_entry("", &[("src/main.rs", "fn main() {}\n")], "src/main.rs");
}

#[test]
fn a_file_in_src_bin_is_marked() {
    assert_entry("", &[("src/bin/a.rs", "fn main() {}\n")], "src/bin/a.rs");
}

#[test]
fn a_main_in_a_src_bin_folder_is_marked() {
    assert_entry(
        "",
        &[("src/bin/b/main.rs", "fn main() {}\n")],
        "src/bin/b/main.rs",
    );
}

#[test]
fn an_example_file_is_marked() {
    assert_entry("", &[("examples/e.rs", "fn main() {}\n")], "examples/e.rs");
}

#[test]
fn an_example_folder_main_is_marked() {
    assert_entry(
        "",
        &[("examples/f/main.rs", "fn main() {}\n")],
        "examples/f/main.rs",
    );
}

#[test]
fn a_bench_file_is_marked() {
    assert_entry("", &[("benches/b.rs", "fn main() {}\n")], "benches/b.rs");
}

#[test]
fn a_bench_folder_main_is_marked() {
    assert_entry(
        "",
        &[("benches/c/main.rs", "fn main() {}\n")],
        "benches/c/main.rs",
    );
}

#[test]
fn a_bin_table_path_is_marked() {
    assert_entry(
        "[[bin]]\nname = \"x\"\npath = \"tools/x.rs\"\n",
        &[("tools/x.rs", "fn main() {}\n")],
        "tools/x.rs",
    );
}

#[test]
fn an_example_table_path_is_marked() {
    assert_entry(
        "[[example]]\nname = \"x\"\npath = \"tools/x.rs\"\n",
        &[("tools/x.rs", "fn main() {}\n")],
        "tools/x.rs",
    );
}

#[test]
fn a_bench_table_path_is_marked() {
    assert_entry(
        "[[bench]]\nname = \"x\"\npath = \"tools/x.rs\"\n",
        &[("tools/x.rs", "fn main() {}\n")],
        "tools/x.rs",
    );
}

#[test]
fn a_test_table_path_is_marked() {
    assert_entry(
        "[[test]]\nname = \"x\"\npath = \"tools/x.rs\"\n",
        &[("tools/x.rs", "fn main() {}\n")],
        "tools/x.rs",
    );
}

#[test]
fn a_lib_path_file_is_not_marked() {
    let document = run(&[
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[lib]\npath = \"core/root.rs\"\n",
        ),
        ("core/root.rs", "pub struct A;\n"),
    ]);

    assert!(marked(&document).is_empty());
}

#[test]
fn an_example_path_naming_no_file_is_ignored_and_a_present_one_is_marked() {
    let document = run(&[
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[[example]]\nname = \"a\"\npath = \"tools/a.rs\"\n[[example]]\nname = \"b\"\npath = \"tools/missing.rs\"\n",
        ),
        ("tools/a.rs", "fn main() {}\n"),
    ]);

    assert_eq!(marked(&document), vec!["tools/a.rs"]);
}

#[test]
fn a_cfg_test_mod_marks_its_file() {
    let document = krate(&[
        ("src/lib.rs", "#[cfg(test)]\nmod tests;\nmod plain;\n"),
        ("src/tests.rs", ""),
        ("src/plain.rs", ""),
    ]);

    assert_eq!(marked(&document), vec!["src/tests.rs"]);
}

#[test]
fn a_cfg_test_mod_in_a_mod_rs_marks_the_sibling_file() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\n"),
        ("src/a/mod.rs", "#[cfg(test)]\nmod tests;\n"),
        ("src/a/tests.rs", ""),
    ]);

    assert_eq!(marked(&document), vec!["src/a/tests.rs"]);
}

#[test]
fn a_cfg_test_mod_with_a_path_attribute_marks_that_file() {
    let document = krate(&[
        (
            "src/lib.rs",
            "#[cfg(test)]\n#[path = \"t.rs\"]\nmod tests;\n",
        ),
        ("src/t.rs", ""),
    ]);

    assert_eq!(marked(&document), vec!["src/t.rs"]);
}

#[test]
fn a_test_modules_own_children_are_marked() {
    let document = krate(&[
        ("src/lib.rs", "#[cfg(test)]\nmod checks;\n"),
        ("src/checks.rs", "mod helper;\n"),
        ("src/checks/helper.rs", ""),
    ]);

    assert_eq!(
        marked(&document),
        vec!["src/checks.rs", "src/checks/helper.rs"]
    );
}

#[test]
fn a_plain_mod_is_not_marked() {
    let document = krate(&[("src/lib.rs", "mod x;\n"), ("src/x.rs", "")]);

    assert!(marked(&document).is_empty());
}

#[test]
fn a_cfg_test_mod_without_a_file_adds_nothing_and_is_not_counted_missing() {
    let scanned = run_scan(&with_manifest_borrowed(&[(
        "src/lib.rs",
        "#[cfg(test)]\nmod gone;\n",
    )]));

    assert!(marked(&scanned.document).is_empty());
    assert_eq!(scanned.missing_mods, 0);
}

#[test]
fn a_cfg_test_mod_adds_no_edge() {
    let document = krate(&[
        ("src/lib.rs", "#[cfg(test)]\nmod tests;\n"),
        ("src/tests.rs", ""),
    ]);

    assert!(edges(&document).is_empty(), "{:?}", edges(&document));
}

#[test]
fn only_the_present_cfg_test_mod_is_marked() {
    let document = krate(&[
        (
            "src/lib.rs",
            "#[cfg(test)]\nmod present;\n#[cfg(test)]\nmod absent;\n",
        ),
        ("src/present.rs", ""),
    ]);

    assert_eq!(marked(&document), vec!["src/present.rs"]);
}

fn with_manifest_borrowed(
    files: &[(&'static str, &'static str)],
) -> Vec<(&'static str, &'static str)> {
    let mut all = vec![(
        "Cargo.toml",
        "[package]\nname = \"app\"\nversion = \"0.1.0\"\n",
    )];

    all.extend_from_slice(files);

    all
}

#[test]
fn the_labelled_fixture_marks_exactly_the_expected_files() {
    let directory = repository().join("fixtures/rust/entry-points");
    let expected: Vec<String> =
        serde_json::from_str(&fs::read_to_string(directory.join("expected.json")).unwrap())
            .unwrap();
    let scanned = recognizer_scan_rust::scan(&directory, None, None)
        .ok()
        .expect("the fixture scans");

    validate(&scanned.document);

    assert_eq!(marked(&scanned.document), expected);
}
