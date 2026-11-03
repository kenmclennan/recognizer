import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from common import bucket, copy_repository, emit, functions_with_sites, sensor_run, token_edit

NODE = ["node", "--experimental-strip-types", "--no-warnings"]


def stryker_mutants(
    stryker: str, repository: Path, source: str, test: str, work: Path
) -> list[dict]:
    root = work / "stryker"
    copy_repository(repository, root)
    (root / "package.json").write_text('{"name":"validation","type":"module","private":true}')
    (root / "stryker.config.json").write_text(
        json.dumps(
            {
                "mutate": [source],
                "testRunner": "command",
                "commandRunner": {"command": " ".join([*NODE, test])},
                "reporters": ["json"],
                "jsonReporter": {"fileName": "report.json"},
                "coverageAnalysis": "off",
                "disableTypeChecks": "**/*.ts",
                "concurrency": 2,
            }
        )
    )
    subprocess.run([stryker, "run"], cwd=root, capture_output=True, check=True)
    report = json.loads((root / "report.json").read_text())
    text = (root / source).read_text().splitlines()
    mutants = []

    for entry in report["files"].values():
        for mutant in entry["mutants"]:
            start, end = mutant["location"]["start"], mutant["location"]["end"]
            original = (
                text[start["line"] - 1][start["column"] - 1 :]
                if start["line"] == end["line"]
                else ""
            )
            original = (
                text[start["line"] - 1][start["column"] - 1 : end["column"] - 1]
                if start["line"] == end["line"]
                else original
            )
            mutants.append(
                {
                    "mutator": mutant["mutatorName"],
                    "line": start["line"],
                    "original": original,
                    "replacement": mutant["replacement"],
                    "status": mutant["status"],
                }
            )

    return mutants


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--test", required=True)
    parser.add_argument("--stryker", required=True)
    parser.add_argument("--c8", required=True)
    args = parser.parse_args()
    repository = args.repository.resolve()

    with tempfile.TemporaryDirectory(prefix="recognizer-mutation-") as temporary:
        work = Path(temporary)
        sites = functions_with_sites(repository, args.source)
        compared = []

        for mutant in stryker_mutants(args.stryker, repository, args.source, args.test, work):
            edit = token_edit(mutant["original"], mutant["replacement"])
            owner = next((s["function"] for s in sites if s["line"] == mutant["line"]), None)
            compared.append(
                mutant
                | {"function": owner, "edit": edit, "bucket": bucket(edit, mutant["line"], sites)}
            )

        probe = work / "coverage-probe"
        copy_repository(args.repository, probe)
        subprocess.run(
            [
                args.c8,
                "--include",
                args.source,
                "--reporter=lcovonly",
                "--reports-dir",
                "cov",
                *NODE,
                args.test,
            ],
            cwd=probe,
            capture_output=True,
            check=True,
        )
        sensor = sensor_run(
            repository,
            args.source,
            "typescript",
            [*NODE, args.test],
            (probe / "cov" / "lcov.info").read_text(),
            work,
        )

        emit(
            {
                "sites": sites,
                "reference": compared,
                "sensor": sensor["survivors"]["functions"],
                "overlay": sensor["overlay"]["values"],
            }
        )


if __name__ == "__main__":
    main()
