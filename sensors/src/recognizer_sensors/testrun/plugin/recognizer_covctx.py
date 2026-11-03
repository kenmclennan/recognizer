from pathlib import Path

import pytest

try:
    import coverage
except ImportError:
    coverage = None


def switch(name):
    if coverage is None:
        return

    current = coverage.Coverage.current()

    if current is not None:
        current.switch_context(name)


def test_file_of(item):
    try:
        return Path(item.path).relative_to(Path.cwd()).as_posix()
    except (AttributeError, ValueError):
        return ""


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    switch(test_file_of(item))

    try:
        yield
    finally:
        switch("")
