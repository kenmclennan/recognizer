from collections.abc import Callable
from dataclasses import dataclass

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.mutation import sensor as mutation
from recognizer_sensors.mutation.estimate import planned_work
from recognizer_sensors.outcome import Outcome
from recognizer_sensors.testrun.guide import guide, mutation_guide
from recognizer_sensors.testrun.readiness import check_with_notes, mutation_check
from recognizer_sensors.thresholds import sensor as thresholds


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[..., Outcome]
    needs_commit: bool = False
    runs_tests: bool = False
    scoped: bool = False
    checkpoints: bool = False
    check: Callable[..., tuple[list[dict], list[dict]]] | None = None
    guide: Callable[[], str] | None = None
    work: Callable[..., dict | None] | None = None


SHIPPED = {
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
        check=mutation_check,
        guide=mutation_guide,
        work=planned_work,
    ),
    "thresholds": Sensor(thresholds.parse_settings, thresholds.run, needs_commit=True),
}
