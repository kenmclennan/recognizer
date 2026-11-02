from pathlib import PurePosixPath


class SettingsError(ValueError):
    pass


class MeasurementError(RuntimeError):
    pass


def relative_path(key: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        raise SettingsError(f"{key} must be a non-empty string")

    path = PurePosixPath(value)

    if path.is_absolute() or ".." in path.parts:
        raise SettingsError(f"{key} must be a relative path inside the repository")

    return value
