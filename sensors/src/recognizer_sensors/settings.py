from pathlib import PurePosixPath


class SettingsError(ValueError):
    pass


class MeasurementError(RuntimeError):
    pass


MAX_FAILING_NAMES = 5


def diagnose(
    code: str,
    line: str,
    fix: str | None = None,
    failing: dict | None = None,
    suite: str | None = None,
) -> dict:
    diagnosis: dict = {"code": code, "line": line}

    if suite:
        diagnosis["suite"] = suite

    if fix:
        diagnosis["fix"] = fix

    if failing:
        diagnosis["failing"] = failing

    return diagnosis


class Refusal(MeasurementError):
    def __init__(self, diagnosis: dict) -> None:
        super().__init__(diagnosis["line"])

        self.diagnosis = diagnosis


def relative_path(key: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        raise SettingsError(f"{key} must be a non-empty string")

    path = PurePosixPath(value)

    if path.is_absolute() or ".." in path.parts:
        raise SettingsError(f"{key} must be a relative path inside the repository")

    return value
