from conftest import REPOSITORY

from recognizer_sensors.crap.jacoco import merge_coverage, parse_jacoco

REPORT = (REPOSITORY / "fixtures" / "crap" / "jacoco" / "report.xml").read_text()

FILES = [
    "src/main/kotlin/com/shop/orders/Order.kt",
    "src/main/kotlin/com/shop/orders/Item.kt",
    "src/main/kotlin/com/shop/billing/Item.kt",
    "src/main/kotlin/com/shop/other/Item.kt",
]


def test_a_covered_line_is_a_hit_and_a_missed_line_is_zero():
    coverage = parse_jacoco(REPORT, FILES)

    assert coverage["src/main/kotlin/com/shop/orders/Order.kt"] == {3: 2, 4: 0, 6: 1}


def test_a_line_with_nothing_missed_or_covered_is_omitted():
    coverage = parse_jacoco(REPORT, FILES)

    assert 5 not in coverage["src/main/kotlin/com/shop/orders/Order.kt"]


def test_the_package_picks_the_file_by_suffix():
    coverage = parse_jacoco(REPORT, FILES)

    assert coverage["src/main/kotlin/com/shop/orders/Item.kt"] == {1: 0}
    assert coverage["src/main/kotlin/com/shop/billing/Item.kt"] == {1: 4}
    assert "src/main/kotlin/com/shop/other/Item.kt" not in coverage


def test_a_package_and_source_matching_two_files_is_left_out():
    files = [*FILES, "other/src/main/kotlin/com/shop/orders/Order.kt"]
    coverage = parse_jacoco(REPORT, files)

    assert "src/main/kotlin/com/shop/orders/Order.kt" not in coverage
    assert "other/src/main/kotlin/com/shop/orders/Order.kt" not in coverage


def test_a_source_file_with_only_empty_lines_is_absent():
    text = (
        '<report><package name="p"><sourcefile name="A.kt">'
        '<line nr="1" mi="0" ci="0"/></sourcefile></package></report>'
    )

    assert parse_jacoco(text, ["p/A.kt"]) == {}


def test_unparseable_xml_is_none():
    assert parse_jacoco("not xml", FILES) is None


def test_merging_sums_hits_by_path():
    into = {"a": {1: 1}}

    merge_coverage(into, {"a": {1: 2, 2: 0}, "b": {1: 1}})

    assert into == {"a": {1: 3, 2: 0}, "b": {1: 1}}


def sourcefile_report(line: int) -> str:
    return (
        '<report><package name="com/shop"><sourcefile name="A.kt">'
        f'<line nr="{line}" mi="0" ci="1"/></sourcefile></package></report>'
    )


def test_two_modules_with_the_same_file_each_get_their_own_report():
    files = ["a/src/main/kotlin/com/shop/A.kt", "b/src/main/kotlin/com/shop/A.kt"]

    first = parse_jacoco(sourcefile_report(1), files, "a/build/reports/jacoco/test/jacoco.xml")
    second = parse_jacoco(sourcefile_report(2), files, "b/build/reports/jacoco/test/jacoco.xml")

    assert first == {"a/src/main/kotlin/com/shop/A.kt": {1: 1}}
    assert second == {"b/src/main/kotlin/com/shop/A.kt": {2: 1}}


def test_kotlin_and_java_roots_resolve_by_the_reports_module():
    files = ["a/src/main/kotlin/com/shop/A.kt", "b/src/main/java/com/shop/A.kt"]

    coverage = parse_jacoco(sourcefile_report(1), files, "b/build/jacoco.xml")

    assert coverage == {"b/src/main/java/com/shop/A.kt": {1: 1}}


def test_a_conventional_root_breaks_a_tie_the_module_cannot():
    files = ["bin/com/shop/A.kt", "src/main/kotlin/com/shop/A.kt"]

    coverage = parse_jacoco(sourcefile_report(1), files)

    assert coverage == {"src/main/kotlin/com/shop/A.kt": {1: 1}}


def test_an_ambiguous_leftover_is_counted_and_attributed_to_no_file(capsys):
    files = ["x/src/main/kotlin/com/shop/A.kt", "y/src/main/kotlin/com/shop/A.kt"]
    text = (
        '<report><package name="com/shop">'
        '<sourcefile name="A.kt"><line nr="1" mi="0" ci="1"/></sourcefile>'
        '<sourcefile name="B.kt"><line nr="1" mi="0" ci="1"/></sourcefile>'
        "</package></report>"
    )
    files.append("src/main/kotlin/com/shop/B.kt")

    coverage = parse_jacoco(text, files, "z/build/jacoco.xml")

    assert coverage == {"src/main/kotlin/com/shop/B.kt": {1: 1}}
    assert (
        "jacoco: 1 of 2 source files matched no single scanned file (e.g. com/shop/A.kt)"
        in capsys.readouterr().err
    )
