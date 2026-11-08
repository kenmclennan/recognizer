import json
import shutil
import subprocess
from pathlib import Path, PurePosixPath

import pytest
from conftest import git_commit

from recognizer_sensors.hashes import digest_of, support_hash
from recognizer_sensors.mutation.inline_tests import (
    UnsoundWalk,
    is_test_attribute,
    unit_test_hashes,
)

LIB_UNIT = {"src/lib.rs": ("calc", "lib", "calc")}

MODULE = """pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    #[test]
    fn unit_add() {
        assert_eq!(super::add(1, 1), 2);
    }
}
"""


def crate(tmp_path, files):
    root = tmp_path / "r"

    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    git_commit(root)

    return root


def digest(root, units=LIB_UNIT):
    return unit_test_hashes(root, units)["src/lib.rs"]


@pytest.mark.parametrize(
    ("attribute", "expected"),
    [
        ("#[test]", True),
        ("#[cfg(test)]", True),
        ("#[cfg(all(test, unix))]", True),
        ("#[cfg(not(test))]", False),
        ("#[cfg_attr(test, derive(Debug))]", False),
        ("#[derive(Debug)]", False),
        ("#[cfg(testing)]", False),
    ],
)
def test_an_attribute_marks_test_code_only_by_test_or_a_cfg_naming_test_without_not(
    attribute, expected
):
    assert is_test_attribute(attribute) is expected


def test_only_lib_and_bin_units_get_an_entry(tmp_path):
    root = crate(tmp_path, {"src/lib.rs": MODULE, "src/main.rs": "fn main() {}\n"})
    units = {
        **LIB_UNIT,
        "src/main.rs": ("calc", "bin", "calc"),
        "tests/many.rs": ("calc", "test", "many"),
    }

    assert sorted(unit_test_hashes(root, units)) == ["src/lib.rs", "src/main.rs"]


def test_a_test_item_edit_changes_the_digest_and_a_production_or_comment_edit_does_not(tmp_path):
    root = crate(tmp_path, {"src/lib.rs": MODULE})
    first = digest(root)

    (root / "src/lib.rs").write_text(MODULE.replace("a + b", "a + b + 0"))
    assert digest(root) == first

    (root / "src/lib.rs").write_text("// note\n" + MODULE)
    assert digest(root) == first

    (root / "src/lib.rs").write_text(MODULE.replace("(1, 1), 2", "(1, 1), 3"))
    assert digest(root) != first

    (root / "src/lib.rs").write_text(MODULE)
    assert digest(root) == first


def test_adding_deleting_and_reordering_test_items_change_the_digest(tmp_path):
    two = MODULE + "\n#[test]\nfn one() {}\n\n#[test]\nfn two() {}\n"
    swapped = MODULE + "\n#[test]\nfn two() {}\n\n#[test]\nfn one() {}\n"
    root = crate(tmp_path, {"src/lib.rs": MODULE})
    base = digest(root)
    digests = {}

    for name, text in {"two": two, "swapped": swapped, "none": "pub fn add() {}\n"}.items():
        (root / "src/lib.rs").write_text(text)
        digests[name] = digest(root)

    assert len({base, *digests.values()}) == 4


def test_a_cfg_not_test_item_and_an_untagged_item_are_not_hashed(tmp_path):
    root = crate(tmp_path, {"src/lib.rs": "pub fn a() {}\n"})
    base = digest(root)

    (root / "src/lib.rs").write_text(
        "pub fn a() {}\n#[cfg(not(test))]\nfn b() {}\n#[cfg_attr(test, derive(Debug))]\nstruct S;\n"
    )

    assert digest(root) == base


def test_a_cfg_test_file_module_is_hashed_whole_in_both_layouts(tmp_path):
    for layout in ("more.rs", "more/mod.rs"):
        root = crate(
            tmp_path / layout.replace("/", "_"),
            {"src/lib.rs": "#[cfg(test)]\nmod more;\n", f"src/{layout}": "fn a() {}\n"},
        )
        first = digest(root)

        (root / f"src/{layout}").write_text("fn a() { 1; }\n")
        assert digest(root) != first


def test_a_production_file_module_is_searched_for_nested_tests(tmp_path):
    files = {
        "src/lib.rs": "mod prod;\n",
        "src/prod.rs": "mod inner;\npub fn p() {}\n",
        "src/prod/inner.rs": "#[cfg(test)]\nmod tests { fn t() {} }\n",
    }
    root = crate(tmp_path, files)
    first = digest(root)

    (root / "src/prod/inner.rs").write_text("#[cfg(test)]\nmod tests { fn t() { 1; } }\n")
    assert digest(root) != first

    (root / "src/prod/inner.rs").write_text(files["src/prod/inner.rs"])
    (root / "src/prod.rs").write_text("mod inner;\npub fn p() { 2; }\n")
    assert digest(root) == first


def test_a_path_attribute_is_followed_and_prints_nothing(tmp_path, capsys):
    root = crate(
        tmp_path,
        {
            "src/lib.rs": '#[cfg(test)]\n#[path = "extra/spec.rs"]\nmod t;\n',
            "src/extra/spec.rs": "fn a() {}\n",
        },
    )
    first = digest(root)

    assert capsys.readouterr().err == ""

    (root / "src/extra/spec.rs").write_text("fn a() { 1; }\n")

    assert digest(root) != first
    assert list(entries(root)) == ["src/extra/spec.rs#file"]


def entries(root, unit="src/lib.rs"):
    from recognizer_sensors.mutation.inline_tests import walk_unit

    found = {}

    walk_unit(root, PurePosixPath(unit), found)

    return found


def test_an_inner_test_attribute_file_gets_one_entry_and_its_items_are_not_entries(tmp_path):
    root = crate(
        tmp_path,
        {
            "src/lib.rs": "mod i;\n",
            "src/i.rs": "#![cfg(test)]\n#[test]\nfn a() {}\n#[test]\nfn b() {}\n",
        },
    )

    assert list(entries(root)) == ["src/i.rs#file"]


def test_a_gated_module_brings_the_files_it_declares(tmp_path):
    root = crate(
        tmp_path,
        {
            "src/lib.rs": "#[cfg(test)]\nmod t;\n",
            "src/t.rs": "mod u;\n",
            "src/t/u.rs": "fn a() {}\n",
        },
    )

    assert sorted(entries(root)) == ["src/t.rs#file", "src/t/u.rs#file"]


SKIPPED_FILE_CASES = (
    "declaration in a bin root",
    "declaration in a build script",
    "a lib.rs outside src is not a root",
)

UNSOUND_FILE_CASES = ("declaration with no file",)


def test_the_walk_follows_the_shared_file_cases(tmp_path):
    cases = json.loads(
        (Path(__file__).parents[2] / "fixtures" / "rust-test-gate" / "file-cases.json").read_text()
    )

    assert len(cases) > 22

    for number, case in enumerate(cases):
        if case["name"] in SKIPPED_FILE_CASES:
            continue

        root = crate(tmp_path / str(number), case["files"])

        if case["name"] in UNSOUND_FILE_CASES:
            with pytest.raises(UnsoundWalk):
                entries(root)

            continue

        unit = case.get("roots", ["src/lib.rs"])[0]
        found = {key.removesuffix("#file") for key in entries(root, unit) if key.endswith("#file")}
        expected = set(case["test_files"])

        assert found == expected, case["name"]


def test_an_unresolved_module_gives_the_coarse_digest_naming_the_reason(tmp_path, capsys):
    root = crate(tmp_path, {"src/lib.rs": "mod gone;\n"})
    first = digest(root)

    assert "mod gone resolves to no file" in capsys.readouterr().err

    (root / "src/other.rs").write_text("fn a() {}\n")
    shutil.rmtree(root / ".git", ignore_errors=True)
    git_commit(root)

    assert digest(root) != first


def test_an_unreadable_module_file_gives_the_coarse_digest_naming_the_file(
    tmp_path, capsys, monkeypatch
):
    root = crate(
        tmp_path,
        {"src/lib.rs": "mod prod;\n", "src/prod.rs": "pub fn p() {}\n"},
    )
    first = digest(root)
    capsys.readouterr()
    real_read_bytes = Path.read_bytes

    def refuse_prod(self):
        if self.name == "prod.rs":
            raise PermissionError("denied")

        return real_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", refuse_prod)

    second = digest(root)
    err = capsys.readouterr().err

    assert err.count("not found by module walk") == 1
    assert "cannot read src/prod.rs" in err
    assert second != first

    monkeypatch.undo()
    (root / "src/lib.rs").write_text("mod prod;\n// edit\n")
    capsys.readouterr()

    assert digest(root) == first


def test_unit_entries_would_change_support_so_they_join_only_the_ran_and_tests_sets(tmp_path):
    root = crate(tmp_path, {"src/lib.rs": MODULE})
    files = {"tests/many.rs": "x"}
    merged = {**files, **unit_test_hashes(root, LIB_UNIT)}

    assert support_hash(merged) != support_hash(files)
    assert digest_of(merged) != digest_of(files)


def test_the_committed_app_crate_reaches_one_test_item_in_each_file_with_a_cfg_test_line():
    repository = Path(__file__).parents[2]

    if not (repository / "app/src-tauri/src/lib.rs").exists():
        pytest.skip("no app/src-tauri in this checkout")

    from recognizer_sensors.mutation import inline_tests

    reached = {}

    for root in ("app/src-tauri/src/lib.rs", "app/src-tauri/src/main.rs"):
        entries = {}
        inline_tests.walk_file(repository, inline_tests.PurePosixPath(root), set(), entries)
        reached[root] = entries

    grep = subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "grep",
            "-l",
            "-E",
            r"^#\[cfg\(test\)\]",
            "--",
            "app/src-tauri/src",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    expected = {line for line in grep.stdout.splitlines() if line}

    assert expected
    assert len(reached["app/src-tauri/src/lib.rs"]) == len(expected)
    assert {k.split("#")[0] for k in reached["app/src-tauri/src/lib.rs"]} == expected
    assert reached["app/src-tauri/src/main.rs"] == {}

    units = {
        "app/src-tauri/src/lib.rs": ("recognizer_app", "lib", "recognizer_app"),
        "app/src-tauri/src/main.rs": ("recognizer_app", "bin", "recognizer_app"),
    }

    assert sorted(unit_test_hashes(repository, units)) == sorted(units)


GATE_CASES = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "rust-test-gate" / "cases.json").read_text()
)


def test_the_test_gate_table_is_read():
    assert len(GATE_CASES) > 20


@pytest.mark.parametrize("case", GATE_CASES, ids=[c["attribute"] for c in GATE_CASES])
def test_is_test_attribute_follows_the_shared_test_gate_table(case):
    assert is_test_attribute(case["attribute"]) is case["test"]


def module_digest(tmp_path, gate):
    files = {
        "src/lib.rs": f"pub fn add() {{}}\n\n{gate}\nmod m;\n",
        "src/m.rs": "#[test]\nfn t() {}\n",
    }

    return digest(crate(tmp_path, files))


def test_an_any_test_module_is_walked_as_production(tmp_path):
    production = module_digest(tmp_path / "a", "#[cfg(any(test, unix))]")
    gated = module_digest(tmp_path / "b", "#[cfg(all(test, unix))]")

    assert production != gated


def test_an_any_of_only_test_module_is_a_gate(tmp_path):
    assert module_digest(tmp_path / "a", "#[cfg(any(test, test))]") == module_digest(
        tmp_path / "b", "#[cfg(all(test, unix))]"
    )
