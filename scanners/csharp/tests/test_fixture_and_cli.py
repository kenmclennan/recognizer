import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from conftest import EXPECTED_SCAN, FIXTURE_ROOT, REPOSITORY, build_tree, module_ids, validate

from recognizer_scan_csharp import scan, scan_with_stats
from recognizer_scan_csharp.discovery import selection

CONSOLE_SCRIPT = Path(sys.executable).parent / "recognizer-scan-csharp"
TEST_PROJECTS = [
    "tests/Shop.Checks.Flag",
    "tests/Shop.Checks.MSTest",
    "tests/Shop.Checks.Mvc",
    "tests/Shop.Checks.Sdk",
    "tests/Shop.Checks.UnitTests",
    "tests/Shop.Checks.Xunit",
]


def expected() -> dict:
    return json.loads(EXPECTED_SCAN.read_text())


def run_cli(*args):
    return subprocess.run([str(CONSOLE_SCRIPT), *args], capture_output=True, text=True)


def test_fixture_matches_expected_scan():
    actual = scan(FIXTURE_ROOT, None)
    wanted = expected()

    assert actual["scanner"]["name"] == wanted["scanner"]["name"]
    assert actual["scanner"]["version"] == version("recognizer-scan-csharp")

    wanted["scanner"]["version"] = actual["scanner"]["version"]

    assert actual == wanted
    validate(actual)


def test_the_fixture_scans_no_test_project_file_and_lists_six_directories():
    document = scan(FIXTURE_ROOT, None)

    assert document["selection"]["skip_paths"] == TEST_PROJECTS
    assert not any(m.startswith("tests/") for m in module_ids(document))
    assert len(document["modules"]) == 24


def test_the_fixture_has_exactly_one_damaged_file_that_keeps_its_types():
    result = scan_with_stats(FIXTURE_ROOT, None)
    broken = next(m for m in result.document["modules"] if m["id"].endswith("Damaged.cs"))

    assert result.damaged == 1
    assert [m["name"] for m in broken["members"]] == ["Survivor", "Broken"]


def test_the_fixture_marks_the_five_entry_points():
    document = scan(FIXTURE_ROOT, None)
    entries = sorted(m["id"] for m in document["modules"] if m.get("entry_point"))

    assert entries == [
        "src/Shop.Application/PlaceOrderHandler.cs",
        "src/Shop.Infrastructure/Migrations/InitialCreate.cs",
        "src/Shop.Web/OrderWorker.cs",
        "src/Shop.Web/OrdersController.cs",
        "src/Shop.Web/Program.cs",
    ]


def test_the_fixture_global_usings_file_declares_no_type_and_has_no_edges():
    document = scan(FIXTURE_ROOT, None)
    path = "src/Shop.Application/GlobalUsings.cs"

    assert next(m for m in document["modules"] if m["id"] == path)["members"] == []
    assert not [e for e in document["edges"] if e["from"] == path]


def test_the_selection_equals_the_binding_constants():
    assert selection() == {
        "extensions": [".cs"],
        "skip_directory_names": ["bin", "obj"],
        "skip_directory_prefixes": ["."],
        "skip_directory_suffixes": [],
        "skip_directories_containing": [],
        "skip_file_globs": ["*.g.cs", "*.g.i.cs", "*.Designer.cs"],
        "skip_paths": [],
    }


def test_the_scan_selection_is_the_constants_plus_the_test_project_directories():
    assert scan(FIXTURE_ROOT, None)["selection"] == selection(TEST_PROJECTS)


def test_files_equal_the_shared_selection_parity_tree(tmp_path):
    parity = json.loads((REPOSITORY / "fixtures" / "selection-parity.json").read_text())["csharp"]
    build_tree(tmp_path, dict.fromkeys(parity["tree"], ""))

    assert [f["path"] for f in scan(tmp_path, None)["files"]] == parity["accepted"]


def test_a_file_named_designer_or_g_is_scanned_but_the_three_globs_skip(tmp_path):
    build_tree(
        tmp_path,
        dict.fromkeys(
            ["Designer.cs", "g.cs", "A.g.cs", "A.g.i.cs", "A.Designer.cs", "bin/B.cs", "obj/B.cs"],
            "",
        ),
    )

    assert [f["path"] for f in scan(tmp_path, None)["files"]] == ["Designer.cs", "g.cs"]


def test_a_dot_directory_is_skipped(tmp_path):
    build_tree(tmp_path, {".vs/A.cs": "", ".hidden/B.cs": "", "C.cs": ""})

    assert [f["path"] for f in scan(tmp_path, None)["files"]] == ["C.cs"]


def test_cli_end_to_end(tmp_path):
    result = run_cli(str(FIXTURE_ROOT), "--commit", "abc1234", "--modified", "false")
    document = json.loads(result.stdout)
    wanted = expected()
    wanted["commit"] = "abc1234"
    wanted["modified"] = False
    wanted["scanner"]["version"] = document["scanner"]["version"]

    assert result.returncode == 0
    assert document == wanted
    assert "1 of 24 files had damaged spans" in result.stderr
    assert "left out 1 .fs and 1 .vb files" in result.stderr
    validate(document)

    output = tmp_path / "scan.json"
    second = run_cli(
        str(FIXTURE_ROOT), "--commit", "abc1234", "--modified", "false", "--output", str(output)
    )

    assert second.returncode == 0
    assert second.stdout == ""
    assert output.read_text() == result.stdout
    assert result.stdout.endswith("}\n")


def test_cli_prints_the_package_version():
    result = run_cli("--version")

    assert result.returncode == 0
    assert result.stdout == f"{version('recognizer-scan-csharp')}\n"


def test_cli_refuses_a_root_that_is_not_a_directory(tmp_path):
    result = run_cli(str(tmp_path / "missing"))

    assert result.returncode == 2
    assert "ROOT is not a directory" in result.stderr


def test_cli_reads_git_when_commit_and_modified_are_absent(tmp_path):
    build_tree(tmp_path, {"A.cs": "class A {}\n"})
    git = ["git", "-C", str(tmp_path)]
    subprocess.run([*git, "init", "--quiet"], check=True)
    subprocess.run([*git, "add", "A.cs"], check=True)
    subprocess.run(
        [*git, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "x"],
        check=True,
    )
    head = subprocess.run(
        [*git, "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    document = json.loads(run_cli(str(tmp_path)).stdout)

    assert document["commit"] == head
    assert document["modified"] is False


def test_cli_records_none_for_a_folder_outside_git(tmp_path):
    build_tree(tmp_path, {"A.cs": "class A {}\n"})
    document = json.loads(run_cli(str(tmp_path)).stdout)

    assert document["commit"] is None
    assert document["modified"] is None
