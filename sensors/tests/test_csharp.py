import json
import os
import shutil
import stat
import sys

import pytest
from conftest import REPOSITORY, git_commit
from jsonschema import Draft202012Validator

from recognizer_sensors.cli import main
from recognizer_sensors.crap.complexity import cyclomatic_complexity
from recognizer_sensors.duplication.normalise import normalise
from recognizer_sensors.duplication.shapes import is_accessor_shape, is_constructor_shape
from recognizer_sensors.functions import find_functions
from recognizer_sensors.mutation.sites import find_sites
from recognizer_sensors.parsing import grammar_for, parse
from recognizer_sensors.scans import read_scans
from recognizer_sensors.settings import MeasurementError
from recognizer_sensors.testrun.run import collect_coverage

pytestmark = pytest.mark.real_probes

SAMPLE = REPOSITORY / "fixtures" / "csharp" / "sample"
EXPECTED_SCAN = REPOSITORY / "fixtures" / "csharp" / "expected-scan.json"
FINDINGS_SCHEMA = REPOSITORY / "schema" / "findings.schema.json"
REPORT = ".recognizer/cache/coverage/csharp"


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


SHAPES = [
    ("class A { A(int a, int b) { this.a = a; this.b = 2; } }", "constructor"),
    ("class A { A(int a) { this.a = a + 1; } }", None),
    ("class A { A(int a) { this.a = other; } }", None),
    ("class A { A(int a) { this.a = a; Run(); } }", None),
    ("class A { A(int a) { this.a += a; } }", None),
    ('class A { int F() { return this.s.Section("k").Entry("x", 0); } }', "accessor"),
    ('class A { int F => this.s.Section("k").Entry("x", 0); }', "accessor"),
    ("class A { int F => this.items[0]; }", "accessor"),
    ("class A { int F(int k) { return this.s.Get(k); } }", None),
    ("class A { int F() { var x = this.s; return x; } }", None),
    ("class A { int F { get { return this.s.Get(1); } } }", "accessor"),
]


@pytest.mark.parametrize(("source", "shape"), SHAPES)
def test_the_constructor_and_accessor_shapes_hold_for_csharp(source, shape):
    function = next(iter(functions(source).values())).node

    assert is_constructor_shape(function) is (shape == "constructor")
    assert is_accessor_shape(function) is (shape == "accessor")


def test_a_call_keeps_its_method_name_and_loses_the_receiver_name():
    first = functions("class A { int F() { return one.Go(x); } }")["A.F"].node
    second = functions("class A { int F() { return two.Go(y); } }")["A.F"].node
    third = functions("class A { int F() { return one.Stop(x); } }")["A.F"].node

    assert normalise(first, set()) == normalise(second, set())
    assert normalise(first, set()) != normalise(third, set())


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
    coverage = collect_coverage(root, read_scans(root), None, None)

    assert coverage["src/Shop.Domain/Order.cs"] == {1: 1, 2: 0}
    assert coverage["src/Shop.Domain/Product.cs"] == {1: 5}
    assert all(not path.startswith("/") for path in coverage)
    assert not any("Other.cs" in path for path in coverage)


def test_a_second_run_does_not_merge_the_first_runs_reports(monkeypatch, tmp_path):
    install_dotnet(monkeypatch, tmp_path)
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text("coverlet.collector")
    stale = root / REPORT / "old" / "coverage.info"
    stale.parent.mkdir(parents=True)
    stale.write_text(f"SF:{root}/src/A/Stale.cs\nDA:1,1\nend_of_record\n")
    coverage = collect_coverage(root, read_scans(root), None, None)

    assert "src/A/Stale.cs" not in coverage
    assert not stale.exists()


def test_a_test_project_without_coverlet_stops_before_dotnet_starts(monkeypatch, tmp_path):
    install_dotnet(
        monkeypatch, tmp_path, '#!/bin/sh\n[ "$1" = --version ] && exit 0\ntouch started\n'
    )
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text('<Project Sdk="Microsoft.NET.Sdk" />')

    with pytest.raises(MeasurementError) as raised:
        collect_coverage(root, read_scans(root), None, None)

    assert str(raised.value) == (
        "the csharp test project tests/T does not reference coverlet.collector; "
        "add it with dotnet add tests/T package coverlet.collector"
    )
    assert not (root / "started").exists()


def test_coverlet_named_in_a_directory_build_props_above_the_project_passes(monkeypatch, tmp_path):
    install_dotnet(monkeypatch, tmp_path)
    root = csharp_repository(tmp_path, "tests/unit/T")
    (root / "tests/unit/T/T.csproj").write_text("<Project />")
    (root / "tests/Directory.Build.props").write_text("<coverlet.collector />")

    assert collect_coverage(root, read_scans(root), None, None)


def test_the_preflight_is_skipped_when_a_test_command_or_coverage_is_set(monkeypatch, tmp_path):
    install_dotnet(monkeypatch, tmp_path)
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text("<Project />")

    assert collect_coverage(
        root, read_scans(root), ["dotnet", "test", "--results-directory", REPORT], None
    )

    report = root / "cov.info"
    report.write_text("SF:src/Shop.Domain/Order.cs\nDA:1,1\nend_of_record\n")

    assert collect_coverage(root, read_scans(root), None, "cov.info") == {
        "src/Shop.Domain/Order.cs": {1: 1}
    }


def test_a_missing_dotnet_ends_with_the_not_installed_line(monkeypatch, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text("coverlet.collector")

    with pytest.raises(MeasurementError, match="dotnet is not installed"):
        collect_coverage(root, read_scans(root), None, None)


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
def test_crap_and_mutation_exit_2_naming_dotnet_when_it_is_missing(
    sensor, monkeypatch, tmp_path, capsys
):
    empty = tmp_path / "empty"
    empty.mkdir()
    root = csharp_repository(tmp_path)
    (root / "tests/T/T.csproj").write_text("coverlet.collector")
    commit = git_commit(root)
    monkeypatch.setenv("PATH", str(empty))
    status, output = run_sensor(sensor, root, tmp_path, {}, commit)

    if sensor == "mutation":
        assert status == 2
        assert capsys.readouterr().err.splitlines()[-1] == (
            "dotnet is not installed; install it with brew install --cask dotnet-sdk"
        )
    else:
        assert status == 0
        assert json.loads(output.read_text())["diagnosis"]["code"] == "coverage-unavailable"


def valid(output):
    document = json.loads(output.read_text())
    schema = json.loads(FINDINGS_SCHEMA.read_text())

    assert list(Draft202012Validator(schema).iter_errors(document)) == []

    return document["findings"]


def test_duplication_runs_without_dotnet_on_the_fixture(monkeypatch, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    root = csharp_repository(tmp_path)
    status, output = run_sensor("duplication", root, tmp_path, {}, "c1")

    assert status == 0
    assert valid(output) == []


def test_crap_and_thresholds_run_on_the_fixture_with_a_coverlet_shaped_report(tmp_path):
    root = csharp_repository(tmp_path)
    (root / "cov.info").write_text(
        f"SF:{root}/src/Shop.Domain/Pricing.cs\nDA:7,1\nDA:8,0\nend_of_record\n"
    )
    status, output = run_sensor("crap", root, tmp_path, {"coverage": "cov.info"}, "c1")

    assert status == 0
    valid(output)

    status, output = run_sensor("thresholds", root, tmp_path, {}, "c1")

    assert status == 0
    valid(output)


def test_mutation_runs_on_the_fixture_with_a_runner_script(tmp_path):
    root = csharp_repository(tmp_path)
    (root / "cov.info").write_text(
        "SF:src/Shop.Domain/Pricing.cs\n"
        + "".join(f"DA:{n},1\n" for n in range(1, 20))
        + "end_of_record\n"
    )
    commit = git_commit(root)
    settings = {
        "test_command": [sys.executable, "-c", "import sys; sys.exit(0)"],
        "coverage": "cov.info",
    }
    status, output = run_sensor("mutation", root, tmp_path, settings, commit)

    assert status == 0
    valid(output)


def test_duplication_over_the_real_fixture_pins_its_finding_count(tmp_path):
    root = csharp_repository(tmp_path)
    status, output = run_sensor("duplication", root, tmp_path, {}, "c1")

    assert status == 0
    assert len(valid(output)) == 0
