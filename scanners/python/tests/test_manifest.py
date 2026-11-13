import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

from recognizer_scan_python.cli import main
from recognizer_scan_python.manifest import PROTOCOL, build

REPOSITORY = Path(__file__).resolve().parents[3]
LAUNCH = "import sys; from recognizer_scan_python.cli import main; sys.exit(main())"


def schema_validator() -> Draft202012Validator:
    schema = json.loads((REPOSITORY / "schema" / "manifest.schema.json").read_text())

    return Draft202012Validator(schema)


def run_manifest(cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", LAUNCH, "manifest"],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def test_protocol_equals_the_shared_protocol_file():
    shared = json.loads((REPOSITORY / "schema" / "protocol.json").read_text())

    assert shared == {"protocol": PROTOCOL}


def test_manifest_verb_prints_a_valid_manifest_and_nothing_else(tmp_path):
    result = run_manifest(tmp_path)

    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout.endswith("\n")
    assert not result.stdout.endswith("\n\n")
    schema_validator().validate(json.loads(result.stdout))


def test_manifest_is_the_same_from_another_working_directory(tmp_path):
    other = tmp_path / "elsewhere"
    other.mkdir()

    assert run_manifest(tmp_path).stdout == run_manifest(other).stdout
    assert list(other.iterdir()) == []


def test_manifest_in_process_returns_zero_and_writes_the_document(capsys):
    assert main(["manifest"]) == 0
    assert json.loads(capsys.readouterr().out) == json.loads(json.dumps(build()))


def test_languages_equal_the_shared_table():
    table = json.loads((REPOSITORY / "fixtures" / "plugins" / "languages.json").read_text())
    expected = [entry for entry in table if entry["name"] == "python"]

    assert build()["languages"] == expected
