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

PROTOCOL = 1

INSTALL = (
    "brew upgrade kenmclennan/tap/recognizer-scan-python "
    "|| brew install kenmclennan/tap/recognizer-scan-python"
)


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
        "languages": [
            {
                "name": "python",
                "extensions": list(SOURCE_EXTENSIONS),
                "files": [],
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
