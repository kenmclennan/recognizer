import json

import pytest
from conftest import REPOSITORY, edges_of, module, targets

from recognizer_scan_kotlin import scan
from recognizer_scan_kotlin.parse import parse_file

BUILD = {"build.gradle.kts": ""}
GUARD = (
    "package a\n\nfun run(x: Any) {\n"
    "    when (x) {\n        is String if x.isNotEmpty() -> shout(x)\n        else -> Unit\n    }\n}\n"
)
GUARD_TARGET = "package a\n\nfun shout(s: String) {}\n"


def flagged(document: dict) -> list[str]:
    return sorted(m["id"] for m in document["modules"] if m.get("entry_point"))


@pytest.mark.parametrize(
    "source",
    [
        "fun main() {}\n",
        "fun main(args: Array<String>) {}\n",
        "suspend fun main() {}\n",
        "private fun main() {}\n",
    ],
)
def test_a_top_level_main_is_an_entry_point(run, source):
    document = run({"a/Run.kt": f"package a\n\n{source}", "a/Plain.kt": "package a\n\nclass P\n"})

    assert flagged(document) == ["a/Run.kt"]


@pytest.mark.parametrize(
    "source",
    [
        "fun String.main() {}\n",
        "object O { fun main() {} }\n",
        "val main = 1\n",
    ],
)
def test_a_receiver_member_or_property_main_is_not_an_entry_point(run, source):
    document = run({"a/Run.kt": f"package a\n\n{source}"})

    assert flagged(document) == []


def test_a_damaged_file_with_a_top_level_main_is_an_entry_point(run):
    document = run({"a/Run.kt": "package a\n\nfun main() {}\n\nval = \n"})

    assert flagged(document) == ["a/Run.kt"]


def test_two_actuals_sharing_one_expect_both_link_to_it(run):
    document = run(
        {
            **BUILD,
            "common/Clock.kt": "package a\n\nexpect fun now(): Long\n",
            "jvm/Clock.jvm.kt": "package a\n\nactual fun now(): Long = 1\n",
            "native/Clock.native.kt": "package a\n\nactual fun now(): Long = 2\n",
        }
    )

    assert module(document, "jvm/Clock.jvm.kt")["actual_of"] == ["common/Clock.kt"]
    assert module(document, "native/Clock.native.kt")["actual_of"] == ["common/Clock.kt"]
    assert "actual_of" not in module(document, "common/Clock.kt")


def test_an_actual_typealias_completes_an_expect_class(run):
    document = run(
        {
            **BUILD,
            "common/Handle.kt": "package a\n\nexpect class Handle\n",
            "jvm/Handle.jvm.kt": "package a\n\nactual typealias Handle = Int\n",
        }
    )

    assert module(document, "jvm/Handle.jvm.kt")["actual_of"] == ["common/Handle.kt"]


def test_an_actual_without_an_expect_has_no_key(run):
    document = run({**BUILD, "jvm/Only.kt": "package a\n\nactual fun solo() {}\n"})

    assert "actual_of" not in module(document, "jvm/Only.kt")


def test_an_expect_in_another_build_module_does_not_link(run):
    document = run(
        {
            "one/build.gradle.kts": "",
            "one/Clock.kt": "package a\n\nexpect fun now(): Long\n",
            "two/build.gradle.kts": "",
            "two/Clock.kt": "package a\n\nactual fun now(): Long = 1\n",
        }
    )

    assert "actual_of" not in module(document, "two/Clock.kt")


def test_an_expect_in_another_package_does_not_link(run):
    document = run(
        {
            **BUILD,
            "common/Clock.kt": "package a\n\nexpect fun now(): Long\n",
            "jvm/Clock.kt": "package b\n\nactual fun now(): Long = 1\n",
        }
    )

    assert "actual_of" not in module(document, "jvm/Clock.kt")


def test_a_file_with_two_actuals_lists_both_expect_files_sorted(run):
    document = run(
        {
            **BUILD,
            "common/Z.kt": "package a\n\nexpect fun zed()\n",
            "common/A.kt": "package a\n\nexpect fun ay()\n",
            "jvm/Both.kt": "package a\n\nactual fun zed() {}\n\nactual fun ay() {}\n",
        }
    )

    assert module(document, "jvm/Both.kt")["actual_of"] == ["common/A.kt", "common/Z.kt"]


def test_an_unresolved_actual_beside_a_resolved_one_lists_only_the_resolved_file(run):
    document = run(
        {
            **BUILD,
            "common/A.kt": "package a\n\nexpect fun ay()\n",
            "jvm/Mixed.kt": "package a\n\nactual fun ay() {}\n\nactual fun lonely() {}\n",
        }
    )

    assert module(document, "jvm/Mixed.kt")["actual_of"] == ["common/A.kt"]


def test_precondition_the_guard_example_is_damaged():
    assert parse_file(GUARD.encode()).damaged


def test_a_damaged_file_keeps_the_edge_its_lost_call_made(run):
    document = run({"a/User.kt": GUARD, "a/Shout.kt": GUARD_TARGET})

    assert targets(document, "a/User.kt") == {"a/Shout.kt": ["shout"]}


def test_a_name_in_a_comment_or_string_of_a_damaged_file_makes_no_edge(run):
    source = 'package a\n\n// shout\nval s = "shout"\nval = \n/* shout */\n'
    document = run({"a/User.kt": source, "a/Shout.kt": GUARD_TARGET})

    assert edges_of(document, "a/User.kt") == []


def test_a_template_in_a_string_of_a_damaged_file_makes_an_edge(run):
    source = 'package a\n\nval s = "hello $shout"\nval = \n'
    document = run({"a/User.kt": source, "a/Shout.kt": GUARD_TARGET})

    assert targets(document, "a/User.kt") == {"a/Shout.kt": ["shout"]}


def test_an_undamaged_file_makes_no_edge_from_a_name_in_a_comment(run):
    document = run({"a/User.kt": "package a\n\n// shout\nclass U\n", "a/Shout.kt": GUARD_TARGET})

    assert edges_of(document, "a/User.kt") == []


def test_a_same_package_function_does_not_hide_a_star_imported_overload(run):
    document = run(
        {
            "a/Href.kt": "package a\n\nfun <T> href(x: T) {}\n",
            "b/Own.kt": "package b\n\nfun String.href() {}\n",
            "b/User.kt": "package b\n\nimport a.*\n\nfun go() {\n    href(1)\n}\n",
        }
    )

    assert set(targets(document, "b/User.kt")) == {"a/Href.kt", "b/Own.kt"}


def test_a_same_package_class_still_hides_a_star_imported_one(run):
    document = run(
        {
            "a/Thing.kt": "package a\n\nclass Thing\n",
            "b/Thing.kt": "package b\n\nclass Thing\n",
            "b/User.kt": "package b\n\nimport a.*\n\nval t = Thing()\n",
        }
    )

    assert set(targets(document, "b/User.kt")) == {"b/Thing.kt"}


def test_a_same_package_property_still_hides_a_star_imported_function(run):
    document = run(
        {
            "a/Href.kt": "package a\n\nfun href() {}\n",
            "b/Own.kt": "package b\n\nval href = 1\n",
            "b/User.kt": "package b\n\nimport a.*\n\nval x = href\n",
        }
    )

    assert "a/Href.kt" not in targets(document, "b/User.kt")


def test_the_entry_points_fixture_matches_its_committed_scan_and_expectations():
    root = REPOSITORY / "fixtures" / "kotlin" / "entry-points"
    expected = json.loads((root / "expected.json").read_text())
    document = scan(root, None)

    assert document == json.loads((root / "scan.json").read_text())
    assert flagged(document) == expected["entry_points"]
    assert {m["id"]: m["actual_of"] for m in document["modules"] if "actual_of" in m} == expected[
        "actual_of"
    ]
