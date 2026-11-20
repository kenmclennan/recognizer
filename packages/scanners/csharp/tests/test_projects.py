import pytest
from conftest import csproj, module_ids

CLASS = "namespace N;\npublic class C {}\n"


def tree_with(project: str, project_text: str, name: str | None = None) -> dict[str, str]:
    name = name or project.rsplit("/", 1)[-1]

    return {
        f"{project}/{name}.csproj": project_text,
        f"{project}/C.cs": CLASS,
        "src/App/App.csproj": csproj(),
        "src/App/A.cs": "namespace App;\npublic class A {}\n",
    }


@pytest.mark.parametrize(
    ("label", "text"),
    [
        ("test-sdk", csproj(packages=("Microsoft.NET.Test.Sdk",))),
        ("is-test-project", csproj(properties={"IsTestProject": "true"})),
        ("mstest-sdk", csproj(sdk="MSTest.Sdk/3.6.0")),
        ("xunit", csproj(packages=("xunit.v3",))),
        ("nunit", csproj(packages=("NUnit",))),
        ("mstest", csproj(packages=("MSTest.TestFramework",))),
        ("tunit", csproj(packages=("TUnit",))),
        ("mvc-testing", csproj(packages=("Microsoft.AspNetCore.Mvc.Testing",))),
    ],
)
def test_each_signal_makes_a_test_project_and_lists_its_directory(run, label, text):
    document = run(tree_with(f"tests/{label}", text))

    assert module_ids(document) == ["src/App/A.cs"]
    assert document["selection"]["skip_paths"] == [f"tests/{label}"]


def test_a_signal_is_not_needed_for_a_project_with_none(run):
    document = run(tree_with("src/Plain", csproj()))

    assert "src/Plain/C.cs" in module_ids(document)
    assert document["selection"]["skip_paths"] == []


def test_is_test_project_false_is_not_a_signal(run):
    document = run(tree_with("src/Plain", csproj(properties={"IsTestProject": "false"})))

    assert "src/Plain/C.cs" in module_ids(document)


def test_a_signal_set_in_directory_build_props_applies_to_the_project(run):
    files = tree_with("tests/FromProps", csproj())
    files["Directory.Build.props"] = (
        "<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup></Project>"
    )
    files["src/App/App.csproj"] = csproj(properties={"IsTestProject": "false"})
    document = run(files)

    assert "tests/FromProps/C.cs" not in module_ids(document)
    assert document["selection"]["skip_paths"] == ["tests/FromProps"]
    assert "src/App/A.cs" in module_ids(document)


def test_a_package_reference_in_directory_build_props_accumulates(run):
    files = tree_with("tests/Shared", csproj())
    files["tests/Directory.Build.props"] = (
        '<Project><ItemGroup><PackageReference Include="xunit" /></ItemGroup></Project>'
    )
    document = run(files)

    assert document["selection"]["skip_paths"] == ["tests/Shared"]


@pytest.mark.parametrize(
    "name", ["Foo.Tests", "Foo.UnitTests", "Foo.IntegrationTests", "Foo.FunctionalTests"]
)
def test_the_name_fallback_applies_to_an_unreadable_csproj(run, name):
    document = run(tree_with(f"tests/{name}", "<Project><broken"))

    assert "tests/" + name + "/C.cs" not in module_ids(document)
    assert document["selection"]["skip_paths"] == [f"tests/{name}"]


def test_the_name_fallback_does_not_apply_to_a_readable_csproj_with_no_signal(run):
    document = run(tree_with("tests/Foo.Tests", csproj()))

    assert "tests/Foo.Tests/C.cs" in module_ids(document)
    assert document["selection"]["skip_paths"] == []


def test_a_name_that_only_looks_like_a_test_name_is_not_test_code(run):
    document = run(tree_with("src/Foo.TestUtilities", "<Project><broken"))

    assert "src/Foo.TestUtilities/C.cs" in module_ids(document)
    assert document["selection"]["skip_paths"] == []


def test_a_project_listed_in_a_solution_whose_csproj_is_missing_falls_back_to_its_name(run):
    files = {
        "All.sln": 'Project("{X}") = "Foo.Tests", "tests\\Foo.Tests\\Foo.Tests.csproj", "{1}"\nEndProject\n',
        "tests/Foo.Tests/C.cs": CLASS,
        "src/App/App.csproj": csproj(),
        "src/App/A.cs": "namespace App;\npublic class A {}\n",
    }
    document = run(files)

    assert module_ids(document) == ["src/App/A.cs"]
    assert document["selection"]["skip_paths"] == ["tests/Foo.Tests"]


def test_a_solution_listing_a_missing_csproj_records_it_as_an_absent_path(run):
    files = {
        "All.sln": 'Project("{X}") = "Foo.Tests", "tests\\Foo.Tests\\Foo.Tests.csproj", "{1}"\nEndProject\n'
        'Project("{X}") = "App", "src\\App\\App.csproj", "{2}"\nEndProject\n',
        "src/App/App.csproj": csproj(),
        "src/App/A.cs": "namespace App;\npublic class A {}\n",
    }
    document = run(files)

    assert document["selection"]["input_absent_paths"] == ["tests/Foo.Tests/Foo.Tests.csproj"]
    paths = [f["path"] for f in document["files"]]
    assert "src/App/App.csproj" in paths
    assert "tests/Foo.Tests/Foo.Tests.csproj" not in paths


def test_a_scan_with_no_missing_project_has_no_absent_paths_key(run):
    document = run({"src/App/App.csproj": csproj(), "src/App/A.cs": "public class A {}\n"})

    assert "input_absent_paths" not in document["selection"]


def test_a_solution_in_the_slnx_format_lists_projects_too(run):
    files = {
        "All.slnx": '<Solution><Project Path="tests/Foo.UnitTests/Foo.UnitTests.csproj" /></Solution>',
        "tests/Foo.UnitTests/C.cs": CLASS,
    }
    document = run(files)

    assert module_ids(document) == []
    assert document["selection"]["skip_paths"] == ["tests/Foo.UnitTests"]


def test_a_test_project_in_the_repository_root_lists_a_dot(run):
    document = run(
        {
            "Root.csproj": csproj(packages=("xunit",)),
            "A.cs": CLASS,
        }
    )

    assert document["modules"] == []
    assert document["selection"]["skip_paths"] == ["."]


def test_a_test_project_that_holds_a_scanned_project_is_not_listed(run):
    files = {
        "tests/Outer/Outer.csproj": csproj(packages=("xunit",)),
        "tests/Outer/O.cs": CLASS,
        "tests/Outer/Helpers/Helpers.csproj": csproj(),
        "tests/Outer/Helpers/H.cs": "namespace H;\npublic class H {}\n",
        "tests/Other/Other.csproj": csproj(packages=("xunit",)),
        "tests/Other/X.cs": CLASS,
    }
    document = run(files)

    assert document["selection"]["skip_paths"] == ["tests/Other"]
    assert module_ids(document) == ["tests/Outer/Helpers/H.cs"]


def test_skip_paths_are_sorted_without_trailing_slash_or_backslash(run):
    files = {}

    for name in ("Zed", "Alpha", "Mid"):
        files.update(tree_with(f"tests/{name}", csproj(packages=("xunit",))))

    document = run(files)
    paths = document["selection"]["skip_paths"]

    assert paths == ["tests/Alpha", "tests/Mid", "tests/Zed"]
    assert not any(p.endswith("/") or "\\" in p for p in paths)


def test_conditions_on_property_groups_are_read_as_unconditional(run):
    text = (
        "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup Condition=\"'$(X)' == 'y'\">"
        "<IsTestProject>true</IsTestProject></PropertyGroup></Project>"
    )
    document = run(tree_with("tests/Conditioned", text))

    assert document["selection"]["skip_paths"] == ["tests/Conditioned"]


def test_a_cs_file_with_no_project_is_scanned(run):
    document = run({"loose/A.cs": CLASS})

    assert module_ids(document) == ["loose/A.cs"]


def test_a_file_linked_only_into_a_test_project_from_outside_is_not_scanned_when_it_has_no_owner(
    run,
):
    files = {
        "tests/T/T.csproj": csproj(
            packages=("xunit",), compiles=(("..\\..\\shared\\S.cs", "S.cs"),)
        ),
        "tests/T/C.cs": CLASS,
        "shared/S.cs": "namespace S;\npublic class S {}\n",
    }
    document = run(files)

    assert module_ids(document) == []


def test_a_file_linked_into_a_scanned_project_and_a_test_project_is_scanned(run):
    link = (("..\\Shared\\S.cs", "S.cs"),)
    files = {
        "tests/T/T.csproj": csproj(
            packages=("xunit",), compiles=(("..\\..\\src\\Shared\\S.cs", "S.cs"),)
        ),
        "src/App/App.csproj": csproj(compiles=link),
        "src/Shared/S.cs": "namespace S;\npublic class S {}\n",
    }
    document = run(files)

    assert module_ids(document) == ["src/Shared/S.cs"]
