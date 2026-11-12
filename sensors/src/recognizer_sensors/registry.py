from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.duplication import sensor as duplication
from recognizer_sensors.mutation import sensor as mutation
from recognizer_sensors.outcome import Outcome
from recognizer_sensors.testrun.guide import guide
from recognizer_sensors.testrun.readiness import check_with_notes
from recognizer_sensors.thresholds import sensor as thresholds


def no_gaps(
    repository: Path, settings: dict, run: bool, names: list[str] | None = None
) -> tuple[list[dict], list[dict]]:
    return [], []


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[..., Outcome]
    needs_commit: bool = False
    runs_tests: bool = False
    scoped: bool = False
    checkpoints: bool = False
    check: Callable[..., tuple[list[dict], list[dict]]] = no_gaps
    guide: Callable[[], str] | None = None


SHIPPED = {
    "duplication": Sensor(
        duplication.parse_settings,
        lambda repository, scans, settings: Outcome(
            duplication.run(repository, scans, settings),
            inputs=duplication.measured_modules(repository, scans),
        ),
    ),
    "crap": Sensor(
        crap.parse_settings, crap.run, runs_tests=True, check=check_with_notes, guide=guide
    ),
    "mutation": Sensor(
        mutation.parse_settings,
        mutation.run,
        needs_commit=True,
        runs_tests=True,
        scoped=True,
        checkpoints=True,
        check=check_with_notes,
        guide=guide,
    ),
    "thresholds": Sensor(thresholds.parse_settings, thresholds.run, needs_commit=True),
}
