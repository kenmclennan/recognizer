from typing import Protocol


class Dispatcher(Protocol):
    def dispatch(self, event: str) -> None: ...
