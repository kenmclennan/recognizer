import hashlib
import json
import shutil
from pathlib import Path

import pytest
from conftest import git_commit

from recognizer_sensors import hashes
from recognizer_sensors.rust_test_blocks import in_file_test_hashes, is_test_attribute

FIXTURES = Path(__file__).parents[2] / "fixtures" / "sensors" / "tests-digest"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text())


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fixture_copy(tmp_path):
    root = tmp_path / "fx"
    shutil.copytree(FIXTURES / "rust-in-file", root)
    git_commit(root)

    return root


def repository(tmp_path, files):
    root = tmp_path / "repo"

    for name, text in files.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    return root


def entries_of(tmp_path, files):
    return sorted(in_file_test_hashes(repository(tmp_path, files), list(files)))


def edit(root, path, old, new):
    text = (root / path).read_text()

    assert old in text

    (root / path).write_text(text.replace(old, new, 1))


def test_the_fixture_gives_the_shared_digest_and_entries(tmp_path):
    root = fixture_copy(tmp_path)

    assert hashes.tests_hash(root, []) == EXPECTED["digest"]

    merged = {
        **hashes.test_hashes(root, []),
        **in_file_test_hashes(root, hashes.listed_files(root)),
    }

    assert merged == EXPECTED["entries"]


@pytest.mark.parametrize(
    ("path", "old", "new"),
    [
        ("src/lib.rs", "a + b", "b + a"),
        ("src/more.rs", "x * 2", "x * 3"),
    ],
)
def test_a_production_edit_leaves_the_digest(tmp_path, path, old, new):
    root = fixture_copy(tmp_path)

    edit(root, path, old, new)

    assert hashes.tests_hash(root, []) == EXPECTED["digest"]


@pytest.mark.parametrize(
    ("path", "old", "new"),
    [
        ("src/lib.rs", "assert_eq!(add(1, 2), 3)", "assert_eq!(add(1, 2), 4)"),
        ("src/more/helper_tests.rs", ", 4)", ", 5)"),
        ("src/inner.rs", "    7\n", "    9\n"),
        ("src/lib.rs", "fn adds()", "fn  adds()"),
    ],
)
def test_a_test_edit_changes_the_digest_and_reverting_restores_it(tmp_path, path, old, new):
    root = fixture_copy(tmp_path)

    edit(root, path, old, new)

    assert hashes.tests_hash(root, []) != EXPECTED["digest"]

    edit(root, path, new, old)

    assert hashes.tests_hash(root, []) == EXPECTED["digest"]


def test_swapping_deleting_and_the_end_of_a_file(tmp_path):
    root = fixture_copy(tmp_path)
    text = (root / "src/lib.rs").read_text()
    split = text.index("#[cfg(all(test, unix))]")
    module = text.index("#[cfg(test)]\nmod tests")

    (root / "src/lib.rs").write_text(text[:split] + text[module:] + "\n" + text[split:module])

    assert hashes.tests_hash(root, []) != EXPECTED["digest"]

    (root / "src/lib.rs").write_text(text[:module])

    assert hashes.tests_hash(root, []) != EXPECTED["digest"]

    root = fixture_copy(tmp_path / "again")
    more = (root / "src/more.rs").read_text()
    (root / "src/more.rs").write_text(more.rstrip())

    assert hashes.tests_hash(root, []) == EXPECTED["digest"]

    (root / "src/at_eof.rs").write_text("#[test] fn at_eof() {}")

    assert hashes.tests_hash(root, []) != EXPECTED["digest"]


@pytest.mark.parametrize(
    "text",
    [
        "// #[test]\nfn a() {}\n",
        "/* /* #[test] */ #[test] */\nfn a() {}\n",
        'const A: &str = "#[test]";\n',
        'const A: &str = r#"#[test]"#;\n',
        'const A: &str = r##"a"#b"##;\n',
        'const A: &[u8] = b"#[test]";\n',
        'const A: &[u8] = br#"#[test]"#;\n',
        "#[cfg_attr(test, derive(Debug))]\nstruct A;\n",
        "#[cfg(not(test))]\nfn a() {}\n",
        '#[cfg(feature = "testing")]\nfn a() {}\n',
    ],
)
def test_a_literal_comment_or_non_test_attribute_adds_no_entry(tmp_path, text):
    assert entries_of(tmp_path, {"src/a.rs": text + "// test\n"}) == []


@pytest.mark.parametrize(
    "body",
    [
        "fn a() { let c = '}'; }\n",
        "fn a() { let c = '\\''; }\n",
        "fn a() { let c = b'}'; }\n",
        "fn a() { let c = '\\u{1F600}'; }\n",
        "fn a<'a>(x: &'a str) -> &'a str { x }\n",
    ],
)
def test_a_character_literal_or_lifetime_does_not_end_an_item_early(tmp_path, body):
    root = repository(tmp_path, {"src/a.rs": f"#[test]\n{body}fn after() {{}}\n"})
    found = in_file_test_hashes(root, ["src/a.rs"])

    assert found == {"src/a.rs#0": sha(f"#[test]\n{body.rstrip()}".encode())}


@pytest.mark.parametrize(
    "text",
    [
        "#[cfg( test )]\nfn a() {}\n",
        "#[cfg(all(test, unix))]\nfn a() {}\n",
        "#[cfg(\n    test\n)]\nfn a() {}\n",
        "#[inline]\n/// doc\n#[test]\nfn a() {}\n",
        "#[test]\nfn a() {}",
    ],
)
def test_test_attribute_forms_are_recognised(tmp_path, text):
    assert entries_of(tmp_path, {"src/a.rs": text}) == ["src/a.rs#0"]


def test_a_file_without_test_text_and_a_test_file_are_not_scanned(tmp_path):
    assert entries_of(tmp_path, {"src/a.rs": "fn a() {}\n"}) == []
    assert entries_of(tmp_path / "t", {"tests/a.rs": "#[test]\nfn a() {}\n"}) == []


def test_declared_modules_resolve_to_listed_files_only(tmp_path):
    files = {
        "src/lib.rs": "#[cfg(test)]\nmod one;\n#[cfg(test)]\nmod two;\n#[cfg(test)]\nmod three;\n",
        "src/one.rs": "fn one() {}\n",
        "src/two/mod.rs": "fn two() {}\n",
    }

    assert entries_of(tmp_path, files) == [
        "src/lib.rs#0",
        "src/lib.rs#1",
        "src/lib.rs#2",
        "src/one.rs#file",
        "src/two/mod.rs#file",
    ]


def test_a_file_reached_from_a_non_mod_file_resolves_under_its_stem_directory(tmp_path):
    files = {
        "src/lib.rs": "mod outer;\n",
        "src/outer.rs": "#[cfg(test)]\npub(crate) mod inner;\n",
        "src/outer/inner.rs": "fn x() {}\n",
        "src/inner.rs": "fn y() {}\n",
    }

    assert entries_of(tmp_path, files) == ["src/outer.rs#0", "src/outer/inner.rs#file"]


def test_only_the_resolved_file_of_a_module_name_is_included(tmp_path):
    files = {
        "src/lib.rs": "#[cfg(test)]\nmod x;\n",
        "src/x.rs": "fn a() {}\n",
        "src/deep/x.rs": "fn b() {}\n",
    }

    assert entries_of(tmp_path, files) == ["src/lib.rs#0", "src/x.rs#file"]


def test_a_declared_file_brings_its_descendants_and_not_a_same_named_file(tmp_path):
    files = {
        "src/lib.rs": "#[cfg(test)]\nmod t;\n",
        "src/t.rs": "mod u;\n",
        "src/t/u.rs": "fn a() {}\n",
        "src/a/t.rs": "fn b() {}\n",
    }

    assert entries_of(tmp_path, files) == ["src/lib.rs#0", "src/t.rs#file", "src/t/u.rs#file"]


def test_real_content_has_one_entry_per_file_with_a_cfg_test_line():
    import subprocess

    repository_root = Path(__file__).parents[2]
    listed = hashes.listed_files(repository_root)

    if not listed:
        pytest.skip("no git metadata in this checkout")

    grep = subprocess.run(
        [
            "git",
            "-C",
            str(repository_root),
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
    expected = sorted(f"{line}#0" for line in grep.stdout.splitlines() if line)
    app = [path for path in listed if path.startswith("app/src-tauri/src/")]

    assert expected
    assert sorted(in_file_test_hashes(repository_root, app)) == expected


GATE_CASES = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "rust-test-gate" / "cases.json").read_text()
)


FILE_CASES = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "rust-test-gate" / "file-cases.json").read_text()
)


def test_the_file_case_table_is_read():
    assert len(FILE_CASES) > 15


@pytest.mark.parametrize("case", FILE_CASES, ids=[c["name"] for c in FILE_CASES])
def test_the_test_files_follow_the_shared_file_cases(tmp_path, case):
    files = case["files"]
    found = {
        key.removesuffix("#file")
        for key in in_file_test_hashes(repository(tmp_path, files), list(files))
        if key.endswith("#file")
    }

    assert found == set(case["test_files"])


def test_the_test_gate_table_is_read():
    assert len(GATE_CASES) > 20


@pytest.mark.parametrize("case", GATE_CASES, ids=[c["attribute"] for c in GATE_CASES])
def test_is_test_attribute_follows_the_shared_test_gate_table(case):
    assert is_test_attribute(case["attribute"][2:-1].encode("latin1")) is case["test"]


def test_a_mixed_file_counts_only_items_that_require_test(tmp_path):
    text = (
        "#[cfg(all(test, unix))]\nfn a() {}\n"
        "#[cfg(any(test, unix))]\nfn b() {}\n"
        "#[cfg(test)]\nfn c() {}\n"
    )

    assert entries_of(tmp_path, {"src/a.rs": text}) == ["src/a.rs#0", "src/a.rs#1"]
