use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};

pub const EXTENSIONS: [&str; 1] = [".rs"];
pub const SKIPPED_DIRECTORY_NAMES: [&str; 3] = ["target", "node_modules", "tests"];
pub const SKIPPED_DIRECTORY_PREFIXES: [&str; 1] = ["."];

pub fn selection() -> Value {
    json!({
        "extensions": EXTENSIONS,
        "skip_directory_names": SKIPPED_DIRECTORY_NAMES,
        "skip_directory_prefixes": SKIPPED_DIRECTORY_PREFIXES,
        "skip_directory_suffixes": [],
        "skip_directories_containing": [],
        "skip_file_globs": [],
        "input_file_globs": ["Cargo.toml"],
    })
}

pub fn is_skipped_directory(name: &str) -> bool {
    SKIPPED_DIRECTORY_NAMES.contains(&name)
        || SKIPPED_DIRECTORY_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

pub type Listing = Option<HashSet<String>>;

pub fn git_listing(root: &Path) -> Listing {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();

        if !message.contains("not a git repository") {
            let first = message
                .lines()
                .next()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("exit {}", output.status.code().unwrap_or(-1)));

            eprintln!(
                "recognizer-scan-rust: git could not list files ({first}); scanning every file"
            );
        }

        return None;
    }

    Some(
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .map(|entry| String::from_utf8_lossy(entry).into_owned())
            .collect(),
    )
}

pub fn walk(root: &Path, listing: &Listing, wanted: &dyn Fn(&str) -> bool) -> Vec<String> {
    let mut found = Vec::new();

    visit(root, "", wanted, &mut found);
    found.retain(|path| listing.as_ref().is_none_or(|listed| listed.contains(path)));
    found.sort();

    found
}

fn visit(directory: &Path, prefix: &str, wanted: &dyn Fn(&str) -> bool, found: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let relative = format!("{prefix}{name}");

        if kind.is_dir() {
            if !is_skipped_directory(&name) {
                visit(&entry.path(), &format!("{relative}/"), wanted, found);
            }
        } else if (kind.is_file() || (kind.is_symlink() && entry.path().is_file())) && wanted(&name)
        {
            found.push(relative);
        }
    }
}

pub fn source_files(root: &Path) -> Vec<String> {
    source_files_in(root, &git_listing(root))
}

pub fn source_files_in(root: &Path, listing: &Listing) -> Vec<String> {
    walk(root, listing, &|name| {
        EXTENSIONS.iter().any(|extension| name.ends_with(extension))
    })
}

pub fn manifests(root: &Path) -> Vec<String> {
    manifests_in(root, &git_listing(root))
}

pub fn manifests_in(root: &Path, listing: &Listing) -> Vec<String> {
    walk(root, listing, &|name| name == "Cargo.toml")
}
