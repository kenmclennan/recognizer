import json
import shutil

import pytest
from conftest import (
    FINDINGS_SCHEMA,
    REPOSITORY,
    exports_module,
    git_commit,
    write_scan_document,
)
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.registry import SHIPPED
from recognizer_sensors.settings import SettingsError
from recognizer_sensors.unused_exports.entry_points import is_entry_point
from recognizer_sensors.unused_exports.sensor import parse_settings

ENTRY_POINTS = REPOSITORY / "fixtures" / "sensors" / "entry-points.json"


def edge(source, target, names=None, kind="depends", to_member=None):
    value = {"from": source, "to": target, "kind": kind, "line": 1}

    if names is not None:
        value["names"] = names

    if to_member is not None:
        value["to_member"] = to_member

    return value


def sense(root, tmp_path, settings=None):
    git_commit(root)
    output = tmp_path / "findings.json"
    argv = ["unused-exports", "--repository", str(root), "--output", str(output)]

    if settings is not None:
        argv += ["--settings", json.dumps(settings)]

    assert main(argv) == 0
    document = json.loads(output.read_text())
    Draft202012Validator(json.loads(FINDINGS_SCHEMA.read_text())).validate(document)

    return document


def python_scan(root, modules, edges):
    files = [m["id"] for m in modules]
    write_scan_document(root, "python", modules, edges, files)


def unused(document):
    return {
        f["evidence"]["modules"][0]: [m["name"] for m in f["evidence"]["members"]]
        for f in document["findings"]
    }


def test_mixed_use_lists_only_the_unused_name(tmp_path):
    python_scan(
        tmp_path,
        [exports_module("shop/a.py", "a", "b", "c"), exports_module("shop/b.py", "x")],
        [edge("shop/b.py", "shop/a.py", ["a"]), edge("shop/b.py", "shop/a.py", ["b"])],
    )

    document = sense(tmp_path, tmp_path)

    assert unused(document) == {"shop/a.py": ["c"], "shop/b.py": ["x"]}
    assert document["findings"][0]["summary"] == (
        "shop/a.py exports 1 name no other module imports: c"
    )


def test_all_used_yields_nothing_and_none_used_lists_all(tmp_path):
    python_scan(
        tmp_path,
        [exports_module("shop/a.py", "a", "b", "c"), exports_module("shop/b.py", "x")],
        [edge("shop/x.py", "shop/a.py", ["a", "b", "c"]), edge("shop/x.py", "shop/b.py", ["x"])],
    )
    assert sense(tmp_path, tmp_path)["findings"] == []

    python_scan(tmp_path, [exports_module("shop/a.py", "c", "a", "b")], [])
    document = sense(tmp_path, tmp_path)

    assert document["findings"][0]["summary"] == (
        "shop/a.py exports 3 names no other module imports: a, b, c"
    )
    assert [m["name"] for m in document["findings"][0]["evidence"]["members"]] == ["a", "b", "c"]


@pytest.mark.parametrize("names", [None, []])
def test_an_edge_with_no_names_uses_every_export(tmp_path, names):
    python_scan(
        tmp_path,
        [exports_module("shop/a.py", "a", "b")],
        [edge("shop/b.py", "shop/a.py", names)],
    )

    assert sense(tmp_path, tmp_path)["findings"] == []


@pytest.mark.parametrize("kind", ["inherits", "implements"])
def test_inherits_and_implements_use_the_named_member(tmp_path, kind):
    python_scan(
        tmp_path,
        [exports_module("shop/a.py", "Base", "Other")],
        [edge("shop/b.py", "shop/a.py", kind=kind, to_member="Base")],
    )

    assert unused(sense(tmp_path, tmp_path)) == {"shop/a.py": ["Other"]}


def test_a_dotted_member_is_used_through_its_leading_segment(tmp_path):
    write_scan_document(
        tmp_path,
        "kotlin",
        [exports_module("app/domain", "Currency", "Currency.Companion", "Money")],
        [edge("app/other", "app/domain", ["Currency"])],
        ["app/domain/Currency.kt", "app/domain/Money.kt"],
    )

    assert unused(sense(tmp_path, tmp_path)) == {"app/domain": ["Money"]}


def test_self_and_foreign_edges_use_nothing(tmp_path):
    python_scan(
        tmp_path,
        [exports_module("shop/a.py", "a")],
        [edge("shop/a.py", "shop/a.py", ["a"]), edge("shop/b.py", "foreign:os", ["a"])],
    )

    assert unused(sense(tmp_path, tmp_path)) == {"shop/a.py": ["a"]}


def test_a_non_exported_member_is_never_listed(tmp_path):
    python_scan(
        tmp_path,
        [
            exports_module("shop/a.py", hidden=("h",)),
            exports_module("shop/b.py", "b", hidden=("g",)),
        ],
        [],
    )

    assert unused(sense(tmp_path, tmp_path)) == {"shop/b.py": ["b"]}


@pytest.mark.parametrize(
    "module_id",
    [
        "shop/tests/helper.py",
        "shop/test_x.py",
        "api/src/x.spec.ts",
        "app/FooTest.kt",
        "api/src/index.ts",
        "shop/src/lib.rs",
        "src/main/App.kt",
    ],
)
def test_skipped_modules_are_never_reported(tmp_path, module_id):
    python_scan(tmp_path, [exports_module(module_id, "a")], [])

    assert sense(tmp_path, tmp_path, {"entry_points": ["src/main/**"]})["findings"] == []


def test_an_entry_point_glob_matches_exactly(tmp_path):
    python_scan(
        tmp_path,
        [exports_module("src/main/App.kt", "a"), exports_module("src/mainline/App.kt", "b")],
        [],
    )

    assert unused(sense(tmp_path, tmp_path, {"entry_points": ["src/main/**"]})) == {
        "src/mainline/App.kt": ["b"]
    }


@pytest.mark.parametrize(
    "settings",
    [{"nope": 1}, {"entry_points": "src/**"}, {"entry_points": [""]}, {"entry_points": [1]}],
)
def test_bad_settings_exit_2(tmp_path, settings):
    python_scan(tmp_path, [exports_module("shop/a.py", "a")], [])
    git_commit(tmp_path)

    assert (
        main(
            [
                "unused-exports",
                "--repository",
                str(tmp_path),
                "--settings",
                json.dumps(settings),
            ]
        )
        == 2
    )
    with pytest.raises(SettingsError):
        parse_settings(settings)


def test_python_evidence_carries_file_and_lines(tmp_path):
    python_scan(tmp_path, [exports_module("shop/a.py", "a")], [])

    finding = sense(tmp_path, tmp_path)["findings"][0]

    assert finding["id"] == "unused-exports:shop/a.py"
    assert finding["kind"] == "unused-exports"
    assert finding["severity"] == "warning"
    assert finding["principle"] == "Export only what is used"
    assert finding["fix_pattern"] == "narrow-exports"
    assert finding["evidence"]["members"] == [
        {"module": "shop/a.py", "name": "a", "file": "shop/a.py", "lines": [10, 10]}
    ]


def test_kotlin_evidence_resolves_the_file_by_stem(tmp_path):
    write_scan_document(
        tmp_path,
        "kotlin",
        [exports_module("app/domain", "Currency.Companion", "Zed")],
        [],
        ["app/domain/Currency.kt", "app/domain/Money.kt"],
    )

    members = sense(tmp_path, tmp_path)["findings"][0]["evidence"]["members"]

    assert members[0] == {
        "module": "app/domain",
        "name": "Currency.Companion",
        "file": "app/domain/Currency.kt",
        "lines": [10, 10],
    }
    assert members[1] == {"module": "app/domain", "name": "Zed"}


def test_kotlin_single_file_directory_resolves_without_a_stem_match(tmp_path):
    write_scan_document(
        tmp_path, "kotlin", [exports_module("app/domain", "Zed")], [], ["app/domain/Money.kt"]
    )

    members = sense(tmp_path, tmp_path)["findings"][0]["evidence"]["members"]

    assert members[0]["file"] == "app/domain/Money.kt"


def test_finding_ids_come_out_sorted(tmp_path):
    python_scan(
        tmp_path,
        [exports_module("shop/z.py", "z"), exports_module("shop/a.py", "a")],
        [],
    )

    ids = [f["id"] for f in sense(tmp_path, tmp_path)["findings"]]

    assert ids == sorted(ids) == ["unused-exports:shop/a.py", "unused-exports:shop/z.py"]


def test_no_scan_yields_no_findings(tmp_path):
    (tmp_path / "README.md").write_text("x")

    assert sense(tmp_path, tmp_path)["findings"] == []


@pytest.mark.parametrize("case", json.loads(ENTRY_POINTS.read_text()), ids=lambda c: c["id"])
def test_python_entry_points_agree_with_the_shared_fixture(case):
    assert is_entry_point(case["id"], case["entry_points"]) is case["expected"]


EXPECTED = {
    "python": {
        "shop/adapters/special_store.py": ["SpecialStore"],
        "shop/application/lookup.py": ["lookup"],
        "shop/application/place.py": ["place"],
        "shop/application/refund.py": ["refund"],
    },
    "typescript": {"api/src/cache.ts": ["cached"], "api/src/place.ts": ["place"]},
    "kotlin": {
        "app/src/main/kotlin/shop/application": ["UseCase"],
        "app/src/main/kotlin/shop/clients": ["PaymentClient"],
        "app/src/main/kotlin/shop/domain": ["Currency", "Currency.Companion"],
        "app/src/main/kotlin/shop/persistence": ["JdbcOrderStore", "OrderRepository"],
        "app/src/main/kotlin/shop/web": ["OrderController"],
    },
    "rust": {},
}


@pytest.mark.parametrize("language", sorted(EXPECTED))
def test_the_committed_fixture_scans_give_the_known_exports(tmp_path, language):
    cache = tmp_path / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(
        REPOSITORY / "fixtures" / language / "expected-scan.json", cache / f"scan.{language}.json"
    )

    assert unused(sense(tmp_path, tmp_path)) == EXPECTED[language]


def test_the_sensor_is_registered_without_needing_a_commit():
    assert SHIPPED["unused-exports"].needs_commit is False
