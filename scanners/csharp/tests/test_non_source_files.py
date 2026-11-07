import hashlib

from conftest import csproj

CLASS = "namespace A; public class C { }\n"


def paths(document: dict) -> list[str]:
    return [f["path"] for f in document["files"]]


def test_project_props_and_solution_are_listed_with_the_hash_of_their_bytes(run, tmp_path):
    props = "<Project><PropertyGroup><LangVersion>12</LangVersion></PropertyGroup></Project>"
    solution = 'Project("{X}") = "App", "src\\App\\App.csproj", "{1}"\nEndProject\n'
    document = run(
        {
            "Directory.Build.props": props,
            "App.sln": solution,
            "src/App/App.csproj": csproj(),
            "src/App/C.cs": CLASS,
        }
    )

    assert paths(document) == [
        "App.sln",
        "Directory.Build.props",
        "src/App/App.csproj",
        "src/App/C.cs",
    ]

    for entry in document["files"]:
        data = (tmp_path / entry["path"]).read_bytes()

        assert entry["hash"] == hashlib.sha256(data).hexdigest()


def test_a_solution_is_listed_in_the_slnx_form_too(run):
    document = run(
        {
            "All.slnx": '<Solution><Project Path="src/App/App.csproj" /></Solution>',
            "src/App/App.csproj": csproj(),
            "src/App/C.cs": CLASS,
        }
    )

    assert "All.slnx" in paths(document)


def test_an_imports_file_is_listed_once_and_paths_are_sorted_and_unique(run):
    document = run(
        {
            "App/App.csproj": csproj(sdk="Microsoft.NET.Sdk.Razor"),
            "App/_Imports.razor": "@using System\n",
            "App/Page.razor": "<h1>Hi</h1>\n",
            "App/C.cs": CLASS,
        }
    )
    listed = paths(document)

    assert listed.count("App/_Imports.razor") == 1
    assert listed == sorted(set(listed))


def test_an_unparseable_project_is_listed(run):
    document = run({"App/App.csproj": "<Project", "App/C.cs": CLASS})

    assert "App/App.csproj" in paths(document)


def test_a_project_under_a_skipped_directory_is_not_listed(run):
    document = run(
        {
            "App/App.csproj": csproj(),
            "App/C.cs": CLASS,
            "bin/Old/Old.csproj": csproj(),
            "obj/x/Directory.Build.props": "<Project />",
        }
    )

    assert paths(document) == ["App/App.csproj", "App/C.cs"]
