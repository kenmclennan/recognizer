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

PROTOCOL = 1

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
    }
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
