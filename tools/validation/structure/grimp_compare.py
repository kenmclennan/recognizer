import argparse
import json
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

import grimp


def scanner_edges(
    scanner: str, repository: Path, source_root: str, package: str
) -> set[tuple[str, str]]:
    with tempfile.TemporaryDirectory(prefix="recognizer-grimp-") as temporary:
        output = Path(temporary) / "scan.json"
        command = [*shlex.split(scanner), str(repository), "--output", str(output)]

        if source_root:
            command += ["--source-root", source_root]

        subprocess.run(command, check=True, capture_output=True)
        scan = json.loads(output.read_text())

    prefix = f"{source_root}/" if source_root else ""
    inside = {
        m["id"]
        for m in scan["modules"]
        if m["id"].startswith(prefix + package + "/") or m["id"] == prefix + package + ".py"
    }

    return {
        (e["from"], e["to"])
        for e in scan["edges"]
        if "inferred" not in e
        and e["from"] in inside
        and e["to"] in inside
        and e["from"] != e["to"]
    }


def module_path(repository: Path, source_root: str, module: str) -> str | None:
    base = repository / source_root if source_root else repository
    parts = module.split(".")
    for candidate in (
        base.joinpath(*parts).with_suffix(".py"),
        base.joinpath(*parts, "__init__.py"),
    ):
        if candidate.is_file():
            return candidate.relative_to(repository).as_posix()

    return None


def grimp_edges(repository: Path, source_root: str, package: str) -> set[tuple[str, str]]:
    sys.path.insert(0, str(repository / source_root if source_root else repository))
    graph = grimp.build_graph(package, include_external_packages=False)
    edges = set()

    for module in graph.modules:
        source = module_path(repository, source_root, module)

        for imported in graph.find_modules_directly_imported_by(module):
            target = module_path(repository, source_root, imported)

            if source and target and source != target:
                edges.add((source, target))

    return edges


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--source-root", default="")
    parser.add_argument("--scanner", required=True)
    args = parser.parse_args()
    repository = args.repository.resolve()
    scanned = scanner_edges(args.scanner, repository, args.source_root, args.package)
    imported = grimp_edges(repository, args.source_root, args.package)
    json.dump(
        {
            "scanner_edges": len(scanned),
            "grimp_edges": len(imported),
            "intersection": len(scanned & imported),
            "only_scanner": sorted(scanned - imported),
            "only_grimp": sorted(imported - scanned),
        },
        sys.stdout,
        indent=1,
    )


if __name__ == "__main__":
    main()
