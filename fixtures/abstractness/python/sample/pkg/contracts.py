from abc import ABC, ABCMeta, abstractmethod
from typing import Protocol


class Store(Protocol):
    def save(self) -> None: ...


class Base(ABC):
    pass


class Meta(metaclass=ABCMeta):
    pass


class Template:
    @abstractmethod
    def run(self) -> None: ...
