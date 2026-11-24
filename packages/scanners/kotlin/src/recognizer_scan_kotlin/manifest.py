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

PROTOCOL = 1

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
    }
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
