import ctypes
import errno
import itertools
import os
import queue
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Collection, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from recognizer_sensors.testrun.suites import Suite, directory_of, login_shell, shell_script

WORK = Path(".recognizer") / "cache" / "mutation" / "work"
TAIL_LINES = 20
PID_FILE = "pid"
PID_GRACE_SECONDS = 60
STOPPED_STATUS = 143
STOP_GRACE_SECONDS = 30

STOP = threading.Event()

KOTLIN_JVM_OPTIONS = (
    "-Dorg.gradle.daemon=false",
    "-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process",
)
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


CLONE_NOFOLLOW = 1

FALLBACK_ERRNOS = {errno.ENOTSUP, errno.EXDEV, errno.EINVAL}

CLONE_STATE = {"enabled": sys.platform == "darwin", "call": None}


def clone_call() -> Callable[[bytes, bytes, int], int] | None:
    if CLONE_STATE["call"] is None:
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            call = libc.clonefile
            call.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
            call.restype = ctypes.c_int
        except (OSError, AttributeError):
            return None

        CLONE_STATE["call"] = call

    return CLONE_STATE["call"]


def clone_path(source: Path, destination: Path) -> bool:
    if not CLONE_STATE["enabled"]:
        return False

    call = clone_call()

    if call is None:
        CLONE_STATE["enabled"] = False

        return False

    if call(os.fsencode(source), os.fsencode(destination), CLONE_NOFOLLOW) == 0:
        return True

    number = ctypes.get_errno()

    if number in FALLBACK_ERRNOS:
        CLONE_STATE["enabled"] = False

        return False

    raise OSError(number, os.strerror(number), str(source))


def copy_entry(
    source: Path, destination: Path, ignore: Callable[[str, list[str]], set[str]]
) -> None:
    if os.path.lexists(destination):
        return

    destination.parent.mkdir(parents=True, exist_ok=True)

    if source.is_dir() and not source.is_symlink():
        if clone_path(source, destination):
            drop_bytecode(destination)

            return

        shutil.copytree(source, destination, symlinks=True, ignore=ignore)

        return

    if clone_path(source, destination):
        return

    shutil.copy2(source, destination, follow_symlinks=False)


def drop_bytecode(folder: Path) -> None:
    for here, names, files in os.walk(folder):
        for name in [name for name in names if name == "__pycache__"]:
            shutil.rmtree(Path(here) / name, ignore_errors=True)
            names.remove(name)

        for name in files:
            if name.endswith(".pyc"):
                (Path(here) / name).unlink(missing_ok=True)


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


def index_tracked(tracked: Collection[str]) -> dict[Path, set[str]]:
    index: dict[Path, set[str]] = {}

    for item in tracked:
        path = Path(item)
        index.setdefault(path.parent, set()).add(path.name)

    return index


def carried_by(relative: str, index: dict[Path, set[str]], carry: tuple[str, ...]) -> bool:
    return str(Path(relative.rstrip("/"))) in carry


def carried(relative: str, tracked: set[str], carry: tuple[str, ...]) -> bool:
    return carried_by(relative, index_tracked(tracked), carry)


def plan_listing(repository: Path, carry: tuple[str, ...]) -> tuple[list[str], set[str]] | None:
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
    index = index_tracked(tracked)

    for relative in ignored:
        if excluded(relative.rstrip("/")):
            continue

        if carried_by(relative, index, carry):
            entries.append(relative.rstrip("/"))

    for item in carry:
        if item not in entries and not excluded(item) and os.path.lexists(repository / item):
            entries.append(item)

    return entries, tracked


def plan_copy(repository: Path, carry: tuple[str, ...]) -> list[str] | None:
    plan = plan_listing(repository, carry)

    return None if plan is None else plan[0]


def copy_repository(
    repository: Path,
    destination: Path,
    carry: tuple[str, ...] = (),
    plan: tuple[list[str], set[str]] | None = None,
) -> None:
    entries = plan[0] if plan is not None else plan_copy(repository, tuple(carry))
    ignore = ignore_for(repository)

    if entries is None:
        shutil.copytree(repository, destination, symlinks=True, ignore=ignore)

        return

    destination.mkdir(parents=True, exist_ok=True)

    for relative in entries:
        copy_entry(repository / relative, destination / relative, ignore)


def descendants(pid: int) -> list[int]:
    try:
        listing = subprocess.run(
            ["ps", "-axo", "pid=,ppid="],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except OSError:
        return []

    children: dict[int, list[int]] = {}

    for line in listing.splitlines():
        parts = line.split()

        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            children.setdefault(int(parts[1]), []).append(int(parts[0]))

    found: list[int] = []
    pending = [pid]

    while pending:
        for child in children.get(pending.pop(), []):
            found.append(child)
            pending.append(child)

    return found


def kill_group(process: subprocess.Popen) -> None:
    below = descendants(process.pid)

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except OSError:
        process.kill()

    for pid in below:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            continue


def run_test_command(
    command: list[str] | str,
    cwd: Path,
    timeout: float | None,
    suite: Suite | None = None,
    extra: dict[str, str] | None = None,
) -> TestRun:
    started = time.monotonic()
    words = command if isinstance(command, str) else shlex.join(command)
    env = {**os.environ, **(suite.env if suite is not None else {}), **(extra or {})}

    if suite is not None and suite.language == "kotlin":
        env["GRADLE_OPTS"] = " ".join(
            word for word in (env.get("GRADLE_OPTS", ""), *KOTLIN_JVM_OPTIONS) if word
        )

    argv = (
        [login_shell(), "-ilc", shell_script(suite, words)]
        if suite is not None
        else (shlex.split(command) if isinstance(command, str) else command)
    )

    try:
        with LIVE_LOCK:
            if STOP.is_set():
                return TestRun(None, False, 0.0, "")

            process = subprocess.Popen(
                argv,
                cwd=cwd,
                env=env,
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
    except BaseException:
        kill_group(process)
        process.wait()

        raise
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


class ResetFailed(Exception):
    pass


Stat = tuple[int, int, int]


def stat_of(path: Path) -> Stat:
    info = os.lstat(path)

    return (info.st_mode, info.st_size, info.st_mtime_ns)


def remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


class PooledCopy:
    def __init__(
        self,
        path: Path,
        repository: Path,
        carry: tuple[str, ...],
        plan: tuple[list[str], set[str]],
    ) -> None:
        entries, tracked = plan
        index = index_tracked(tracked)

        self.path = path
        self.repository = repository
        self.carry = carry
        self.index = index
        self.written: tuple[str, bytes] | None = None
        self.manifest: dict[str, Stat] = {}
        self.directories: set[str] = set()

        for relative in entries:
            parts = Path(relative).parts
            prefixes = ["/".join(parts[: count + 1]) for count in range(len(parts))]

            if any(carried_by(prefix, index, carry) for prefix in prefixes):
                continue

            self.manifest[relative] = stat_of(path / relative)
            self.directories.update(prefixes[:-1])

    def restore(self, relative: str) -> None:
        target = self.path / relative

        if os.path.lexists(target):
            remove_path(target)

        copy_entry(self.repository / relative, target, ignore_for(self.repository))
        self.manifest[relative] = stat_of(target)

    def walk(self, relative: str) -> None:
        folder = self.path / relative if relative else self.path

        with os.scandir(folder) as scanned:
            found = list(scanned)

        for entry in found:
            name = f"{relative}/{entry.name}" if relative else entry.name

            if carried_by(name, self.index, self.carry):
                continue

            if name in self.manifest:
                if stat_of(Path(entry.path)) != self.manifest[name]:
                    self.restore(name)
            elif name in self.directories and entry.is_dir(follow_symlinks=False):
                self.walk(name)
            else:
                remove_path(Path(entry.path))

    def reset(self) -> None:
        self.walk("")

        for relative in self.manifest:
            if not os.path.lexists(self.path / relative):
                self.restore(relative)

        if self.written is not None:
            relative, source = self.written
            (self.path / relative).write_bytes(source)
            self.manifest[relative] = stat_of(self.path / relative)
            self.written = None

        for relative, expected in self.manifest.items():
            if stat_of(self.path / relative) != expected:
                raise ResetFailed(relative)


class MutantSlot:
    def __init__(self, pool: "MutantCopies", number: int) -> None:
        self.pool = pool
        self.number = number
        self.copy: PooledCopy | None = None

    def prepare(self) -> PooledCopy:
        if self.copy is not None:
            try:
                self.copy.reset()

                return self.copy
            except (ResetFailed, OSError):
                self.retire()

        self.copy = self.pool.make(self.number)

        return self.copy

    def retire(self) -> None:
        if self.copy is not None:
            shutil.rmtree(self.copy.path, ignore_errors=True)

        self.copy = None


class MutantCopies:
    def __init__(
        self, repository: Path, work: Path, size: int, carry: tuple[str, ...] = ()
    ) -> None:
        self.repository = repository
        self.work = work
        self.carry = tuple(carry)
        self.enabled = plan_listing(repository, self.carry) is not None
        self.slots = [MutantSlot(self, number) for number in range(size)]
        self.free: queue.Queue[int] = queue.Queue()

        for number in range(size):
            self.free.put(number)

    def make(self, number: int) -> PooledCopy:
        plan = plan_listing(self.repository, self.carry)

        if plan is None:
            raise OSError("git cannot list the repository's files")

        destination = self.work / f"mutant-{number}"

        try:
            if self.carry:
                copy_repository(self.repository, destination, self.carry, plan=plan)
            else:
                copy_repository(self.repository, destination, plan=plan)

            return PooledCopy(destination, self.repository, self.carry, plan)
        except BaseException:
            shutil.rmtree(destination, ignore_errors=True)

            raise

    @contextmanager
    def lease(self) -> Iterator[MutantSlot]:
        number = self.free.get()

        try:
            yield self.slots[number]
        finally:
            self.free.put(number)


def failed_files(output: str, known: Collection[str], directory: str = "") -> frozenset[str] | None:
    found: set[str] = set()

    for line in output.splitlines():
        word, _, rest = line.partition(" ")

        if word not in ("FAILED", "ERROR") or not rest:
            continue

        path = rest.split("::", 1)[0].split(" - ", 1)[0].strip()
        path = f"{directory}/{path}" if directory else path

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
    suite: Suite,
    known: Collection[str] | None = None,
    carry: tuple[str, ...] = (),
    copies: MutantCopies | None = None,
) -> MutantResult:
    if copies is not None:
        return run_pooled(copies, mutant, command, timeout, suite, known)

    copy = work / str(number)

    try:
        copy_repository(repository, copy, carry) if carry else copy_repository(repository, copy)
        head = mutant.source[: mutant.start_byte]
        tail = mutant.source[mutant.end_byte :]
        (copy / mutant.path).write_bytes(head + mutant.replacement + tail)
        result = run_test_command(command, copy, timeout, suite=suite)
    except OSError:
        return MutantResult("killed")
    finally:
        shutil.rmtree(copy, ignore_errors=True)

    return verdict_of(result, known, directory_of(suite))


def verdict_of(result: TestRun, known: Collection[str] | None, directory: str) -> MutantResult:
    if result.timed_out:
        return MutantResult("timeout")

    if result.passed:
        return MutantResult("survived")

    failed = failed_files(result.output, known, directory) if known is not None else None

    return MutantResult("killed", failed)


def run_pooled(
    copies: MutantCopies,
    mutant: Mutant,
    command: list[str],
    timeout: float,
    suite: Suite,
    known: Collection[str] | None,
) -> MutantResult:
    with copies.lease() as slot:
        try:
            pooled = slot.prepare()
            pooled.written = (mutant.path, mutant.source)
            head = mutant.source[: mutant.start_byte]
            tail = mutant.source[mutant.end_byte :]
            (pooled.path / mutant.path).write_bytes(head + mutant.replacement + tail)
            result = run_test_command(command, pooled.path, timeout, suite=suite)
        except OSError:
            slot.retire()

            return MutantResult("killed")

        if result.timed_out or result.exit_code is None or STOP.is_set():
            slot.retire()

    return verdict_of(result, known, directory_of(suite))


def run_function(
    repository: Path,
    work: Path,
    mutants: list[Mutant],
    plan_for: Callable[[int], tuple[list[str], float]],
    suite: Suite,
    known: Collection[str] | None = None,
    carry: tuple[str, ...] = (),
    deadline: float | None = None,
    clock: Callable[[], float] = time.monotonic,
    copies: MutantCopies | None = None,
) -> list[MutantResult] | None:
    results = []

    for index, mutant in enumerate(mutants):
        if STOP.is_set() or (deadline is not None and clock() >= deadline):
            return None

        command, timeout = plan_for(index)

        if STOP.is_set() or (deadline is not None and clock() >= deadline):
            return None

        result = run_mutant(
            repository,
            work,
            next(NUMBERS),
            mutant,
            command,
            timeout,
            suite,
            known,
            carry,
            copies,
        )

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
