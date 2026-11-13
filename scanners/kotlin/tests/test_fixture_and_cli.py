import hashlib
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from conftest import (
    EXPECTED_SCAN,
    FIXTURE_ROOT,
    REPOSITORY,
    build_tree,
    edges_of,
    member,
    validate,
    without_events,
)

from recognizer_scan_kotlin import scan
from recognizer_scan_kotlin.discovery import selection

CONSOLE_SCRIPT = Path(sys.executable).parent / "recognizer-scan-kotlin"
MAIN = "app/src/main/kotlin/shop"
TEST = "app/src/test/kotlin/shop"


def expected() -> dict:
    return json.loads(EXPECTED_SCAN.read_text())


def edge_pairs(document: dict, kind: str = "depends") -> set[tuple[str, str]]:
    return {(e["from"], e["to"]) for e in document["edges"] if e["kind"] == kind}


def run_bare(*args):
    return subprocess.run([str(CONSOLE_SCRIPT), *args], capture_output=True, text=True)


def run_cli(*args):
    return run_bare("run", *args)


def test_fixture_matches_expected_scan():
    actual = scan(FIXTURE_ROOT, None)
    wanted = expected()

    assert actual["scanner"]["name"] == wanted["scanner"]["name"]
    assert actual["scanner"]["version"] == version("recognizer-scan-kotlin")

    wanted["scanner"]["version"] = actual["scanner"]["version"]

    assert actual == wanted
    validate(actual)


def test_the_fixture_has_ten_file_modules_in_path_order():
    document = scan(FIXTURE_ROOT, None)
    ids = [m["id"] for m in document["modules"]]

    assert ids == sorted(ids)
    assert ids == [
        f"{MAIN}/{name}"
        for name in (
            "application/PlaceOrder.kt",
            "application/UseCase.kt",
            "clients/PaymentClient.kt",
            "config/Paths.kt",
            "domain/Currency.kt",
            "domain/Order.kt",
            "persistence/JdbcOrderStore.kt",
            "persistence/OrderRepository.kt",
            "ports/OrderStore.kt",
            "web/OrderController.kt",
        )
    ]
    assert {m["id"]: m["kind"] for m in document["modules"] if m["kind"] != "module"} == {
        f"{MAIN}/clients/PaymentClient.kt": "interface",
        f"{MAIN}/persistence/OrderRepository.kt": "interface",
        f"{MAIN}/ports/OrderStore.kt": "interface",
    }


def test_the_fixture_edges_hold_the_listed_relationships():
    document = scan(FIXTURE_ROOT, None)
    depends = edge_pairs(document)
    jdbc = f"{MAIN}/persistence/JdbcOrderStore.kt"

    assert len(document["edges"]) == 20
    assert len(depends) == 19
    assert (f"{MAIN}/web/OrderController.kt", f"{MAIN}/application/PlaceOrder.kt") in depends
    assert (f"{MAIN}/web/OrderController.kt", f"{MAIN}/config/Paths.kt") in depends
    assert (f"{MAIN}/application/PlaceOrder.kt", f"{MAIN}/ports/OrderStore.kt") in depends
    assert edge_pairs(document, "implements") == {(jdbc, f"{MAIN}/ports/OrderStore.kt")}
    assert (jdbc, "foreign:shop.generated") in depends
    assert (
        f"{MAIN}/persistence/OrderRepository.kt",
        "foreign:io.micronaut.data.repository",
    ) in depends
    assert not any(m["id"].startswith(TEST) for m in document["modules"])


def test_the_fixture_same_directory_references_are_edges_between_files():
    document = scan(FIXTURE_ROOT, None)
    use_case = next(
        e
        for e in edges_of(document, f"{MAIN}/application/PlaceOrder.kt")
        if e["to"] == f"{MAIN}/application/UseCase.kt"
    )
    repository = next(
        e
        for e in edges_of(document, f"{MAIN}/persistence/JdbcOrderStore.kt")
        if e["to"] == f"{MAIN}/persistence/OrderRepository.kt"
    )

    assert use_case["names"] == ["UseCase"]
    assert repository["names"] == ["OrderRepository"]


def test_the_fixture_wildcard_names_only_the_used_domain_names():
    document = scan(FIXTURE_ROOT, None)
    domain = next(
        e
        for e in edges_of(document, f"{MAIN}/web/OrderController.kt")
        if e["to"] == f"{MAIN}/domain/Order.kt"
    )

    assert domain["names"] == ["Order", "total"]


def test_the_fixture_alias_edge_names_the_real_name_not_the_alias():
    document = scan(FIXTURE_ROOT, None)
    ports = next(
        e
        for e in edges_of(document, f"{MAIN}/application/PlaceOrder.kt")
        if e["to"] == f"{MAIN}/ports/OrderStore.kt"
    )

    assert ports["names"] == ["OrderStore"]


def test_the_fixture_template_only_use_makes_the_config_edge():
    document = scan(FIXTURE_ROOT, None)
    config = next(
        e
        for e in edges_of(document, f"{MAIN}/web/OrderController.kt")
        if e["to"] == f"{MAIN}/config/Paths.kt"
    )

    assert config["names"] == ["BASE"]


def test_the_fixture_lists_one_unresolved_import():
    assert scan(FIXTURE_ROOT, None)["unresolved_imports"] == [
        {
            "from": f"{MAIN}/persistence/JdbcOrderStore.kt",
            "import": "shop.generated.OrderRecord",
            "line": 4,
        }
    ]


def test_the_fixture_recovers_the_misparsed_and_companion_members():
    document = scan(FIXTURE_ROOT, None)
    application = f"{MAIN}/application"
    domain = f"{MAIN}/domain"

    assert member(document, f"{application}/UseCase.kt", "UseCase")["kind"] == "class"
    assert member(document, f"{application}/PlaceOrder.kt", "PlaceOrder")["kind"] == "class"
    assert member(document, f"{domain}/Currency.kt", "Currency.Companion")["kind"] == "class"
    assert member(document, f"{domain}/Order.kt", "total")["kind"] == "function"
    assert all("visibility" in m for module in document["modules"] for m in module["members"])


def test_the_fixture_calls_dispatch_through_the_port():
    document = scan(FIXTURE_ROOT, None)
    calls = {(c["from"], c["to"], c["how"]) for c in document["calls"]}
    jdbc = f"{MAIN}/persistence/JdbcOrderStore.kt"

    assert len(document["calls"]) == 5
    assert (
        f"{MAIN}/application/PlaceOrder.kt::PlaceOrder.execute",
        f"{MAIN}/ports/OrderStore.kt::OrderStore.save",
        "call",
    ) in calls
    assert (
        f"{MAIN}/ports/OrderStore.kt::OrderStore.save",
        f"{jdbc}::JdbcOrderStore.save",
        "dispatch",
    ) in calls
    assert (
        f"{jdbc}::JdbcOrderStore.save",
        f"{MAIN}/persistence/OrderRepository.kt::OrderRepository",
        "call",
    ) in calls


def test_the_selection_equals_the_binding_constants():
    assert selection() == {
        "extensions": [".kt"],
        "skip_directory_names": [
            "build",
            "test",
            "androidTest",
            "integrationTest",
            "testFixtures",
            "test-fixtures",
        ],
        "skip_directory_prefixes": ["."],
        "skip_directory_suffixes": ["Test"],
        "skip_directories_containing": [],
        "skip_file_globs": ["*Test.kt", "*Tests.kt"],
        "input_file_globs": ["build.gradle", "build.gradle.kts", "pom.xml"],
    }
    assert scan(FIXTURE_ROOT, None)["selection"] == selection()


def test_files_equal_the_shared_selection_parity_tree(tmp_path):
    parity = json.loads((REPOSITORY / "fixtures" / "selection-parity.json").read_text())["kotlin"]
    build_tree(tmp_path, dict.fromkeys(parity["tree"], ""))

    sources = [f["path"] for f in scan(tmp_path, None)["files"] if f["path"].endswith(".kt")]

    assert sources == parity["accepted"]


def test_a_probed_build_file_is_listed_with_the_hash_of_its_bytes(tmp_path):
    build_tree(
        tmp_path,
        {
            "a/build.gradle.kts": "plugins {}\n",
            "a/b/x.kt": "package p\n\nclass X\n",
            "c/build.gradle.kts": "other\n",
        },
    )
    document = scan(tmp_path, None)
    digest = hashlib.sha256(b"plugins {}\n").hexdigest()

    assert document["files"] == [
        {"path": "a/b/x.kt", "hash": hashlib.sha256(b"package p\n\nclass X\n").hexdigest()},
        {"path": "a/build.gradle.kts", "hash": digest},
    ]
    assert document["selection"]["input_file_globs"] == [
        "build.gradle",
        "build.gradle.kts",
        "pom.xml",
    ]
    assert "input_absent_paths" not in document["selection"]


def test_cli_end_to_end(tmp_path):
    result = run_cli(str(FIXTURE_ROOT), "--commit", "abc1234", "--modified", "false")
    document = json.loads(result.stdout)
    wanted = expected()
    wanted["commit"] = "abc1234"
    wanted["modified"] = False
    wanted["scanner"]["version"] = document["scanner"]["version"]

    assert result.returncode == 0
    assert document == wanted
    assert without_events(result.stderr) == ""
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
    result = run_bare("--version")

    assert result.returncode == 0
    assert result.stdout == f"{version('recognizer-scan-kotlin')}\n"


def test_cli_refuses_a_root_that_is_not_a_directory(tmp_path):
    result = run_cli(str(tmp_path / "missing"))

    assert result.returncode == 2
    assert "ROOT is not a directory" in result.stderr


def test_run_reports_start_and_progress_events_ending_at_the_total():
    result = run_cli(str(FIXTURE_ROOT))
    events = [
        json.loads(line.removeprefix("recognizer-event "))
        for line in result.stderr.splitlines()
        if line.startswith("recognizer-event ")
    ]

    assert result.returncode == 0
    assert events[0]["event"] == "start"
    assert events[0]["unit"] == "files"
    assert all(event["unit"] == "files" for event in events)
    assert all(event["done"] <= event["total"] for event in events[1:])
    assert events[-1] == {
        "event": "progress",
        "done": events[0]["total"],
        "total": events[0]["total"],
        "unit": "files",
    }


def test_check_exits_two_without_a_document():
    result = run_bare("check")

    assert result.returncode == 2
    assert result.stdout == ""
    assert "manifest, check, run, guide" in result.stderr


def test_guide_prints_nothing():
    result = run_bare("guide")

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_a_bare_path_and_a_flag_are_not_verbs(tmp_path):
    for arguments in ([str(tmp_path)], ["--output", str(tmp_path / "x.json")]):
        result = run_bare(*arguments)

        assert result.returncode == 2
        assert "manifest, check, run, guide" in result.stderr
