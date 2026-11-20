from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.manifest import build
from recognizer_sensors.mutation import sensor as mutation
from recognizer_sensors.registry import SHIPPED


def declared(name):
    return [
        {k: metric[k] for k in ("name", "type", "granularity", "bad")}
        for metric in build(name)["metrics"]
    ]


def test_the_crap_metrics_equal_the_manifest():
    assert crap.METRICS == declared("crap")


def test_the_mutation_metrics_equal_the_manifest():
    assert mutation.METRICS == declared("mutation")


def test_the_registry_flags_equal_the_manifest_for_every_shipped_sensor():
    for name, sensor in SHIPPED.items():
        manifest = build(name)

        assert sensor.runs_tests is manifest["runs_tests"]
        assert sensor.scoped is manifest["scoped"]
