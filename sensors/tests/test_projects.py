import os
import stat
from pathlib import Path

import pytest
from conftest import REPOSITORY, git_commit

from recognizer_sensors.crap.lcov import function_coverage, normalise_path, parse_lcov
from recognizer_sensors.hashes import listed_files
from recognizer_sensors.mutation import runner, sensor
from recognizer_sensors.mutation.runner import EnvironmentPool, new_work_folder, remove_work_folder
from recognizer_sensors.scans import Scan, ScanModule
from recognizer_sensors.settings import Refusal
from recognizer_sensors.testrun import profiles
from recognizer_sensors.testrun.probes import probe
from recognizer_sensors.testrun.profiles import (
    coverage_command,
    mutant_command,
    python_runner,
    report_path,
    selected_command,
    tool_environment,
)
from recognizer_sensors.testrun.projects import Project, discover, owner_of, resolve, within
from recognizer_sensors.testrun.run import (
    Source,
    collect_coverage,
    collect_coverage_with_tests,
    plan,
    projects_dropped,
    read_source,
    run_steps,
    single_root,
)

PYPROJECT = '[project]\nname = "t"\nversion = "0"\n'

PACKAGE = '{"scripts": {"test": "node --test"}}'

STUB_UV = """#!/bin/sh
echo "$PWD $*" >> "$STUB_LOG"
[ -f ./FAIL ] && exit 1
case "$*" in
  *lcov*)
    out=""
    prev=""
    for a in "$@"; do
      [ "$prev" = "-o" ] && out="$a"
      prev="$a"
    done
    mkdir -p "$(dirname "$out")"
    printf 'SF:pkg/m.py\\nDA:1,1\\nDA:2,0\\nend_of_record\\n' > "$out"
    ;;
esac
exit 0
"""

STUB_NPX = """#!/bin/sh
echo "$PWD $*" >> "$STUB_LOG"
prev=""
for a in "$@"; do
  [ "$prev" = "--reports-dir" ] && out="$a"
  prev="$a"
done
mkdir -p "$out"
printf 'SF:src/m.ts\\nDA:1,1\\nend_of_record\\n' > "$out/lcov.info"
exit 0
"""


def scan_of(language: str, files: list[str], skip: tuple[str, ...] = ()) -> Scan:
    return Scan(language, tuple(ScanModule(f, (f,)) for f in files), False, skip_paths=skip)


def build(tmp_path: Path, files: dict[str, str], executable: tuple[str, ...] = ()) -> Path:
    root = tmp_path / "repo"

    for name, text in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    for name in executable:
        (root / name).chmod(0o755)

    git_commit(root)

    return root


def directories(root: Path, scan: Scan) -> list[str]:
    return [project.directory for project in discover(root, scan)]


def stub(monkeypatch, tmp_path: Path, **programs: str) -> Path:
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir(exist_ok=True)
    log = tmp_path / "stub.log"

    for name, text in programs.items():
        path = bin_directory / name
        path.write_text(text)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)

    monkeypatch.setenv("PATH", f"{bin_directory}:{os.environ['PATH']}")
    monkeypatch.setenv("STUB_LOG", str(log))

    return log


def two_python_projects(tmp_path: Path) -> tuple[Path, Scan]:
    files = {}

    for name in ("a", "b"):
        files[f"{name}/pyproject.toml"] = PYPROJECT
        files[f"{name}/uv.lock"] = ""
        files[f"{name}/pkg/m.py"] = "def f():\n    return 1\n"
        files[f"{name}/test_m.py"] = "def test_f():\n    pass\n"

    root = build(tmp_path, files)

    return root, scan_of("python", ["a/pkg/m.py", "b/pkg/m.py"])


def test_two_python_projects_each_run_their_own_uv_run_and_merge_repository_relative_coverage(
    tmp_path, monkeypatch
):
    root, scan = two_python_projects(tmp_path)
    log = stub(monkeypatch, tmp_path, uv=STUB_UV)
    steps, sources = plan(root, [scan], None, None)

    assert [step.directory for step in steps] == ["a", "b"]
    assert [step.label for step in steps] == ["python a", "python b"]
    assert all(
        "uv run env -u UV_PROJECT_ENVIRONMENT python" in step.command[2]
        and "borrowed_python.py" in step.command[2]
        and f"python-envs/{step.directory}/bin/python -m coverage run -m pytest" in step.command[2]
        for step in steps
    )

    coverage = collect_coverage(root, [scan], None, None)

    assert sorted(coverage) == ["a/pkg/m.py", "b/pkg/m.py"]
    assert function_coverage(coverage["a/pkg/m.py"], 1, 2) == 0.5
    assert function_coverage(coverage["b/pkg/m.py"], 1, 2) == 0.5

    lines = log.read_text().splitlines()
    pwds = {line.split(" ")[0] for line in lines}

    assert pwds == {str((root / "a").resolve()), str((root / "b").resolve())}
    assert all(" run " in line for line in lines)
    assert [s.path for s in sources] == [
        ".recognizer/cache/coverage/projects/a/python.lcov",
        ".recognizer/cache/coverage/projects/b/python.lcov",
    ]
    assert (root / ".recognizer/cache/python-envs/a").is_dir()
    assert (root / ".recognizer/cache/python-envs/b").is_dir()
    assert not (root / "a/.recognizer").exists()


def test_a_root_only_repository_keeps_every_command_path_and_environment(tmp_path):
    root = build(tmp_path, {"pyproject.toml": PYPROJECT, "m.py": "x = 1\n", "test_m.py": ""})
    scan = scan_of("python", ["m.py"])
    steps, sources = plan(root, [scan], None, None)

    assert [project.directory for project in resolve(root, scan)] == [""]
    assert len(steps) == 1
    assert steps[0].label is None
    assert steps[0].directory == ""
    assert steps[0].command == [
        "sh",
        "-c",
        "export COVERAGE_FILE=.recognizer/cache/coverage/python.data"
        "; python3 -m coverage run -m pytest; status=$?"
        "; python3 -m coverage lcov -o .recognizer/cache/coverage/python.lcov; lcov=$?"
        "; [ $status -ne 0 ] && exit $status; exit $lcov",
    ]
    assert sources == [Source(".recognizer/cache/coverage/python.lcov", "lcov")]
    assert mutant_command(root, "python") == ["python3", "-m", "pytest", "-rfE"]
    assert tool_environment(root) is None
    assert python_runner(root) == ["python3", "-m"]

    (root / "uv.lock").write_text("")

    assert tool_environment(root) == {
        **os.environ,
        "UV_PROJECT_ENVIRONMENT": str(root / ".recognizer/cache/python-env"),
    }

    key = sensor.record_key(None, sensor.commands_for(root, [scan], None))

    assert key == {
        "commands": {
            "python": ["uv", "run", "env", "-u", "UV_PROJECT_ENVIRONMENT", "pytest", "-rfE"]
        },
        "selection": 2,
    }


def test_a_failing_project_keeps_the_other_projects_coverage_and_is_named(tmp_path, monkeypatch):
    root, scan = two_python_projects(tmp_path)
    (root / "b" / "FAIL").write_text("")
    stub(monkeypatch, tmp_path, uv=STUB_UV)
    diagnoses: list[dict] = []

    coverage = collect_coverage(root, [scan], None, None, diagnoses)

    assert sorted(coverage) == ["a/pkg/m.py"]
    assert len(diagnoses) == 1
    assert diagnoses[0]["code"] == "coverage-unavailable"
    assert "python b" in diagnoses[0]["line"]

    with pytest.raises(Refusal) as refusal:
        collect_coverage_with_tests(root, [scan], None)

    assert "python b" in refusal.value.diagnosis["line"]


def test_the_nested_lock_decides_whether_a_nested_pyproject_is_a_project(tmp_path):
    files = {
        "pyproject.toml": PYPROJECT,
        "m.py": "x = 1\n",
        "sub/pyproject.toml": PYPROJECT,
        "sub/m.py": "x = 1\n",
    }
    root = build(tmp_path / "plain", files)
    scan = scan_of("python", ["m.py", "sub/m.py"])

    assert directories(root, scan) == [""]

    locked = build(tmp_path / "locked", {**files, "sub/uv.lock": ""})

    assert directories(locked, scan) == ["", "sub"]
    assert [p.slug for p in discover(locked, scan)] == ["", "sub"]
    assert owner_of(discover(locked, scan), "sub/m.py").directory == "sub"
    assert owner_of(discover(locked, scan), "m.py").directory == ""

    ancestor = build(
        tmp_path / "ancestor",
        {
            "uv.lock": "",
            "pyproject.toml": PYPROJECT,
            "mid/pyproject.toml": PYPROJECT,
            "mid/deep/pyproject.toml": PYPROJECT,
            "mid/deep/m.py": "x = 1\n",
        },
    )

    assert directories(ancestor, scan_of("python", ["mid/deep/m.py"])) == [""]
    assert python_runner(ancestor, "mid/deep") == ["uv", "run"]
    assert (ancestor / "uv.lock").is_file()


def test_a_configured_test_command_replaces_discovery_and_coverage_replaces_only_the_pass(
    tmp_path,
):
    root, scan = two_python_projects(tmp_path)
    steps, sources = plan(root, [scan], ["make", "test"], None)

    assert [(step.label, step.command, step.directory) for step in steps] == [
        (None, ["make", "test"], "")
    ]
    assert sources == [Source(".recognizer/cache/coverage/python.lcov", "lcov")]

    steps, sources = plan(root, [scan], None, "coverage/lcov.info")

    assert steps == []
    assert sources == [Source("coverage/lcov.info", "lcov")]

    commands = sensor.commands_for(root, [scan], None, {"python": ["a", "b"]})

    assert sorted(commands) == ["python@a", "python@b"]
    assert commands["python@a"] == [
        "uv",
        "run",
        "env",
        "-u",
        "UV_PROJECT_ENVIRONMENT",
        "pytest",
        "-rfE",
    ]
    assert sensor.commands_for(root, [scan], ["x"], {"python": ["a", "b"]}) == {"python": ["x"]}


def test_the_mutant_command_and_selection_are_relative_to_the_project(tmp_path):
    root, _ = two_python_projects(tmp_path)

    assert mutant_command(root, "python", directory="a") == [
        "uv",
        "run",
        "env",
        "-u",
        "UV_PROJECT_ENVIRONMENT",
        "pytest",
        "-rfE",
    ]
    assert selected_command(
        root, "python", {"a/test_m.py", "a/other/test_x.py"}, directory="a"
    ) == [
        "uv",
        "run",
        "env",
        "-u",
        "UV_PROJECT_ENVIRONMENT",
        "pytest",
        "-rfE",
        "other/test_x.py",
        "test_m.py",
    ]
    assert selected_command(root, "python", {"b/test_m.py"}, directory="a") == mutant_command(
        root, "python", directory="a"
    )


def test_every_language_without_a_root_marker_finds_its_nested_projects(tmp_path):
    cases = {
        "typescript": (
            {"a/package.json": PACKAGE, "b/package.json": PACKAGE, "a/m.ts": "", "b/m.ts": ""},
            ["a/m.ts", "b/m.ts"],
            (),
            (),
        ),
        "kotlin": (
            {"a/gradlew": "", "b/gradlew": "", "a/M.kt": "", "b/M.kt": ""},
            ["a/M.kt", "b/M.kt"],
            ("a/gradlew", "b/gradlew"),
            (),
        ),
        "rust": (
            {"a/Cargo.toml": "", "b/Cargo.toml": "", "a/m.rs": "", "b/m.rs": ""},
            ["a/m.rs", "b/m.rs"],
            (),
            (),
        ),
        "csharp": (
            {"a/A.sln": "", "b/B.csproj": "", "a/x/X.csproj": "", "a/M.cs": "", "b/M.cs": ""},
            ["a/M.cs", "b/M.cs"],
            (),
            ("a/x",),
        ),
    }

    for language, (files, scanned, executable, skip) in cases.items():
        root = build(tmp_path / language, files, executable)
        scan = scan_of(language, scanned, skip)

        assert directories(root, scan) == ["a", "b"], language

        steps, sources = plan(root, [scan], None, None)

        assert [step.directory for step in steps] == ["a", "b"], language
        assert [step.label for step in steps] == [f"{language} a", f"{language} b"]
        assert [s.prefix for s in sources] == ["a", "b"]
        assert sources[0].path == report_path(language, Project(language, "a", "a"))


def test_a_root_marker_makes_the_root_the_only_project_in_every_language(tmp_path):
    cases = {
        "typescript": ({"package.json": PACKAGE, "a/package.json": PACKAGE, "a/m.ts": ""}, ()),
        "kotlin": ({"gradlew": "", "a/gradlew": "", "a/M.kt": ""}, ("gradlew", "a/gradlew")),
        "rust": ({"Cargo.toml": "", "a/Cargo.toml": "", "a/m.rs": ""}, ()),
        "csharp": ({"R.sln": "", "a/A.csproj": "", "a/M.cs": ""}, ()),
    }
    suffix = {"typescript": ".ts", "kotlin": ".kt", "rust": ".rs", "csharp": ".cs"}

    for language, (files, executable) in cases.items():
        root = build(tmp_path / language, files, executable)
        scan = scan_of(language, [f for f in files if f.endswith(suffix[language])])

        assert directories(root, scan) == [""], language
        assert len(plan(root, [scan], None, None)[0]) == 1


def test_a_directory_with_several_solutions_is_no_project(tmp_path):
    root = build(
        tmp_path,
        {"A.sln": "", "B.sln": "", "x/X.csproj": "", "x/M.cs": "", "M.cs": ""},
    )

    assert directories(root, scan_of("csharp", ["x/M.cs", "M.cs"])) == ["x"]


def test_typescript_projects_run_from_their_directory_and_merge_with_the_right_prefix(
    tmp_path, monkeypatch
):
    root = build(
        tmp_path,
        {"a/package.json": PACKAGE, "b/package.json": PACKAGE, "a/src/m.ts": "", "b/src/m.ts": ""},
    )
    log = stub(monkeypatch, tmp_path, npx=STUB_NPX)
    scan = scan_of("typescript", ["a/src/m.ts", "b/src/m.ts"])

    coverage = collect_coverage(root, [scan], None, None)

    assert sorted(coverage) == ["a/src/m.ts", "b/src/m.ts"]
    assert {line.split(" ")[0] for line in log.read_text().splitlines()} == {
        str((root / "a").resolve()),
        str((root / "b").resolve()),
    }


@pytest.mark.parametrize(
    ("language", "written", "expected"),
    [
        ("typescript", "src/m.ts", "p/src/m.ts"),
        ("rust", "{root}/p/src/m.rs", "p/src/m.rs"),
        ("csharp", "{root}/p/M.cs", "p/M.cs"),
    ],
)
def test_a_relative_report_path_gets_the_project_prefix_and_an_absolute_one_does_not(
    tmp_path, language, written, expected
):
    lcov = f"SF:{written.replace('{root}', str(tmp_path.resolve()))}\nDA:1,1\nend_of_record\n"
    project = Project(language, "p", "p")
    report = tmp_path / report_path(language, project).replace("*", "x")
    report.parent.mkdir(parents=True)
    report.write_text(lcov)

    source = Source(report_path(language, project).replace("*", "x"), "lcov", "p")

    assert sorted(read_source(tmp_path, source, [])) == [expected]


def test_the_kotlin_report_is_read_under_the_project_directory():
    assert (
        report_path("kotlin", Project("kotlin", "svc", "svc"))
        == "svc/**/build/reports/jacoco/test/jacocoTestReport.xml"
    )
    assert report_path("kotlin") == "**/build/reports/jacoco/test/jacocoTestReport.xml"


def test_a_non_root_cache_directory_is_absolute_and_outside_the_project(tmp_path):
    project = Project("rust", "app/src-tauri", "app__src-tauri")
    command = coverage_command(tmp_path, "rust", project=project)

    assert command[command.index("--output-path") + 1] == str(
        tmp_path / ".recognizer/cache/coverage/projects/app__src-tauri/rust.lcov"
    )
    assert coverage_command(tmp_path, "rust")[4] == ".recognizer/cache/coverage/rust.lcov"


def test_two_directories_with_the_same_slug_get_a_numbered_slug(tmp_path):
    root = build(
        tmp_path,
        {
            "a/b/Cargo.toml": "",
            "a__b/Cargo.toml": "",
            "a/b/m.rs": "",
            "a__b/m.rs": "",
        },
    )
    found = discover(root, scan_of("rust", ["a/b/m.rs", "a__b/m.rs"]))

    assert [(p.directory, p.slug) for p in found] == [("a/b", "a__b"), ("a__b", "a__b-2")]


def test_a_scanned_file_under_no_project_belongs_to_no_run(tmp_path):
    root = build(
        tmp_path,
        {"a/Cargo.toml": "", "a/m.rs": "", "loose/m.rs": ""},
    )

    assert directories(root, scan_of("rust", ["a/m.rs", "loose/m.rs"])) == ["a"]
    assert owner_of(discover(root, scan_of("rust", ["a/m.rs"])), "loose/m.rs") is None


def test_every_scanned_file_belongs_to_exactly_one_project(tmp_path):
    files = {"pyproject.toml": PYPROJECT, "m.py": ""}

    for depth in ("a", "a/b", "a/b/c", "d"):
        files[f"{depth}/pyproject.toml"] = PYPROJECT
        files[f"{depth}/uv.lock"] = ""
        files[f"{depth}/m.py"] = ""
        files[f"{depth}/x/y.py"] = ""

    root = build(tmp_path, files)
    paths = sorted(f for f in files if f.endswith(".py") and "pyproject" not in f)
    projects = discover(root, scan_of("python", paths))

    for path in paths:
        owners = [p for p in projects if within(path, p.directory)]
        deepest = max(owners, key=lambda p: len(p.directory))

        assert owner_of(projects, path) == deepest


def test_a_python_mutant_runs_in_its_project_with_its_own_environment(tmp_path, monkeypatch):
    root, _ = two_python_projects(tmp_path)
    log = stub(monkeypatch, tmp_path, uv=STUB_UV)
    work = new_work_folder(root)
    pool = EnvironmentPool(root, work, 1, ["a", "b"], {"a": "a", "b": "b"})
    seen = []
    real = runner.run_test_command

    def spy(command, cwd, timeout, environment=None):
        seen.append((command, cwd, environment))

        return real(command, cwd, timeout, environment=environment)

    monkeypatch.setattr(runner, "run_test_command", spy)
    source = b"def f():\n    return 1\n"

    for directory in ("a", "b"):
        result = runner.run_mutant(
            root,
            work,
            len(seen),
            runner.Mutant(f"{directory}/pkg/m.py", source, 0, 3, b"def"),
            ["uv", "run", "env", "-u", "UV_PROJECT_ENVIRONMENT", "pytest"],
            30.0,
            environments=pool,
            directory=directory,
        )

        assert result.verdict == "survived"

    remove_work_folder(work)
    remove_work_folder(pool.folder)

    mutants = [
        entry
        for entry in seen
        if entry[0] == ["uv", "run", "env", "-u", "UV_PROJECT_ENVIRONMENT", "pytest"]
    ]
    warms = [entry for entry in seen if entry[0] == runner.WARM_COMMAND]

    assert pool.enabled
    assert [cwd.name for _, cwd, _ in mutants] == ["a", "b"]
    assert {cwd for _, cwd, _ in warms} == {root / "a", root / "b"}
    assert {env.parent.name for _, _, env in mutants} == {"a", "b"}
    assert all(env.parent.parent == pool.folder for _, _, env in mutants)
    assert "pytest" in log.read_text()


def test_a_pool_for_a_root_uv_project_keeps_its_slot_layout(tmp_path):
    root = build(tmp_path, {"uv.lock": "", "pyproject.toml": PYPROJECT, "m.py": ""})
    work = new_work_folder(root)
    pool = EnvironmentPool(root, work, 1)

    with pool.lease() as environment:
        assert environment == pool.folder / "0"

    remove_work_folder(work)
    remove_work_folder(pool.folder)


def test_failed_files_are_repository_relative_for_a_project():
    output = "FAILED test_m.py::test_f - assert 0\n"

    assert runner.failed_files(output, {"a/test_m.py"}, "a") == frozenset({"a/test_m.py"})
    assert runner.failed_files(output, {"test_m.py"}) == frozenset({"test_m.py"})


def test_selection_is_dropped_for_a_language_with_several_projects(capsys):
    projects = [Project("kotlin", "a", "a"), Project("kotlin", "b", "b")]

    assert not single_root(projects)
    assert single_root([Project("kotlin")])
    assert projects_dropped("kotlin", projects) == {}
    assert capsys.readouterr().err == (
        "recognizer-sensors: mutation: kotlin has 2 projects; running the whole suite for kotlin\n"
    )


def test_python_context_names_become_repository_relative(tmp_path):
    from recognizer_sensors.testrun.contexts import PythonContexts
    from recognizer_sensors.testrun.run import python_selection, usable_contexts

    root = build(tmp_path, {"a/test_m.py": "", "a/pkg/m.py": ""})
    projects = [Project("python", "a", "a")]
    selection = python_selection(root, {}, projects)
    reader = selection.readers[0]

    assert isinstance(reader, PythonContexts)
    assert reader.directory == "a"
    assert reader.data_path == ".recognizer/cache/coverage/projects/a/python.data"
    assert usable_contexts(["test_m.py"], root / "a") == frozenset({"test_m.py"})


@pytest.mark.real_probes
def test_the_probe_asks_each_project_and_names_the_one_that_is_missing_a_tool(
    tmp_path, monkeypatch
):
    root = build(
        tmp_path,
        {"sensors/pyproject.toml": PYPROJECT, "sensors/uv.lock": "", "sensors/m.py": ""},
    )
    log = stub(
        monkeypatch,
        tmp_path,
        uv='#!/bin/sh\necho "$PWD $*" >> "$STUB_LOG"\necho coverage\n',
    )
    found = probe(root, [scan_of("python", ["sensors/m.py"])], {})

    assert found.diagnosis is None
    assert found.borrowed == {"sensors": ["--with", "coverage"]}
    assert log.read_text().split(" ")[0] == str((root / "sensors").resolve())

    only = tmp_path / "bin2"
    only.mkdir()
    monkeypatch.setenv("PATH", f"{only}:/usr/bin:/bin")
    (only / "python3").write_text('#!/bin/sh\necho "coverage pytest"\n')
    (only / "python3").chmod(0o755)
    plain = build(
        tmp_path / "plain", {"x/pyproject.toml": PYPROJECT, "x/poetry.lock": "", "x/m.py": ""}
    )
    (only / "poetry").write_text('#!/bin/sh\necho "coverage"\n')
    (only / "poetry").chmod(0o755)
    missing = probe(plain, [scan_of("python", ["x/m.py"])], {})

    assert missing.diagnosis is not None
    assert missing.diagnosis["line"].startswith("x/: ")


@pytest.mark.real_probes
def test_a_typescript_project_finds_a_hoisted_install_at_the_root(tmp_path, monkeypatch):
    root = build(
        tmp_path,
        {
            "app/package.json": '{"scripts": {"test": "t"}, "devDependencies": {"x": "1"}}',
            "app/m.ts": "",
        },
    )
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()

    for name in ("npm", "npx"):
        (bin_directory / name).write_text("#!/bin/sh\n")
        (bin_directory / name).chmod(0o755)

    monkeypatch.setenv("PATH", f"{bin_directory}:/usr/bin:/bin")
    scan = scan_of("typescript", ["app/m.ts"])

    assert "dependencies are not installed" in probe(root, [scan], {}).diagnosis["line"]

    (root / "node_modules").mkdir()

    assert probe(root, [scan], {}).diagnosis is None


def test_the_real_repository_layout_is_discovered():
    files = [f for f in listed_files(REPOSITORY) if not f.startswith(("fixtures/", "validation/"))]
    suffixes = {
        "python": ".py",
        "typescript": ".ts",
        "rust": ".rs",
        "kotlin": ".kt",
        "csharp": ".cs",
    }
    found = {
        language: [
            p.directory
            for p in discover(
                REPOSITORY, scan_of(language, [f for f in files if f.endswith(suffix)]), files
            )
        ]
        for language, suffix in suffixes.items()
    }

    assert found == {
        "python": ["scanners/csharp", "scanners/kotlin", "scanners/python", "sensors"],
        "typescript": ["app", "check", "describers/claude", "scanners/typescript"],
        "rust": ["app/src-tauri", "scanners/rust"],
        "kotlin": [],
        "csharp": [],
    }


def test_lcov_prefix_leaves_absolute_and_dot_paths_consistent(tmp_path):
    text = "SF:./pkg/m.py\nDA:1,1\nend_of_record\nSF:/elsewhere/x.py\nDA:1,1\nend_of_record\n"

    assert sorted(parse_lcov(text, tmp_path, "a")) == ["a/pkg/m.py"]
    assert normalise_path("./pkg/m.py", tmp_path) == "pkg/m.py"
    assert profiles.report_path("python", Project("python", "a", "a")).startswith(
        ".recognizer/cache/coverage/projects/a/"
    )


def test_run_steps_runs_a_step_in_its_directory(tmp_path, monkeypatch):
    root = build(tmp_path, {"a/x.txt": ""})
    log = stub(monkeypatch, tmp_path, tool='#!/bin/sh\npwd >> "$STUB_LOG"\n')
    from recognizer_sensors.testrun.run import Step

    run_steps(root, [Step("t", ["tool"], None, "a")])

    assert log.read_text().strip() == str((root / "a").resolve())
