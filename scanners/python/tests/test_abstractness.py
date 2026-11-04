import json
import sys
from importlib.metadata import version

import pytest
from conftest import REPOSITORY, build_tree, validate

from recognizer_scan_python import scan

FIXTURE = REPOSITORY / "fixtures" / "abstractness" / "python"


def members() -> dict:
    document = scan(FIXTURE / "sample", ["."], None)

    return {m["name"]: m for module in document["modules"] for m in module["members"]}


def test_sample_matches_expected_scan():
    actual = scan(FIXTURE / "sample", ["."], None)
    wanted = json.loads((FIXTURE / "expected-scan.json").read_text())
    wanted["scanner"]["version"] = version("recognizer-scan-python")

    assert actual == wanted
    validate(actual)


def test_protocol_abc_and_abcmeta_are_interfaces():
    found = members()

    assert [found[name]["kind"] for name in ("Store", "Base", "Meta")] == ["interface"] * 3


def test_a_class_with_only_an_abstractmethod_is_not_counted():
    found = members()

    assert found["Template"]["kind"] == "class"
    assert "tags" not in found["Template"]


def test_type_aliases_are_constants_or_absent():
    found = members()

    assert found["Id"]["kind"] == "constant"
    assert found["Alias"]["kind"] == "constant"


@pytest.mark.skipif(sys.version_info < (3, 12), reason="PEP 695 type statements need Python 3.12")
def test_a_pep_695_type_alias_is_not_abstract(tmp_path):
    build_tree(tmp_path, {"m.py": "type Id = int\ntype Pair[T] = tuple[T, T]\n"})

    document = scan(tmp_path, ["."], None)
    found = {m["name"]: m for module in document["modules"] for m in module["members"]}

    assert "interface" not in {m["kind"] for m in found.values()}
    validate(document)
