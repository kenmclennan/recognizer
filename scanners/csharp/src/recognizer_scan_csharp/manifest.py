import json
from importlib.metadata import version

from recognizer_scan_csharp.discovery import (
    MARKUP_EXTENSIONS,
    SKIPPED_DIRECTORY_NAMES,
    SKIPPED_DIRECTORY_PREFIXES,
    SKIPPED_FILE_PATTERNS,
    SOURCE_EXTENSIONS,
)

PROTOCOL = 1

INSTALL = (
    "brew upgrade kenmclennan/tap/recognizer-scan-csharp "
    "|| brew install kenmclennan/tap/recognizer-scan-csharp"
)


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
        "languages": [
            {
                "name": "csharp",
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
