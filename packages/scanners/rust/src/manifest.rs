use serde_json::{json, Value};

use crate::discovery::{EXTENSIONS, SKIPPED_DIRECTORY_NAMES, SKIPPED_DIRECTORY_PREFIXES};
use crate::scanner::SCAN_SCHEMA_VERSION;

pub const PROTOCOL: u64 = 3;

pub const INSTALL: &str = "brew upgrade kenmclennan/tap/recognizer-scan-rust || brew install kenmclennan/tap/recognizer-scan-rust";

fn vocabulary() -> Value {
    json!({
        "comment_markers": [
            "comment"
        ],
        "literal_types": [
            "string_content",
            "true",
            "false"
        ],
        "literal_suffixes": [
            "_literal"
        ],
        "call_types": [
            "call_expression"
        ],
        "identifier_types": [
            "identifier",
            "self"
        ],
        "identifier_suffixes": [
            "_identifier"
        ],
        "block_types": [
            "block"
        ],
        "member_fields": [
            {
                "type": "attribute",
                "field": "attribute"
            },
            {
                "type": "field_expression",
                "field": "field"
            },
            {
                "type": "scoped_identifier",
                "field": "name"
            }
        ],
        "return_types": [
            "return_expression"
        ],
        "assignment_types": [
            "assignment_expression"
        ],
        "member_types": [
            "attribute",
            "field_expression"
        ],
        "subscript_types": [
            "index_expression"
        ],
        "identifier_leaf_types": [
            "identifier",
            "field_identifier"
        ],
        "self_types": [
            "self"
        ],
        "self_texts": [
            "self"
        ],
        "shorthand_initialiser_types": [
            "shorthand_field_initializer"
        ],
        "field_initialiser_types": [
            "field_initializer"
        ],
        "struct_literal_types": [
            "struct_expression"
        ],
        "plain_name_types": [
            "identifier"
        ],
        "expression_statement_types": [
            "expression_statement"
        ],
        "name_leaf_types": [
            "identifier",
            "type_identifier"
        ],
        "operator_node_types": [
            "binary_expression"
        ],
        "node_names": [
            {
                "type": "impl_item",
                "name_field": "type",
                "strip_after": "<"
            }
        ],
        "fields": {
            "name": "name",
            "body": "body",
            "parameters": "parameters",
            "parameter_pattern": "pattern",
            "arguments": "arguments",
            "callee": "function",
            "operator": "operator",
            "assigned_value": "right",
            "initialiser_list": "body",
            "initialiser_value": "value"
        },
        "assignment_operators": ["="]
    })
}

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
                "vocabulary": vocabulary(),
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
