import json
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from conftest import REPOSITORY, git_commit, shim_suite, write_scans

from recognizer_sensors.cli import main
from recognizer_sensors.mutation import runner

FIXTURES = REPOSITORY / "fixtures"
OVERLAYS = Path(".recognizer") / "cache" / "overlays"
PENDING = "pending-filing"


def load(sensor: str) -> dict:
    return json.loads((FIXTURES / sensor / "corpus" / "expected.json").read_text())


def cases_of(sensor: str) -> list:
    return [
        pytest.param(
            case,
            id=case["id"],
            marks=[pytest.mark.xfail(strict=True, reason=str(case["known_defect"]))]
            if case["known_defect"] is not None
            else [],
        )
        for case in load(sensor)["cases"]
    ]


def run_sensor(name: str, root: Path, output: Path, settings: dict, commit: str | None = None):
    argv = [
        name,
        "--repository",
        str(root),
        "--output",
        str(output),
        "--settings",
        json.dumps(settings),
    ]

    if commit is not None:
        argv += ["--commit", commit]

    assert main(argv) == 0

    return json.loads(output.read_text())["findings"]


def read_overlay(root: Path, name: str) -> dict:
    return json.loads((root / OVERLAYS / f"{name}.json").read_text())


def exactly(wanted: set[str], got: set[str]) -> dict:
    return {"missing": sorted(wanted - got), "extra": sorted(got - wanted)}


def finding_named(findings: list, finding_id: str) -> dict | None:
    return next((f for f in findings if f["id"] == finding_id), None)


@pytest.fixture(scope="module")
def work():
    with tempfile.TemporaryDirectory(prefix="recognizer-corpus-") as folder:
        yield Path(folder)


def copy_corpus(sensor: str, destination: Path, *ignore: str) -> Path:
    shutil.copytree(
        FIXTURES / sensor / "corpus",
        destination,
        ignore=shutil.ignore_patterns("expected.json", *ignore),
    )

    return destination


@pytest.fixture(scope="module")
def crap_runs(work):
    root = copy_corpus(
        "crap", work / "crap", "native", "tests", "lib.rs", "Cargo.toml", "Cargo.lock"
    )
    write_scans(root)
    runs = {}
    reports = {
        "lcov": (("python", "typescript", "rust", "csharp"), "coverage/lcov.info", "lcov"),
        "jacoco": (("kotlin",), "coverage/jacoco.xml", "jacoco"),
    }

    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("SHELL", "/bin/sh")

        for run, (languages, report, format_) in reports.items():
            tests = [
                {
                    "name": language,
                    "language": language,
                    "directory": ".",
                    "command": f"touch {report}",
                    "coverage": {"path": report, "format": format_},
                    **({"runner": "vitest"} if language == "typescript" else {}),
                }
                for language in languages
            ]
            findings = run_sensor(
                "crap", root, work / f"crap-{run}.json", {"tests": tests}, commit="c1"
            )
            runs[run] = (findings, read_overlay(root, "crap"))

    return runs


def test_the_crap_corpus_labels_60_functions_12_in_each_language():
    cases = load("crap")["cases"]

    assert len(cases) == 60
    assert {c["language"] for c in cases} == {
        "python",
        "typescript",
        "kotlin",
        "rust",
        "csharp",
    }
    assert [sum(1 for c in cases if c["language"] == lang) for lang in ("python",)] == [12]
    assert sorted(c["measures"]["complexity"] for c in cases if c["language"] == "rust") == list(
        range(1, 13)
    )
    assert sorted(c["measures"]["complexity"] for c in cases if c["language"] == "csharp") == list(
        range(1, 13)
    )


@pytest.mark.parametrize("run", ["lcov", "jacoco"])
def test_the_crap_findings_are_exactly_the_labelled_ones(crap_runs, run):
    findings, _ = crap_runs[run]
    wanted = {
        c["finding_id"]
        for c in load("crap")["cases"]
        if c["run"] == run and c["expect"] == "finding" and c["known_defect"] is None
    }

    assert exactly(wanted, {f["id"] for f in findings}) == {"missing": [], "extra": []}


@pytest.mark.parametrize("case", cases_of("crap"))
def test_crap_measures_match_the_hand_derivation(crap_runs, case):
    findings, overlay = crap_runs[case["run"]]
    identity = case["finding_id"].removeprefix("crap:")
    values = overlay["values"]
    measures = case["measures"]

    assert values["complexity"].get(identity) == measures["complexity"]
    assert values["coverage"].get(identity) == measures.get("coverage")
    assert values["crap"].get(identity) == measures.get("crap")

    finding = finding_named(findings, case["finding_id"])

    if case["expect"] == "no-finding":
        assert finding is None
    else:
        assert finding is not None
        assert finding["evidence"]["measures"] == measures


@pytest.fixture(scope="module")
def thresholds_repository(work):
    root = copy_corpus("thresholds", work / "thresholds", "overlays")
    write_scans(root)
    commit = git_commit(root)
    scanned = sorted(p.name.split(".")[1] for p in (root / OVERLAYS.parent).glob("scan.*.json"))
    tests = [
        {
            "name": language,
            "language": language,
            "directory": ".",
            "command": "touch coverage/lcov.info",
            "coverage": {"path": "coverage/lcov.info", "format": "lcov"},
            **({"runner": "vitest"} if language == "typescript" else {}),
        }
        for language in scanned
    ]

    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("SHELL", "/bin/sh")
        run_sensor(
            "crap",
            root,
            work / "thresholds-crap.json",
            {"tests": tests, "threshold": 1000000},
        )

    return root, commit


@pytest.fixture(scope="module")
def thresholds_runs(thresholds_repository, work):
    root, _ = thresholds_repository
    custom = {"complexity": {"above": 11, "severity": "violation"}, "coverage": {"below": 0.61}}

    return {
        "default": run_sensor("thresholds", root, work / "thresholds-default.json", {}),
        "custom": run_sensor("thresholds", root, work / "thresholds-custom.json", custom),
    }


def test_the_thresholds_corpus_plants_50_functions_10_in_each_language():
    planted = load("thresholds")["planted"]

    assert len(planted) == 50
    assert [
        sum(1 for p in planted if p["language"] == lang) for lang in ("python", "kotlin", "csharp")
    ] == [10, 10, 10]
    assert len(load("thresholds")["cases"]) == 200


@pytest.mark.parametrize("run", ["default", "custom"])
def test_the_thresholds_findings_are_exactly_the_labelled_ones(thresholds_runs, run):
    wanted = {
        c["finding_id"]
        for c in load("thresholds")["cases"]
        if c["run"] == run and c["expect"] == "finding" and c["known_defect"] is None
    }

    assert exactly(wanted, {f["id"] for f in thresholds_runs[run]}) == {
        "missing": [],
        "extra": [],
    }


@pytest.mark.parametrize("case", cases_of("thresholds"))
def test_thresholds_follow_the_line_at_each_planted_value(thresholds_runs, case):
    finding = finding_named(thresholds_runs[case["run"]], case["finding_id"])

    if case["expect"] == "no-finding":
        assert finding is None

        return

    assert finding is not None
    assert finding["severity"] == case["severity"]
    assert finding["evidence"]["measures"] == case["measures"]


def prepare_overlay(root: Path, commit: str, name: str, file: str) -> Path:
    folder = root / OVERLAYS
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    text = (FIXTURES / "thresholds" / "corpus" / "overlays" / file).read_text()
    (folder / file).write_text(text.replace("COMMIT", commit))

    return folder


def test_a_mixed_overlay_resolves_what_it_can_and_counts_the_rest(
    thresholds_repository, work, capsys
):
    root, commit = thresholds_repository
    expected = load("thresholds")["mixed"]
    prepare_overlay(root, commit, "mixed", "mixed.json")
    findings = run_sensor("thresholds", root, work / "mixed.json", {})
    captured = capsys.readouterr().err
    ids = {f["id"]: f for f in findings}

    assert sorted(ids) == sorted(f["finding_id"] for f in expected["findings"])

    for wanted in expected["findings"]:
        assert ids[wanted["finding_id"]]["evidence"]["measures"] == wanted["measures"]

    for absent in expected["absent"]:
        assert absent not in ids

    for metric, count in expected["unresolved"].items():
        assert f"{count} ids of {metric} in mixed.json match no scanned module; skipped" in captured


def test_an_overlay_from_another_commit_produces_nothing(thresholds_repository, work, capsys):
    root, commit = thresholds_repository
    expected = load("thresholds")["stale"]
    prepare_overlay(root, commit, "stale", "stale.json")
    findings = run_sensor("thresholds", root, work / "stale.json", {})
    captured = capsys.readouterr().err

    assert findings == expected["findings"]
    assert (
        f"overlay stale.json is from commit {expected['skipped_commit']}, not {commit}; skipped"
        in captured
    )


def node_strips_types() -> bool:
    try:
        result = subprocess.run(
            ["node", "--experimental-strip-types", "--no-warnings", "-e", "0"],
            capture_output=True,
            check=False,
        )
    except OSError:
        return False

    return result.returncode == 0


def mutation_suites(**shim):
    python = shlex.quote(sys.executable)
    node = "node --experimental-strip-types --no-warnings tests/run.ts"

    return {
        "python": shim_suite(f"{python} tests/run.py", **shim),
        "typescript": shim_suite(node, tool="npx", language="typescript", runner="vitest", **shim),
        "csharp": shim_suite(
            f"{python} tests/run_csharp.py", tool="dotnet", language="csharp", **shim
        ),
    }


MUTATION_SUITES = mutation_suites()


@pytest.fixture(scope="module")
def mutation_runs(work):
    runs = {}

    for language, suite in MUTATION_SUITES.items():
        if language == "typescript" and not node_strips_types():
            continue

        root = copy_corpus("mutation", work / f"mutation-{language}", "scan.*.json")
        commit = git_commit(root)
        cache = root / ".recognizer" / "cache"
        cache.mkdir(parents=True)
        shutil.copy(
            FIXTURES / "mutation" / "corpus" / f"scan.{language}.json",
            cache / f"scan.{language}.json",
        )
        findings = run_sensor(
            "mutation",
            root,
            work / f"mutation-{language}.json",
            {"tests": [suite], "max_workers": 2},
            commit=commit,
        )
        survivors = json.loads((root / ".recognizer/cache/mutation/survivors.json").read_text())
        runs[language] = (findings, read_overlay(root, "mutation"), survivors)

    return runs


def test_the_mutation_corpus_labels_24_functions_8_in_each_language():
    cases = load("mutation")["cases"]

    assert len(cases) == 24
    assert sum(1 for c in cases if c["language"] == "python") == 8
    assert sum(1 for c in cases if c["language"] == "csharp") == 8
    assert all(c["derivation"].strip() for c in cases)
    assert all(c["survivors"] and c["survivors"][0]["reason"] for c in cases if c["survivors"])


@pytest.mark.parametrize("language", ["python", "typescript", "csharp"])
def test_the_mutation_findings_are_exactly_the_labelled_ones(mutation_runs, language):
    if language not in mutation_runs:
        pytest.skip("node cannot strip TypeScript types here")

    findings = mutation_runs[language][0]
    wanted = {
        c["finding_id"]
        for c in load("mutation")["cases"]
        if c["language"] == language and c["expect"] == "finding" and c["known_defect"] is None
    }

    assert exactly(wanted, {f["id"] for f in findings}) == {"missing": [], "extra": []}


@pytest.mark.parametrize("case", cases_of("mutation"))
def test_mutation_counts_and_survivors_match_the_reading_of_the_tests(mutation_runs, case):
    language = case["language"]

    if language not in mutation_runs:
        pytest.skip("node cannot strip TypeScript types here")

    findings, overlay, survivors = mutation_runs[language]
    identity = case["finding_id"].removeprefix("mutation:")
    values = overlay["values"]
    measures = case["measures"]

    for name in ("killed", "survived", "uncovered"):
        assert values[name].get(identity) == measures[name]

    assert values["score"].get(identity) == measures.get("score")

    listed = survivors["functions"].get(identity, {}).get("survivors", [])
    wanted = [
        {"line": s["line"], "operator": s["operator"], "replacement": s["replacement"]}
        for s in case["survivors"]
    ]

    assert listed == wanted
    assert (finding_named(findings, case["finding_id"]) is not None) == (
        case["expect"] == "finding"
    )


POOLED_COPIES: dict[str, int] = {}


def counting_pooled_copies(name: str):
    real = runner.copy_repository
    POOLED_COPIES[name] = 0

    def counted(*args, **kwargs):
        if kwargs.get("plan") is not None:
            POOLED_COPIES[name] += 1

        return real(*args, **kwargs)

    patch = pytest.MonkeyPatch()
    patch.setattr(runner, "copy_repository", counted)

    return patch


def mutants_run(overlay: dict) -> int:
    values = overlay["values"]

    return sum(sum(values[name].values()) for name in ("killed", "survived"))


@pytest.fixture(scope="module")
def mutation_git_copy_run(work):
    patch = counting_pooled_copies("git-copy")
    root = copy_corpus("mutation", work / "mutation-git-copy", "scan.*.json")
    (root / ".gitignore").write_text(".worktrees/\n")
    stray = root / ".worktrees" / "checkout"
    stray.mkdir(parents=True)
    (stray / "big.txt").write_text("x" * 1000)
    commit = git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(
        FIXTURES / "mutation" / "corpus" / "scan.python.json",
        cache / "scan.python.json",
    )
    findings = run_sensor(
        "mutation",
        root,
        work / "mutation-git-copy.json",
        {"tests": [MUTATION_SUITES["python"]], "max_workers": 2},
        commit=commit,
    )
    patch.undo()
    survivors = json.loads((root / ".recognizer/cache/mutation/survivors.json").read_text())

    return findings, read_overlay(root, "mutation"), survivors


def assert_python_mutation_matches_expected(run):
    findings, overlay, survivors = run
    cases = [
        c
        for c in load("mutation")["cases"]
        if c["language"] == "python" and c["known_defect"] is None
    ]
    values = overlay["values"]

    assert cases

    for case in cases:
        identity = case["finding_id"].removeprefix("mutation:")

        for name in ("killed", "survived", "uncovered"):
            assert values[name].get(identity) == case["measures"][name]

        assert values["score"].get(identity) == case["measures"].get("score")

        listed = survivors["functions"].get(identity, {}).get("survivors", [])
        wanted = [
            {"line": x["line"], "operator": x["operator"], "replacement": x["replacement"]}
            for x in case["survivors"]
        ]

        assert listed == wanted
        assert (finding_named(findings, case["finding_id"]) is not None) == (
            case["expect"] == "finding"
        )


def test_the_python_mutation_corpus_through_a_git_copy_matches_expected(mutation_git_copy_run):
    assert_python_mutation_matches_expected(mutation_git_copy_run)


def test_the_git_copy_corpus_run_makes_fewer_mutant_copies_than_it_runs_mutants(
    mutation_git_copy_run,
):
    _, overlay, _ = mutation_git_copy_run

    assert 0 < POOLED_COPIES["git-copy"] <= 2
    assert POOLED_COPIES["git-copy"] < mutants_run(overlay)


@pytest.fixture(scope="module")
def mutation_suite_run(work):
    patch = counting_pooled_copies("suite")
    root = copy_corpus("mutation", work / "mutation-suite", "scan.*.json")
    (root / ".gitignore").write_text(".venv/\n")
    subprocess.run(["uv", "venv", "-q"], cwd=root, check=True, capture_output=True)
    commit = git_commit(root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(
        FIXTURES / "mutation" / "corpus" / "scan.python.json",
        cache / "scan.python.json",
    )
    suite = mutation_suites(prefix=". .venv/bin/activate && ")["python"]
    findings = run_sensor(
        "mutation",
        root,
        work / "mutation-suite.json",
        {"tests": [suite], "carry": [".venv"], "max_workers": 2},
        commit=commit,
    )
    patch.undo()
    survivors = json.loads((root / ".recognizer/cache/mutation/survivors.json").read_text())

    return findings, read_overlay(root, "mutation"), survivors


@pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH")
def test_the_python_mutation_corpus_through_a_suite_matches_expected(mutation_suite_run):
    assert_python_mutation_matches_expected(mutation_suite_run)


@pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv on PATH")
def test_the_suite_corpus_run_makes_fewer_mutant_copies_than_it_runs_mutants(mutation_suite_run):
    _, overlay, _ = mutation_suite_run

    assert 0 < POOLED_COPIES["suite"] <= 2
    assert POOLED_COPIES["suite"] < mutants_run(overlay)
