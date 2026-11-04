import argparse
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from recognizer_scan_csharp.scanner import scan_with_stats
from recognizer_scan_csharp.serialise import render


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
    parser = argparse.ArgumentParser(prog="recognizer-scan-csharp")
    parser.add_argument("root", type=Path)
    parser.add_argument("--commit")
    parser.add_argument("--modified", type=parse_modified)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--version", action="version", version=version("recognizer-scan-csharp"))

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
            f"recognizer-scan-csharp: {result.damaged} of {result.total} files had damaged spans",
            file=sys.stderr,
        )

    left_out = result.left_out

    if any(left_out.values()):
        fs, vb = left_out[".fs"], left_out[".vb"]
        print(f"recognizer-scan-csharp: left out {fs} .fs and {vb} .vb files", file=sys.stderr)

    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    return 0
