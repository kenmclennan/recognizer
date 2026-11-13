import sys

from recognizer_sensors.cli import main
from recognizer_sensors.manifest import manifest_text


def run(name: str, argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv

    if arguments == ["manifest"]:
        sys.stdout.write(manifest_text(name))

        return 0

    return main([name, *arguments])


def crap(argv: list[str] | None = None) -> int:
    return run("crap", argv)


def mutation(argv: list[str] | None = None) -> int:
    return run("mutation", argv)


def thresholds(argv: list[str] | None = None) -> int:
    return run("thresholds", argv)
