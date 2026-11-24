from pkg.contracts import Dispatcher


class LoggingDispatcher(Dispatcher):
    def __init__(self, inner: Dispatcher) -> None:
        self.inner = inner

    def dispatch(self, event: str) -> None:
        self.inner.dispatch(event)
