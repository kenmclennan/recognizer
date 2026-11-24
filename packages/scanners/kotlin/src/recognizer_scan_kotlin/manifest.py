import json
from importlib.metadata import version

from recognizer_scan_kotlin.discovery import (
    SKIPPED_DIRECTORY_NAMES,
    SKIPPED_DIRECTORY_PREFIXES,
    SKIPPED_DIRECTORY_SUFFIXES,
    SKIPPED_FILE_PATTERNS,
    SOURCE_EXTENSIONS,
)
from recognizer_scan_kotlin.scan_schema import SCAN_SCHEMA_VERSION

PROTOCOL = 2

INSTALL = (
    "brew upgrade kenmclennan/tap/recognizer-scan-kotlin "
    "|| brew install kenmclennan/tap/recognizer-scan-kotlin"
)

GRAMMARS = [
    {
        "name": "kotlin",
        "extensions": [".kt"],
        "function_types": ["function_declaration"],
        "scope_types": ["class_declaration", "object_declaration", "companion_object"],
        "branch_types": [
            "if_expression",
            "for_statement",
            "while_statement",
            "do_while_statement",
            "when_entry",
            "catch_block",
            "conjunction_expression",
            "disjunction_expression",
        ],
        "boolean_operators": [],
        "bound_function_types": [],
        "vocabulary": {
            "comment_markers": ["comment"],
            "literal_types": ["string_content", "true", "false"],
            "literal_suffixes": ["_literal"],
            "call_types": ["call_expression"],
            "identifier_types": ["identifier"],
            "identifier_suffixes": ["_identifier"],
            "block_types": ["statements"],
            "member_fields": [{"type": "navigation_expression"}, {"type": "navigation_suffix"}],
            "jump_types": ["jump_expression"],
            "return_keywords": ["return"],
            "assignment_types": ["assignment"],
            "positional_assignment_types": ["assignment"],
            "member_types": ["navigation_expression"],
            "subscript_types": ["indexing_expression"],
            "identifier_leaf_types": ["identifier", "simple_identifier"],
            "self_types": ["this", "this_expression"],
            "self_texts": ["self"],
            "plain_name_types": ["identifier", "simple_identifier"],
            "argument_wrapper_types": ["value_argument"],
            "argument_list_types": ["value_arguments"],
            "call_suffix_types": ["call_suffix"],
            "subscript_argument_list_types": ["indexing_suffix"],
            "parameter_list_types": ["function_value_parameters"],
            "function_body_types": ["function_body"],
            "name_leaf_types": ["identifier", "type_identifier", "simple_identifier"],
            "node_names": [{"type": "companion_object", "default": "Companion"}],
            "assignment_operators": ["="],
        },
        "function_names": [],
        "span": {
            "scope_calls": [
                "synchronized",
                "use",
                "withLock",
                "runCatching",
                "run",
                "with",
                "apply",
                "also",
                "let",
            ],
            "statements_type": "statements",
            "call_type": "call_expression",
            "callee_name_type": "simple_identifier",
            "navigation_type": "navigation_expression",
            "navigation_suffix_type": "navigation_suffix",
            "call_suffix_type": "call_suffix",
            "lambda_argument_type": "annotated_lambda",
            "lambda_type": "lambda_literal",
            "jump_type": "jump_expression",
            "jump_returns": ["return", "return@"],
            "label_type": "label",
            "function_body_type": "function_body",
            "object_literal_type": "object_literal",
            "object_body_type": "class_body",
        },
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
]


def build() -> dict:
    return {
        "kind": "scanner",
        "name": "kotlin",
        "display": "Kotlin",
        "version": version("recognizer-scan-kotlin"),
        "protocol": PROTOCOL,
        "install": INSTALL,
        "check": False,
        "long_running": True,
        "units": ["files"],
        "settings": [],
        "scan_schema_version": SCAN_SCHEMA_VERSION,
        "setup_survey": {"order": 4},
        "languages": [
            {
                "name": "kotlin",
                "display": "Kotlin",
                "grammars": GRAMMARS,
                "extensions": list(SOURCE_EXTENSIONS),
                "files": [],
                "test_files": TEST_FILES,
                "supertype_links": True,
                "private_imports": False,
                "skip": {
                    "directory_names": list(SKIPPED_DIRECTORY_NAMES),
                    "directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
                    "directory_suffixes": list(SKIPPED_DIRECTORY_SUFFIXES),
                    "directory_markers": [],
                    "file_globs": list(SKIPPED_FILE_PATTERNS),
                },
            }
        ],
    }


def manifest_text() -> str:
    return json.dumps(build(), indent=2) + "\n"
