import argparse
import os
import subprocess
import sys
import tempfile
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_kotlin.events import Progress
from recognizer_scan_kotlin.manifest import manifest_text
from recognizer_scan_kotlin.scanner import scan_with_stats
from recognizer_scan_kotlin.serialise import render


def resolve_commit(root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None

    sha = result.stdout.strip()

    return sha if result.returncode == 0 and sha else None


def resolve_modified(root: Path) -> bool | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain", "--", ".", ":!.recognizer"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None

    if result.returncode != 0:
        return None

    return result.stdout.strip() != ""


def parse_modified(value: str) -> bool:
    if value not in ("true", "false"):
        raise argparse.ArgumentTypeError("must be true or false")

    return value == "true"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="recognizer-scan-kotlin")
    parser.add_argument("root", type=Path)
    parser.add_argument("--commit")
    parser.add_argument("--modified", type=parse_modified)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--version", action="version", version=version("recognizer-scan-kotlin"))

    return parser


PROG = "recognizer-scan-kotlin"

VERBS_TEXT = "manifest, check, run, guide"


def write_atomically(text: str, output: Path) -> None:
    handle, temporary = tempfile.mkstemp(dir=output.parent, prefix=f".{output.name}.")

    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)

        os.replace(temporary, output)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)

        raise


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv

    if arguments in (["--version"], ["--help"], ["-h"]):
        build_parser().parse_args(arguments)

    verb, rest = (arguments[0], arguments[1:]) if arguments else (None, [])

    if verb == "manifest" and not rest:
        sys.stdout.write(manifest_text())

        return 0

    if verb == "guide" and not rest:
        return 0

    if verb == "check":
        print(f"{PROG}: no check verb; the verbs are {VERBS_TEXT}", file=sys.stderr)

        return 2

    if verb != "run":
        print(f"{PROG}: the first argument must be a verb: {VERBS_TEXT}", file=sys.stderr)

        return 2

    args = build_parser().parse_args(rest)
    root: Path = args.root

    if not root.is_dir():
        print(f"ROOT is not a directory: {root}", file=sys.stderr)
        return 2

    commit = args.commit if args.commit else resolve_commit(root)

    modified = args.modified if args.modified is not None else resolve_modified(root)

    result = scan_with_stats(root, commit, modified, Progress())
    text = render(result.document)

    if result.damaged:
        print(
            f"recognizer-scan-kotlin: {result.damaged} of {result.total} files had damaged spans",
            file=sys.stderr,
        )

    if args.output:
        write_atomically(text, args.output)
    else:
        sys.stdout.write(text)

    return 0
