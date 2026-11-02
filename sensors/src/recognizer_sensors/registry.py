from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.duplication import sensor as duplication
from recognizer_sensors.mutate import measurer as mutate
from recognizer_sensors.mutation import sensor as mutation
from recognizer_sensors.outcome import Measurement, Outcome
from recognizer_sensors.scans import Scan
from recognizer_sensors.unused_exports import sensor as unused_exports


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[..., Outcome]
    needs_commit: bool = False


@dataclass(frozen=True)
class Measurer:
    parse_settings: Callable[[dict], dict]
    run: Callable[[Path, list[Scan], dict, str, bool], Measurement]


SHIPPED = {
    "duplication": Sensor(
        duplication.parse_settings,
        lambda repository, scans, settings: Outcome(duplication.run(repository, scans, settings)),
    ),
    "crap": Sensor(crap.parse_settings, crap.run),
    "mutation": Sensor(mutation.parse_settings, mutation.run, needs_commit=True),
    "unused-exports": Sensor(unused_exports.parse_settings, unused_exports.run),
}

MEASURERS = {"mutate": Measurer(mutate.parse_settings, mutate.run)}
