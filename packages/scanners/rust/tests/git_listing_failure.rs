mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::process::Command;

use support::*;

const BODY: &str = "pub fn a() {}\n";

fn tree(directory: &std::path::Path) {
    write_tree(
        directory,
        &[
            ("src/a.rs", BODY),
            ("out/a.rs", BODY),
            (".gitignore", "out/\n"),
        ],
    );
}

#[test]
fn a_missing_git_scans_every_file_silently_and_a_refusal_warns_once() {
    let empty = tempfile::tempdir().unwrap();
    let wrapper = tempfile::tempdir().unwrap();
    let script = wrapper.path().join("git");

    fs::write(
        &script,
        "#!/bin/sh\necho 'fatal: detected dubious ownership in repository' >&2\nexit 128\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    let directory = tempfile::tempdir().unwrap();
    tree(directory.path());

    let binary = env!("CARGO_BIN_EXE_recognizer-scan-rust");

    let missing = Command::new(binary)
        .arg("run")
        .arg(directory.path())
        .env("PATH", empty.path())
        .output()
        .unwrap();
    let missing_ids = String::from_utf8_lossy(&missing.stdout).into_owned();

    assert!(
        !String::from_utf8_lossy(&missing.stderr).contains("git could not list"),
        "{}",
        String::from_utf8_lossy(&missing.stderr)
    );
    assert!(missing_ids.contains("\"out/a.rs\""));
    assert!(missing_ids.contains("\"src/a.rs\""));

    let refused = Command::new(binary)
        .arg("run")
        .arg(directory.path())
        .env("PATH", wrapper.path())
        .output()
        .unwrap();

    let noise: String = String::from_utf8_lossy(&refused.stderr)
        .lines()
        .filter(|line| !line.starts_with("recognizer-event "))
        .map(|line| format!("{line}\n"))
        .collect();

    assert_eq!(
        noise,
        "recognizer-scan-rust: git could not list files (fatal: detected dubious ownership in repository); scanning every file\n"
    );
    assert_eq!(String::from_utf8_lossy(&refused.stdout), missing_ids);
}
