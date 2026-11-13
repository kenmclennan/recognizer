import json
import os
import re
import shlex
import shutil
import stat
from dataclasses import asdict
from pathlib import Path
from unittest import mock

import pytest
from conftest import REPOSITORY, SENSOR_LIST, SHIPPED

from recognizer_sensors.cli import main
from recognizer_sensors.registry import SHIPPED as REGISTRY
from recognizer_sensors.scans import Scan, ScanModule
from recognizer_sensors.testrun import readiness
from recognizer_sensors.testrun.readiness import check, check_with_notes
from recognizer_sensors.testrun.suites import parse_suites

LCOV = "SF:a.py\nDA:1,1\nend_of_record\n"

STUB_SHELL = '#!/bin/sh\necho started >> "$STUB_LOG"\nexec sh -c "$2"\n'

SILENT_SHELL = '#!/bin/sh\necho started >> "$STUB_LOG"\nexit 0\n'

PYTHON_STUB = '#!/bin/sh\ncase " $STUB_MISSING " in *" ${2#import } "*) exit 1;; esac\nexit 0\n'

NODE_STUB = (
    '#!/bin/sh\nfor n in $STUB_MISSING; do echo "recognizer-check: missing $n"; done\nexit 0\n'
)

CARGO_STUB = '#!/bin/sh\ncase " $STUB_MISSING " in *" llvm-cov "*) exit 1;; esac\nexit 0\n'

RUSTUP_STUB = (
    '#!/bin/sh\ncase " $STUB_MISSING " in *" llvm-tools "*) exit 0;; esac\n'
    "echo llvm-tools-aarch64-apple-darwin\necho rustc-aarch64-apple-darwin\n"
)

REAL_NODE = shutil.which("node")

FIXTURES = REPOSITORY / "fixtures"

EXAMPLES = REPOSITORY / "schema" / "config-examples" / "valid"


def executable(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)

    return path


@pytest.fixture
def harness(tmp_path, monkeypatch):
    stubs = tmp_path / "stubs"

    for name, text in {
        "python": PYTHON_STUB,
        "node": NODE_STUB,
        "cargo": CARGO_STUB,
        "rustup": RUSTUP_STUB,
    }.items():
        executable(stubs / name, text)

    executable(stubs / "shell", STUB_SHELL)
    log = tmp_path / "shell.log"
    monkeypatch.setenv("SHELL", str(stubs / "shell"))
    monkeypatch.setenv("PATH", f"{stubs}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("STUB_LOG", str(log))
    monkeypatch.setenv("STUB_MISSING", "")

    root = tmp_path / "repo"
    root.mkdir()

    class Harness:
        pass

    found = Harness()
    found.root = root
    found.stubs = stubs
    found.log = log
    found.missing = lambda *names: monkeypatch.setenv("STUB_MISSING", " ".join(names))
    found.silent_shell = lambda: executable(stubs / "shell", SILENT_SHELL)

    return found


def raw(language="python", name="api", directory=".", **overrides):
    suite = {
        "name": name,
        "language": language,
        "directory": directory,
        "command": "true",
        "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
    }

    if language == "typescript":
        suite["runner"] = "vitest"

    return {**suite, **overrides}


def settings_of(*items):
    return {"suites": [asdict(suite) for suite in parse_suites(list(items))]}


def codes(gaps):
    return [item["code"] for item in gaps]


def test_no_suites_gives_one_gap_and_runs_no_suite(harness):
    with mock.patch.object(readiness, "run_suite") as run_suite:
        gaps = check(harness.root, {"suites": None}, True)

    assert gaps == [
        {
            "code": "no-test-suites",
            "suite": None,
            "line": "no test suites are configured in .recognizer/config.yaml",
        }
    ]
    run_suite.assert_not_called()


@pytest.mark.parametrize(
    ("missing", "code", "sentence"),
    [
        ("pytest_cov", "pytest-cov-missing", "pytest-cov is not installed"),
        ("pytest", "pytest-missing", "pytest is not installed"),
        ("coverage", "coverage-missing", "coverage is not installed"),
    ],
)
def test_a_python_suite_missing_a_tool_gives_that_gap(harness, missing, code, sentence):
    harness.missing(missing)

    gaps = check(harness.root, settings_of(raw()), False)

    assert gaps == [
        {
            "code": code,
            "suite": "api",
            "line": f"suite api: {sentence} in the activated environment",
        }
    ]
    assert harness.log.read_text() == "started\n"


def test_a_python_suite_with_every_tool_has_no_gap(harness):
    assert check(harness.root, settings_of(raw()), False) == []


@pytest.mark.parametrize(
    ("runner", "missing", "code", "line"),
    [
        ("vitest", "vitest", "vitest-missing", "suite web: vitest is not installed"),
        (
            "vitest",
            "coverage",
            "vitest-coverage-missing",
            "suite web: neither @vitest/coverage-v8 nor @vitest/coverage-istanbul is installed",
        ),
        ("jest", "jest", "jest-missing", "suite web: jest is not installed"),
    ],
)
def test_a_typescript_suite_missing_its_runner_tooling_gives_that_gap(
    harness, runner, missing, code, line
):
    harness.missing(missing)

    gaps = check(harness.root, settings_of(raw("typescript", name="web", runner=runner)), False)

    assert [(item["code"], item["line"]) for item in gaps] == [(code, line)]


def test_a_typescript_suite_listing_vitest_and_jest_is_a_runner_conflict(harness):
    (harness.root / "web").mkdir()
    (harness.root / "web" / "package.json").write_text(
        json.dumps({"devDependencies": {"vitest": "1", "jest": "1"}})
    )

    gaps = check(harness.root, settings_of(raw("typescript", name="web", directory="web")), False)

    assert gaps == [
        {
            "code": "runner-conflict",
            "suite": "web",
            "line": "suite web: both vitest and jest are listed in package.json, "
            "and only one runner is supported",
        }
    ]


@pytest.mark.skipif(REAL_NODE is None, reason="node is not installed")
def test_the_node_probe_reports_packages_node_cannot_resolve(harness, monkeypatch):
    executable(harness.stubs / "node", f'#!/bin/sh\nexec "{REAL_NODE}" "$@"\n')
    (harness.root / "web").mkdir()

    gaps = check(harness.root, settings_of(raw("typescript", name="web", directory="web")), False)

    assert codes(gaps) == ["vitest-missing", "vitest-coverage-missing"]


@pytest.mark.parametrize(
    ("missing", "code", "line"),
    [
        ("llvm-cov", "llvm-cov-missing", "suite core: cargo-llvm-cov is not installed"),
        (
            "llvm-tools",
            "llvm-tools-missing",
            "suite core: the llvm-tools component is not installed",
        ),
    ],
)
def test_a_rust_suite_missing_a_tool_gives_that_gap(harness, missing, code, line):
    harness.missing(missing)

    gaps = check(harness.root, settings_of(raw("rust", name="core")), False)

    assert [(item["code"], item["line"]) for item in gaps] == [(code, line)]


def test_a_rust_suite_with_the_target_named_llvm_tools_component_is_ready(harness):
    assert check(harness.root, settings_of(raw("rust", name="core")), False) == []


def kotlin_repository(harness, build_file, wrapper=True):
    app = harness.root / "app"
    app.mkdir()
    shutil.copy(build_file, app / "build.gradle.kts")

    if wrapper:
        executable(app / "gradlew", "#!/bin/sh\n")


def test_the_jacoco_text_check_reads_the_committed_fixtures(harness):
    kotlin_repository(harness, FIXTURES / "mutation" / "kotlin" / "build.gradle.kts")
    settings = settings_of(raw("kotlin", name="app", directory="app"))

    assert check(harness.root, settings, False) == []

    shutil.copy(
        FIXTURES / "kotlin" / "sample" / "app" / "build.gradle.kts",
        harness.root / "app" / "build.gradle.kts",
    )

    assert codes(check(harness.root, settings, False)) == ["jacoco-missing"]


def test_a_kotlin_suite_without_an_executable_gradlew_gives_that_gap(harness):
    kotlin_repository(harness, FIXTURES / "mutation" / "kotlin" / "build.gradle.kts", wrapper=False)

    gaps = check(harness.root, settings_of(raw("kotlin", name="app", directory="app")), False)

    assert gaps == [
        {
            "code": "gradlew-missing",
            "suite": "app",
            "line": "suite app: gradlew is missing or not executable",
        }
    ]


def test_a_kotlin_module_suite_uses_the_gradlew_at_the_repository_root(harness):
    kotlin_repository(harness, FIXTURES / "mutation" / "kotlin" / "build.gradle.kts", wrapper=False)
    executable(harness.root / "gradlew", "#!/bin/sh\n")

    gaps = check(harness.root, settings_of(raw("kotlin", name="app", directory="app")), False)

    assert gaps == []


def test_a_kotlin_module_suite_reads_jacoco_from_the_root_build_file(harness):
    app = harness.root / "app"
    app.mkdir()
    shutil.copy(
        FIXTURES / "kotlin" / "sample" / "app" / "build.gradle.kts", app / "build.gradle.kts"
    )
    shutil.copy(
        FIXTURES / "mutation" / "kotlin" / "build.gradle.kts", harness.root / "build.gradle.kts"
    )
    executable(harness.root / "gradlew", "#!/bin/sh\n")
    settings = settings_of(raw("kotlin", name="app", directory="app"))

    assert check(harness.root, settings, False) == []

    (harness.root / "build.gradle.kts").unlink()

    assert codes(check(harness.root, settings, False)) == ["jacoco-missing"]


def test_a_kotlin_module_suite_with_no_gradlew_up_to_the_root_keeps_the_gap(harness):
    kotlin_repository(harness, FIXTURES / "mutation" / "kotlin" / "build.gradle.kts", wrapper=False)

    gaps = check(harness.root, settings_of(raw("kotlin", name="app", directory="app")), False)

    assert codes(gaps) == ["gradlew-missing"]


def csharp_project(root, relative, text):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


TEST_PROJECT = '<Project><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" />{extra}'
TEST_PROJECT += "</ItemGroup></Project>"


def test_a_csharp_test_project_without_coverlet_gives_one_gap_each(harness):
    csharp_project(
        harness.root,
        "tests/Shop.Tests/Shop.Tests.csproj",
        TEST_PROJECT.format(extra=""),
    )
    csharp_project(
        harness.root,
        "tests/Other.Tests/Other.Tests.csproj",
        TEST_PROJECT.format(extra='<PackageReference Include="coverlet.collector" />'),
    )

    gaps = check(harness.root, settings_of(raw("csharp", name="tests", directory="tests")), False)

    assert gaps == [
        {
            "code": "coverlet-missing",
            "suite": "tests",
            "line": "suite tests: the test project tests/Shop.Tests/Shop.Tests.csproj "
            "does not reference coverlet.collector",
        }
    ]


def test_a_csharp_project_inheriting_coverlet_or_not_a_test_project_gives_no_gap(harness):
    csharp_project(
        harness.root,
        "tests/Shop.Tests/Shop.Tests.csproj",
        TEST_PROJECT.format(extra=""),
    )
    csharp_project(
        harness.root, "tests/Directory.Build.props", "<Project>coverlet.collector</Project>"
    )
    csharp_project(harness.root, "tests/Lib/Lib.csproj", "<Project />")

    gaps = check(harness.root, settings_of(raw("csharp", name="tests", directory="tests")), False)

    assert gaps == []


def test_a_csharp_project_without_the_test_sdk_is_not_a_test_project(harness):
    csharp_project(harness.root, "tests/Lib/Lib.csproj", "<Project />")

    assert (
        check(harness.root, settings_of(raw("csharp", name="tests", directory="tests")), False)
        == []
    )


def test_a_shell_that_prints_nothing_is_an_activate_failure_after_the_stub_started(harness):
    harness.silent_shell()

    gaps = check(harness.root, settings_of(raw()), False)

    assert harness.log.read_text() == "started\n"
    assert codes(gaps) == ["activate-failed"]
    assert gaps[0]["suite"] == "api"
    assert gaps[0]["line"].startswith("suite api: the activate command failed")


def test_a_failing_activate_names_its_last_output_line_and_skips_the_tool_check(harness):
    harness.missing("pytest")

    gaps = check(
        harness.root,
        settings_of(raw(activate="echo no such environment >&2; false")),
        False,
    )

    assert gaps == [
        {
            "code": "activate-failed",
            "suite": "api",
            "line": "suite api: the activate command failed: no such environment",
        }
    ]


def test_a_shell_that_does_not_finish_in_time_reads_as_a_timeout(harness, monkeypatch):
    executable(harness.stubs / "shell", "#!/bin/sh\nsleep 5\n")
    monkeypatch.setattr(readiness, "SHELL_TIMEOUT_SECONDS", 0.2)

    gaps = check(harness.root, settings_of(raw()), False)

    assert gaps[0]["line"] == "suite api: the activate command did not finish within 0.2 seconds"


def test_a_missing_directory_is_one_gap_and_no_shell_starts(harness):
    gaps = check(harness.root, settings_of(raw(directory="services/api")), False)

    assert gaps == [
        {
            "code": "directory-missing",
            "suite": "api",
            "line": "suite api: the directory services/api does not exist",
        }
    ]
    assert not harness.log.exists()


def test_three_suites_give_exactly_the_two_gaps_of_the_suites_that_have_one(harness):
    (harness.root / "ready").mkdir()
    (harness.root / "broken").mkdir()
    harness.missing("pytest_cov")
    settings = settings_of(
        raw("rust", name="ready", directory="ready"),
        raw(name="broken", directory="broken"),
        raw(name="absent", directory="absent"),
    )

    gaps = check(harness.root, settings, False)

    assert [(item["suite"], item["code"]) for item in gaps] == [
        ("broken", "pytest-cov-missing"),
        ("absent", "directory-missing"),
    ]
    assert "ready" not in json.dumps(gaps)


def run_settings(command, **overrides):
    return settings_of(raw(command=command, **overrides))


WRITES_LCOV = f"mkdir -p coverage && printf '%s' '{LCOV}' > coverage/lcov.info"


def prepared(harness):
    (harness.root / "a.py").write_text("x = 1\n")


def test_a_suite_that_leaves_a_parseable_report_is_ready_under_run(harness):
    prepared(harness)

    assert check(harness.root, run_settings(WRITES_LCOV), True) == []


def test_a_suite_that_writes_nothing_and_exits_one_gives_coverage_missing_with_its_status(
    harness,
):
    gaps = check(harness.root, run_settings("exit 1"), True)

    assert gaps == [
        {
            "code": "coverage-missing",
            "suite": "api",
            "line": "suite api: the suite exited 1 and left no coverage report "
            "at coverage/lcov.info",
        }
    ]


def test_a_suite_that_writes_nothing_and_exits_zero_omits_the_status(harness):
    gaps = check(harness.root, run_settings("true"), True)

    assert gaps[0]["line"] == "suite api: the suite left no coverage report at coverage/lcov.info"


def test_a_suite_that_writes_an_unparseable_report_gives_coverage_unreadable(harness):
    gaps = check(
        harness.root,
        run_settings("mkdir -p coverage && echo 'not lcov' > coverage/lcov.info"),
        True,
    )

    assert gaps == [
        {
            "code": "coverage-unreadable",
            "suite": "api",
            "line": "suite api: the coverage report at coverage/lcov.info does not parse",
        }
    ]


JACOCO = (
    "<report name='x'><package name='com/acme'><sourcefile name='A.kt'>"
    "<line nr='1' mi='0' ci='2'/></sourcefile></package></report>"
)


def jacoco_run_settings(harness, text):
    shutil.copy(
        FIXTURES / "mutation" / "kotlin" / "build.gradle.kts",
        harness.root / "build.gradle.kts",
    )
    executable(harness.root / "gradlew", "#!/bin/sh\n")

    return settings_of(
        raw(
            "kotlin",
            name="app",
            command=f"mkdir -p build && printf '%s' \"{text}\" > build/jacoco.xml",
            coverage={"path": "build/jacoco.xml", "format": "jacoco"},
        )
    )


def test_a_malformed_jacoco_report_keeps_coverage_unreadable(harness):
    gaps = check(harness.root, jacoco_run_settings(harness, "<report"), True)

    assert gaps == [
        {
            "code": "coverage-unreadable",
            "suite": "app",
            "line": "suite app: the coverage report at build/jacoco.xml does not parse",
        }
    ]


def test_a_well_formed_jacoco_report_with_no_scan_asks_for_a_scan(harness):
    gaps = check(harness.root, jacoco_run_settings(harness, JACOCO), True)

    assert gaps == [
        {
            "code": "coverage-unmatched",
            "suite": "app",
            "line": "suite app: the coverage report at build/jacoco.xml parses, but there is "
            "no scan to match it against; run recognizer scan first",
        }
    ]


def test_a_well_formed_jacoco_report_matching_no_scanned_file_says_so(harness):
    other = Scan(
        language="kotlin", modules=(ScanModule(id="b/B.kt", files=("b/B.kt",)),), modified=False
    )

    with mock.patch.object(readiness, "read_scans", return_value=[other]):
        gaps = check(harness.root, jacoco_run_settings(harness, JACOCO), True)

    assert gaps == [
        {
            "code": "coverage-unmatched",
            "suite": "app",
            "line": "suite app: the coverage report at build/jacoco.xml parses, but its paths "
            "match no file in the scan",
        }
    ]


def test_a_failing_suite_with_a_parseable_report_is_not_a_gap(harness):
    prepared(harness)

    assert check(harness.root, run_settings(f"{WRITES_LCOV}; exit 1"), True) == []


def test_a_suite_with_an_earlier_gap_is_not_run(harness):
    harness.missing("pytest")
    marker = harness.root / "ran"

    gaps = check(harness.root, run_settings(f"touch {marker}"), True)

    assert codes(gaps) == ["pytest-missing"]
    assert not marker.exists()


def test_no_suite_command_starts_without_run(harness):
    marker = harness.root / "ran"

    assert check(harness.root, run_settings(f"touch {marker}"), False) == []
    assert not marker.exists()


def parse_example(path: Path) -> list[dict]:
    suites: list[dict] = []
    nested: dict | None = None

    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("tests:"):
            continue

        indent = len(line) - len(line.lstrip())
        text = line.strip()

        if text.startswith("- "):
            suites.append({})
            text = text[2:]
            indent = 4
            nested = None

        key, _, value = text.partition(":")
        value = value.strip().strip('"')

        if indent == 4:
            if value == "":
                nested = suites[-1].setdefault(key, {})
            else:
                suites[-1][key] = value
                nested = None
        elif nested is not None:
            nested[key] = value

    return suites


def test_the_committed_five_language_example_parses_and_gives_only_per_language_file_gaps(
    harness,
):
    items = parse_example(EXAMPLES / "tests-five-languages.yaml")

    for item in items:
        item.pop("activate", None)

    settings = {"suites": [asdict(suite) for suite in parse_suites(items)]}

    assert [item["name"] for item in settings["suites"]] == ["api", "web", "jvm", "engine", "shop"]

    gaps = check(harness.root, settings, False)

    assert sorted(codes(gaps)) == ["directory-missing"] * 5

    for suite in settings["suites"]:
        (harness.root / suite["directory"]).mkdir()

    gaps = check(harness.root, settings, False)

    assert [(item["suite"], item["code"]) for item in gaps] == [
        ("jvm", "gradlew-missing"),
    ]

    executable(harness.root / "jvm" / "gradlew", "#!/bin/sh\n")
    gaps = check(harness.root, settings, False)

    assert [(item["suite"], item["code"]) for item in gaps] == [("jvm", "jacoco-missing")]


def test_the_committed_python_activate_example_gives_only_directory_missing_until_created(
    harness,
):
    items = parse_example(EXAMPLES / "tests-python-activate.yaml")
    items[0]["activate"] = "true"
    settings = {"suites": [asdict(suite) for suite in parse_suites(items)]}

    assert codes(check(harness.root, settings, False)) == ["directory-missing"]

    (harness.root / "service").mkdir()

    assert check(harness.root, settings, False) == []


def run_cli(args, capsys):
    status = main(args)
    out = capsys.readouterr().out

    return status, out


def test_the_check_flag_needs_no_commit(tmp_path, capsys):
    status, out = run_cli(["thresholds", "--repository", str(tmp_path), "--check"], capsys)

    assert status == 0
    assert json.loads(out) == {"gaps": [], "notes": []}


def test_the_check_flag_prints_gaps_runs_no_tests_and_writes_nothing(tmp_path, capsys):
    before = sorted(path.name for path in tmp_path.iterdir())

    status, out = run_cli(["crap", "--repository", str(tmp_path), "--check"], capsys)

    assert status == 0
    assert codes(json.loads(out)["gaps"]) == ["no-test-suites"]
    assert sorted(path.name for path in tmp_path.iterdir()) == before


@pytest.mark.parametrize("name", ["thresholds"])
def test_a_sensor_without_a_check_prints_no_gaps(name, tmp_path, capsys):
    status, out = run_cli([name, "--repository", str(tmp_path), "--check"], capsys)

    assert status == 0
    assert json.loads(out) == {"gaps": [], "notes": []}


def test_the_crap_check_prints_the_no_suites_gap_and_runs_nothing(harness, capsys):
    status, out = run_cli(["crap", "--repository", str(harness.root), "--check"], capsys)

    assert status == 0
    assert json.loads(out) == {
        "gaps": [
            {
                "code": "no-test-suites",
                "suite": None,
                "line": "no test suites are configured in .recognizer/config.yaml",
            }
        ],
        "notes": [],
    }
    assert not harness.log.exists()


def test_only_crap_and_mutation_have_a_test_check():
    listed = json.loads(SENSOR_LIST.read_text())
    checking = sorted(name for name, sensor in REGISTRY.items() if sensor.runs_tests)

    assert checking == ["crap", "mutation"]
    assert sorted(entry["name"] for entry in listed if entry["runs_tests"]) == checking
    assert sorted(json.loads(SHIPPED.read_text())) == sorted(REGISTRY)
    assert sorted(name for name, sensor in REGISTRY.items() if sensor.guide is not None) == checking
    assert (
        REGISTRY["crap"].check is readiness.check_with_notes
        and REGISTRY["mutation"].check is readiness.mutation_check
    )


def coverage_run_settings(command="coverage run -m pytest"):
    return json.dumps({"tests": [raw(command=command)]})


def test_the_mutation_check_lists_the_no_test_contexts_gap_and_the_crap_check_does_not(
    harness, capsys
):
    harness.root.mkdir(exist_ok=True)
    args = ["--repository", str(harness.root), "--check", "--settings", coverage_run_settings()]

    status, out = run_cli(["mutation", *args], capsys)

    assert status == 0
    found = [item for item in json.loads(out)["gaps"] if item["code"] == "no-test-contexts"]
    assert [item["suite"] for item in found] == ["api"]
    assert "dynamic_context = test_function" in found[0]["line"]

    status, out = run_cli(["crap", *args], capsys)

    assert status == 0
    assert "no-test-contexts" not in out


def test_the_check_over_this_repositorys_sensors_suite_reports_exactly_one_gap():
    root = Path(__file__).resolve().parents[1]
    suite = parse_suites([raw(directory="sensors", command="coverage run -m pytest")])[0]

    assert readiness.lacks_contexts(suite, root)


def test_the_guide_of_mutation_names_the_context_requirement_and_both_fixes(capsys):
    status, out = run_cli(["mutation", "--guide"], capsys)

    assert status == 0
    assert "dynamic_context = test_function" in out
    assert "pytest --cov" in out
    assert "carry" in out
    assert "PYTHONPATH" in out
    assert "pythonpath" not in out
    assert "pyproject.toml" not in out


def test_the_guide_of_mutation_states_what_a_blank_budget_and_worker_count_mean(capsys):
    _, out = run_cli(["mutation", "--guide"], capsys)
    _, crap_out = run_cli(["crap", "--guide"], capsys)

    for text in (
        "no time budget: the run continues until it finishes",
        "sized from the machine's cores and free memory",
    ):
        assert text in out
        assert text not in crap_out


def test_the_guide_of_mutation_names_carry_and_the_import_path_fix_in_recognizer_config(capsys):
    status, out = run_cli(["mutation", "--guide"], capsys)

    assert status == 0
    assert "carry" in out
    assert "PYTHONPATH" in out
    assert "pythonpath" not in out
    assert "pyproject.toml" not in out


def guide_text(capsys):
    status, out = run_cli(["crap", "--guide"], capsys)

    assert status == 0

    return out


BINDING_SUITES = (
    (
        "python",
        "pytest --cov=src --cov-report=lcov:.recognizer/cache/coverage/api/lcov.info",
        ".recognizer/cache/coverage/api/lcov.info",
    ),
    (
        "typescript",
        "npx vitest run --coverage --coverage.reporter=lcov --coverage.reportsDirectory=.recognizer/cache/coverage/web",
        ".recognizer/cache/coverage/web/lcov.info",
    ),
    (
        "typescript",
        "npx jest --coverage --coverageReporters=lcov --coverageDirectory=.recognizer/cache/coverage/web",
        ".recognizer/cache/coverage/web/lcov.info",
    ),
    (
        "kotlin",
        "./gradlew cleanTest test jacocoTestReport",
        "build/reports/jacoco/test/jacocoTestReport.xml",
    ),
    (
        "rust",
        "cargo llvm-cov --lcov --output-path target/lcov.info",
        "target/lcov.info",
    ),
    (
        "csharp",
        'dotnet test tests --collect:"XPlat Code Coverage;Format=lcov"',
        "tests/TestResults/*/coverage.info",
    ),
    (
        "kotlin",
        "./gradlew cleanTest test jacocoTestReport",
        "**/build/reports/jacoco/test/jacocoTestReport.xml",
    ),
    (
        "rust",
        "cargo llvm-cov --workspace --lcov --output-path target/lcov.info",
        "target/lcov.info",
    ),
    (
        "rust",
        "cargo llvm-cov --lcov --output-path lcov.info",
        "lcov.info",
    ),
    (
        "typescript",
        "npx vitest run --config ../../vitest.config.ts --coverage --coverage.reporter=lcov "
        "--coverage.reportsDirectory=coverage",
        "coverage/lcov.info",
    ),
    (
        "csharp",
        'dotnet test --collect:"XPlat Code Coverage;Format=lcov"',
        "**/TestResults/*/coverage.info",
    ),
)


COMMAND_LINE = "  recognizer config "


def config_lines(out):
    return [shlex.split(line)[2:] for line in out.splitlines() if line.startswith(COMMAND_LINE)]


def suites_of(out):
    suites = []
    previous = None

    for line in out.splitlines():
        if not line.startswith(COMMAND_LINE):
            previous = None

            continue

        words = shlex.split(line)[2:]
        is_suite_line = words[0].startswith("tests.")

        if is_suite_line and previous is not True:
            suites.append([])

        if is_suite_line:
            suites[-1].append(words)

        previous = is_suite_line

    return suites


def test_the_guide_registers_crap_under_sensors(capsys):
    out = guide_text(capsys)

    assert ["--add-section", "sensors.crap"] in config_lines(out)
    assert "  recognizer config --add-section sensors.crap\n" in out


def test_the_guide_registers_crap_and_mutation_with_add_section_where_nothing_is_carried(capsys):
    out = guide_text(capsys)
    headings = {"kotlin": "Kotlin:", "rust": "Rust:", "csharp": "C#:"}

    for language, heading in headings.items():
        block = out.split(f"\n{heading}\n\n")[1].split("\n\n")[0] + "\n"

        assert "  recognizer config --add-section sensors.crap\n" in block, language
        assert "  recognizer config --add-section sensors.mutation\n" in block, language

    assert "  recognizer config --add sensors.mutation.carry .venv\n" in out


def test_the_guide_states_the_sensor_order_plainly(capsys):
    out = " ".join(guide_text(capsys).split())

    assert "recognizer config --add-section sensors.<name> registers one with its defaults" in out
    assert (
        "C.R.A.P. and Mutation read no overlay of each other's: register them in either order"
        in out
    )
    assert "thresholds reads their overlays, so it comes last." in out


def test_the_guide_registers_every_shipped_sensor(capsys):
    out = guide_text(capsys)
    names = json.loads(SHIPPED.read_text())
    lines = config_lines(out)

    assert names

    for name in names:
        assert any(
            re.fullmatch(rf"sensors\.{name}(\..*)?", arg) for words in lines for arg in words
        ), name


def test_the_guide_names_both_format_values(capsys):
    out = guide_text(capsys)
    formats = {words[1] for words in config_lines(out) if words[0].endswith(".coverage.format")}

    assert formats == {"lcov", "jacoco"}
    assert "takes exactly two values" in out


def test_the_guide_has_a_suite_for_each_language_and_both_typescript_runners(capsys):
    out = guide_text(capsys)
    arguments = [words for words in config_lines(out) if words[0].startswith("tests.")]
    languages = [words[1] for words in config_lines(out) if words[0].endswith(".language")]
    runners = [words[1] for words in config_lines(out) if words[0].endswith(".runner")]

    assert arguments
    assert sorted(set(languages)) == ["csharp", "kotlin", "python", "rust", "typescript"]
    assert sorted(runners) == ["jest", "vitest", "vitest"]


def test_the_guide_carries_each_measured_command_and_path_verbatim(capsys):
    out = guide_text(capsys)
    lines = config_lines(out)
    commands = [words[1] for words in lines if words[0].endswith(".command")]
    paths = [words[1] for words in lines if words[0].endswith(".coverage.path")]

    assert commands == [command for _, command, _ in BINDING_SUITES]
    assert paths == [path for _, _, path in BINDING_SUITES]


def test_the_guide_gives_kotlin_jacoco_and_every_other_suite_lcov(capsys):
    out = guide_text(capsys)
    suites = suites_of(out)
    pairs = [
        (
            next(words[1] for words in suite if words[0].endswith(".language")),
            next(words[1] for words in suite if words[0].endswith(".coverage.format")),
        )
        for suite in suites
    ]

    assert [language for language, _ in pairs] == [language for language, _, _ in BINDING_SUITES]

    for language, fmt in pairs:
        assert fmt == ("jacoco" if language == "kotlin" else "lcov")


def test_the_guide_keeps_the_single_project_suites_and_adds_five_multi_project_ones(capsys):
    suites = suites_of(guide_text(capsys))

    assert len(suites) == len(BINDING_SUITES) == 11

    languages = [next(w[1] for w in suite if w[0].endswith(".language")) for suite in suites]
    formats = [next(w[1] for w in suite if w[0].endswith(".coverage.format")) for suite in suites]
    directories = [next(w[1] for w in suite if w[0].endswith(".directory")) for suite in suites]
    last = suites[6:]

    assert languages[6:] == ["kotlin", "rust", "rust", "typescript", "csharp"]
    assert formats[6:] == ["jacoco", "lcov", "lcov", "lcov", "lcov"]
    assert directories[6:8] == [".", "."]
    assert all(directory not in (".", "") for directory in directories[8:10])
    assert directories[10] == "."
    assert ["vitest"] == [w[1] for w in last[3] if w[0].endswith(".runner")]


def test_the_guide_states_the_multi_project_facts(capsys):
    out = guide_text(capsys)
    flat = " ".join(out.split())

    assert "Repositories with more than one project:" in out

    for fact in ("**/build/reports/jacoco", "--workspace", "--config ../../vitest.config.ts"):
        assert fact in out

    assert "A suite per Gradle module also works: the readiness check uses the nearest" in flat
    assert ":moshi:cleanTest :moshi:test :moshi:jacocoTestReport" in flat
    assert "ready does not say the whole workspace was covered" in flat

    for fact in (
        "inside each test project",
        "one per target framework",
        "A suite per test project also works",
        "Directory.Packages.props",
        "PackageVersion entry there",
        "fails restore with NU1008",
    ):
        assert fact in flat

    assert "TestFrameworks" not in out
    assert (
        "pythonpath"
        not in out.split("Repositories with more than one project:")[1]
        .split("What Mutation needs")[0]
        .lower()
    )


def test_the_guide_states_the_four_runtime_facts(capsys):
    out = guide_text(capsys)

    for fact in ("cleanTest", "recognizer scan", "Format=lcov", "*/coverage.info"):
        assert fact in out


def test_the_guide_still_installs_nothing_and_leaves_the_development_config_alone(capsys):
    out = guide_text(capsys)

    assert "Never install anything" in out
    assert "Never change the repository's own development config" in out


def test_run_alone_is_exit_two(tmp_path, capsys):
    status, _ = run_cli(["crap", "--repository", str(tmp_path), "--run"], capsys)

    assert status == 2


def test_check_with_run_is_accepted(tmp_path, capsys):
    status, out = run_cli(["crap", "--repository", str(tmp_path), "--check", "--run"], capsys)

    assert status == 0
    assert codes(json.loads(out)["gaps"]) == ["no-test-suites"]


def test_a_malformed_tests_list_is_the_config_gap_with_exit_zero(tmp_path, capsys):
    status, out = run_cli(
        [
            "crap",
            "--repository",
            str(tmp_path),
            "--check",
            "--settings",
            json.dumps({"tests": "nope"}),
        ],
        capsys,
    )

    assert status == 0
    assert json.loads(out) == {
        "gaps": [{"code": "config", "suite": None, "line": "tests must be a non-empty array"}],
        "notes": [],
    }


def test_the_guide_of_crap_names_the_mandated_tools_and_thresholds_prints_nothing(tmp_path, capsys):
    status, out = run_cli(["crap", "--guide"], capsys)

    assert status == 0

    for word in (
        "pytest",
        "coverage",
        "pytest-cov",
        "vitest",
        "jest",
        "llvm-cov",
        "coverlet.collector",
        "gradlew",
        "recognizer sensors check --run",
        "Never install anything without the human's say-so",
    ):
        assert word in out

    assert run_cli(["thresholds", "--guide"], capsys) == (0, "")


def test_an_unticked_suite_with_a_missing_tool_gives_no_gap(harness):
    harness.missing("jest")
    (harness.root / "web").mkdir()
    settings = settings_of(
        raw("python", name="unit"),
        raw("typescript", name="web", directory="web", runner="jest"),
    )

    assert check(harness.root, settings, False, ["unit"]) == []
    assert codes(check(harness.root, settings, False, ["web"])) == ["jest-missing"]
    assert codes(check(harness.root, settings, False)) == ["jest-missing"]


def lcov_listing(*paths):
    body = "".join(f"SF:{path}\\nDA:1,1\\nend_of_record\\n" for path in paths)

    return f"mkdir -p coverage && printf '{body}' > coverage/lcov.info"


def scan_of(language, *paths):
    return Scan(
        language=language,
        modules=tuple(ScanModule(id=path, files=(path,)) for path in paths),
        modified=False,
    )


def run_notes(harness, scans, command, **overrides):
    with mock.patch.object(readiness, "read_scans", return_value=scans):
        return check_with_notes(harness.root, run_settings(command, **overrides), True)


PYTHON_THREE = ("a.py", "b.py", "c.py")


def partial(suite, covered, expected, language="Python", noun="files"):
    return {
        "code": "coverage-partial",
        "suite": suite,
        "line": f"suite {suite}: the coverage report covers {covered} of {expected} "
        f"scanned {language} {noun}",
    }


def test_a_report_listing_every_scanned_file_gives_no_note(harness):
    scans = [scan_of("python", *PYTHON_THREE)]

    assert run_notes(harness, scans, lcov_listing(*PYTHON_THREE)) == ([], [])


def test_a_report_listing_two_of_three_files_gives_the_count(harness):
    scans = [scan_of("python", *PYTHON_THREE)]

    gaps, notes = run_notes(harness, scans, lcov_listing("a.py", "b.py"))

    assert gaps == []
    assert notes == [partial("api", 2, 3)]


def test_a_report_listing_one_of_three_files_gives_the_count(harness):
    scans = [scan_of("python", *PYTHON_THREE)]

    gaps, notes = run_notes(harness, scans, lcov_listing("a.py"))

    assert gaps == []
    assert notes == [partial("api", 1, 3)]


def test_an_lcov_report_listing_none_of_the_scanned_files_gives_zero_and_no_gap(harness):
    scans = [scan_of("python", *PYTHON_THREE)]

    gaps, notes = run_notes(harness, scans, lcov_listing("other.py"))

    assert gaps == []
    assert notes == [partial("api", 0, 3)]


def test_a_single_scanned_file_is_counted_in_the_singular(harness):
    gaps, notes = run_notes(harness, [scan_of("python", "a.py")], lcov_listing("other.py"))

    assert gaps == []
    assert notes == [partial("api", 0, 1, noun="file")]


def test_the_count_is_scoped_to_the_suite_directory(harness):
    (harness.root / "api").mkdir()
    scans = [scan_of("python", "api/a.py", "api/b.py", "x.py", "y.py", "z.py")]

    gaps, notes = run_notes(
        harness,
        scans,
        lcov_listing("a.py"),
        directory="api",
    )

    assert gaps == []
    assert notes == [partial("api", 1, 2)]


def test_the_count_is_scoped_to_the_suite_language(harness):
    scans = [
        scan_of("python", *PYTHON_THREE),
        scan_of("typescript", "1.ts", "2.ts", "3.ts", "4.ts", "5.ts"),
    ]

    gaps, notes = run_notes(harness, scans, lcov_listing("a.py"))

    assert gaps == []
    assert notes == [partial("api", 1, 3)]


def test_a_parseable_report_with_no_scan_gives_no_note(harness):
    assert run_notes(harness, [], lcov_listing("a.py")) == ([], [])


def test_only_the_partial_suite_among_two_is_noted(harness):
    (harness.root / "full").mkdir()
    (harness.root / "part").mkdir()
    scans = [scan_of("python", "full/a.py", "part/a.py", "part/b.py")]
    settings = settings_of(
        raw(name="full", directory="full", command=lcov_listing("a.py")),
        raw(name="part", directory="part", command=lcov_listing("a.py")),
    )

    with mock.patch.object(readiness, "read_scans", return_value=scans):
        gaps, notes = check_with_notes(harness.root, settings, True)

    assert gaps == []
    assert notes == [partial("part", 1, 2)]


def test_a_jacoco_report_listing_one_of_two_scanned_files_gives_the_count(harness):
    scans = [scan_of("kotlin", "com/acme/A.kt", "com/acme/B.kt")]

    with mock.patch.object(readiness, "read_scans", return_value=scans):
        gaps, notes = check_with_notes(harness.root, jacoco_run_settings(harness, JACOCO), True)

    assert gaps == []
    assert notes == [partial("app", 1, 2, language="Kotlin")]


def test_a_jacoco_report_matching_nothing_is_the_gap_and_no_note(harness):
    other = scan_of("kotlin", "b/B.kt")

    with mock.patch.object(readiness, "read_scans", return_value=[other]):
        gaps, notes = check_with_notes(harness.root, jacoco_run_settings(harness, JACOCO), True)

    assert codes(gaps) == ["coverage-unmatched"]
    assert notes == []


def test_without_run_there_are_no_notes(harness):
    scans = [scan_of("python", *PYTHON_THREE)]

    with mock.patch.object(readiness, "read_scans", return_value=scans):
        result = check_with_notes(harness.root, run_settings(lcov_listing("a.py")), False)

    assert result == ([], [])


def test_a_suite_with_an_earlier_gap_is_not_run_and_has_no_note(harness):
    harness.missing("pytest")
    scans = [scan_of("python", *PYTHON_THREE)]

    gaps, notes = run_notes(harness, scans, lcov_listing("a.py"))

    assert codes(gaps) == ["pytest-missing"]
    assert notes == []


def test_the_check_line_carries_a_partial_note_under_notes_and_exits_zero(harness, capsys):
    (harness.root / "a.py").write_text("x = 1\n")
    scans = [scan_of("python", "a.py", "b.py")]
    settings = json.dumps({"tests": [raw(command=lcov_listing("a.py"))]})

    with mock.patch.object(readiness, "read_scans", return_value=scans):
        status, out = run_cli(
            ["crap", "--repository", str(harness.root), "--check", "--run", "--settings", settings],
            capsys,
        )

    assert status == 0
    assert json.loads(out) == {"gaps": [], "notes": [partial("api", 1, 2)]}
