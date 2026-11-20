import json

from conftest import REPOSITORY

from recognizer_sensors.principles import PRINCIPLES, principle_fields

SHARED = json.loads((REPOSITORY / "fixtures" / "sensors" / "principles.json").read_text())


def test_the_python_table_equals_the_shared_file():
    assert PRINCIPLES == SHARED


def test_principle_fields_returns_the_id_and_the_citation():
    fields = principle_fields("mutation-testing")
    expected = next(p for p in SHARED if p["id"] == "mutation-testing")

    assert fields == {"principle": "mutation-testing", "citation": expected["citation"]}
