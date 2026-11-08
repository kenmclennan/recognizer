import subprocess
import sys
from pathlib import Path

TMUTIL_TIMEOUT_SECONDS = 30


def exclude_from_backup(folder: Path) -> None:
    if sys.platform != "darwin":
        return

    try:
        subprocess.run(
            ["tmutil", "addexclusion", str(folder)],
            capture_output=True,
            check=False,
            timeout=TMUTIL_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return
