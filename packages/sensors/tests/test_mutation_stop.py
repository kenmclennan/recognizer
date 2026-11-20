import os
import signal
import subprocess
import sys
import threading
import time

from recognizer_sensors.mutation import runner

HOLD_THE_LOCK = """
import os, sys, time
from pathlib import Path

from recognizer_sensors.mutation import runner

runner.STOP_GRACE_SECONDS = 1
work = Path(sys.argv[1]) / "work" / "copy"
work.mkdir(parents=True)
runner.install_stop_handler(work)
print("ready", flush=True)

with runner.LIVE_LOCK:
    time.sleep(60)
"""

RECORD_ACQUIRERS = """
import sys, threading, time
from pathlib import Path

from recognizer_sensors.mutation import runner

runner.STOP_GRACE_SECONDS = 1
log = Path(sys.argv[1]) / "acquirers.txt"


class Recording:
    def __init__(self):
        self.inner = threading.Lock()

    def acquire(self, *args, **kwargs):
        who = "main" if threading.current_thread() is threading.main_thread() else "other"

        with log.open("a") as handle:
            handle.write(who + "\\n")

        return self.inner.acquire(*args, **kwargs)

    def release(self):
        self.inner.release()


runner.LIVE_LOCK = Recording()
work = Path(sys.argv[1]) / "work" / "copy"
work.mkdir(parents=True)
runner.install_stop_handler(work)
print("ready", flush=True)
time.sleep(30)
"""


def start_child(tmp_path, source):
    script = tmp_path / "child.py"
    script.write_text(source)
    process = subprocess.Popen(
        [sys.executable, str(script), str(tmp_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )

    assert process.stdout.readline().strip() == "ready"

    return process


def test_two_sigterms_while_the_main_thread_holds_the_live_lock_exit_143(tmp_path):
    process = start_child(tmp_path, HOLD_THE_LOCK)

    try:
        os.kill(process.pid, signal.SIGTERM)
        time.sleep(0.2)
        os.kill(process.pid, signal.SIGTERM)

        assert process.wait(timeout=10) == 143
        assert not (tmp_path / "work" / "copy").exists()
    finally:
        if process.poll() is None:
            process.kill()


def test_one_sigterm_while_the_main_thread_holds_the_live_lock_exits_143(tmp_path):
    process = start_child(tmp_path, HOLD_THE_LOCK)

    try:
        os.kill(process.pid, signal.SIGTERM)

        assert process.wait(timeout=10) == 143
        assert not (tmp_path / "work" / "copy").exists()
    finally:
        if process.poll() is None:
            process.kill()


def test_the_stop_handler_takes_no_lock_on_the_main_thread(tmp_path):
    process = start_child(tmp_path, RECORD_ACQUIRERS)

    try:
        os.kill(process.pid, signal.SIGTERM)

        assert process.wait(timeout=10) == 143
    finally:
        if process.poll() is None:
            process.kill()

    acquirers = (tmp_path / "acquirers.txt").read_text().split()

    assert acquirers
    assert "main" not in acquirers


def test_stop_all_gives_up_waiting_for_the_live_lock(monkeypatch):
    monkeypatch.setattr(runner, "LIVE_LOCK_WAIT_SECONDS", 0.2)
    thread = threading.Thread(target=runner.stop_all)

    with runner.LIVE_LOCK:
        thread.start()
        thread.join(timeout=5)

        assert not thread.is_alive()
