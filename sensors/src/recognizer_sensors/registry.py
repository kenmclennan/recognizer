from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.duplication import sensor as duplication
from recognizer_sensors.mutation import sensor as mutation
from recognizer_sensors.outcome import Outcome
from recognizer_sensors.testrun.suites import suite_gaps
from recognizer_sensors.thresholds import sensor as thresholds


def no_gaps(repository: Path, scans: list, settings: dict, sensor: str) -> list[dict]:
    return []


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[..., Outcome]
    needs_commit: bool = False
    runs_tests: bool = False
    scoped: bool = False
    checkpoints: bool = False
    preflight: Callable[[Path, list, dict, str], list[dict]] = no_gaps


SHIPPED = {
    "duplication": Sensor(
        duplication.parse_settings,
        lambda repository, scans, settings: Outcome(
            duplication.run(repository, scans, settings),
            inputs=duplication.measured_modules(repository, scans),
        ),
    ),
    "crap": Sensor(crap.parse_settings, crap.run, runs_tests=True, preflight=suite_gaps),
    "mutation": Sensor(
        mutation.parse_settings,
        mutation.run,
        needs_commit=True,
        runs_tests=True,
        scoped=True,
        checkpoints=True,
        preflight=suite_gaps,
    ),
    "thresholds": Sensor(thresholds.parse_settings, thresholds.run, needs_commit=True),
}
