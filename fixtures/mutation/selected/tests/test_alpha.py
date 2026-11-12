import os
import sys
import time

sys.path.insert(0, os.getcwd())

from app.rules import alpha


def test_alpha():
    if os.path.basename(os.getcwd()).startswith("baseline-"):
        with open(os.environ["HANG_PID_FILE"], "w") as handle:
            handle.write(str(os.getpid()))

        time.sleep(60)

    assert alpha(True, True) is True
    assert alpha(True, False) is False
    assert alpha(False, True) is False
