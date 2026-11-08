import itertools
import os
import shutil
import signal
import subprocess
import threading
import time
import uuid
from collections.abc import Callable, Collection
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.testrun.profiles import tool_environment

WORK = Path(".recognizer") / "cache" / "mutation" / "work"
TAIL_LINES = 20
PID_FILE = "pid"
PID_GRACE_SECONDS = 60
STOPPED_STATUS = 143
STOP_GRACE_SECONDS = 30

STOP = threading.Event()

LIVE_LOCK = threading.Lock()
LIVE: set[subprocess.Popen] = set()


class Stopped(Exception):
    pass


class StoppedBeforeMutation(Exception):
    pass


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
class MutantResult:
    verdict: str
    failed: frozenset[str] | None = None


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

        skipped = {name for name in names if name == "__pycache__" or name.endswith(".pyc")}

        if here == root:
            skipped |= {name for name in names if name == ".git"}

        if here == root / ".recognizer":
            skipped |= {name for name in names if name == "cache"}

        return skipped

    return ignore


GRADLE_FILES = {"build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"}


def copy_entry(
    source: Path, destination: Path, ignore: Callable[[str, list[str]], set[str]]
) -> None:
    if os.path.lexists(destination):
        return

    destination.parent.mkdir(parents=True, exist_ok=True)

    if source.is_dir() and not source.is_symlink():
        shutil.copytree(source, destination, symlinks=True, ignore=ignore)

        return

    shutil.copy2(source, destination, follow_symlinks=False)


def git_lines(repository: Path, *arguments: str) -> list[str] | None:
    try:
        done = subprocess.run(
            ["git", "-C", str(repository), "ls-files", "-z", *arguments],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
        )
    except OSError:
        return None

    if done.returncode != 0:
        return None

    return [item.decode("utf-8", "surrogateescape") for item in done.stdout.split(b"\0") if item]


def excluded(relative: str) -> bool:
    parts = Path(relative).parts

    return (
        parts[:1] == (".git",)
        or parts[:2] == (".recognizer", "cache")
        or "__pycache__" in parts
        or relative.endswith(".pyc")
    )


def carried(relative: str, tracked: set[str], carry: tuple[str, ...]) -> bool:
    path = Path(relative.rstrip("/"))
    name = path.name
    parent = path.parent

    def beside(*matches: str) -> bool:
        return any(Path(item).parent == parent and Path(item).name in matches for item in tracked)

    if str(path) in carry or name == "node_modules":
        return True

    if name == "target":
        return beside("Cargo.toml")

    if name in {"build", ".gradle"}:
        return beside(*GRADLE_FILES)

    if name in {"bin", "obj"}:
        return any(Path(item).parent == parent and item.endswith(".csproj") for item in tracked)

    return False


def plan_copy(repository: Path, carry: tuple[str, ...]) -> list[str] | None:
    listed = git_lines(repository, "--cached", "--others", "--exclude-standard")

    if listed is None:
        return None

    ignored = git_lines(repository, "--others", "--ignored", "--exclude-standard", "--directory")

    if ignored is None:
        return None

    entries = []

    for relative in dict.fromkeys(listed):
        if excluded(relative) or not os.path.lexists(repository / relative):
            continue

        entries.append(relative)

    tracked = {relative for relative in listed}

    for relative in ignored:
        if excluded(relative.rstrip("/")):
            continue

        if carried(relative, tracked, carry):
            entries.append(relative.rstrip("/"))

    for item in carry:
        if item not in entries and not excluded(item) and os.path.lexists(repository / item):
            entries.append(item)

    return entries


def copy_repository(repository: Path, destination: Path, carry: tuple[str, ...] = ()) -> None:
    entries = plan_copy(repository, tuple(carry))
    ignore = ignore_for(repository)

    if entries is None:
        shutil.copytree(repository, destination, symlinks=True, ignore=ignore)

        return

    destination.mkdir(parents=True, exist_ok=True)

    for relative in entries:
        copy_entry(repository / relative, destination / relative, ignore)


def kill_group(process: subprocess.Popen) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except OSError:
        process.kill()


def run_test_command(command: list[str], cwd: Path, timeout: float | None) -> TestRun:
    started = time.monotonic()

    try:
        with LIVE_LOCK:
            if STOP.is_set():
                return TestRun(None, False, 0.0, "")

            process = subprocess.Popen(
                command,
                cwd=cwd,
                env=tool_environment(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            LIVE.add(process)
    except OSError as error:
        return TestRun(None, False, time.monotonic() - started, str(error))

    try:
        output, _ = process.communicate(timeout=timeout)
        timed_out = False
    except subprocess.TimeoutExpired:
        kill_group(process)
        output, _ = process.communicate()
        timed_out = True
    finally:
        with LIVE_LOCK:
            LIVE.discard(process)

    return TestRun(
        process.returncode,
        timed_out,
        time.monotonic() - started,
        output.decode("utf-8", "replace"),
    )


def output_tail(output: str) -> str:
    return "\n".join(output.splitlines()[-TAIL_LINES:])


NUMBERS = itertools.count()


def failed_files(output: str, known: Collection[str]) -> frozenset[str] | None:
    found: set[str] = set()

    for line in output.splitlines():
        word, _, rest = line.partition(" ")

        if word not in ("FAILED", "ERROR") or not rest:
            continue

        path = rest.split("::", 1)[0].split(" - ", 1)[0].strip()

        if path not in known:
            return None

        found.add(path)

    return frozenset(found) if found else None


def run_mutant(
    repository: Path,
    work: Path,
    number: int,
    mutant: Mutant,
    command: list[str],
    timeout: float,
    known: Collection[str] | None = None,
    carry: tuple[str, ...] = (),
) -> MutantResult:
    copy = work / str(number)

    try:
        copy_repository(repository, copy, carry) if carry else copy_repository(repository, copy)
        head = mutant.source[: mutant.start_byte]
        tail = mutant.source[mutant.end_byte :]
        (copy / mutant.path).write_bytes(head + mutant.replacement + tail)
        result = run_test_command(command, copy, timeout)
    except OSError:
        return MutantResult("killed")
    finally:
        shutil.rmtree(copy, ignore_errors=True)

    if result.timed_out:
        return MutantResult("timeout")

    if result.passed:
        return MutantResult("survived")

    failed = failed_files(result.output, known) if known is not None else None

    return MutantResult("killed", failed)


def run_function(
    repository: Path,
    work: Path,
    mutants: list[Mutant],
    plan_for: Callable[[int], tuple[list[str], float]],
    known: Collection[str] | None = None,
    carry: tuple[str, ...] = (),
) -> list[MutantResult] | None:
    results = []

    for index, mutant in enumerate(mutants):
        if STOP.is_set():
            return None

        command, timeout = plan_for(index)
        result = run_mutant(repository, work, next(NUMBERS), mutant, command, timeout, known, carry)

        if STOP.is_set():
            return None

        results.append(result)

    return results


def run_functions(
    items: list,
    run_item: Callable[[object], list | None],
    max_workers: int,
    deadline: float | None,
    clock: Callable[[], float],
    on_done: Callable[[object, list], None] | None = None,
) -> list[list | None]:
    spent = threading.Event()
    done_lock = threading.Lock()

    def take(item: object) -> list | None:
        if spent.is_set() or STOP.is_set() or (deadline is not None and clock() >= deadline):
            spent.set()

            return None

        try:
            verdicts = run_item(item)
        except Stopped:
            return None

        if verdicts is not None and on_done is not None:
            with done_lock:
                on_done(item, verdicts)

        return verdicts

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(take, item) for item in items]

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


def stop_all() -> None:
    with LIVE_LOCK:
        for process in list(LIVE):
            if process.returncode is None:
                kill_group(process)


def install_stop_handler(work: Path) -> Callable[[], None]:
    requested = threading.Event()

    def leave() -> None:
        stop_all()
        remove_work_folder(work)
        os._exit(STOPPED_STATUS)

    def watchdog() -> None:
        time.sleep(STOP_GRACE_SECONDS)
        leave()

    def stop() -> None:
        requested.wait()
        STOP.set()
        stop_all()
        threading.Thread(target=watchdog, daemon=True).start()

    def on_signal(_signum: int, _frame: object) -> None:
        if requested.is_set():
            leave()

        requested.set()

    threading.Thread(target=stop, daemon=True).start()
    previous = signal.signal(signal.SIGTERM, on_signal)

    def restore() -> None:
        if not STOP.is_set():
            signal.signal(signal.SIGTERM, previous)

    return restore


def install_coverage_stop_handler() -> Callable[[], None]:
    def on_signal(_signum: int, _frame: object) -> None:
        if STOP.is_set():
            return

        STOP.set()

        raise StoppedBeforeMutation

    previous = signal.signal(signal.SIGTERM, on_signal)

    def restore() -> None:
        signal.signal(signal.SIGTERM, previous)

    return restore
