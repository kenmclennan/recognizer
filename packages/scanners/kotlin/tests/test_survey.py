import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

from recognizer_scan_kotlin.survey import survey

REPOSITORY = Path(__file__).resolve().parents[4]
LAUNCH = "import sys; from recognizer_scan_kotlin.cli import main; sys.exit(main())"
KOTLIN_BUILD = 'plugins {\n    kotlin("jvm") version "2.0.0"\n    id("jacoco")\n}\n'
COMMAND = "./gradlew cleanTest test jacocoTestReport"
DEFAULT_PATH = "build/reports/jacoco/test/jacocoTestReport.xml"

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


def answer_of(root: Path, suites: list[dict] | None = None, files: list[str] | None = None) -> dict:
    request = {
        "root": str(root),
        "files": files_under(root) if files is None else files,
        "suites": suites or [],
    }
    answer = survey(request)

    VALIDATOR.validate(answer)

    return answer


def test_a_kotlin_dsl_build_with_jacoco_gives_one_runner_with_the_command_and_the_default_path(
    tmp_path,
):
    answer = answer_of(
        tree(
            tmp_path,
            {"build.gradle.kts": KOTLIN_BUILD, "gradlew": "", "src/main/kotlin/A.kt": "class A\n"},
        )
    )

    assert len(answer["runners"]) == 1
    assert answer["runners"][0] == {
        "language": "kotlin",
        "runner": "gradle",
        "directory": ".",
        "from": "build.gradle.kts",
        "command": COMMAND,
        "coverage": {"path": DEFAULT_PATH, "format": "jacoco"},
        "tool": None,
    }
    assert answer["tools"] == []
    assert answer["notes"] == []


def test_a_groovy_build_with_xml_outputlocation_gives_that_path(tmp_path):
    groovy = answer_of(
        tree(
            tmp_path / "a",
            {
                "build.gradle": (
                    "plugins {\n    id 'jacoco'\n}\njacocoTestReport {\n    reports {\n"
                    "        xml.outputLocation = "
                    "layout.buildDirectory.file('coverage/jacoco.xml')\n    }\n}\n"
                ),
                "gradlew": "",
            },
        )
    )
    kotlin = answer_of(
        tree(
            tmp_path / "b",
            {
                "build.gradle.kts": (
                    f"{KOTLIN_BUILD}tasks.jacocoTestReport {{\n    reports {{\n"
                    '        xml.outputLocation.set(layout.buildDirectory.file("coverage/j.xml"))'
                    "\n    }\n}\n"
                ),
                "gradlew": "",
            },
        )
    )

    assert len(groovy["runners"]) == 1
    assert groovy["runners"][0]["coverage"]["path"] == "build/coverage/jacoco.xml"
    assert len(kotlin["runners"]) == 1
    assert kotlin["runners"][0]["coverage"]["path"] == "build/coverage/j.xml"


def test_a_build_with_a_pacttest_task_gives_only_the_test_suite(tmp_path):
    answer = answer_of(
        tree(
            tmp_path,
            {
                "build.gradle.kts": (
                    f"{KOTLIN_BUILD}val pactTest by tasks.registering(Test::class) {{ }}\n"
                    'tasks.register<Test>("integrationTest") { }\n'
                ),
                "gradlew": "",
                "src/pactTest/kotlin/P.kt": "class P\n",
                "src/main/kotlin/A.kt": "class A\n",
            },
        )
    )

    assert len(answer["runners"]) == 1
    assert "test" in answer["runners"][0]["command"]
    assert "pactTest" not in answer["runners"][0]["command"]
    assert "integrationTest" not in answer["runners"][0]["command"]


def test_a_build_without_jacoco_gives_no_runner_and_the_add_jacoco_note(tmp_path):
    answer = answer_of(
        tree(
            tmp_path,
            {
                "build.gradle.kts": 'plugins {\n    id("io.micronaut.application")\n}\n',
                "gradlew": "",
                "src/main/kotlin/A.kt": "class A\n",
            },
        )
    )

    assert answer["runners"] == []
    assert len(answer["notes"]) == 1
    assert answer["notes"][0]["directory"] == "."
    assert 'id("jacoco")' in answer["notes"][0]["text"]
    assert "build.gradle.kts" in answer["notes"][0]["text"]


def test_a_build_with_no_kotlin_sources_and_no_jacoco_gives_no_gradle_note(tmp_path):
    java_only = answer_of(
        tree(
            tmp_path / "a",
            {
                "build.gradle.kts": "plugins {\n    java\n}\n",
                "src/main/java/A.java": "class A {}\n",
            },
        )
    )
    untracked = answer_of(
        tree(
            tmp_path / "b",
            {"build.gradle.kts": "plugins {\n    java\n}\n", "bin/main/A.kt": "class A\n"},
        )
    )

    for answer in (java_only, untracked):
        assert answer["runners"] == []
        assert not any("JaCoCo" in note["text"] for note in answer["notes"])


def test_an_unreadable_report_path_gives_the_default_path_and_a_note(tmp_path):
    dollar = tree(
        tmp_path / "a",
        {
            "build.gradle.kts": (
                f"{KOTLIN_BUILD}tasks.jacocoTestReport {{\n"
                '    reports.xml.outputLocation = file("${buildDir}/x.xml")\n}\n'
            ),
            "gradlew": "",
        },
    )
    two = tree(
        tmp_path / "b",
        {
            "build.gradle": (
                "plugins {\n    id 'jacoco'\n}\n"
                "a { xml.outputLocation = layout.buildDirectory.file('a.xml') }\n"
                "b { xml.outputLocation = layout.buildDirectory.file('b.xml') }\n"
            ),
            "gradlew": "",
        },
    )

    for directory in (dollar, two):
        answer = answer_of(directory)

        assert len(answer["runners"]) == 1
        assert answer["runners"][0]["coverage"]["path"] == DEFAULT_PATH
        assert any("may differ" in note["text"] for note in answer["notes"])


def test_jacoco_applied_only_from_subprojects_gives_no_runner(tmp_path):
    answer = answer_of(
        tree(
            tmp_path,
            {
                "build.gradle": "subprojects {\n    apply plugin: 'jacoco'\n}\n",
                "gradlew": "",
                "src/main/kotlin/A.kt": "class A\n",
            },
        )
    )

    assert answer["runners"] == []
    assert any('id("jacoco")' in note["text"] for note in answer["notes"])


def test_each_subproject_with_a_build_file_is_its_own_suite_and_finds_the_wrapper_above_it(
    tmp_path,
):
    answer = answer_of(
        tree(
            tmp_path,
            {
                "gradlew": "",
                "settings.gradle.kts": 'include("svc-a", "svc-b")\n',
                "svc-a/build.gradle.kts": KOTLIN_BUILD,
                "svc-a/src/main/kotlin/A.kt": "class A\n",
                "svc-b/build.gradle.kts": 'plugins {\n    kotlin("jvm")\n}\n',
                "svc-b/src/main/kotlin/B.kt": "class B\n",
            },
        )
    )

    assert len(answer["runners"]) == 1
    assert answer["runners"][0]["directory"] == "svc-a"
    assert answer["runners"][0]["command"] == "../gradlew cleanTest test jacocoTestReport"
    assert len(answer["notes"]) == 1
    assert answer["notes"][0]["directory"] == "svc-b"
    assert 'id("jacoco")' in answer["notes"][0]["text"]


def test_no_wrapper_gives_the_assumed_command_and_a_note(tmp_path):
    answer = answer_of(
        tree(tmp_path, {"build.gradle.kts": KOTLIN_BUILD, "src/main/kotlin/A.kt": "class A\n"})
    )

    assert len(answer["runners"]) == 1
    assert answer["runners"][0]["command"] == COMMAND
    assert any("no Gradle wrapper" in note["text"] for note in answer["notes"])


def test_a_configured_suite_hides_the_runner_and_the_note(tmp_path):
    answer = answer_of(
        tree(tmp_path, {"build.gradle.kts": KOTLIN_BUILD, "src/main/kotlin/A.kt": "class A\n"}),
        suites=[{"language": "kotlin", "directory": "."}],
    )

    assert answer["runners"] == []
    assert answer["notes"] == []


def test_the_survey_reads_the_build_and_runs_no_gradle(tmp_path, monkeypatch):
    root = tree(
        tmp_path,
        {"build.gradle.kts": KOTLIN_BUILD, "gradlew": "", "src/main/kotlin/A.kt": "class A\n"},
    )
    calls: list[object] = []

    def refuse(*args, **kwargs):
        calls.append(args)

        raise AssertionError("the survey started a process")

    monkeypatch.setattr(subprocess, "run", refuse)
    monkeypatch.setattr(subprocess, "Popen", refuse)

    answer = answer_of(root)

    assert len(answer["runners"]) == 1
    assert calls == []


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


def test_the_survey_of_this_repository_lists_its_real_gradle_fixtures():
    answer = answer_of(REPOSITORY, files=git_files(REPOSITORY))
    runner = next(
        one
        for one in answer["runners"]
        if one["language"] == "kotlin" and one["directory"] == "fixtures/mutation/kotlin"
    )

    assert runner["command"] == COMMAND
    assert runner["coverage"]["path"] == DEFAULT_PATH
    assert any(
        note["directory"] == "fixtures/mutation/kotlin" and "no Gradle wrapper" in note["text"]
        for note in answer["notes"]
    )
    assert any(
        note["directory"] == "fixtures/kotlin/sample/app" and "no JaCoCo" in note["text"]
        for note in answer["notes"]
    )


def test_the_survey_verb_answers_a_request_file_and_exits_zero(tmp_path):
    root = tree(
        tmp_path / "repo",
        {"build.gradle.kts": KOTLIN_BUILD, "gradlew": "", "src/main/kotlin/A.kt": "class A\n"},
    )
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

    assert [one["from"] for one in answer["runners"]] == ["build.gradle.kts"]


def test_the_survey_verb_exits_two_for_a_request_file_that_is_not_there(tmp_path):
    result = subprocess.run(
        [sys.executable, "-c", LAUNCH, "survey", str(tmp_path / "missing.json")],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
