import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from recognizer_sensors.crap.lcov import parse_lcov
from recognizer_sensors.crap.sensor import measure_file

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "fixtures" / "crap" / "corpus"


def native_ratio(lines: dict[int, int], start: int, end: int) -> float | None:
    inside = [hits for number, hits in lines.items() if start <= number <= end]

    return sum(1 for hits in inside if hits > 0) / len(inside) if inside else None


def sensor_ratios(
    folder: Path, file: str, lcov: Path
) -> dict[tuple[int, int], tuple[str, float | None]]:
    coverage = parse_lcov(lcov.read_text(), folder)
    ratios = {}

    for measured, start in measure_file(file, file, (folder / file).read_bytes(), coverage):
        ratios[(start, measured.end_line)] = (measured.qualified, measured.coverage)

    return ratios


def compare(language: str, file: str, sensor, native_lines: dict[int, int]) -> list[dict]:
    rows = []

    for (start, end), (name, value) in sorted(sensor.items()):
        reference = native_ratio(native_lines, start, end)
        rows.append(
            {
                "language": language,
                "function": name,
                "lines": [start, end],
                "sensor": None if value is None else round(value, 4),
                "native": None if reference is None else round(reference, 4),
            }
        )

    return rows


def run_python(venv: Path, folder: Path) -> list[dict]:
    python = str(venv / "bin" / "python")
    env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": str(folder),
        "COVERAGE_FILE": str(folder / ".coverage"),
    }
    subprocess.run(
        [
            python,
            "-m",
            "coverage",
            "run",
            "--include=python/risk.py",
            "-m",
            "pytest",
            "-q",
            "native/python",
        ],
        cwd=folder,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [python, "-m", "coverage", "lcov", "-o", "python.lcov"],
        cwd=folder,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [python, "-m", "coverage", "json", "-o", "python.json"],
        cwd=folder,
        env=env,
        check=True,
        capture_output=True,
    )
    report = json.loads((folder / "python.json").read_text())["files"]["python/risk.py"]
    lines = {n: 1 for n in report["executed_lines"]} | {n: 0 for n in report["missing_lines"]}

    return compare(
        "python",
        "python/risk.py",
        sensor_ratios(folder, "python/risk.py", folder / "python.lcov"),
        lines,
    )


def run_c8(c8: str, folder: Path) -> list[dict]:
    out = folder / "c8out"
    subprocess.run(
        [
            c8,
            "--include=typescript/risk.ts",
            "--reporter=lcovonly",
            "--reporter=json",
            "--reports-dir",
            str(out),
            "node",
            "--experimental-strip-types",
            "--no-warnings",
            "native/typescript/run.ts",
        ],
        cwd=folder,
        check=True,
        capture_output=True,
    )
    final = json.loads((out / "coverage-final.json").read_text())
    entry = next(iter(final.values()))
    lines: dict[int, int] = {}

    for key, location in entry["statementMap"].items():
        number = location["start"]["line"]
        lines[number] = max(lines.get(number, 0), entry["s"][key])

    return compare(
        "typescript",
        "typescript/risk.ts",
        sensor_ratios(folder, "typescript/risk.ts", out / "lcov.info"),
        lines,
    )


def run_rust(tool: str, folder: Path) -> list[dict]:
    crate = folder / "rust"
    env = {**os.environ, "PATH": f"{Path(tool).parent}:{os.environ['PATH']}"}
    subprocess.run(
        ["cargo", "llvm-cov", "--lcov", "--output-path", "rust.lcov"],
        cwd=crate,
        env=env,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["cargo", "llvm-cov", "--json", "--output-path", "rust.json"],
        cwd=crate,
        env=env,
        check=True,
        capture_output=True,
    )
    data = json.loads((crate / "rust.json").read_text())["data"][0]["files"]
    report = next(f for f in data if f["filename"].endswith("src/risk.rs"))
    lines: dict[int, int] = {}

    for line, _column, count, has_count, _entry, gap in report["segments"]:
        if has_count and not gap:
            lines[line] = max(lines.get(line, 0), count)

    text = (crate / "rust.lcov").read_text().replace(str(crate) + "/", "")
    (crate / "rust.lcov").write_text(text)

    return compare(
        "rust", "src/risk.rs", sensor_ratios(crate, "src/risk.rs", crate / "rust.lcov"), lines
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-venv", type=Path)
    parser.add_argument("--c8")
    parser.add_argument("--cargo-llvm-cov")
    args = parser.parse_args()
    rows = []
    not_run = []

    with tempfile.TemporaryDirectory(prefix="recognizer-validation-") as temporary:
        folder = Path(temporary) / "corpus"
        shutil.copytree(CORPUS, folder, ignore=shutil.ignore_patterns("expected.json"))

        for language, tool, runner, argument in (
            ("python", args.python_venv, run_python, args.python_venv),
            ("typescript", args.c8, run_c8, args.c8),
            ("rust", args.cargo_llvm_cov, run_rust, args.cargo_llvm_cov),
        ):
            if tool is None:
                not_run.append({"language": language, "reason": "tool not installed"})

                continue

            rows += runner(argument, folder)

        not_run.append({"language": "kotlin", "reason": "no JVM or gradle, so no jacoco run"})

    json.dump({"compared": rows, "not_run": not_run}, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
