import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from conftest import EXPECTED_SCAN, FIXTURE_ROOT, build_tree, validate

from recognizer_scan_python import scan

CONSOLE_SCRIPT = Path(sys.executable).parent / "recognizer-scan-python"


def expected() -> dict:
    return json.loads(EXPECTED_SCAN.read_text())


def run_cli(*args):
    return subprocess.run([str(CONSOLE_SCRIPT), *args], capture_output=True, text=True)


def test_fixture_matches_expected_scan():
    actual = scan(FIXTURE_ROOT, ["."], None)
    wanted = expected()

    assert actual["scanner"]["name"] == wanted["scanner"]["name"]
    assert actual["scanner"]["version"] == version("recognizer-scan-python")

    wanted["scanner"]["version"] = actual["scanner"]["version"]

    assert actual == wanted
    validate(actual)


def test_cli_end_to_end(tmp_path):
    result = run_cli(str(FIXTURE_ROOT), "--commit", "abc1234")
    document = json.loads(result.stdout)
    wanted = expected()
    wanted["commit"] = "abc1234"
    wanted["scanner"]["version"] = document["scanner"]["version"]

    assert result.returncode == 0
    assert document == wanted
    validate(document)

    output = tmp_path / "scan.json"
    second = run_cli(str(FIXTURE_ROOT), "--commit", "abc1234", "--output", str(output))

    assert second.returncode == 0
    assert second.stdout == ""
    assert output.read_text() == result.stdout
    assert run_cli(str(FIXTURE_ROOT), "--commit", "abc1234").stdout == result.stdout
    assert result.stdout.endswith("}\n")


def test_commit_is_null_outside_a_work_tree(tmp_path):
    build_tree(tmp_path, {"a.py": ""})

    assert json.loads(run_cli(str(tmp_path)).stdout)["commit"] is None


def test_commit_is_head_sha_of_a_git_repository(tmp_path):
    build_tree(tmp_path, {"a.py": ""})
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-C", str(tmp_path)]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "a.py"], check=True)
    subprocess.run([*git, "commit", "-q", "-m", "x"], check=True)
    sha = subprocess.run(
        [*git, "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()

    assert json.loads(run_cli(str(tmp_path)).stdout)["commit"] == sha


def test_syntax_errors_exit_2_and_name_every_file(tmp_path):
    build_tree(tmp_path, {"ok.py": "x = 1\n", "bad1.py": "x = 1\ndef (:\n", "bad2.py": "class\n"})
    output = tmp_path.parent / f"{tmp_path.name}-out.json"
    result = run_cli(str(tmp_path), "--output", str(output))

    assert result.returncode == 2
    assert result.stdout == ""
    assert not output.exists()
    assert "bad1.py:2" in result.stderr
    assert "bad2.py:1" in result.stderr


def test_nonexistent_root_exits_2(tmp_path):
    result = run_cli(str(tmp_path / "missing"))

    assert result.returncode == 2
    assert result.stdout == ""


def test_source_root_that_is_not_a_directory_exits_2(tmp_path):
    assert run_cli(str(tmp_path), "--source-root", "nope").returncode == 2


def test_real_content_own_source():
    source = Path(__file__).parents[1] / "src"
    result = run_cli(str(source), "--source-root", ".")
    document = json.loads(result.stdout)
    files = list(source.rglob("*.py"))

    assert result.returncode == 0
    validate(document)
    assert len(document["modules"]) == len(files)
    assert all(m["id"].startswith("recognizer_scan_python/") for m in document["modules"])
