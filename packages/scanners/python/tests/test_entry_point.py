import pytest

GUARD = 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n'


def modules_of(document: dict) -> dict:
    return {m["id"]: m for m in document["modules"]}


@pytest.mark.parametrize(
    "files, flagged",
    [
        ({"pkg/__init__.py": "", "pkg/__main__.py": ""}, "pkg/__main__.py"),
        ({"a/b/__main__.py": "x = 1\n"}, "a/b/__main__.py"),
        ({"scripts/run.py": GUARD}, "scripts/run.py"),
        ({"scripts/run.py": 'if "__main__" == __name__:\n    pass\n'}, "scripts/run.py"),
    ],
)
def test_entry_point_is_flagged(run, files, flagged):
    module = modules_of(run(files))[flagged]

    assert module["entry_point"] is True


@pytest.mark.parametrize(
    "source",
    [
        'try:\n    if __name__ == "__main__":\n        pass\nexcept Exception:\n    pass\n',
        'def main():\n    if __name__ == "__main__":\n        pass\n',
        'if __name__ != "__main__":\n    pass\n',
        'if True:\n    if __name__ == "__main__":\n        pass\n',
        "x = 1\n",
    ],
)
def test_other_modules_carry_no_key(run, source):
    module = modules_of(run({"scripts/run.py": source}))["scripts/run.py"]

    assert "entry_point" not in module
