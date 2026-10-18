from abc import ABC
from typing import Protocol


class Store(Protocol):
    def save(self, order): ...


class Clock(ABC):
    def now(self): ...
