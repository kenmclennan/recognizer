import json
import shutil

from conftest import MUTATE_FIXTURE, git_commit, mutate_settings

from recognizer_sensors.cli import main

SURVIVORS = ".recognizer/cache/mutation/survivors.json"
COVERAGE = "coverage/lcov.info"
ZEROS = "0" * 64
OTHER = "def other():\n    return 1\n"
OTHER_TWO = "def other():\n    return 1\n\n\ndef bare():\n    pass\n"
SECOND = "def double(x):\n    return x * 2\n"
LCOV_SECOND = "SF:app/second.py\nDA:1,1\nDA:2,1\nend_of_record\n"
STRONG_SECOND = "\nfrom app.second import double\n\nassert double(3) == 6\nassert double(0) == 0\n"


def arrange(tmp_path, files=None, lcov="", strong=""):
    root = tmp_path / "sample"
    shutil.copytree(MUTATE_FIXTURE, root, ignore=shutil.ignore_patterns("scan.python.json"))

    for name, text in (files or {}).items():
        (root / name).write_text(text)

    if lcov:
        report = root / COVERAGE
        report.write_text(report.read_text() + lcov)

    if strong:
        suite = root / "tests" / "strong.py"
        suite.write_text(suite.read_text() + strong)

    git_commit(root)
    modules = ["app/rules.py", *(name for name in (files or {}) if name.startswith("app/"))]
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    (cache / "scan.python.json").write_text(
        json.dumps(
            {
                "files": [{"path": name, "hash": ZEROS} for name in modules],
                "modules": [{"id": name} for name in modules],
                "modified": False,
            }
        )
    )

    return root


def mutate(root, tmp_path, scope=None):
    extra = []

    if scope is not None:
        path = tmp_path / "modules.json"
        path.write_text(json.dumps(scope))
        extra = ["--modules", str(path)]

    code = main(
        [
            "mutation",
            "--repository",
            str(root),
            "--output",
            str(tmp_path / "findings.json"),
            "--settings",
            mutate_settings("tests/strong.py"),
            *extra,
        ]
    )
    document = json.loads((tmp_path / "findings.json").read_text())
    survivors = json.loads((root / SURVIVORS).read_text())

    return code, document, survivors


def test_a_file_absent_from_the_coverage_report_is_recorded_as_excluded(tmp_path, capsys):
    root = arrange(tmp_path, {"app/other.py": OTHER})

    code, document, survivors = mutate(root, tmp_path)

    assert code == 0
    assert document["excluded"] == {"functions": 1, "modules": ["app/other.py"]}
    assert document["inputs"] == {"app/other.py": ZEROS, "app/rules.py": ZEROS}
    assert document["counts"] == {"measured": 3, "total": 3}
    assert survivors["excluded"] == [
        {
            "identity": "app/other.py::other",
            "file": "app/other.py",
            "reason": "not-in-coverage-report",
        }
    ]
    assert "app/other.py::other" not in json.dumps(
        json.loads((root / ".recognizer/cache/overlays/mutation.json").read_text())["values"]
    )
    assert (
        "1 functions in 1 modules not tested because their files are not in the coverage report"
        in capsys.readouterr().err
    )


def test_every_function_in_an_absent_file_is_counted(tmp_path):
    root = arrange(tmp_path, {"app/other.py": OTHER_TWO})

    code, document, survivors = mutate(root, tmp_path)

    assert code == 0
    assert document["excluded"] == {"functions": 2, "modules": ["app/other.py"]}
    assert [entry["identity"] for entry in survivors["excluded"]] == [
        "app/other.py::bare",
        "app/other.py::other",
    ]


def test_a_third_module_in_the_report_stays_measured(tmp_path):
    root = arrange(
        tmp_path,
        {"app/other.py": OTHER, "app/second.py": SECOND},
        lcov=LCOV_SECOND,
        strong=STRONG_SECOND,
    )

    code, document, _ = mutate(root, tmp_path)

    assert code == 0
    assert document["excluded"] == {"functions": 1, "modules": ["app/other.py"]}
    assert sorted(document["inputs"]) == ["app/other.py", "app/rules.py", "app/second.py"]
    assert document["counts"] == {"measured": 4, "total": 4}


def test_the_committed_sample_with_every_file_in_the_report_has_no_excluded(tmp_path):
    root = tmp_path / "sample"
    shutil.copytree(MUTATE_FIXTURE, root, ignore=shutil.ignore_patterns("scan.python.json"))
    git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(MUTATE_FIXTURE / "scan.python.json", cache / "scan.python.json")

    code, document, survivors = mutate(root, tmp_path)

    assert code == 0
    assert "excluded" not in document
    assert survivors["excluded"] == []
    assert document["inputs"] == {"app/rules.py": ZEROS}
    assert document["counts"] == {"measured": 3, "total": 3}


def test_scope_does_not_promote_an_unmeasured_module_through_exclusion(tmp_path):
    root = arrange(
        tmp_path,
        {"app/other.py": OTHER, "app/second.py": SECOND},
        lcov=LCOV_SECOND,
        strong=STRONG_SECOND,
    )

    code, document, _ = mutate(root, tmp_path, scope=["app/rules.py"])

    assert code == 0
    assert document["excluded"] == {"functions": 1, "modules": ["app/other.py"]}
    assert "app/second.py" not in document["inputs"]
    assert "app/other.py" in document["inputs"]


def test_a_module_whose_only_function_has_no_executable_line_is_measured_and_listed(
    tmp_path, capsys
):
    root = arrange(tmp_path, {"app/other.py": OTHER}, lcov="SF:app/other.py\nend_of_record\n")

    code, document, survivors = mutate(root, tmp_path)

    assert code == 0
    assert "excluded" not in document
    assert survivors["excluded"] == []
    assert document["inputs"] == {"app/other.py": ZEROS, "app/rules.py": ZEROS}
    assert document["counts"] == {"measured": 3, "total": 3}
    assert survivors["no_executable_line"] == [
        {
            "identity": "app/other.py::other",
            "file": "app/other.py",
            "reason": "no-executable-line",
        }
    ]
    overlay = json.loads((root / ".recognizer/cache/overlays/mutation.json").read_text())
    assert "app/other.py::other" not in json.dumps(overlay["values"])
    assert "not tested" not in capsys.readouterr().err


def test_a_function_with_no_executable_line_beside_a_measured_one_is_not_counted(tmp_path):
    root = arrange(
        tmp_path,
        {"app/other.py": OTHER_TWO},
        lcov="SF:app/other.py\nDA:1,1\nDA:2,1\nend_of_record\n",
    )

    code, document, survivors = mutate(root, tmp_path)

    assert code == 0
    assert "excluded" not in document
    assert "app/other.py" in document["inputs"]
    assert document["counts"]["total"] == 4
    assert [entry["identity"] for entry in survivors["no_executable_line"]] == [
        "app/other.py::bare"
    ]
    assert "app/other.py::other" in json.dumps(
        json.loads((root / ".recognizer/cache/overlays/mutation.json").read_text())["values"]
    )


def test_the_committed_sample_lists_no_function_without_an_executable_line(tmp_path):
    root = tmp_path / "sample"
    shutil.copytree(MUTATE_FIXTURE, root, ignore=shutil.ignore_patterns("scan.python.json"))
    git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(MUTATE_FIXTURE / "scan.python.json", cache / "scan.python.json")

    _, _, survivors = mutate(root, tmp_path)

    assert survivors["no_executable_line"] == []
