import hashlib
import json
import subprocess
from pathlib import Path

from recognizer_sensors.unused_exports.entry_points import is_test_file

RECORD_VERSION = 1
VERDICTS = ("killed", "survived", "timeout")
PATHSPEC = ["--", ".", ":!.recognizer"]


def command_hash(command: object) -> str:
    text = json.dumps(command, separators=(",", ":"), sort_keys=True)

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def body_hash(source: bytes) -> str:
    return hashlib.sha256(source).hexdigest()


def read_record(path: Path, command: object) -> dict | None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    if (
        not isinstance(document, dict)
        or document.get("record_version") != RECORD_VERSION
        or not isinstance(document.get("commit"), str)
        or document.get("command") != command_hash(command)
        or not isinstance(document.get("functions"), dict)
    ):
        return None

    skipped = document.get("skipped")

    if not isinstance(skipped, list) or not all(isinstance(item, str) for item in skipped):
        document["skipped"] = []

    return document


def build_record(
    command: object, commit: str, functions: dict[str, dict], skipped: list[str]
) -> dict:
    return {
        "record_version": RECORD_VERSION,
        "command": command_hash(command),
        "commit": commit,
        "functions": functions,
        "skipped": skipped,
    }


def recorded_verdicts(record: dict, identity: str, body: str) -> list[str | None] | None:
    entry = record["functions"].get(identity)

    if not isinstance(entry, dict) or entry.get("body") != body:
        return None

    verdicts = entry.get("verdicts")

    if not isinstance(verdicts, list) or not all(v is None or v in VERDICTS for v in verdicts):
        return None

    return verdicts


def git_paths(repository: Path, args: list[str]) -> list[str] | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repository), *args],
            capture_output=True,
            check=False,
        )
    except OSError:
        return None

    if result.returncode != 0:
        return None

    return [part.decode("utf-8", "replace") for part in result.stdout.split(b"\0") if part]


def stale_test_reason(repository: Path, commit: str) -> str | None:
    short = commit[:12]
    changed = git_paths(
        repository, ["diff", "--relative", "--name-only", "-z", "--no-renames", commit, *PATHSPEC]
    )
    untracked = git_paths(
        repository, ["ls-files", "--others", "--exclude-standard", "-z", *PATHSPEC]
    )

    if changed is None or untracked is None:
        return f"cannot compare with {short}; running every function"

    for path in [*changed, *untracked]:
        if is_test_file(path):
            return f"test files changed since {short} ({path}); running every function"

    return None
