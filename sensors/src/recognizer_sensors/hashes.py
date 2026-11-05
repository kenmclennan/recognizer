import hashlib
import subprocess
from collections.abc import Iterable, Mapping
from pathlib import Path

from recognizer_sensors.mutation.test_files import is_test_entry, is_test_file
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


def test_hashes(repository: Path, scans: Iterable[Scan]) -> dict[str, str]:
    known = scan_hashes(scans)
    hashes: dict[str, str] = {}

    for path in sorted({p for p in listed_files(repository) if is_test_file(p)}):
        digest = known.get(path) or file_sha256(repository / path)

        if digest is not None:
            hashes[path] = digest

    return hashes


def digest_of(hashes: Mapping[str, str]) -> str:
    lines = [f"{path}\t{hashes[path]}\n" for path in sorted(hashes)]

    return hashlib.sha256("".join(lines).encode("utf-8", errors="surrogateescape")).hexdigest()


def support_hash(hashes: Mapping[str, str]) -> str:
    return digest_of(
        {
            path: digest
            for path, digest in hashes.items()
            if not is_test_entry(path) and path.split("/")[-1] != "conftest.py"
        }
    )


def tests_hash(repository: Path, scans: Iterable[Scan]) -> str:
    return digest_of(test_hashes(repository, scans))


def inputs_map(modules: Iterable[str], hashes: Mapping[str, str]) -> dict[str, str]:
    return {module: hashes[module] for module in sorted(set(modules)) if module in hashes}
