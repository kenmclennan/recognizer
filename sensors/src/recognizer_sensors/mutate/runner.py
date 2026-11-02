import os
import shutil
import signal
import subprocess
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

WORK = Path(".recognizer") / "cache" / "mutation" / "work"
TAIL_LINES = 20
PID_FILE = "pid"
PID_GRACE_SECONDS = 60


@dataclass(frozen=True)
class TestRun:
    exit_code: int | None
    timed_out: bool
    seconds: float
    output: str

    @property
    def passed(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


@dataclass(frozen=True)
class Mutant:
    path: str
    source: bytes
    start_byte: int
    end_byte: int
    replacement: bytes


def ignore_for(repository: Path) -> Callable[[str, list[str]], set[str]]:
    root = repository.resolve()

    def ignore(directory: str, names: list[str]) -> set[str]:
        here = Path(directory).resolve()

        if here == root:
            return {name for name in names if name == ".git"}

        if here == root / ".recognizer":
            return {name for name in names if name == "cache"}

        return set()

    return ignore


def copy_repository(repository: Path, destination: Path) -> None:
    shutil.copytree(repository, destination, symlinks=True, ignore=ignore_for(repository))


def kill_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except OSError:
        process.kill()


def run_test_command(command: list[str], cwd: Path, timeout: float | None) -> TestRun:
    started = time.monotonic()

    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except OSError as error:
        return TestRun(None, False, time.monotonic() - started, str(error))

    try:
        output, _ = process.communicate(timeout=timeout)
        timed_out = False
    except subprocess.TimeoutExpired:
        kill_group(process)
        output, _ = process.communicate()
        timed_out = True

    return TestRun(
        process.returncode,
        timed_out,
        time.monotonic() - started,
        output.decode("utf-8", "replace"),
    )


def output_tail(output: str) -> str:
    return "\n".join(output.splitlines()[-TAIL_LINES:])


def run_mutant(
    repository: Path, work: Path, number: int, mutant: Mutant, command: list[str], timeout: float
) -> bool:
    copy = work / str(number)

    try:
        copy_repository(repository, copy)
        head = mutant.source[: mutant.start_byte]
        tail = mutant.source[mutant.end_byte :]
        (copy / mutant.path).write_bytes(head + mutant.replacement + tail)
        result = run_test_command(command, copy, timeout)
    except OSError:
        return True
    finally:
        shutil.rmtree(copy, ignore_errors=True)

    return not result.passed


def run_mutants(
    repository: Path,
    work: Path,
    mutants: list[Mutant],
    command: list[str],
    timeout: float,
    max_workers: int,
) -> list[bool]:
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [
            pool.submit(run_mutant, repository, work, number, mutant, command, timeout)
            for number, mutant in enumerate(mutants)
        ]

        return [future.result() for future in futures]


def new_work_folder(repository: Path) -> Path:
    folder = repository / WORK / f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    folder.mkdir(parents=True)
    (folder / PID_FILE).write_text(str(os.getpid()))

    return folder


def process_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

    return True


def folder_is_old(folder: Path) -> bool:
    try:
        return time.time() - folder.stat().st_mtime > PID_GRACE_SECONDS
    except OSError:
        return False


def folder_is_stale(folder: Path) -> bool:
    try:
        pid = int((folder / PID_FILE).read_text().strip())
    except (OSError, ValueError):
        return folder_is_old(folder)

    return pid <= 0 or not process_is_alive(pid)


def remove_stale_work_folders(own: Path) -> None:
    try:
        siblings = list(own.parent.iterdir())
    except OSError:
        return

    for folder in siblings:
        if folder != own and folder.is_dir() and folder_is_stale(folder):
            shutil.rmtree(folder, ignore_errors=True)


def remove_work_folder(folder: Path) -> None:
    shutil.rmtree(folder, ignore_errors=True)

    try:
        folder.parent.rmdir()
    except OSError:
        return
