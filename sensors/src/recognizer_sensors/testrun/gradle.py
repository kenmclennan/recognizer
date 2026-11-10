import hashlib
import os
import subprocess
import sys
from pathlib import Path

IDLE_TIMEOUT_MILLISECONDS = 600000

STOP_SECONDS = 20

KEY_DIGITS = 12

WRAPPER = "./gradlew"


def cache_root() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches"

    configured = os.environ.get("XDG_CACHE_HOME")

    return Path(configured) if configured else Path.home() / ".cache"


def repository_key(repository: Path) -> str:
    resolved = str(repository.resolve()).rstrip("/")
    digest = hashlib.sha256(resolved.encode("utf-8")).hexdigest()[:KEY_DIGITS]

    return f"{repository.resolve().name}-{digest}"


def gradle_home(repository: Path) -> Path:
    return cache_root() / "recognizer" / repository_key(repository) / "gradle-home"


def prepare_home(repository: Path) -> Path:
    home = gradle_home(repository)
    home.mkdir(parents=True, exist_ok=True)
    properties = home / "gradle.properties"
    wanted = f"org.gradle.daemon.idletimeout={IDLE_TIMEOUT_MILLISECONDS}\n"

    try:
        if not properties.is_file() or properties.read_text(encoding="utf-8") != wanted:
            properties.write_text(wanted, encoding="utf-8")
    except OSError:
        pass

    return home


def is_gradle(command: list[str]) -> bool:
    return bool(command) and command[0] == WRAPPER


def gradle_environment(repository: Path, base: dict[str, str] | None = None) -> dict[str, str]:
    home = prepare_home(repository)

    return {**(os.environ if base is None else base), "GRADLE_USER_HOME": str(home)}


def stop_daemons(repository: Path) -> None:
    if not (repository / "gradlew").is_file() or not gradle_home(repository).is_dir():
        return

    try:
        subprocess.run(
            [WRAPPER, "--stop"],
            cwd=repository,
            env=gradle_environment(repository),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            timeout=STOP_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return
