import re
import subprocess
import sys
from pathlib import Path

KOTLIN_WORKER_MEMORY = 3 * 1024**3

PAGE_SIZE = re.compile(r"page size of (\d+) bytes")

PAGE_COUNT = re.compile(r"^Pages (free|inactive|speculative):\s+(\d+)\.", re.MULTILINE)


def parse_meminfo(text: str) -> int | None:
    for row in text.splitlines():
        if row.startswith("MemAvailable:"):
            parts = row.split()

            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1]) * 1024

    return None


def parse_vm_stat(text: str) -> int | None:
    size = PAGE_SIZE.search(text)
    pages = {name: int(count) for name, count in PAGE_COUNT.findall(text)}

    if size is None or len(pages) != 3:
        return None

    return sum(pages.values()) * int(size.group(1))


def free_memory() -> int | None:
    if sys.platform == "darwin":
        try:
            result = subprocess.run(
                ["vm_stat"], capture_output=True, text=True, check=False, timeout=10
            )
        except (OSError, subprocess.SubprocessError):
            return None

        return parse_vm_stat(result.stdout) if result.returncode == 0 else None

    try:
        return parse_meminfo(Path("/proc/meminfo").read_text(encoding="utf-8"))
    except OSError:
        return None


def kotlin_workers(cores: int, free: int | None) -> int:
    if free is None:
        return cores

    return min(cores, max(1, free // KOTLIN_WORKER_MEMORY))
