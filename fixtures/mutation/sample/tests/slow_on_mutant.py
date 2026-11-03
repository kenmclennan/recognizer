import os
import sys
import time

sys.path.insert(0, os.getcwd())

from app.rules import both, grade

if grade(90) != "A":
    time.sleep(60)

assert grade(95) == "A"
assert grade(70) == "pass"
assert grade(10) == "fail"
assert both(True, True) is True
assert both(False, False) is False
