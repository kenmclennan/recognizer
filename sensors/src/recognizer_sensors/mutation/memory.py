import os
import subprocess
import sys
from pathlib import Path


def vm_stat_bytes(text: str) -> int | None:
    lines = text.splitlines()

    if not lines or "page size of" not in lines[0]:
        return None

    try:
        page = int(lines[0].split("page size of")[1].split()[0])
    except (IndexError, ValueError):
        return None

    wanted = {"Pages free": None, "Pages inactive": None, "Pages speculative": None}

    for line in lines[1:]:
        name, _, value = line.partition(":")

        if name in wanted:
            digits = value.strip().rstrip(".")

            if digits.isdigit():
                wanted[name] = int(digits)

    if any(count is None for count in wanted.values()):
        return None

    return sum(count for count in wanted.values() if count is not None) * page


def meminfo_bytes(text: str) -> int | None:
    for line in text.splitlines():
        if line.startswith("MemAvailable:"):
            parts = line.split()

            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1]) * 1024

    return None


def cgroup_clamp(available: int, limit: str, current: str | None) -> int:
    if not limit.strip().isdigit() or current is None or not current.strip().isdigit():
        return available

    return min(available, int(limit) - int(current))


def read_text(path: str) -> str | None:
    try:
        return Path(path).read_text()
    except OSError:
        return None


def linux_available() -> int | None:
    meminfo = read_text("/proc/meminfo")
    available = meminfo_bytes(meminfo) if meminfo is not None else None

    if available is None:
        return None

    limit = read_text("/sys/fs/cgroup/memory.max")

    if limit is None:
        return available

    return max(0, cgroup_clamp(available, limit, read_text("/sys/fs/cgroup/memory.current")))


def macos_available() -> int | None:
    try:
        text = subprocess.run(
            ["vm_stat"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except OSError:
        return None

    return vm_stat_bytes(text)


def available_bytes() -> int | None:
    if sys.platform == "darwin":
        return macos_available()

    if sys.platform.startswith("linux"):
        return linux_available()

    return None


def core_count() -> int:
    return os.cpu_count() or 1


def default_workers(cpus: int, available: int | None, peak: int) -> int:
    if available is None:
        return 1

    if peak <= 0:
        return max(1, cpus)

    return max(1, min(cpus, available // peak))
