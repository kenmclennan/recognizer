import argparse
import json
import subprocess
import sys
from pathlib import Path

from recognizer_sensors.crap.sensor import measure_file
from recognizer_sensors.parsing import grammar_for

ROOT = Path(__file__).resolve().parents[2]
SKIP = {".git", "node_modules", ".recognizer", "target", ".venv", "__pycache__", "build", "dist"}


def source_files(
    repository: Path, suffixes: tuple[str, ...], prefixes: tuple[str, ...]
) -> list[str]:
    found = []

    for path in sorted(repository.rglob("*")):
        relative = path.relative_to(repository)

        if not path.is_file() or path.suffix not in suffixes or SKIP & set(relative.parts):
            continue

        if prefixes and not relative.as_posix().startswith(prefixes):
            continue

        found.append(relative.as_posix())

    return found


def sensor_values(repository: Path, files: list[str]) -> dict[tuple[str, int], dict]:
    values = {}

    for file in files:
        if grammar_for(file) is None:
            continue

        for measured, start in measure_file(file, file, (repository / file).read_bytes(), None):
            values[(file, start)] = {"name": measured.qualified, "sensor": measured.complexity}

    return values


def radon_values(binary: str, repository: Path, files: list[str]) -> dict[tuple[str, int], int]:
    if not files:
        return {}

    result = subprocess.run(
        [binary, "cc", "-j", *files], cwd=repository, capture_output=True, text=True, check=True
    )
    values = {}

    for file, blocks in json.loads(result.stdout).items():
        for block in blocks:
            if block["type"] in ("function", "method"):
                values[(file, block["lineno"])] = block["complexity"]

            for inner in block.get("closures", []):
                values[(file, inner["lineno"])] = inner["complexity"]

    return values


ESLINT_CONFIG = """import tseslint from "typescript-eslint";
export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: { complexity: ["error", { max: 0 }] },
  },
];
"""


def eslint_values(binary: str, repository: Path, files: list[str]) -> dict[tuple[str, int], int]:
    if not files:
        return {}

    home = Path(binary).absolute().parent.parent.parent
    config = home / "eslint.complexity.config.mjs"
    config.write_text(ESLINT_CONFIG)
    result = subprocess.run(
        [binary, "--config", str(config), "-f", "json", *files],
        cwd=repository,
        capture_output=True,
        text=True,
        check=False,
    )
    if not result.stdout.startswith("["):
        raise SystemExit(result.stderr)

    values = {}

    for entry in json.loads(result.stdout):
        file = Path(entry["filePath"]).relative_to(repository).as_posix()

        for message in entry["messages"]:
            if message["ruleId"] == "complexity":
                text = message["message"]
                values[(file, message["line"])] = int(text.split("complexity of ")[1].split(".")[0])

    return values


def rca_values(binary: str, repository: Path, files: list[str]) -> dict[tuple[str, int], int]:
    values = {}

    for file in files:
        result = subprocess.run(
            [binary, "-m", "-O", "json", "-p", str(repository / file)],
            capture_output=True,
            text=True,
            check=False,
        )

        for line in result.stdout.splitlines():
            if not line.strip():
                continue

            walk(json.loads(line), file, values)

    return values


def walk(space: dict, file: str, values: dict) -> None:
    if space.get("kind") == "function":
        values[(file, space["start_line"])] = int(space["metrics"]["cyclomatic"]["sum"])

    for inner in space.get("spaces", []):
        walk(inner, file, values)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=ROOT)
    parser.add_argument("--prefix", action="append", default=[])
    parser.add_argument("--radon")
    parser.add_argument("--eslint")
    parser.add_argument("--rca")
    args = parser.parse_args()
    repository = args.repository.resolve()
    prefixes = tuple(args.prefix)
    languages = {
        "python": ((".py",), args.radon, radon_values),
        "typescript": ((".ts",), args.eslint, eslint_values),
        "rust": ((".rs",), args.rca, rca_values),
        "kotlin": ((".kt",), None, None),
    }
    records = []
    not_run = []

    for language, (suffixes, binary, reader) in languages.items():
        files = source_files(repository, suffixes, prefixes)
        sensor = sensor_values(repository, files)

        if reader is None or binary is None:
            not_run.append(
                {
                    "language": language,
                    "functions": len(sensor),
                    "reason": "no reference tool available",
                }
            )

            continue

        reference = reader(binary, repository, files)

        for key in sorted(set(sensor) | set(reference)):
            records.append(
                {
                    "language": language,
                    "file": key[0],
                    "line": key[1],
                    "name": sensor.get(key, {}).get("name"),
                    "sensor": sensor.get(key, {}).get("sensor"),
                    "reference": reference.get(key),
                }
            )

    json.dump({"compared": records, "not_run": not_run}, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
