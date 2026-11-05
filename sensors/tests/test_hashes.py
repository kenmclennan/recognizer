import hashlib
import json

from conftest import MUTATE_FIXTURE, git_commit, mutate_repository, write_scans

from recognizer_sensors import hashes
from recognizer_sensors.cli import main
from recognizer_sensors.scans import read_scan

EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
WORKED = "9a49fc96a1cf8fd7663d83897d346b14a4f4de85c8114981854191414ab6df5a"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def repository(tmp_path, files):
    root = tmp_path / "repo"
    root.mkdir()

    for name, text in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text)

    git_commit(root)

    return root


def test_the_worked_example_gives_the_recorded_hash(tmp_path):
    root = repository(tmp_path, {"tests/b.py": b"b", "tests/a.py": b"a"})

    assert sha(b"a").startswith("ca978112")
    assert sha(b"b").startswith("3e23e816")
    assert hashes.tests_hash(root, []) == WORKED


def test_no_test_files_gives_the_hash_of_the_empty_text(tmp_path):
    root = repository(tmp_path, {"app/rules.py": b"x = 1\n"})

    assert hashes.tests_hash(root, []) == EMPTY


def test_a_test_file_in_a_scan_takes_the_scans_hash_and_one_outside_takes_the_disk_hash(tmp_path):
    root = repository(tmp_path, {"tests/a.py": b"a", "tests/b.py": b"b"})
    write_scans(root)
    scan = read_scan(root, "python")
    other = "f" * 64

    assert scan is not None

    scan = type(scan)(**{**scan.__dict__, "hashes": {"tests/a.py": other}})
    expected = sha(f"tests/a.py\t{other}\ntests/b.py\t{sha(b'b')}\n".encode())

    assert hashes.tests_hash(root, [scan]) == expected


def test_an_unreadable_listed_path_is_skipped(tmp_path):
    root = repository(tmp_path, {"tests/a.py": b"a", "tests/b.py": b"b"})
    (root / "tests" / "b.py").unlink()

    assert hashes.tests_hash(root, []) == sha(f"tests/a.py\t{sha(b'a')}\n".encode())


def test_paths_sort_by_code_point_so_uppercase_comes_first(tmp_path):
    root = repository(tmp_path, {"tests/a.py": b"a", "tests/B.py": b"b"})
    text = f"tests/B.py\t{sha(b'b')}\ntests/a.py\t{sha(b'a')}\n"

    assert hashes.tests_hash(root, []) == sha(text.encode())


def test_inputs_omit_a_module_the_scan_has_no_hash_for():
    assert hashes.inputs_map(["b", "a", "c"], {"a": "1", "b": "2"}) == {"a": "1", "b": "2"}


def test_the_committed_mutation_scan_gives_the_scans_hash_not_the_disk_hash(tmp_path):
    root, _ = mutate_repository(tmp_path)
    scan = read_scan(root, "python")

    assert scan is not None

    inputs = hashes.inputs_map(["app/rules.py"], hashes.scan_hashes([scan]))

    assert inputs == {"app/rules.py": "0" * 64}
    assert sha((MUTATE_FIXTURE / "app" / "rules.py").read_bytes()) != "0" * 64


def test_a_duplication_run_writes_version_two_with_the_scans_hashes_and_no_tests(sample, tmp_path):
    output = tmp_path / "out.json"

    assert (
        main(
            ["duplication", "--repository", str(sample), "--commit", "c1", "--output", str(output)]
        )
        == 0
    )

    document = json.loads(output.read_text())

    assert document["findings_version"] == 2
    assert "tests" not in document
    assert set(document["inputs"]) >= {"app/pricing.py"}
    assert set(document["inputs"].values()) == {"0" * 64}
