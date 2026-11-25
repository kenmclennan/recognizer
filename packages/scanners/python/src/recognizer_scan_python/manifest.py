import json
from importlib.metadata import version

from recognizer_scan_python.discovery import (
    SKIPPED_DIRECTORY_MARKERS,
    SKIPPED_DIRECTORY_NAMES,
    SKIPPED_DIRECTORY_PREFIXES,
    SKIPPED_DIRECTORY_SUFFIXES,
    SKIPPED_FILE_PATTERNS,
    SOURCE_EXTENSIONS,
)
from recognizer_scan_python.scan_schema import SCAN_SCHEMA_VERSION

PROTOCOL = 3

INSTALL = (
    "brew upgrade kenmclennan/tap/recognizer-scan-python "
    "|| brew install kenmclennan/tap/recognizer-scan-python"
)

GRAMMARS = [
    {
        "name": "python",
        "extensions": [".py"],
        "function_types": ["function_definition"],
        "scope_types": ["class_definition"],
        "branch_types": [
            "if_statement",
            "elif_clause",
            "for_statement",
            "while_statement",
            "except_clause",
            "conditional_expression",
            "for_in_clause",
            "if_clause",
            "case_clause",
        ],
        "boolean_operators": ["and", "or"],
        "bound_function_types": [],
        "vocabulary": {
            "comment_markers": ["comment"],
            "literal_types": [
                "string",
                "string_content",
                "integer",
                "float",
                "true",
                "false",
                "none",
            ],
            "call_types": ["call"],
            "identifier_types": ["identifier"],
            "block_types": ["block"],
            "member_fields": [{"type": "attribute", "field": "attribute"}],
            "return_types": ["return_statement"],
            "assignment_types": ["assignment"],
            "positional_assignment_types": ["assignment"],
            "member_types": ["attribute"],
            "subscript_types": ["subscript"],
            "identifier_leaf_types": ["identifier"],
            "self_texts": ["self"],
            "plain_name_types": ["identifier"],
            "expression_statement_types": ["expression_statement"],
            "docstring_string_types": ["string"],
            "name_leaf_types": ["identifier"],
            "operator_node_types": ["boolean_operator"],
            "fields": {
                "name": "name",
                "body": "body",
                "parameters": "parameters",
                "arguments": "arguments",
                "callee": "function",
                "operator": "operator",
                "assigned_value": "right",
            },
            "assignment_operators": ["="],
        },
        "function_names": [],
    }
]

TEST_FILES = [
    {
        "extensions": [],
        "directory_names": ["test", "tests"],
        "directory_suffixes": [],
        "basename_patterns": ["^test_.*\\.py$", "^.*_test\\.py$", "^conftest\\.py$"],
        "stem_suffixes": [],
    },
]


def build() -> dict:
    return {
        "kind": "scanner",
        "name": "python",
        "display": "Python",
        "version": version("recognizer-scan-python"),
        "protocol": PROTOCOL,
        "install": INSTALL,
        "check": False,
        "long_running": True,
        "units": ["files"],
        "settings": [],
        "scan_schema_version": SCAN_SCHEMA_VERSION,
        "setup_survey": {"order": 3},
        "languages": [
            {
                "name": "python",
                "display": "Python",
                "grammars": GRAMMARS,
                "extensions": list(SOURCE_EXTENSIONS),
                "files": [],
                "test_files": TEST_FILES,
                "supertype_links": False,
                "private_imports": True,
                "skip": {
                    "directory_names": list(SKIPPED_DIRECTORY_NAMES),
                    "directory_prefixes": list(SKIPPED_DIRECTORY_PREFIXES),
                    "directory_suffixes": list(SKIPPED_DIRECTORY_SUFFIXES),
                    "directory_markers": list(SKIPPED_DIRECTORY_MARKERS),
                    "file_globs": list(SKIPPED_FILE_PATTERNS),
                },
            }
        ],
    }


def manifest_text() -> str:
    return json.dumps(build(), indent=2) + "\n"
