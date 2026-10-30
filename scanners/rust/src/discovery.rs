use std::fs;
use std::path::Path;

use serde_json::{json, Value};

pub const EXTENSIONS: [&str; 1] = [".rs"];
pub const SKIPPED_DIRECTORY_NAMES: [&str; 2] = ["target", "node_modules"];
pub const SKIPPED_DIRECTORY_PREFIXES: [&str; 1] = ["."];

pub fn selection() -> Value {
    json!({
        "extensions": EXTENSIONS,
        "skip_directory_names": SKIPPED_DIRECTORY_NAMES,
        "skip_directory_prefixes": SKIPPED_DIRECTORY_PREFIXES,
        "skip_directory_suffixes": [],
        "skip_directories_containing": [],
        "skip_file_globs": [],
    })
}

pub fn is_skipped_directory(name: &str) -> bool {
    SKIPPED_DIRECTORY_NAMES.contains(&name)
        || SKIPPED_DIRECTORY_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

pub fn walk(root: &Path, wanted: &dyn Fn(&str) -> bool) -> Vec<String> {
    let mut found = Vec::new();

    visit(root, "", wanted, &mut found);
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
    walk(root, &|name| {
        EXTENSIONS.iter().any(|extension| name.ends_with(extension))
    })
}

pub fn manifests(root: &Path) -> Vec<String> {
    walk(root, &|name| name == "Cargo.toml")
}
