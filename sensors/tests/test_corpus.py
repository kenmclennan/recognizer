import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from conftest import REPOSITORY, git_commit, write_scans

from recognizer_sensors.cli import main

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

    for run, coverage in (("lcov", "coverage/lcov.info"), ("jacoco", "coverage/jacoco.xml")):
        findings = run_sensor(
            "crap", root, work / f"crap-{run}.json", {"coverage": coverage}, commit="c1"
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
    run_sensor(
        "crap",
        root,
        work / "thresholds-crap.json",
        {"coverage": "coverage/lcov.info", "threshold": 1000000},
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


MUTATION_COMMANDS = {
    "python": [sys.executable, "tests/run.py"],
    "typescript": ["node", "--experimental-strip-types", "--no-warnings", "tests/run.ts"],
    "csharp": [sys.executable, "tests/run_csharp.py"],
}


@pytest.fixture(scope="module")
def mutation_runs(work):
    runs = {}

    for language, command in MUTATION_COMMANDS.items():
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
            {"test_command": command, "coverage": "coverage/lcov.info", "max_workers": 2},
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


@pytest.fixture(scope="module")
def mutation_git_copy_run(work):
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
        {
            "test_command": MUTATION_COMMANDS["python"],
            "coverage": "coverage/lcov.info",
            "max_workers": 2,
        },
        commit=commit,
    )
    survivors = json.loads((root / ".recognizer/cache/mutation/survivors.json").read_text())

    return findings, read_overlay(root, "mutation"), survivors


def test_the_python_mutation_corpus_through_a_git_copy_matches_expected(mutation_git_copy_run):
    findings, overlay, survivors = mutation_git_copy_run
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
