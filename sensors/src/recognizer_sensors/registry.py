from collections.abc import Callable
from dataclasses import dataclass

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.duplication import sensor as duplication
from recognizer_sensors.mutation import sensor as mutation
from recognizer_sensors.outcome import Outcome
from recognizer_sensors.thresholds import sensor as thresholds


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[..., Outcome]
    needs_commit: bool = False
    runs_tests: bool = False


SHIPPED = {
    "duplication": Sensor(
        duplication.parse_settings,
        lambda repository, scans, settings: Outcome(duplication.run(repository, scans, settings)),
    ),
    "crap": Sensor(crap.parse_settings, crap.run, runs_tests=True),
    "mutation": Sensor(mutation.parse_settings, mutation.run, needs_commit=True, runs_tests=True),
    "thresholds": Sensor(thresholds.parse_settings, thresholds.run, needs_commit=True),
}
