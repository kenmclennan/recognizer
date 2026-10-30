mod support;

use std::process::Command;

use support::*;

#[test]
fn a_path_expression_with_no_use_gives_no_edge() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nserde = \"1\"\n",
        ),
        (
            "src/lib.rs",
            "mod a;\npub fn run() { crate::a::go(); serde::ser::noop(); }\n",
        ),
        ("src/a.rs", "pub fn go() {}\n"),
    ];
    let document = run(&files);

    assert_eq!(edges(&document), vec!["src/lib.rs -> src/a.rs".to_string()]);
}

#[test]
fn a_cfg_gated_mod_is_read_as_written() {
    let document = krate(&[
        ("src/lib.rs", "#[cfg(feature = \"never\")]\nmod gated;\n"),
        ("src/gated.rs", "pub struct G;\n"),
    ]);

    assert_has(&document, "src/lib.rs -> src/gated.rs");
}

#[test]
fn macro_bodies_are_not_read() {
    let document = krate(&[
        (
            "src/lib.rs",
            "mod a;\nmacro_rules! m { () => { use crate::a::X; } }\n",
        ),
        ("src/a.rs", ""),
    ]);

    assert_eq!(edges(&document), vec!["src/lib.rs -> src/a.rs".to_string()]);
}

#[test]
fn use_items_inside_function_bodies_are_not_read() {
    let document = krate(&[
        ("src/lib.rs", "mod a;\npub fn f() { use crate::a::X; }\n"),
        ("src/a.rs", "pub struct X;\n"),
    ]);

    assert_eq!(edges(&document), vec!["src/lib.rs -> src/a.rs".to_string()]);
}

#[test]
fn an_orphan_file_resolves_foreign_uses_but_not_crate_paths() {
    let files = [
        (
            "Cargo.toml",
            "[package]\nname = \"app\"\n[dependencies]\nserde = \"1\"\n",
        ),
        ("src/lib.rs", "pub struct Y;\n"),
        (
            "src/orphan.rs",
            "use crate::Y;\nuse serde::Serialize;\nuse std::fmt;\n",
        ),
    ];
    let document = run(&files);

    assert_has(&document, "src/orphan.rs -> foreign:serde");
    assert_has(&document, "src/orphan.rs -> foreign:std");
    assert_lacks(&document, "src/orphan.rs -> src/lib.rs [Y]");
}

#[test]
fn an_orphan_file_outside_any_package_still_resolves_std() {
    let document = run(&[("loose.rs", "use std::fmt;\nuse serde::X;\n")]);

    assert_eq!(
        edges(&document),
        vec!["loose.rs -> foreign:std".to_string()]
    );
}

#[test]
fn a_file_with_no_members_is_still_a_module_and_a_file() {
    let document = run(&[("empty.rs", "")]);

    assert_eq!(document["files"].as_array().unwrap().len(), 1);
    assert_eq!(
        module(&document, "empty.rs")["members"],
        serde_json::json!([])
    );
}

fn binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
}

#[test]
fn a_parse_failure_exits_two_and_lists_the_file() {
    let directory = tempfile::tempdir().unwrap();

    write_tree(
        directory.path(),
        &[("good.rs", "fn ok() {}\n"), ("bad.rs", "fn ( {\n")],
    );

    let output = binary().arg(directory.path()).output().unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(output.status.code(), Some(2));
    assert!(stderr.starts_with("could not parse:"), "{stderr}");
    assert!(stderr.contains("bad.rs: "), "{stderr}");
    assert!(!stderr.contains("good.rs"), "{stderr}");
}

#[test]
fn a_root_that_is_not_a_directory_exits_two() {
    let output = binary().arg("/nonexistent/path/for/scan").output().unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("ROOT is not a directory"));
}

#[test]
fn the_missing_mod_diagnostic_prints_only_when_a_mod_has_no_file() {
    let directory = tempfile::tempdir().unwrap();

    write_tree(
        directory.path(),
        &[
            ("Cargo.toml", "[package]\nname = \"a\"\n"),
            ("src/lib.rs", "mod gone;\n"),
        ],
    );

    let output = binary().arg(directory.path()).output().unwrap();

    assert!(String::from_utf8_lossy(&output.stderr)
        .contains("recognizer-scan-rust: 1 mod declarations had no file"));

    write_tree(directory.path(), &[("src/lib.rs", "")]);

    let quiet = binary().arg(directory.path()).output().unwrap();

    assert_eq!(String::from_utf8_lossy(&quiet.stderr), "");
}

#[test]
fn commit_modified_and_output_are_honoured() {
    let directory = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("scan.json");

    write_tree(directory.path(), &[("a.rs", "fn a() {}\n")]);

    let status = binary()
        .arg(directory.path())
        .args(["--commit", "abc123", "--modified", "true", "--output"])
        .arg(&target)
        .status()
        .unwrap();
    let document: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();

    assert!(status.success());
    assert_eq!(document["commit"], "abc123");
    assert_eq!(document["modified"], true);
    assert_eq!(document["scanner"]["name"], "recognizer-scan-rust");
    validate(&document);
}

#[test]
fn a_modified_value_other_than_true_or_false_is_refused() {
    let output = binary()
        .args(["/tmp", "--modified", "maybe"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
}
