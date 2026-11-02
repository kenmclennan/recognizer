from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.duplication import sensor as duplication
from recognizer_sensors.scans import Scan


@dataclass(frozen=True)
class Sensor:
    parse_settings: Callable[[dict], dict]
    run: Callable[[Path, list[Scan], dict], list[dict]]


SHIPPED = {"duplication": Sensor(duplication.parse_settings, duplication.run)}
