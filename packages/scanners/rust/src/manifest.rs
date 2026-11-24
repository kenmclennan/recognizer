use serde_json::{json, Value};

use crate::discovery::{EXTENSIONS, SKIPPED_DIRECTORY_NAMES, SKIPPED_DIRECTORY_PREFIXES};
use crate::scanner::SCAN_SCHEMA_VERSION;

pub const PROTOCOL: u64 = 2;

pub const INSTALL: &str = "brew upgrade kenmclennan/tap/recognizer-scan-rust || brew install kenmclennan/tap/recognizer-scan-rust";

pub fn build() -> Value {
    json!({
        "kind": "scanner",
        "name": "rust",
        "display": "Rust",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL,
        "install": INSTALL,
        "check": false,
        "reports_tests": true,
        "setup_survey": { "order": 2 },
        "long_running": true,
        "units": ["files"],
        "settings": [],
        "scan_schema_version": SCAN_SCHEMA_VERSION,
        "languages": [{
            "name": "rust",
            "display": "Rust",
            "grammars": [{
                "name": "rust",
                "extensions": [".rs"],
                "function_types": ["function_item"],
                "scope_types": ["impl_item", "trait_item", "mod_item"],
                "branch_types": ["if_expression", "for_expression", "while_expression", "match_arm"],
                "boolean_operators": ["&&", "||"],
                "bound_function_types": [],
                "function_names": [],
            }],
            "extensions": EXTENSIONS,
            "files": [],
            "test_files": [{
                "extensions": [],
                "directory_names": ["test", "tests"],
                "directory_suffixes": [],
                "basename_patterns": [],
                "stem_suffixes": [],
            }],
            "supertype_links": false,
            "private_imports": false,
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
