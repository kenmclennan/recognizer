from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Overlay:
    metrics: list[dict]
    values: dict[str, dict[str, float]]
    path: Path


@dataclass(frozen=True)
class Outcome:
    findings: list[dict]
    overlay: Overlay | None = None


@dataclass(frozen=True)
class Measurement:
    overlay: Overlay
    survivors: dict
    record: dict | None = None
