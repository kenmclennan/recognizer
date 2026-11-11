import shlex
import sys
from pathlib import Path

import pytest
from conftest import mutate_repository, mutate_settings
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
        (8, 4 * GB, 2 * GB, 2),
        (8, 4 * GB - 1, 2 * GB, 1),
        (8, 1 * GB, 2 * GB, 1),
        (2, 64 * GB, 2 * GB, 2),
        (8, 8 * GB, 0, 8),
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
"""


def test_vm_stat_sums_free_inactive_and_speculative():
    assert memory.vm_stat_bytes(VM_STAT) == (18167 + 232800 + 7100) * 16384


def test_vm_stat_without_a_field_is_none():
    assert memory.vm_stat_bytes("nothing here") is None
    assert memory.vm_stat_bytes(VM_STAT.replace("Pages speculative", "Pages other")) is None


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
    assert 0 < available < 4096 * GB


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
    peak_bytes = 1 * GB

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


def sized_run(tmp_path, monkeypatch, capsys, available, cpus, **extra):
    root, _ = mutate_repository(tmp_path)
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
    assert "workers: 3 (cores 8, available 3000 MB, one run 1000 MB)" in err


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
    seen, _ = sized_run(tmp_path, monkeypatch, capsys, lambda: 16 * GB, 2)

    assert seen == [2]


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
