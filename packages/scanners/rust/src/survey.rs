use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};

const TOOL: &str = "cargo-llvm-cov";
const REPORT_ROOT: &str = "{up}.recognizer/cache/coverage/{slug}";

struct Found {
    directory: String,
    from: String,
}

fn directory_of(path: &str) -> String {
    match path.rfind('/') {
        Some(at) => path[..at].to_string(),
        None => ".".to_string(),
    }
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn declares_a_package(text: &str) -> bool {
    text.lines().any(|line| line.starts_with("[package]"))
}

fn strings_of(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn runners(root: &Path, files: &[String], suites: &[(String, String)]) -> Vec<Found> {
    let mut found: Vec<Found> = files
        .iter()
        .filter(|file| base_name(file) == "Cargo.toml")
        .filter(|file| {
            std::fs::read_to_string(root.join(file))
                .map(|text| declares_a_package(&text))
                .unwrap_or(false)
        })
        .map(|file| Found {
            directory: directory_of(file),
            from: file.clone(),
        })
        .filter(|one| {
            !suites
                .iter()
                .any(|(language, directory)| language == "rust" && *directory == one.directory)
        })
        .collect();

    found.sort_by(|a, b| a.directory.cmp(&b.directory));

    found
}

fn installed(root: &Path) -> bool {
    Command::new("cargo")
        .args(["llvm-cov", "--version"])
        .current_dir(root)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn answer(request: &Value) -> Result<Value, String> {
    let root = request["root"]
        .as_str()
        .filter(|root| !root.is_empty())
        .ok_or("the request has no root")?;
    let files = strings_of(&request["files"]);
    let suites: Vec<(String, String)> = request["suites"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some((
                        item["language"].as_str()?.to_string(),
                        item["directory"].as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let root = Path::new(root);
    let found = runners(root, &files, &suites);
    let entries: Vec<Value> = found
        .iter()
        .map(|one| {
            json!({
                "language": "rust",
                "runner": "cargo",
                "directory": one.directory,
                "from": one.from,
                "command": format!("cargo llvm-cov --lcov --output-path {REPORT_ROOT}/lcov.info"),
                "coverage": {
                    "path": ".recognizer/cache/coverage/{slug}/lcov.info",
                    "format": "lcov",
                },
                "tool": TOOL,
            })
        })
        .collect();
    let mut tools: Vec<Value> = Vec::new();

    if !found.is_empty() {
        tools.push(json!({
            "name": TOOL,
            "kind": "cargo",
            "installed": installed(root),
            "why": "cargo writes its coverage report through this subcommand",
            "needed_by": found.iter().map(|one| one.from.clone()).collect::<Vec<_>>(),
            "installs": "the cargo bin folder, outside the repository",
            "command": ["cargo", "install", TOOL, "--locked"],
            "cwd": ".",
            "undo": ["cargo", "uninstall", TOOL],
            "undo_note": format!("{TOOL} was uninstalled"),
        }));
    }

    Ok(json!({
        "runners": entries,
        "tools": tools,
        "notes": [],
    }))
}
