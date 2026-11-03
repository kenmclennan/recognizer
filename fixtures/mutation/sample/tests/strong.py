import os
import sys

sys.path.insert(0, os.getcwd())

from app.rules import both, grade

assert grade(90) == "A"
assert grade(89) == "pass"
assert grade(50) == "pass"
assert grade(49) == "fail"
assert both(True, True) is True
assert both(True, False) is False
assert both(False, True) is False
