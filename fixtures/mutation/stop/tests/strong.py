import os
import sys

sys.path.insert(0, os.getcwd())

from app.rules import alpha, beta, gamma

for function in (alpha, beta, gamma):
    assert function(True, True) is True
    assert function(True, False) is False
    assert function(False, True) is False
