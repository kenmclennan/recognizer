import dataclasses

from conftest import run_cli, write_scans

from recognizer_sensors import cli
from recognizer_sensors.cache_ignore import ensure_cache_ignore


def test_the_helper_creates_the_folder_and_file(tmp_path):
    ensure_cache_ignore(tmp_path)

    assert (tmp_path / ".recognizer/cache/.gitignore").read_text() == "*\n"


def test_an_existing_gitignore_is_left_alone(tmp_path):
    cache = tmp_path / ".recognizer/cache"
    cache.mkdir(parents=True)
    (cache / ".gitignore").write_text("custom\n")

    ensure_cache_ignore(tmp_path)

    assert (cache / ".gitignore").read_text() == "custom\n"


def test_a_sensor_run_leaves_the_file_in_place(sample, tmp_path):
    assert run_cli(sample, tmp_path / "out.json") == 0
    assert (sample / ".recognizer/cache/.gitignore").read_text() == "*\n"


def test_a_test_running_sensor_ignores_the_cache_before_running(tmp_path, monkeypatch):
    write_scans(tmp_path)
    seen = {}

    def fake_run(repository, scans, settings, **extra):
        seen["file"] = (repository / ".recognizer/cache/.gitignore").is_file()
        raise cli.MeasurementError("stop here")

    monkeypatch.setitem(cli.SHIPPED, "crap", dataclasses.replace(cli.SHIPPED["crap"], run=fake_run))

    cli.main(
        [
            "crap",
            "run",
            "--repository",
            str(tmp_path),
            "--commit",
            "c1",
            "--output",
            str(tmp_path / "o.json"),
        ]
    )

    assert seen.get("file") is True
