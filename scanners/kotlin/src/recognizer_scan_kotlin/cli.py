import argparse
import subprocess
import sys
from pathlib import Path

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

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root: Path = args.root

    if not root.is_dir():
        print(f"ROOT is not a directory: {root}", file=sys.stderr)
        return 2

    commit = args.commit if args.commit else resolve_commit(root)

    modified = args.modified if args.modified is not None else resolve_modified(root)

    result = scan_with_stats(root, commit, modified)
    text = render(result.document)

    if result.damaged:
        print(
            f"recognizer-scan-kotlin: {result.damaged} of {result.total} files had damaged spans",
            file=sys.stderr,
        )

    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    return 0
