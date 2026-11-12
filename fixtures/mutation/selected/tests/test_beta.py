import os
import sys

sys.path.insert(0, os.getcwd())

from app.rules import beta


def test_beta():
    assert beta(True, True) is True
    assert beta(True, False) is False
    assert beta(False, True) is False
