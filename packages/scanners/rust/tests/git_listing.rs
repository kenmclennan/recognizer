mod support;

use std::fs;
use std::path::Path;
use std::process::Command;

use recognizer_scan_rust::discovery::{manifests, source_files};
use support::*;

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap()
        .status;

    assert!(status.success(), "git {args:?} failed");
}

fn repository(tracked: &[(&str, &str)], extra: &[(&str, &str)], ignore: &str) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();

    git(root, &["init", "-q"]);
    write_tree(root, tracked);
    fs::write(root.join(".gitignore"), ignore).unwrap();

    let mut add = vec!["add", "-f", ".gitignore"];
    add.extend(tracked.iter().map(|(path, _)| *path));
    git(root, &add);
    git(root, &["commit", "-q", "-m", "init"]);
    write_tree(root, extra);

    directory
}

const BODY: &str = "pub fn a() {}\n";

#[test]
fn an_ignored_copy_is_extracted_once_from_src() {
    let directory = repository(&[("src/a.rs", BODY)], &[("out/a.rs", BODY)], "out/\n");

    assert_eq!(source_files(directory.path()), vec!["src/a.rs"]);
}

#[test]
fn an_untracked_file_git_does_not_ignore_is_extracted() {
    let directory = repository(&[("src/a.rs", BODY)], &[("src/new.rs", BODY)], "out/\n");

    assert_eq!(
        source_files(directory.path()),
        vec!["src/a.rs", "src/new.rs"]
    );
}

#[test]
fn a_tracked_file_the_gitignore_names_is_extracted() {
    let directory = repository(&[("src/a.rs", BODY), ("out/kept.rs", BODY)], &[], "out/\n");

    assert_eq!(
        source_files(directory.path()),
        vec!["out/kept.rs", "src/a.rs"]
    );
}

#[test]
fn a_tracked_file_deleted_from_disk_is_not_extracted() {
    let directory = repository(&[("src/a.rs", BODY), ("src/b.rs", BODY)], &[], "out/\n");

    fs::remove_file(directory.path().join("src/b.rs")).unwrap();

    assert_eq!(source_files(directory.path()), vec!["src/a.rs"]);
}

#[test]
fn a_folder_that_is_not_a_repository_extracts_the_ignored_copy_too() {
    let directory = tempfile::tempdir().unwrap();

    write_tree(
        directory.path(),
        &[
            ("src/a.rs", BODY),
            ("out/a.rs", BODY),
            (".gitignore", "out/\n"),
        ],
    );

    assert_eq!(source_files(directory.path()), vec!["out/a.rs", "src/a.rs"]);
}

#[test]
fn a_mixed_tree_extracts_the_tracked_and_the_untracked_not_ignored() {
    let directory = repository(
        &[("src/a.rs", BODY), ("src/b.rs", BODY)],
        &[("src/new.rs", BODY), ("out/c.rs", BODY)],
        "out/\n",
    );

    fs::remove_file(directory.path().join("src/b.rs")).unwrap();

    assert_eq!(
        source_files(directory.path()),
        vec!["src/a.rs", "src/new.rs"]
    );
}

#[test]
fn a_nested_repository_is_not_extracted() {
    let directory = repository(&[("src/a.rs", BODY)], &[], "out/\n");
    let inner = directory.path().join("inner");

    fs::create_dir(&inner).unwrap();
    git(&inner, &["init", "-q"]);
    write_tree(&inner, &[("x.rs", BODY)]);
    git(&inner, &["add", "x.rs"]);
    git(&inner, &["commit", "-q", "-m", "init"]);

    assert_eq!(source_files(directory.path()), vec!["src/a.rs"]);
}

#[test]
fn a_subfolder_root_extracts_its_own_src_with_ids_relative_to_it() {
    let directory = repository(
        &[("sub/src/a.rs", BODY)],
        &[("sub/out/a.rs", BODY)],
        "sub/out/\n",
    );

    assert_eq!(
        source_files(&directory.path().join("sub")),
        vec!["src/a.rs"]
    );
}

#[test]
fn manifests_in_an_ignored_folder_are_not_read() {
    let directory = repository(
        &[("Cargo.toml", ""), ("src/a.rs", BODY)],
        &[("out/Cargo.toml", "")],
        "out/\n",
    );

    assert_eq!(manifests(directory.path()), vec!["Cargo.toml"]);
}
