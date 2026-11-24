import json
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from recognizer_scan_python.survey import survey

REPOSITORY = Path(__file__).resolve().parents[4]
LAUNCH = "import sys; from recognizer_scan_python.cli import main; sys.exit(main())"
CACHE = "{up}.recognizer/cache/python/{slug}"
REQUIREMENTS = {"tools/x/requirements-dev.txt": "pytest\n"}

VALIDATOR = Draft202012Validator(
    json.loads((REPOSITORY / "schema" / "survey-answer.schema.json").read_text())
)


def tree(root: Path, files: dict[str, str]) -> Path:
    for name, text in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    return root


def files_under(root: Path) -> list[str]:
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())


def answer_of(root: Path, uv: bool, python3: bool, suites: list[dict] | None = None) -> dict:
    available = {"uv": uv, "python3": python3}
    request = {"root": str(root), "files": files_under(root), "suites": suites or []}
    answer = survey(request, probe=lambda command: available[command])

    VALIDATOR.validate(answer)

    return answer


def test_a_python_runner_with_a_requirements_file_and_no_venv_builds_an_environment_with_uv(
    tmp_path,
):
    answer = answer_of(tree(tmp_path, REQUIREMENTS), uv=True, python3=True)
    runner = answer["runners"][0]
    tool = answer["tools"][0]

    assert len(answer["runners"]) == 1
    assert "settings" not in runner
    assert runner["directory"] == "tools/x"
    assert runner["from"] == "tools/x/requirements-dev.txt"
    assert runner["command"] == (
        "pytest --cov --cov-report=lcov:{up}.recognizer/cache/coverage/{slug}/lcov.info"
    )
    assert runner["coverage"]["path"] == ".recognizer/cache/coverage/{slug}/lcov.info"
    assert runner["activate"] == f"source {CACHE}/bin/activate"
    assert len(answer["tools"]) == 1
    assert tool["installed"] is False
    assert tool["needed_by"] == ["tools/x/requirements-dev.txt"]
    assert tool["prepare"] == [["uv", "venv", CACHE]]
    assert tool["command"] == [
        "uv",
        "pip",
        "install",
        "--python",
        f"{CACHE}/bin/python",
        "-r",
        "requirements-dev.txt",
        "pytest-cov",
    ]
    assert "undo" not in tool

    for argv in [*tool["prepare"], tool["command"]]:
        assert not argv[0].startswith("python")


def test_a_python_runner_with_a_requirements_file_and_no_venv_or_uv_builds_an_environment_with_python3(
    tmp_path,
):
    tool = answer_of(tree(tmp_path, REQUIREMENTS), uv=False, python3=True)["tools"][0]

    assert tool["prepare"] == [["python3", "-m", "venv", CACHE]]
    assert tool["command"][:4] == [f"{CACHE}/bin/python", "-m", "pip", "install"]

    argvs = [*tool["prepare"], tool["command"]]

    assert len([argv for argv in argvs if argv[0] == "python3"]) == 1


def test_a_python_runner_with_no_venv_uv_or_python3_is_left_out_and_noted(tmp_path):
    answer = answer_of(tree(tmp_path / "a", REQUIREMENTS), uv=False, python3=False)

    assert answer["runners"] == []
    assert answer["tools"] == []
    assert len(answer["notes"]) == 1
    assert answer["notes"][0]["directory"] == "tools/x"
    assert "no Python environment" in answer["notes"][0]["text"]

    mixed = answer_of(
        tree(
            tmp_path / "b",
            {
                **REQUIREMENTS,
                "svc/pyproject.toml": "[tool.pytest]\n",
                "svc/.venv/bin/python": "",
            },
        ),
        uv=False,
        python3=False,
    )

    assert [one["directory"] for one in mixed["runners"]] == ["svc"]
    assert len(mixed["notes"]) == 1


def test_a_python_runner_with_a_project_venv_installs_into_it_and_activates_it(tmp_path):
    directory = tree(tmp_path / "a", {**REQUIREMENTS, "tools/x/.venv/bin/python": ""})
    with_uv = answer_of(directory, uv=True, python3=True)

    assert with_uv["runners"][0]["activate"] == "source .venv/bin/activate"
    assert "prepare" not in with_uv["tools"][0]
    assert with_uv["tools"][0]["command"] == [
        "uv",
        "pip",
        "install",
        "--python",
        ".venv/bin/python",
        "pytest-cov",
    ]

    without = answer_of(directory, uv=False, python3=False)

    assert without["tools"][0]["command"] == [
        ".venv/bin/python",
        "-m",
        "pip",
        "install",
        "pytest-cov",
    ]

    root = answer_of(
        tree(
            tmp_path / "b",
            {"services/api/requirements.txt": "pytest\n", ".venv/bin/python": ""},
        ),
        uv=True,
        python3=True,
    )

    assert root["runners"][0]["activate"] == "source ../../.venv/bin/activate"


def test_a_requirements_file_listing_pytest_cov_makes_the_tool_installed(tmp_path):
    files = {"tools/x/requirements-dev.txt": "pytest\npytest-cov\n"}
    with_venv = answer_of(
        tree(tmp_path / "a", {**files, "tools/x/.venv/bin/python": ""}), uv=True, python3=True
    )

    assert len(with_venv["tools"]) == 1
    assert with_venv["tools"][0]["installed"] is True

    without = answer_of(tree(tmp_path / "b", files), uv=True, python3=True)

    assert len(without["tools"]) == 1
    assert without["tools"][0]["installed"] is False


def test_a_pyproject_only_python_runner_without_a_venv_notes_that_its_dependencies_are_not_installed(
    tmp_path,
):
    answer = answer_of(
        tree(tmp_path, {"tools/x/pyproject.toml": "pytest\n"}), uv=True, python3=True
    )

    assert answer["tools"][0]["command"] == [
        "uv",
        "pip",
        "install",
        "--python",
        f"{CACHE}/bin/python",
        "pytest-cov",
    ]
    assert any("dependencies are not installed" in note["text"] for note in answer["notes"])


def test_a_configured_suite_hides_the_runner_and_its_tool_but_not_the_note(tmp_path):
    suites = [{"language": "python", "directory": "tools/x"}]
    covered = answer_of(tree(tmp_path / "a", REQUIREMENTS), uv=True, python3=True, suites=suites)

    assert covered["runners"] == []
    assert covered["tools"] == []

    noted = answer_of(tree(tmp_path / "b", REQUIREMENTS), uv=False, python3=False, suites=suites)

    assert len(noted["notes"]) == 1


def test_the_survey_verb_answers_a_request_file_and_exits_zero(tmp_path):
    root = tree(tmp_path / "repo", REQUIREMENTS)
    request = tmp_path / "request.json"

    request.write_text(json.dumps({"root": str(root), "files": files_under(root), "suites": []}))

    result = subprocess.run(
        [sys.executable, "-c", LAUNCH, "survey", str(request)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""

    answer = json.loads(result.stdout)

    VALIDATOR.validate(answer)

    assert [one["directory"] for one in answer["runners"]] == ["tools/x"] or [
        note["directory"] for note in answer["notes"]
    ] == ["tools/x"]


def test_the_survey_verb_exits_two_for_a_request_file_that_is_not_there(tmp_path):
    result = subprocess.run(
        [sys.executable, "-c", LAUNCH, "survey", str(tmp_path / "missing.json")],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2


def test_over_this_repository_every_answered_runner_carries_activate():
    root = REPOSITORY
    request = {"root": str(root), "files": git_files(root), "suites": []}
    answer = survey(request, probe=lambda command: True)

    VALIDATOR.validate(answer)

    assert answer["runners"]
    assert all("activate" in one for one in answer["runners"])


@pytest.mark.parametrize("name", ["valid"])
def test_the_answer_examples_validate(name):
    for path in sorted((REPOSITORY / "schema" / "survey-answer-examples" / name).glob("*.json")):
        VALIDATOR.validate(json.loads(path.read_text()))


def git_files(root: Path) -> list[str]:
    listing = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout

    return sorted(
        path
        for path in listing.split("\0")
        if path
        and (root / path).exists()
        and not {"node_modules", "target", ".git"} & set(path.split("/"))
    )
