from dataclasses import dataclass
from typing import TypeAlias


@dataclass
class Row:
    id: int


Id = int

Alias: TypeAlias = "dict[str, int]"


def build() -> Row:
    return Row(1)


def _hidden() -> None: ...
