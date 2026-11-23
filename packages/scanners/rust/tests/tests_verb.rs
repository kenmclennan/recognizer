mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use std::process::Command;

use recognizer_scan_rust::test_report::{is_test_attribute, manifest_roots, Roots};
use serde_json::Value;
use sha2::{Digest, Sha256};
use support::repository;
use tempfile::TempDir;

type Entries = BTreeMap<String, String>;

fn git(root: &Path, arguments: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .status()
        .unwrap();

    assert!(status.success());
}

fn write_files(root: &Path, files: &[(&str, &str)]) {
    for (name, text) in files {
        let target = root.join(name);

        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, text).unwrap();
    }
}

fn repository_of(files: &[(&str, &str)]) -> TempDir {
    let dir = TempDir::new().unwrap();

    git(dir.path(), &["init", "-q"]);
    write_files(dir.path(), files);

    dir
}

fn copy_directory(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();

    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());

        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn fixture_copy() -> TempDir {
    let dir = TempDir::new().unwrap();

    copy_directory(
        &repository().join("fixtures/sensors/tests-digest/rust-in-file"),
        dir.path(),
    );
    git(dir.path(), &["init", "-q"]);

    dir
}

fn entries_at(root: &Path) -> Entries {
    let output = Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
        .arg("tests")
        .arg(root)
        .output()
        .unwrap();

    assert!(output.status.success(), "{:?}", output);

    let document: Value = serde_json::from_slice(&output.stdout).unwrap();

    document["entries"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_string()))
        .collect()
}

fn expected_entries() -> Entries {
    let text = fs::read_to_string(repository().join("fixtures/sensors/tests-digest/expected.json"))
        .unwrap();
    let document: Value = serde_json::from_str(&text).unwrap();

    document["entries"]
        .as_object()
        .unwrap()
        .iter()
        .filter(|(key, _)| key.contains('#'))
        .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_string()))
        .collect()
}

fn keys_of(files: &[(&str, &str)]) -> Vec<String> {
    entries_at(repository_of(files).path())
        .keys()
        .cloned()
        .collect()
}

fn edit(root: &Path, path: &str, from: &str, to: &str) {
    let text = fs::read_to_string(root.join(path)).unwrap();

    assert!(text.contains(from), "{path} lacks {from}");

    fs::write(root.join(path), text.replacen(from, to, 1)).unwrap();
}

fn sha256_hex(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

#[test]
fn gives_the_shared_in_file_entries() {
    let root = fixture_copy();

    assert_eq!(entries_at(root.path()), expected_entries());
}

#[test]
fn leaves_the_entries_when_production_code_in_a_file_with_tests_changes() {
    let root = fixture_copy();

    edit(root.path(), "src/lib.rs", "a + b", "b + a");

    assert_eq!(entries_at(root.path()), expected_entries());
}

#[test]
fn leaves_the_entries_when_production_code_in_a_declaring_file_changes() {
    let root = fixture_copy();

    edit(root.path(), "src/more.rs", "x * 2", "x * 3");

    assert_eq!(entries_at(root.path()), expected_entries());
}

fn changes_and_restores(path: &str, from: &str, to: &str) {
    let root = fixture_copy();

    edit(root.path(), path, from, to);

    assert_ne!(entries_at(root.path()), expected_entries());

    edit(root.path(), path, to, from);

    assert_eq!(entries_at(root.path()), expected_entries());
}

#[test]
fn changes_the_entries_when_a_test_body_changes() {
    changes_and_restores(
        "src/lib.rs",
        "assert_eq!(add(1, 2), 3)",
        "assert_eq!(add(1, 2), 4)",
    );
}

#[test]
fn changes_the_entries_when_a_declared_test_module_file_changes() {
    changes_and_restores("src/more/helper_tests.rs", ", 4)", ", 5)");
}

#[test]
fn changes_the_entries_when_an_inner_test_attribute_file_changes() {
    changes_and_restores("src/inner.rs", "    7\n", "    9\n");
}

#[test]
fn changes_the_entries_when_a_space_inside_a_test_item_changes() {
    changes_and_restores("src/lib.rs", "fn adds()", "fn  adds()");
}

#[test]
fn changes_the_entries_when_two_test_items_swap() {
    let root = fixture_copy();
    let text = fs::read_to_string(root.path().join("src/lib.rs")).unwrap();
    let split = text.find("#[cfg(all(test, unix))]").unwrap();
    let modules = text.find("#[cfg(test)]\nmod tests").unwrap();
    let swapped = format!(
        "{}{}\n{}",
        &text[..split],
        &text[modules..],
        &text[split..modules]
    );

    fs::write(root.path().join("src/lib.rs"), swapped).unwrap();

    assert_ne!(entries_at(root.path()), expected_entries());
}

#[test]
fn changes_the_entries_when_the_test_module_is_deleted() {
    let root = fixture_copy();
    let text = fs::read_to_string(root.path().join("src/lib.rs")).unwrap();

    fs::write(
        root.path().join("src/lib.rs"),
        &text[..text.find("#[cfg(test)]\nmod tests").unwrap()],
    )
    .unwrap();

    assert_ne!(entries_at(root.path()), expected_entries());
}

#[test]
fn ends_a_declaration_at_its_semicolon_with_or_without_a_final_newline() {
    let root = fixture_copy();
    let text = fs::read_to_string(root.path().join("src/more.rs")).unwrap();

    fs::write(root.path().join("src/more.rs"), text.trim_end()).unwrap();

    assert_eq!(entries_at(root.path()), expected_entries());
}

#[test]
fn finds_a_test_item_ending_at_the_last_byte_of_a_file() {
    let root = fixture_copy();

    fs::write(root.path().join("src/at_eof.rs"), "#[test] fn at_eof() {}").unwrap();

    assert!(entries_at(root.path()).contains_key("src/at_eof.rs#0"));
    assert_ne!(entries_at(root.path()), expected_entries());
}

#[test]
fn leaves_a_deleted_files_digest_unreadable_entry_out() {
    let root = fixture_copy();

    git(root.path(), &["add", "."]);
    fs::remove_file(root.path().join("src/more/helper_tests.rs")).unwrap();

    let found = entries_at(root.path());

    assert!(!found.contains_key("src/more/helper_tests.rs#file"));
    assert_ne!(found, expected_entries());
}

#[test]
fn skips_a_listed_file_that_cannot_be_read_and_hashes_the_rest() {
    let item = |name: &str| format!("#[test]\nfn {name}() {{}}\n");
    let root = repository_of(&[
        ("src/a.rs", &item("a")),
        ("src/b.rs", &item("b")),
        ("src/c.rs", &item("c")),
    ]);

    git(root.path(), &["add", "."]);
    fs::remove_file(root.path().join("src/c.rs")).unwrap();

    let keys: Vec<String> = entries_at(root.path()).keys().cloned().collect();

    assert_eq!(keys, ["src/a.rs#0", "src/b.rs#0"]);
}

macro_rules! adds_no_entry {
    ($name:ident, $text:expr) => {
        #[test]
        fn $name() {
            let text = format!("{}// test\n", $text);

            assert_eq!(keys_of(&[("src/a.rs", &text)]), Vec::<String>::new());
        }
    };
}

adds_no_entry!(adds_no_entry_for_a_line_comment, "// #[test]\nfn a() {}\n");
adds_no_entry!(
    adds_no_entry_for_a_nested_block_comment,
    "/* /* #[test] */ #[test] */\nfn a() {}\n"
);
adds_no_entry!(adds_no_entry_for_a_string, "const A: &str = \"#[test]\";\n");
adds_no_entry!(
    adds_no_entry_for_a_raw_string,
    "const A: &str = r#\"#[test]\"#;\n"
);
adds_no_entry!(
    adds_no_entry_for_a_raw_string_of_two_hashes,
    "const A: &str = r##\"a\"#b\"##; // test\n"
);
adds_no_entry!(
    adds_no_entry_for_a_byte_string,
    "const A: &[u8] = b\"#[test]\";\n"
);
adds_no_entry!(
    adds_no_entry_for_a_raw_byte_string,
    "const A: &[u8] = br#\"#[test]\"#;\n"
);
adds_no_entry!(
    adds_no_entry_for_cfg_attr,
    "#[cfg_attr(test, derive(Debug))]\nstruct A;\n"
);
adds_no_entry!(
    adds_no_entry_for_cfg_not_test,
    "#[cfg(not(test))]\nfn a() {}\n"
);
adds_no_entry!(
    adds_no_entry_for_a_feature_named_testing,
    "#[cfg(feature = \"testing\")]\nfn a() {}\n"
);

fn does_not_end_early(body: &str) {
    let text = format!("#[test]\n{body}fn after() {{}}\n");
    let root = repository_of(&[("src/a.rs", &text)]);
    let found = entries_at(root.path());

    assert_eq!(found.keys().collect::<Vec<_>>(), ["src/a.rs#0"]);
    assert_eq!(
        found["src/a.rs#0"],
        sha256_hex(format!("#[test]\n{body}").trim_end())
    );
}

#[test]
fn does_not_end_an_item_early_on_a_character_brace() {
    does_not_end_early("fn a() { let c = '}'; }\n");
}

#[test]
fn does_not_end_an_item_early_on_an_escaped_quote() {
    does_not_end_early("fn a() { let c = '\\''; }\n");
}

#[test]
fn does_not_end_an_item_early_on_a_byte_brace() {
    does_not_end_early("fn a() { let c = b'}'; }\n");
}

#[test]
fn does_not_end_an_item_early_on_a_unicode_escape() {
    does_not_end_early("fn a() { let c = '\\u{1F600}'; }\n");
}

#[test]
fn does_not_end_an_item_early_on_a_lifetime() {
    does_not_end_early("fn a<'a>(x: &'a str) -> &'a str { x }\n");
}

fn finds_one_entry(text: &str) {
    assert_eq!(keys_of(&[("src/a.rs", text)]), ["src/a.rs#0"]);
}

#[test]
fn finds_one_entry_for_extra_whitespace() {
    finds_one_entry("#[cfg( test )]\nfn a() {}\n");
}

#[test]
fn finds_one_entry_for_all_test_unix() {
    finds_one_entry("#[cfg(all(test, unix))]\nfn a() {}\n");
}

#[test]
fn finds_one_entry_for_split_lines() {
    finds_one_entry("#[cfg(\n    test\n)]\nfn a() {}\n");
}

#[test]
fn finds_one_entry_for_a_doc_comment_between_attributes() {
    finds_one_entry("#[inline]\n/// doc\n#[test]\nfn a() {}\n");
}

#[test]
fn finds_one_entry_for_no_final_newline() {
    finds_one_entry("#[test]\nfn a() {}");
}

#[test]
fn skips_a_file_with_no_test_text() {
    assert_eq!(
        keys_of(&[("src/a.rs", "fn a() {}\n")]),
        Vec::<String>::new()
    );
}

#[test]
fn does_not_scan_a_test_file() {
    assert_eq!(
        keys_of(&[("tests/a.rs", "#[test]\nfn a() {}\n")]),
        Vec::<String>::new()
    );
}

#[test]
fn adds_the_listed_files_and_only_the_item_for_an_unlisted_one() {
    let found = keys_of(&[
        (
            "src/lib.rs",
            "#[cfg(test)]\nmod one;\n#[cfg(test)]\nmod two;\n#[cfg(test)]\nmod three;\n",
        ),
        ("src/one.rs", "fn one() {}\n"),
        ("src/two/mod.rs", "fn two() {}\n"),
    ]);

    assert_eq!(
        found,
        [
            "src/lib.rs#0",
            "src/lib.rs#1",
            "src/lib.rs#2",
            "src/one.rs#file",
            "src/two/mod.rs#file",
        ]
    );
}

#[test]
fn resolves_a_file_reached_from_a_non_mod_file_under_its_stem_directory() {
    let found = keys_of(&[
        ("src/lib.rs", "mod outer;\n"),
        ("src/outer.rs", "#[cfg(test)]\npub(crate) mod inner;\n"),
        ("src/outer/inner.rs", "fn x() {}\n"),
        ("src/inner.rs", "fn y() {}\n"),
    ]);

    assert_eq!(found, ["src/outer.rs#0", "src/outer/inner.rs#file"]);
}

#[test]
fn marks_only_the_file_the_declaration_resolves_to() {
    let found = keys_of(&[
        ("src/lib.rs", "#[cfg(test)]\nmod x;\n"),
        ("src/x.rs", "fn a() {}\n"),
        ("src/deep/x.rs", "fn b() {}\n"),
    ]);

    assert_eq!(found, ["src/lib.rs#0", "src/x.rs#file"]);
}

#[test]
fn brings_the_descendants_of_a_declared_file_and_not_a_same_named_file() {
    let found = keys_of(&[
        ("src/lib.rs", "#[cfg(test)]\nmod t;\n"),
        ("src/t.rs", "mod u;\n"),
        ("src/t/u.rs", "fn a() {}\n"),
        ("src/a/t.rs", "fn b() {}\n"),
    ]);

    assert_eq!(found, ["src/lib.rs#0", "src/t.rs#file", "src/t/u.rs#file"]);
}

#[test]
fn finds_one_hash_zero_entry_in_each_app_source_file_with_a_cfg_test_line() {
    let root = repository();
    let prefix = "packages/app/src-tauri/src";
    let grep = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["grep", "-l", "-E", "^#\\[cfg\\(test\\)\\]", "--", prefix])
        .output()
        .unwrap();
    let expected: BTreeSet<String> = String::from_utf8(grep.stdout)
        .unwrap()
        .lines()
        .map(|path| format!("{path}#0"))
        .collect();

    assert!(!expected.is_empty());

    let found: BTreeSet<String> = entries_at(&root)
        .into_keys()
        .filter(|key| key.starts_with(prefix) && key.ends_with("#0"))
        .collect();

    assert_eq!(found, expected);
}

#[test]
fn counts_only_the_items_that_require_test() {
    let text = "#[cfg(all(test, unix))]\nfn a() {}\n#[cfg(any(test, unix))]\nfn b() {}\n#[cfg(test)]\nfn c() {}\n";

    assert_eq!(keys_of(&[("src/a.rs", text)]), ["src/a.rs#0", "src/a.rs#1"]);
}

fn file_cases() -> Vec<Value> {
    let text =
        fs::read_to_string(repository().join("fixtures/rust-test-gate/file-cases.json")).unwrap();

    serde_json::from_str(&text).unwrap()
}

#[test]
fn reads_a_table_with_more_than_twenty_two_cases() {
    assert!(file_cases().len() > 22);
}

#[test]
fn marks_exactly_the_shared_file_cases_test_files_as_file_entries() {
    for case in file_cases() {
        let name = case["name"].as_str().unwrap();
        let files: Vec<(String, String)> = case["files"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(path, text)| (path.clone(), text.as_str().unwrap().to_string()))
            .collect();
        let borrowed: Vec<(&str, &str)> = files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str()))
            .collect();
        let found: BTreeSet<String> = entries_at(repository_of(&borrowed).path())
            .into_keys()
            .filter_map(|key| key.strip_suffix("#file").map(str::to_string))
            .collect();
        let want: BTreeSet<String> = case["test_files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| path.as_str().unwrap().to_string())
            .collect();

        assert_eq!(found, want, "{name}");
    }
}

fn gate_cases() -> Vec<Value> {
    let text = fs::read_to_string(repository().join("fixtures/rust-test-gate/cases.json")).unwrap();

    serde_json::from_str(&text).unwrap()
}

#[test]
fn reads_a_gate_table_with_more_than_twenty_cases() {
    assert!(gate_cases().len() > 20);
}

#[test]
fn classifies_every_attribute_of_the_shared_gate_table() {
    for case in gate_cases() {
        let attribute = case["attribute"].as_str().unwrap();
        let inner = &attribute[2..attribute.len() - 1];

        assert_eq!(
            is_test_attribute(inner.as_bytes()),
            case["test"].as_bool().unwrap(),
            "{attribute}"
        );
    }
}

const PACKAGE: &str = "[package]\nname = \"app\"\nversion = \"0.1.0\"\n";

#[test]
fn leaves_the_files_of_an_unparseable_manifest_to_name_inference() {
    let found = keys_of(&[
        ("Cargo.toml", "[package"),
        ("src/lib.rs", "#[cfg(test)]\nmod t;\n"),
        ("src/t.rs", "fn a() {}\n"),
    ]);

    assert_eq!(found, ["src/lib.rs#0", "src/t.rs#file"]);
}

#[test]
fn resolves_a_covered_package_from_its_manifest_and_a_bare_directory_by_name() {
    let covered = format!("{PACKAGE}[lib]\npath = \"other/mylib.rs\"\n");
    let found = keys_of(&[
        ("covered/Cargo.toml", &covered),
        ("covered/other/mylib.rs", "#[cfg(test)]\nmod t;\n"),
        ("covered/other/t.rs", "fn a() {}\n"),
        ("bare/lib.rs", "#[cfg(test)]\nmod t;\n"),
        ("bare/t.rs", "fn a() {}\n"),
    ]);

    assert!(found.contains(&"bare/t.rs#file".to_string()));
    assert!(found.contains(&"covered/other/t.rs#file".to_string()));
}

fn roots_of(files: &[(&str, &str)]) -> Roots {
    let listed: Vec<String> = files.iter().map(|(path, _)| path.to_string()).collect();
    let texts: BTreeMap<&str, &str> = files.iter().copied().collect();

    manifest_roots(&listed, &|path| {
        texts.get(path).map(|text| text.to_string())
    })
}

#[test]
fn covers_nothing_for_a_virtual_workspace_manifest() {
    let roots = roots_of(&[
        ("Cargo.toml", "[workspace]\nmembers = []\n"),
        ("src/lib.rs", ""),
    ]);

    assert!(roots.covered.is_empty());
}

#[test]
fn reads_every_target_the_scanner_reads() {
    let manifest = format!(
        "{PACKAGE}[[example]]\nname = \"e\"\npath = \"demo/e.rs\"\n[[test]]\nname = \"t\"\npath = \"it/t.rs\"\n"
    );
    let roots = roots_of(&[
        ("p/Cargo.toml", &manifest),
        ("p/src/lib.rs", ""),
        ("p/src/main.rs", ""),
        ("p/build.rs", ""),
        ("p/demo/e.rs", ""),
        ("p/it/t.rs", ""),
        ("p/src/bin/a.rs", ""),
        ("p/src/bin/b/main.rs", ""),
        ("p/src/bin/b/other.rs", ""),
        ("p/benches/x.rs", ""),
        ("p/lib.rs", ""),
    ]);
    let want: BTreeSet<String> = [
        "p/src/lib.rs",
        "p/src/main.rs",
        "p/build.rs",
        "p/demo/e.rs",
        "p/it/t.rs",
        "p/src/bin/a.rs",
        "p/src/bin/b/main.rs",
        "p/benches/x.rs",
    ]
    .iter()
    .map(|path| path.to_string())
    .collect();

    assert_eq!(roots.roots, want);
}

#[test]
fn declares_no_build_script_when_build_is_false() {
    let manifest = PACKAGE.replace("[package]\n", "[package]\nbuild = false\n");
    let roots = roots_of(&[("Cargo.toml", &manifest), ("build.rs", "")]);

    assert!(!roots.roots.contains("build.rs"));
}

#[test]
fn prints_no_entries_for_a_repository_with_no_tests() {
    let root = repository_of(&[("src/a.rs", "fn a() {}\n")]);

    assert!(entries_at(root.path()).is_empty());
}

#[test]
fn exits_non_zero_when_git_cannot_list_the_files() {
    let root = TempDir::new().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_recognizer-scan-rust"))
        .arg("tests")
        .arg(root.path())
        .output()
        .unwrap();

    assert!(!output.status.success());
}
