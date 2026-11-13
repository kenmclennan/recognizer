use serde_json::{json, Value};

use crate::discovery::{EXTENSIONS, SKIPPED_DIRECTORY_NAMES, SKIPPED_DIRECTORY_PREFIXES};

pub const PROTOCOL: u64 = 1;

pub const INSTALL: &str = "brew install --cask kenmclennan/tap/recognizer";

pub fn build() -> Value {
    json!({
        "kind": "scanner",
        "name": "rust",
        "display": "Rust",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL,
        "install": INSTALL,
        "check": false,
        "long_running": true,
        "units": ["files"],
        "settings": [],
        "languages": [{
            "name": "rust",
            "extensions": EXTENSIONS,
            "files": [],
            "skip": {
                "directory_names": SKIPPED_DIRECTORY_NAMES,
                "directory_prefixes": SKIPPED_DIRECTORY_PREFIXES,
                "directory_suffixes": [],
                "directory_markers": [],
                "file_globs": [],
            },
        }],
    })
}

pub fn text() -> String {
    let mut text = serde_json::to_string_pretty(&build()).unwrap();
    text.push('\n');

    text
}
