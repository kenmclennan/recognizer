from pkg.contracts import Dispatcher


class DefaultDispatcher(Dispatcher):
    def dispatch(self, event: str) -> None:
        print(event)
