import argparse
import subprocess
import sys
from pathlib import Path

from recognizer_scan_python.scanner import ScanError, scan
from recognizer_scan_python.serialise import render


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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="recognizer-scan-python")
    parser.add_argument("root", type=Path)
    parser.add_argument("--source-root", action="append", default=None, metavar="DIR")
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root: Path = args.root
    source_roots = args.source_root or ["."]

    if not root.is_dir():
        print(f"ROOT is not a directory: {root}", file=sys.stderr)
        return 2

    missing = [s for s in source_roots if not (root / s).is_dir()]

    if missing:
        print(f"--source-root is not a directory under ROOT: {', '.join(missing)}", file=sys.stderr)
        return 2

    commit = args.commit if args.commit else resolve_commit(root)

    try:
        document = scan(root, [Path(s).as_posix() for s in source_roots], commit)
    except ScanError as error:
        print("could not parse:", file=sys.stderr)
        print("\n".join(error.problems), file=sys.stderr)
        return 2

    text = render(document)

    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)

    return 0
