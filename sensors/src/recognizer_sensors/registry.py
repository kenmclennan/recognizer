from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.crap import sensor as crap
from recognizer_sensors.duplication import sensor as duplication
from recognizer_sensors.outcome import Outcome
from recognizer_sensors.scans import Scan


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[[Path, list[Scan], dict], Outcome]


SHIPPED = {
    "duplication": Sensor(
        duplication.parse_settings,
        lambda repository, scans, settings: Outcome(duplication.run(repository, scans, settings)),
    ),
    "crap": Sensor(crap.parse_settings, crap.run),
}
