from pkg.base import Handler


class SpecialHandler(Handler):
    def handle(self) -> None:
        print("special")
