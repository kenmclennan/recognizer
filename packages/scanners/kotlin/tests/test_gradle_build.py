import pytest

from recognizer_scan_kotlin.gradle_build import (
    DEFAULT_JACOCO_REPORT,
    applies_jacoco,
    jacoco_report_of,
)

APPLIES = [
    ("a multi-line plugins block", 'plugins {\n    id("jacoco")\n}\n', True),
    ("a one-line plugins block", 'plugins { id("jacoco") }\n', True),
    ("the Groovy spelling", "plugins {\n    id 'jacoco'\n}\n", True),
    ("a bare jacoco line", "plugins {\n    jacoco\n}\n", True),
    ("a versioned id", 'plugins {\n    id("jacoco") version "1"\n}\n', True),
    ("apply plugin at the top", "apply plugin: 'jacoco'\n", True),
    ("apply with a named argument", 'apply(plugin = "jacoco")\n', True),
    (
        "apply only inside subprojects",
        "subprojects {\n    apply plugin: 'jacoco'\n}\n",
        False,
    ),
    ("a line comment", 'plugins {\n    // id("jacoco")\n}\n', False),
    ("a block comment", "/* apply plugin: 'jacoco' */\n", False),
    ("configuration only", 'jacoco {\n    toolVersion = "0.8.11"\n}\n', False),
    ("a build with no jacoco", 'plugins {\n    kotlin("jvm")\n}\n', False),
]

REPORTS = [
    (
        "Groovy assignment",
        "xml.outputLocation = layout.buildDirectory.file('coverage/jacoco.xml')",
        {"kind": "literal", "path": "build/coverage/jacoco.xml"},
    ),
    (
        "Kotlin set",
        'xml.outputLocation.set(layout.buildDirectory.file("coverage/j.xml"))',
        {"kind": "literal", "path": "build/coverage/j.xml"},
    ),
    ("nothing set", "plugins { jacoco }", {"kind": "default"}),
    (
        "a variable path",
        'xml.outputLocation = file("$buildDir/x.xml")',
        {"kind": "unreadable"},
    ),
    (
        "a parent segment",
        "xml.outputLocation = layout.buildDirectory.file('../x.xml')",
        {"kind": "unreadable"},
    ),
    (
        "a commented path",
        '// xml.outputLocation = file("x")\nplugins { jacoco }',
        {"kind": "default"},
    ),
]


@pytest.mark.parametrize(
    ("text", "expected"),
    [(text, expected) for _name, text, expected in APPLIES],
    ids=[name for name, _text, _expected in APPLIES],
)
def test_applies_jacoco(text, expected):
    assert applies_jacoco(text) is expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [(text, expected) for _name, text, expected in REPORTS],
    ids=[name for name, _text, _expected in REPORTS],
)
def test_report_path(text, expected):
    assert jacoco_report_of(text) == expected
    assert "jacocoTestReport.xml" in DEFAULT_JACOCO_REPORT
