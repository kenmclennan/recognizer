import json
from importlib.metadata import version

from recognizer_scan_csharp.discovery import (
    MARKUP_EXTENSIONS,
    SKIPPED_DIRECTORY_NAMES,
    SKIPPED_DIRECTORY_PREFIXES,
    SKIPPED_FILE_PATTERNS,
    SOURCE_EXTENSIONS,
)
from recognizer_scan_csharp.scan_schema import SCAN_SCHEMA_VERSION

PROTOCOL = 2

INSTALL = (
    "brew upgrade kenmclennan/tap/recognizer-scan-csharp "
    "|| brew install kenmclennan/tap/recognizer-scan-csharp"
)

GRAMMARS = [
    {
        "name": "csharp",
        "extensions": [".cs"],
        "function_types": [
            "method_declaration",
            "constructor_declaration",
            "local_function_statement",
            "accessor_declaration",
            "destructor_declaration",
            "operator_declaration",
            "conversion_operator_declaration",
            "property_declaration",
            "indexer_declaration",
        ],
        "scope_types": [
            "class_declaration",
            "struct_declaration",
            "record_declaration",
            "interface_declaration",
            "property_declaration",
            "indexer_declaration",
            "event_declaration",
        ],
        "branch_types": [
            "if_statement",
            "for_statement",
            "foreach_statement",
            "while_statement",
            "do_statement",
            "switch_section",
            "switch_expression_arm",
            "catch_clause",
            "conditional_expression",
            "conditional_access_expression",
        ],
        "boolean_operators": ["&&", "||", "??"],
        "bound_function_types": [],
        "vocabulary": {
            "comment_markers": ["comment"],
            "literal_types": ["string_content", "true", "false"],
            "literal_suffixes": ["_literal"],
            "call_types": ["invocation_expression"],
            "identifier_types": ["identifier"],
            "block_types": ["block"],
            "member_fields": [
                {"type": "attribute", "field": "attribute"},
                {"type": "member_access_expression", "field": "name"},
            ],
            "return_types": ["return_statement"],
            "assignment_types": ["assignment_expression"],
            "member_types": ["attribute", "member_access_expression"],
            "subscript_types": ["element_access_expression"],
            "identifier_leaf_types": ["identifier"],
            "self_types": ["this"],
            "self_texts": ["self"],
            "plain_name_types": ["identifier"],
            "expression_statement_types": ["expression_statement"],
            "argument_wrapper_types": ["argument"],
            "subscript_argument_list_types": ["bracketed_argument_list"],
            "expression_bodied_types": ["property_declaration", "indexer_declaration"],
            "expression_body_types": ["arrow_expression_clause"],
            "name_leaf_types": ["identifier"],
            "operator_node_types": ["binary_expression"],
            "node_names": [{"type": "indexer_declaration", "literal": "this"}],
        },
        "function_names": [
            {
                "type": "method_declaration",
                "requires_field": "body",
                "name_field": "name",
            },
            {
                "type": "constructor_declaration",
                "requires_field": "body",
                "name_field": "name",
            },
            {
                "type": "local_function_statement",
                "requires_field": "body",
                "name_field": "name",
            },
            {
                "type": "accessor_declaration",
                "requires_field": "body",
                "name_field": "name",
            },
            {
                "type": "destructor_declaration",
                "requires_field": "body",
                "prefix": "~",
                "name_field": "name",
            },
            {
                "type": "operator_declaration",
                "requires_field": "body",
                "prefix": "operator ",
                "name_field": "operator",
            },
            {
                "type": "conversion_operator_declaration",
                "requires_field": "body",
                "prefix": "operator ",
                "name_field": "type",
            },
            {
                "type": "property_declaration",
                "requires_field": "value",
                "requires_field_type": "arrow_expression_clause",
                "name_field": "name",
            },
            {
                "type": "indexer_declaration",
                "requires_field": "value",
                "requires_field_type": "arrow_expression_clause",
                "literal": "this",
            },
        ],
    }
]

TEST_FILES = [
    {
        "extensions": [],
        "directory_names": ["test", "tests"],
        "directory_suffixes": [],
        "basename_patterns": [],
        "stem_suffixes": ["Test", "Tests"],
    },
    {
        "extensions": [".cs"],
        "directory_names": [],
        "directory_suffixes": ["Test", "Tests"],
        "basename_patterns": [],
        "stem_suffixes": [],
    },
]


def build() -> dict:
    return {
        "kind": "scanner",
        "name": "csharp",
        "display": "C#",
        "version": version("recognizer-scan-csharp"),
        "protocol": PROTOCOL,
        "install": INSTALL,
        "check": False,
        "long_running": True,
        "units": ["files"],
        "settings": [],
        "scan_schema_version": SCAN_SCHEMA_VERSION,
        "languages": [
            {
                "name": "csharp",
                "display": "C#",
                "grammars": GRAMMARS,
                "extensions": [*SOURCE_EXTENSIONS, *MARKUP_EXTENSIONS],
                "files": [],
                "test_files": TEST_FILES,
                "supertype_links": False,
                "private_imports": False,
                "skip": {
                    "directory_names": list(SKIPPED_DIRECTORY_NAMES),
                    "directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
                    "directory_suffixes": [],
                    "directory_markers": [],
                    "file_globs": list(SKIPPED_FILE_PATTERNS),
                },
            }
        ],
    }


def manifest_text() -> str:
    return json.dumps(build(), indent=2) + "\n"
