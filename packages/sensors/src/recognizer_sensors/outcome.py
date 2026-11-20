from dataclasses import dataclass, field
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
    documents: list[tuple[Path, dict]] = field(default_factory=list)
    stopped: bool = False
    measured: int = 0
    total: int = 0
    inputs: frozenset[str] = frozenset()
    tests: str | None = None
    diagnosis: dict | None = None
    excluded: dict | None = None
    refused: bool = False
    unowned: dict | None = None
    suites: list[dict] | None = None
    recorded_inputs: dict[str, str] = field(default_factory=dict)
    work: dict | None = None
