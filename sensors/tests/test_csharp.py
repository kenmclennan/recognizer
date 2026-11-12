import json
import os
import shutil
import stat

import pytest
from conftest import REPOSITORY, git_commit
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.crap.complexity import cyclomatic_complexity
from recognizer_sensors.functions import find_functions
from recognizer_sensors.mutation.sites import find_sites
from recognizer_sensors.mutation.warmup import coverage_run
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import read_scans
from recognizer_sensors.testrun.suites import parse_suites

SAMPLE = REPOSITORY / "fixtures" / "csharp" / "sample"
EXPECTED_SCAN = REPOSITORY / "fixtures" / "csharp" / "expected-scan.json"
FINDINGS_SCHEMA = REPOSITORY / "schema" / "findings.schema.json"

DOTNET_SUITE = {
    "name": "shop",
    "language": "csharp",
    "directory": ".",
    "command": "dotnet test --results-directory out",
    "coverage": {"path": "out/*/coverage.info", "format": "lcov"},
}


def functions(source: str) -> dict[str, object]:
    root = parse("csharp", source.encode()).root_node

    return {f.qualified: f for f in find_functions(root, "csharp")}


def names(source: str) -> set[str]:
    return set(functions(source))


def complexities(source: str) -> dict[str, int]:
    root = parse("csharp", source.encode()).root_node
    found = find_functions(root, "csharp")
    excluded = {f.node.id for f in found}

    return {f.qualified: cyclomatic_complexity(f.node, "csharp", excluded) for f in found}


def sites(source: str) -> list[tuple[str, str]]:
    root = parse("csharp", source.encode()).root_node

    return [(s.operator, s.replacement) for s in find_sites(root, "csharp")]


def test_cs_files_use_the_csharp_grammar():
    assert grammar_for("src/Order.cs") == "csharp"


def test_a_csharp_scan_is_read_with_its_skip_paths(tmp_path):
    cache = tmp_path / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    shutil.copy(EXPECTED_SCAN, cache / "scan.csharp.json")
    scans = read_scans(tmp_path)

    assert [scan.language for scan in scans] == ["csharp"]
    assert "tests/Shop.Checks.UnitTests" in scans[0].skip_paths


@pytest.mark.parametrize("selection", [None, "x", {"skip_paths": "x"}, {"skip_paths": [1, "a"]}])
def test_a_malformed_selection_gives_only_the_strings(tmp_path, selection):
    cache = tmp_path / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    document = {"files": [], "modules": [], "selection": selection}
    (cache / "scan.csharp.json").write_text(json.dumps(document))

    assert read_scans(tmp_path)[0].skip_paths == (
        ("a",) if selection == {"skip_paths": [1, "a"]} else ()
    )


def test_methods_constructors_destructors_and_local_functions_are_functions():
    source = """class C {
    C() { }
    ~C() { }
    int M() { int Local() { return 1; } return Local(); }
}"""

    assert names(source) == {"C.C", "C.~C", "C.M", "C.M.Local"}


def test_operators_are_named_by_their_operator_and_conversions_by_their_type():
    source = """class C {
    public static C operator +(C a, C b) { return a; }
    public static implicit operator int(C c) { return 1; }
}"""

    assert names(source) == {"C.operator +", "C.operator int"}


def test_a_property_with_accessors_is_a_scope_and_each_body_is_a_function():
    source = """class Order {
    int Total {
        get { return 1; }
        set { Field = value; }
    }
    int Auto { get; set; }
    event System.Action Changed { add { } remove { } }
}"""

    assert names(source) == {
        "Order.Total.get",
        "Order.Total.set",
        "Order.Changed.add",
        "Order.Changed.remove",
    }


def test_an_expression_bodied_property_and_indexer_are_functions():
    source = """class C {
    int P => 1;
    int this[int i] => i;
    int Q { get; } = 5;
}"""

    assert names(source) == {"C.P", "C.this"}


def test_bodiless_declarations_and_lambdas_are_not_functions():
    source = """abstract class C {
    abstract int A();
    int B() { Func<int> f = () => 1; return f(); }
}
interface I { int Run(); int Default() { return 1; } }
partial class D { partial void P(); }"""

    assert names(source) == {"C.B", "I.Default"}


def test_nested_types_and_extension_blocks_qualify_as_the_scanner_does():
    source = """namespace N {
    class Outer { class Inner { void Run() { } } }
    static class Ext { extension(string s) { int Len() { return 1; } } }
}"""

    assert {"Outer.Inner.Run", "Ext.Len"} <= names(source)


def test_records_and_structs_are_containers():
    source = "record R(int A) { int M() { return 1; } } struct S { int N() { return 1; } }"

    assert names(source) == {"R.M", "S.N"}


def scan_methods() -> list[tuple[str, str]]:
    document = json.loads(EXPECTED_SCAN.read_text())
    wanted = []

    for module in document["modules"]:
        if module["id"].endswith("Damaged.cs"):
            continue

        for member in module.get("members", []):
            for method in member.get("methods", []):
                if "abstract" not in method.get("tags", []):
                    wanted.append((module["id"], f"{member['name']}.{method['name']}"))

    return wanted


@pytest.mark.parametrize(("module", "qualified"), scan_methods())
def test_every_scanned_method_with_a_body_is_a_found_function(module, qualified):
    found = names((SAMPLE / module).read_text())

    assert qualified in found


def test_a_function_with_a_parse_error_is_marked_so_the_sensors_skip_it():
    source = (SAMPLE / "src/Shop.Application/Damaged.cs").read_text()
    found = functions(source)

    assert any(f.node.has_error for f in found.values())


WORKED = """class C {
int M(int x, int[] z, string a) {
    int Local(int y) { return y > 0 ? 1 : 2; }
    if (x > 0 && x < 3 || x == 9) { return 1; } else if (x == 4) { }
    foreach (var i in z) {} for (;;) {} while (x > 0) {} do { } while (x > 0);
    switch (x) { case 1: case 2: break; default: break; }
    var r = x switch { 1 => 2, 2 => 3, _ => 4 };
    var t = x > 1 ? 2 : 3;
    var u = a?.Trim()?.Length ?? 0;
    a ??= "q";
    try { } catch (System.Exception) { } catch { } finally { }
    Func<int,int> l = q => q > 0 && q < 9 ? 1 : 0;
    return x is 1 or 2 ? 1 : 0;
}
}"""


def test_the_worked_example_counts_24_and_its_local_function_2():
    assert complexities(WORKED) == {"C.M": 24, "C.M.Local": 2}


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("if (a) { }", 2),
        ("if (a) { } else if (b) { }", 3),
        ("for (;;) { }", 2),
        ("foreach (var i in z) { }", 2),
        ("while (a) { }", 2),
        ("do { } while (a);", 2),
        ("switch (a) { case 1: case 2: break; }", 3),
        ("switch (a) { case 1: break; default: break; }", 3),
        ("var r = a switch { 1 => 2, _ => 3 };", 3),
        ("try { } catch (E) { } catch { }", 3),
        ("var t = a ? 1 : 2;", 2),
        ("var t = a && b;", 2),
        ("var t = a || b;", 2),
        ("var t = a ?? b;", 2),
        ("var t = s?.a?.b;", 3),
        ("s ??= b;", 1),
        ("var t = a is 1 or 2;", 1),
        ("var t = a is not null;", 1),
        ("switch (a) { case int n when n > 1: break; }", 2),
        ("try { } catch (E e) when (e.A) { } finally { }", 2),
        ("try { } finally { }", 1),
        ("goto done; done: return;", 1),
        ("Func<int> f = () => a ? 1 : 2;", 2),
    ],
)
def test_each_counted_and_uncounted_construct_matches_its_hand_count(body, expected):
    source = f"class C {{ void M() {{ {body} }} }}"

    assert complexities(source)["C.M"] == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            "return a >= b && true || x != null;",
            [(">=", ">"), ("&&", "||"), ("true", "false"), ("||", "&&"), ("!=", "==")],
        ),
        ('var s = $"{a == b}" + "a == b";', [("+", "-")]),
        ("var t = a ?? b;", []),
        ("n += 1;", []),
        ("n ??= 1;", []),
        ("var n = -a;", []),
        ("var c = 'a' == b;", [("==", "!=")]),
        ("var f = false;", [("false", "true")]),
    ],
)
def test_csharp_mutation_sites(source, expected):
    assert sites(f"class C {{ bool M() {{ {source} }} }}") == expected


def test_a_directive_condition_is_skipped_and_the_code_under_it_is_kept():
    source = "class C {\n#if A == B\nint Z => 1 + 2;\n#endif\n}"

    assert sites(source) == [("+", "-")]


FAKE_DOTNET = """#!/bin/sh
if [ "$1" = "--version" ]; then echo 10.0.0; exit 0; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--results-directory" ]; then directory="$2"; fi
  shift
done
mkdir -p "$directory/aaa" "$directory/bbb"
printf 'SF:%s/src/Shop.Domain/Order.cs\\nDA:1,1\\nDA:2,0\\nend_of_record\\nSF:%s/src/Shop.Domain/Product.cs\\nDA:1,2\\nend_of_record\\n' "$PWD" "$PWD" > "$directory/aaa/coverage.info"
printf 'SF:%s/src/Shop.Domain/Product.cs\\nDA:1,3\\nend_of_record\\nSF:/_/outside/Other.cs\\nDA:1,1\\nend_of_record\\n' "$PWD" > "$directory/bbb/coverage.info"
"""


def install_dotnet(monkeypatch, tmp_path, text=FAKE_DOTNET):
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    executable = bin_directory / "dotnet"
    executable.write_text(text)
    executable.chmod(executable.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_directory}:{os.environ['PATH']}")


def csharp_repository(tmp_path, project="tests/T"):
    root = tmp_path / "repo"
    shutil.copytree(SAMPLE, root)
    cache = root / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    document = json.loads(EXPECTED_SCAN.read_text())
    document["selection"]["skip_paths"] = [project]
    (cache / "scan.csharp.json").write_text(json.dumps(document))
    (root / project).mkdir(parents=True, exist_ok=True)

    return root


def test_two_project_reports_merge_to_repository_relative_paths_and_drop_outside_ones(
    monkeypatch, tmp_path
):
    install_dotnet(monkeypatch, tmp_path)
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text('<PackageReference Include="coverlet.collector" />')
    work = tmp_path / "work"
    work.mkdir()
    coverage, _ = coverage_run(
        root,
        read_scans(root),
        parse_suites([{**DOTNET_SUITE, "activate": f"export PATH={tmp_path / 'bin'}:$PATH"}]),
        work,
    )

    assert coverage["src/Shop.Domain/Order.cs"] == {1: 1, 2: 0}
    assert coverage["src/Shop.Domain/Product.cs"] == {1: 5}
    assert all(not path.startswith("/") for path in coverage)
    assert not any("Other.cs" in path for path in coverage)


def run_sensor(name, root, tmp_path, settings, commit=None):
    output = tmp_path / f"{name}.json"
    argv = [
        name,
        "--repository",
        str(root),
        "--output",
        str(output),
        "--settings",
        json.dumps(settings),
    ]

    if commit:
        argv += ["--commit", commit]

    status = main(argv)

    return status, output


@pytest.mark.parametrize("sensor", ["crap", "mutation"])
def test_crap_and_mutation_exit_2_without_a_tests_list(sensor, tmp_path, capsys):
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text("coverlet.collector")
    commit = git_commit(root)
    status, _ = run_sensor(sensor, root, tmp_path, {}, commit)

    assert status == 2
    assert capsys.readouterr().err.splitlines()[-1] == (
        "coverage unavailable: no test suites are configured; "
        "add a tests list to .recognizer/config.yaml"
    )


def valid(output):
    document = json.loads(output.read_text())
    schema = json.loads(FINDINGS_SCHEMA.read_text())

    assert list(Draft202012Validator(schema).iter_errors(document)) == []

    return document["findings"]


def test_crap_and_thresholds_run_on_the_fixture_with_a_coverlet_shaped_report(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("SHELL", "/bin/sh")
    root = csharp_repository(tmp_path)
    (root / "cov.info").write_text(
        f"SF:{root}/src/Shop.Domain/Pricing.cs\nDA:7,1\nDA:8,0\nend_of_record\n"
    )
    suite = {
        "name": "shop",
        "language": "csharp",
        "directory": ".",
        "command": "touch cov.info",
        "coverage": {"path": "cov.info", "format": "lcov"},
    }
    status, output = run_sensor("crap", root, tmp_path, {"tests": [suite]}, "c1")

    assert status == 0
    valid(output)

    status, output = run_sensor("thresholds", root, tmp_path, {}, "c1")

    assert status == 0
    valid(output)


def test_mutation_runs_on_the_fixture_with_a_runner_script(tmp_path, monkeypatch):
    monkeypatch.setenv("SHELL", "/bin/sh")
    root = csharp_repository(tmp_path)
    (root / "cov.info").write_text(
        "SF:src/Shop.Domain/Pricing.cs\n"
        + "".join(f"DA:{n},1\n" for n in range(1, 20))
        + "end_of_record\n"
    )
    commit = git_commit(root)
    settings = {
        "tests": [
            {
                "name": "shop",
                "language": "csharp",
                "directory": ".",
                "activate": "dotnet() { true; }",
                "command": "touch cov.info #",
                "coverage": {"path": "cov.info", "format": "lcov"},
            }
        ]
    }
    status, output = run_sensor("mutation", root, tmp_path, settings, commit)

    assert status == 0
    valid(output)
