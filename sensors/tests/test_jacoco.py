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


def report_for(package: str, source: str, line: int) -> str:
    return (
        f'<report name="r"><package name="{package}"><sourcefile name="{source}">'
        f'<line nr="{line}" mi="0" ci="3"/></sourcefile></package></report>'
    )


def test_two_gradle_modules_with_the_same_file_each_keep_their_own_lines():
    files = ["a/src/main/kotlin/com/x/Foo.kt", "b/src/main/kotlin/com/x/Foo.kt"]

    first = parse_jacoco(report_for("com/x", "Foo.kt", 1), files, "a")
    second = parse_jacoco(report_for("com/x", "Foo.kt", 2), files, "b")

    assert first == {"a/src/main/kotlin/com/x/Foo.kt": {1: 3}}
    assert second == {"b/src/main/kotlin/com/x/Foo.kt": {2: 3}}


def test_kotlin_and_java_roots_with_the_same_package_resolve_by_the_report_module():
    files = ["m/src/main/kotlin/com/x/Foo.kt", "n/src/main/java/com/x/Foo.kt"]

    coverage = parse_jacoco(report_for("com/x", "Foo.kt", 1), files, "n")

    assert coverage == {"n/src/main/java/com/x/Foo.kt": {1: 3}}


def test_a_conventional_root_breaks_a_tie_inside_one_module():
    files = ["src/main/kotlin/com/x/Foo.kt", "bin/com/x/Foo.kt"]

    coverage = parse_jacoco(report_for("com/x", "Foo.kt", 1), files, "")

    assert coverage == {"src/main/kotlin/com/x/Foo.kt": {1: 3}}


def test_an_unresolvable_tie_is_counted_on_stderr_and_attributed_to_nothing(capsys):
    files = ["a/src/main/kotlin/com/x/Foo.kt", "b/src/main/kotlin/com/x/Foo.kt"]

    coverage = parse_jacoco(report_for("com/x", "Foo.kt", 1), files, None)

    assert not coverage
    assert "jacoco: 1 of 1 source files matched no single scanned file" in capsys.readouterr().err
