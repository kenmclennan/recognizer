import json
import shlex
import sys
from pathlib import Path

import pytest
from conftest import command_suite, mutate_repository, mutate_settings
from test_mutation import run_mutate

from recognizer_sensors.mutation import memory, sensor
from recognizer_sensors.mutation.memory import default_workers
from recognizer_sensors.mutation.runner import PeakSampler, run_test_command
from recognizer_sensors.testrun.suites import Suite

GB = 1_000_000_000
MB = 1_000_000
BINDING = (
    "-Dorg.gradle.daemon=false -Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process"
)


@pytest.mark.parametrize(
    ("cpus", "available", "peak", "expected"),
    [
        (8, 8 * GB, 2 * GB, 4),
        (8, 64 * GB, 2 * GB, 4),
        (8, 4 * GB, 2 * GB, 2),
        (8, 4 * GB - 1, 2 * GB, 1),
        (8, 1 * GB, 2 * GB, 1),
        (8, 4 * GB, 1 * GB, 4),
        (8, 4 * GB - 1, 1 * GB, 3),
        (2, 64 * GB, 2 * GB, 1),
        (1, 64 * GB, 2 * GB, 1),
        (8, 8 * GB, 0, 4),
        (8, None, 2 * GB, 1),
    ],
)
def test_default_workers(cpus, available, peak, expected):
    assert default_workers(cpus, available, peak) == expected


def test_an_absent_max_workers_parses_to_none():
    assert sensor.parse_settings({})["max_workers"] is None
    assert sensor.parse_settings({"max_workers": 2})["max_workers"] == 2


@pytest.mark.parametrize("value", [0, "2", 1.5, True])
def test_a_bad_max_workers_is_refused(value):
    with pytest.raises(sensor.SettingsError):
        sensor.parse_settings({"max_workers": value})


VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               18167.
Pages active:                            200000.
Pages inactive:                          232800.
Pages speculative:                         7100.
Pages purgeable:                           5000.
File-backed pages:                       200000.
"""


def test_vm_stat_sums_free_file_backed_and_purgeable():
    assert memory.vm_stat_bytes(VM_STAT) == (18167 + 200000 + 5000) * 16384


def test_vm_stat_without_a_field_is_none():
    assert memory.vm_stat_bytes(VM_STAT) is not None
    assert memory.vm_stat_bytes("nothing here") is None

    for name in ("Pages free", "File-backed pages", "Pages purgeable"):
        assert memory.vm_stat_bytes(VM_STAT.replace(name, "Pages other")) is None


def capture(free, inactive, speculative, purgeable, file_backed, active):
    return (
        "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
        f"Pages free:  {free}.\nPages active:  {active}.\nPages inactive:  {inactive}.\n"
        f"Pages speculative:  {speculative}.\nPages purgeable:  {purgeable}.\n"
        f"File-backed pages:  {file_backed}.\n"
    )


def fake_vm_stat(monkeypatch, text):
    class Done:
        stdout = text

    monkeypatch.setattr(memory.subprocess, "run", lambda *args, **kwargs: Done())


def test_the_36gb_case_gets_more_than_two_workers(monkeypatch):
    fake_vm_stat(monkeypatch, capture(20000, 560000, 20000, 60000, 900000, 700000))

    available = memory.macos_available()

    assert available == (20000 + 900000 + 60000) * 16384 - memory.MACOS_RESERVE
    assert default_workers(12, available, 3777 * MB) == 3
    assert memory.binding_input(12, available, 3777 * MB) == "memory"


def test_a_low_memory_capture_still_gets_one_worker(monkeypatch):
    fake_vm_stat(monkeypatch, capture(5000, 0, 0, 2000, 40000, 0))

    available = memory.macos_available()

    assert available == 0
    assert default_workers(8, available, 1 * GB) == 1
    assert memory.binding_input(8, available, 1 * GB) == "memory"


@pytest.mark.parametrize(
    ("cpus", "available", "peak", "expected"),
    [
        (8, 16 * GB, 1 * GB, "cores"),
        (8, 3 * GB, 1 * GB, "memory"),
        (8, 4 * GB, 1 * GB, "cores"),
        (8, 0, 1 * GB, "memory"),
        (8, 3 * GB, 0, "cores"),
    ],
)
def test_the_binding_input(cpus, available, peak, expected):
    assert memory.binding_input(cpus, available, peak) == expected


def test_meminfo_reads_mem_available_in_bytes():
    text = "MemTotal:       16000000 kB\nMemAvailable:    8000000 kB\n"

    assert memory.meminfo_bytes(text) == 8000000 * 1024
    assert memory.meminfo_bytes("MemTotal: 1 kB\n") is None


def test_a_cgroup_limit_clamps_the_available_memory():
    assert memory.cgroup_clamp(8 * GB, str(4 * GB), str(3 * GB)) == 1 * GB
    assert memory.cgroup_clamp(8 * GB, "max", str(3 * GB)) == 8 * GB
    assert memory.cgroup_clamp(8 * GB, str(4 * GB), None) == 8 * GB


@pytest.mark.parametrize("platform", ["darwin", "linux"])
def test_available_bytes_on_the_real_host(platform):
    if not sys.platform.startswith(platform):
        pytest.skip(f"not {platform}")

    available = memory.available_bytes()

    assert isinstance(available, int)
    assert (0 if platform == "darwin" else 1) <= available < 4096 * GB


def test_an_unknown_platform_reads_none(monkeypatch):
    monkeypatch.setattr(memory.sys, "platform", "plan9")

    assert memory.available_bytes() is None


def test_the_sampler_reaches_a_grandchild():
    allocate = "x = bytearray(150_000_000); x[::4096] = b'a' * len(x[::4096]); import time; time.sleep(1.5)"
    command = ["/bin/sh", "-c", f"{shlex.quote(sys.executable)} -c {shlex.quote(allocate)}; true"]

    with PeakSampler(interval=0.05) as sampler:
        run_test_command(command, Path.cwd(), 30)

    assert sampler.peak_bytes >= 120 * MB


def test_the_sampler_reports_zero_when_nothing_runs():
    with PeakSampler(interval=0.05) as sampler:
        pass

    assert sampler.peak_bytes == 0


class FakeSampler:
    peaks: list[int] = []
    created = 0

    daemons: list[int] = []

    def __init__(self, interval=0.25, homes=()):
        type(self).created += 1
        self.peak_bytes = type(self).peaks.pop(0) if type(self).peaks else 1 * GB
        self.daemon_bytes = type(self).daemons.pop(0) if type(self).daemons else 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


def sized_run(tmp_path, monkeypatch, capsys, available, cpus, peaks=(), **extra):
    root, _ = mutate_repository(tmp_path)
    FakeSampler.peaks = list(peaks)
    FakeSampler.created = 0
    seen = []
    real = sensor.run_functions

    def spy(items, run_item, workers, *rest):
        seen.append(workers)

        return real(items, run_item, workers, *rest)

    monkeypatch.setattr(sensor, "available_bytes", available)
    monkeypatch.setattr(sensor, "PeakSampler", FakeSampler)
    monkeypatch.setattr(sensor, "core_count", lambda: cpus)
    monkeypatch.setattr(sensor, "run_functions", spy)

    code = run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/weak.py", **extra))

    assert code == 0

    return seen, capsys.readouterr().err


def test_the_default_is_sized_from_memory(tmp_path, monkeypatch, capsys):
    seen, err = sized_run(tmp_path, monkeypatch, capsys, lambda: 3 * GB, 8)

    assert seen == [3]
    assert (
        "workers: 3 (cores 8, half 4, available 3000 MB, one run 1000 MB, bound by memory; max_workers sets the count)"
        in err
    )


def test_an_explicit_value_reads_no_memory(tmp_path, monkeypatch, capsys):
    def refuse():
        raise AssertionError("memory was read")

    seen, err = sized_run(tmp_path, monkeypatch, capsys, refuse, 8, max_workers=1)

    assert seen == [1]
    assert "workers:" not in err


def test_unreadable_memory_gives_one_worker(tmp_path, monkeypatch, capsys):
    seen, err = sized_run(tmp_path, monkeypatch, capsys, lambda: None, 8)

    assert seen == [1]
    assert "workers: 1 (available memory unreadable)" in err


def test_the_cores_bind_when_memory_is_plentiful(tmp_path, monkeypatch, capsys):
    seen, err = sized_run(tmp_path, monkeypatch, capsys, lambda: 16 * GB, 8)

    assert seen == [4]
    assert (
        "workers: 4 (cores 8, half 4, available 16000 MB, one run 1000 MB, bound by cores; max_workers sets the count)"
        in err
    )


def kotlin_suite(env=None):
    return Suite("k", "kotlin", ".", "true", None, env or {}, "c", "lcov", None)


def test_a_kotlin_suite_gets_the_gradle_options(tmp_path):
    result = run_test_command("printenv GRADLE_OPTS", tmp_path, 30, kotlin_suite())

    assert BINDING in result.output


def test_an_existing_gradle_options_value_comes_first(tmp_path):
    result = run_test_command(
        "echo OPTS=$GRADLE_OPTS", tmp_path, 30, kotlin_suite({"GRADLE_OPTS": "-Xmx1g"})
    )
    line = next(row for row in result.output.splitlines() if row.startswith("OPTS="))

    assert line.startswith("OPTS=-Xmx1g")
    assert line.endswith(BINDING)


def test_another_language_gets_no_gradle_options(tmp_path, monkeypatch):
    monkeypatch.delenv("GRADLE_OPTS", raising=False)
    suite = Suite("p", "python", ".", "true", None, {}, "c", "lcov", None)

    result = run_test_command("echo OPTS=$GRADLE_OPTS", tmp_path, 30, suite)

    assert "OPTS=" in result.output.splitlines()


def stub_probe(monkeypatch):
    def found(queue, by_name, suite_size):
        return next(iter(by_name.values())), [sys.executable, "-c", "pass"]

    monkeypatch.setattr(sensor, "probe_command", found)


def test_the_pool_is_sized_from_the_serial_probe(tmp_path, monkeypatch, capsys):
    stub_probe(monkeypatch)

    seen, err = sized_run(
        tmp_path, monkeypatch, capsys, lambda: 3 * GB, 8, peaks=(2 * GB, 100 * MB)
    )

    assert FakeSampler.created == 2
    assert seen == [4]
    assert (
        "workers: 4 (cores 8, half 4, available 3000 MB, one run 100 MB, bound by cores; max_workers sets the count)"
        in err
    )


def test_without_a_selected_command_the_coverage_peak_sizes_the_pool(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sensor, "probe_command", lambda *args: None)

    seen, err = sized_run(
        tmp_path, monkeypatch, capsys, lambda: 3 * GB, 8, peaks=(1 * GB, 100 * MB)
    )

    assert FakeSampler.created == 1
    assert seen == [3]
    assert "one run 1000 MB" in err


def test_an_explicit_max_workers_runs_no_probe(tmp_path, monkeypatch, capsys):
    def refuse(*args):
        raise AssertionError("the probe ran")

    monkeypatch.setattr(sensor, "probe_peak", refuse)

    seen, err = sized_run(tmp_path, monkeypatch, capsys, lambda: 3 * GB, 8, max_workers=2)

    assert seen == [2]
    assert "workers:" not in err


COUNTER = """
import os, sys, time
folder, record = sys.argv[1], sys.argv[2]
mark = os.path.join(folder, str(os.getpid()))
open(mark, "w").close()
now = len(os.listdir(folder))
with open(record, "a") as stream:
    stream.write(f"{now}\\n")
time.sleep(0.4)
os.remove(mark)
"""


def test_the_whole_suite_runs_of_a_sized_run_stay_within_the_coverage_count(
    tmp_path, monkeypatch, capsys
):
    stub_probe(monkeypatch)
    folder = tmp_path / "active"
    folder.mkdir()
    record = tmp_path / "record.txt"
    script = tmp_path / "counter.py"
    script.write_text(COUNTER)
    root, _ = mutate_repository(tmp_path)
    FakeSampler.peaks = [1500 * MB, 100 * MB]
    seen = []
    real = sensor.run_functions

    def spy(items, run_item, workers, *rest):
        seen.append(workers)

        return real(items, run_item, workers, *rest)

    monkeypatch.setattr(sensor, "available_bytes", lambda: 3 * GB)
    monkeypatch.setattr(sensor, "PeakSampler", FakeSampler)
    monkeypatch.setattr(sensor, "core_count", lambda: 8)
    monkeypatch.setattr(sensor, "run_functions", spy)
    suite = command_suite([sys.executable, str(script), str(folder), str(record)])
    settings = json.dumps({"tests": [suite], "incremental": False})

    assert run_mutate(root, tmp_path / "overlay.json", settings) == 0

    counts = [int(line) for line in record.read_text().split()]

    assert seen == [4]
    assert len(counts) >= 3
    assert max(counts) == 2


def test_whole_suite_runs_are_limited_to_the_coverage_sized_count(monkeypatch):
    import threading
    import time

    from recognizer_sensors.mutation import runner
    from recognizer_sensors.mutation.runner import Mutant, MutantResult, run_function, run_functions

    lock = threading.Lock()
    state = {"now": 0, "most": 0, "runs": 0}

    def stub(*args, **kwargs):
        with lock:
            state["now"] += 1
            state["runs"] += 1
            state["most"] = max(state["most"], state["now"])

        time.sleep(0.1)

        with lock:
            state["now"] -= 1

        return MutantResult("killed")

    monkeypatch.setattr(runner, "run_mutant", stub)
    suite = Suite("p", "python", ".", "true", None, {}, "c", "lcov", None)
    mutant = Mutant("a.py", b"", 0, 0, b"")
    gate = threading.Semaphore(2)

    run_functions(
        list(range(8)),
        lambda item: run_function(
            Path("."), Path("."), [mutant], lambda index: ("true", 1.0), suite, whole_slots=gate
        ),
        8,
        None,
        time.monotonic,
    )

    assert state["runs"] >= 4
    assert state["most"] == 2


def test_a_mutant_that_times_out_under_the_larger_pool_is_still_counted(
    tmp_path, monkeypatch, capsys
):
    root, _ = mutate_repository(tmp_path)
    monkeypatch.setattr(sensor, "available_bytes", lambda: 16 * GB)
    monkeypatch.setattr(sensor, "core_count", lambda: 8)
    monkeypatch.setattr(sensor, "PeakSampler", FakeSampler)
    FakeSampler.peaks = []

    code = run_mutate(root, tmp_path / "overlay.json", mutate_settings("tests/slow_on_mutant.py"))
    survivors = json.loads((root / ".recognizer/cache/mutation/survivors.json").read_text())
    grade = survivors["functions"]["app/rules.py::grade"]

    assert code == 0
    assert "workers: 4 (" in capsys.readouterr().err
    assert grade["timeouts"] == [{"line": 2, "operator": ">=", "replacement": ">"}]
