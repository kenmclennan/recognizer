import hashlib
import json
import subprocess
from collections.abc import Collection, Iterable, Mapping
from pathlib import Path

from recognizer_sensors.mutation.test_files import is_test_entry, is_test_file
from recognizer_sensors.rust_test_blocks import in_file_test_hashes
from recognizer_sensors.scans import Scan


def file_sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def listed_files(repository: Path) -> list[str]:
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(repository),
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                ".",
                ":!.recognizer",
            ],
            capture_output=True,
            check=False,
        )
    except OSError:
        return []

    if result.returncode != 0:
        return []

    return [
        path.decode("utf-8", errors="surrogateescape")
        for path in result.stdout.split(b"\0")
        if path
    ]


def scan_hashes(scans: Iterable[Scan]) -> dict[str, str]:
    hashes: dict[str, str] = {}

    for scan in scans:
        hashes.update(scan.hashes)

    return hashes


def rust_test_entries(repository: Path, listed: Collection[str] | None = None) -> set[str]:
    paths = listed_files(repository) if listed is None else listed

    if not any(path.split("/")[-1] == "Cargo.toml" for path in paths):
        return set()

    try:
        result = subprocess.run(
            ["cargo", "metadata", "--no-deps", "--format-version", "1"],
            cwd=repository,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return set()

    if result.returncode != 0:
        return set()

    root = repository.resolve()
    entries: set[str] = set()

    try:
        for package in json.loads(result.stdout)["packages"]:
            for target in package["targets"]:
                if "test" not in target["kind"]:
                    continue

                try:
                    entries.add(Path(target["src_path"]).resolve().relative_to(root).as_posix())
                except ValueError:
                    continue
    except (ValueError, KeyError, TypeError, AttributeError):
        return set()

    return entries


def test_hashes(
    repository: Path, scans: Iterable[Scan], entries: Collection[str] | None = None
) -> dict[str, str]:
    known = scan_hashes(scans)
    hashes: dict[str, str] = {}
    listed = listed_files(repository)
    rust = rust_test_entries(repository, listed) if entries is None else entries

    for path in sorted({p for p in listed if is_test_file(p) or p in rust}):
        digest = known.get(path) or file_sha256(repository / path)

        if digest is not None:
            hashes[path] = digest

    return hashes


def digest_of(hashes: Mapping[str, str]) -> str:
    lines = [f"{path}\t{hashes[path]}\n" for path in sorted(hashes)]

    return hashlib.sha256("".join(lines).encode("utf-8", errors="surrogateescape")).hexdigest()


def support_hash(hashes: Mapping[str, str], entries: Collection[str] = frozenset()) -> str:
    return digest_of(
        {
            path: digest
            for path, digest in hashes.items()
            if not is_test_entry(path)
            and path not in entries
            and path.split("/")[-1] != "conftest.py"
        }
    )


def tests_hash(repository: Path, scans: Iterable[Scan]) -> str:
    return digest_of(
        {
            **test_hashes(repository, scans),
            **in_file_test_hashes(repository, listed_files(repository)),
        }
    )


def inputs_map(modules: Iterable[str], hashes: Mapping[str, str]) -> dict[str, str]:
    return {module: hashes[module] for module in sorted(set(modules)) if module in hashes}
