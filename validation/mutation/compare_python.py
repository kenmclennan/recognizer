import argparse
import re
import subprocess
import tempfile
from pathlib import Path

from common import bucket, copy_repository, emit, functions_with_sites, sensor_run, token_edit


def mutmut_mutants(
    venv: Path, repository: Path, source: str, pytest_file: str, work: Path
) -> list[dict]:
    root = work / "mutmut"
    copy_repository(repository, root)
    (root / "setup.cfg").write_text(
        f"[mutmut]\nsource_paths={source}\npytest_add_cli_args_test_selection={pytest_file}\n"
    )
    env = {"PATH": f"{venv}/bin:/usr/bin:/bin", "HOME": str(work)}
    subprocess.run(["mutmut", "run"], cwd=root, env=env, capture_output=True, check=False)
    results = subprocess.run(
        ["mutmut", "results", "--all", "true"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    mutants = []

    for match in re.finditer(r"^\s+(\S+): (.+)$", results, re.M):
        name, status = match.groups()
        shown = subprocess.run(
            ["mutmut", "show", name], cwd=root, env=env, capture_output=True, text=True, check=True
        ).stdout
        mutants.append({"name": name, "status": status, "diff": shown})

    return mutants


def parse_diff(diff: str) -> tuple[int, str, str] | None:
    lines = diff.splitlines()
    body = [line for line in lines if not line.startswith(("#", "---", "+++"))]
    header = next((line for line in body if line.startswith("@@")), None)

    if header is None:
        return None

    index = 0
    old = new = None

    for line in body[body.index(header) + 1 :]:
        if line.startswith("-"):
            old = (index, line[1:])
        elif line.startswith("+"):
            new = (index, line[1:])
        index += 1 if not line.startswith("+") else 0

    if old is None or new is None:
        return None

    return old[0], old[1], new[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--pytest", required=True)
    parser.add_argument("--venv", type=Path, required=True)
    args = parser.parse_args()
    repository = args.repository.resolve()

    with tempfile.TemporaryDirectory(prefix="recognizer-mutation-") as temporary:
        work = Path(temporary)
        sites = functions_with_sites(repository, args.source)
        starts = {}
        for site in sites:
            starts[site["function"]] = site["function_start"]
        mutants = mutmut_mutants(args.venv, repository, args.source, args.pytest, work)
        compared = []

        for mutant in mutants:
            function = re.search(r"\.x_(\w+?)__mutmut_\d+$", mutant["name"]) or re.search(
                r"\.xǁ(\w+)ǁ(\w+)__mutmut_\d+$", mutant["name"]
            )
            name = (
                function.group(1)
                if function and function.lastindex == 1
                else ".".join(function.groups())
                if function
                else "?"
            )
            parsed = parse_diff(mutant["diff"])
            record = {"mutant": mutant["name"], "function": name, "status": mutant["status"]}

            if parsed is not None and name in starts:
                relative, old, new = parsed
                line = starts[name] + relative
                edit = token_edit(old, new)
                record |= {"line": line, "edit": edit, "bucket": bucket(edit, line, sites)}

            compared.append(record)

        coverage = work / "lcov.info"
        env = {"PATH": f"{args.venv}/bin:/usr/bin:/bin"}
        probe = work / "coverage-probe"
        copy_repository(repository, probe)
        subprocess.run(
            [
                "python",
                "-m",
                "coverage",
                "run",
                "--include",
                args.source,
                "-m",
                "pytest",
                "-q",
                args.pytest,
            ],
            cwd=probe,
            env=env,
            capture_output=True,
            check=False,
        )
        subprocess.run(
            ["python", "-m", "coverage", "lcov", "-o", str(coverage)],
            cwd=probe,
            env=env,
            capture_output=True,
            check=True,
        )
        sensor = sensor_run(
            repository,
            args.source,
            "python",
            [str(args.venv / "bin" / "python"), "-m", "pytest", "-x", "-q", args.pytest],
            coverage.read_text(),
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
