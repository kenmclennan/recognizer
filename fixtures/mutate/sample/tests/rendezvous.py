import os
import sys
import time
import uuid

sys.path.insert(0, os.getcwd())

from app.rules import both, grade

assert grade(95) == "A"
assert grade(70) == "pass"
assert grade(10) == "fail"

folder = os.environ.get("RENDEZVOUS_DIR")

if folder:
    marker = os.path.join(folder, uuid.uuid4().hex)
    open(marker, "w").close()
    deadline = time.monotonic() + 3

    while time.monotonic() < deadline and len(os.listdir(folder)) < 2:
        time.sleep(0.02)

    if len(os.listdir(folder)) >= 2:
        open(os.path.join(folder, "overlapped"), "w").close()

    os.remove(marker)
