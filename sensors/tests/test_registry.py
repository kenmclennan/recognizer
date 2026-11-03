import json

from conftest import SENSOR_LIST

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.mutation import sensor as mutation


def listed(name):
    return next(e for e in json.loads(SENSOR_LIST.read_text()) if e["name"] == name)


def test_the_crap_metrics_equal_the_registry():
    assert crap.METRICS == listed("crap")["metrics"]


def test_the_mutation_metrics_equal_the_registry():
    assert mutation.METRICS == listed("mutation")["metrics"]


def test_the_registry_marks_which_sensors_run_tests():
    from recognizer_sensors.registry import SHIPPED

    for entry in json.loads(SENSOR_LIST.read_text()):
        assert SHIPPED[entry["name"]].runs_tests is entry["runs_tests"]
