import posixpath
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from pathlib import Path

TEST_NAME_SUFFIXES = (".Tests", ".UnitTests", ".IntegrationTests", ".FunctionalTests")
TEST_PACKAGE_PREFIXES = ("xunit", "nunit", "mstest", "tunit")
TEST_PACKAGES = ("microsoft.net.test.sdk", "microsoft.aspnetcore.mvc.testing")
BASE_IMPLICIT_USINGS = (
    "System",
    "System.Collections.Generic",
    "System.IO",
    "System.Linq",
    "System.Net.Http",
    "System.Threading",
    "System.Threading.Tasks",
)
WEB_IMPLICIT_USINGS = (
    "System.Net.Http.Json",
    "Microsoft.AspNetCore.Builder",
    "Microsoft.AspNetCore.Hosting",
    "Microsoft.AspNetCore.Http",
    "Microsoft.AspNetCore.Routing",
    "Microsoft.Extensions.Configuration",
    "Microsoft.Extensions.DependencyInjection",
    "Microsoft.Extensions.Hosting",
    "Microsoft.Extensions.Logging",
)
WORKER_IMPLICIT_USINGS = (
    "Microsoft.Extensions.Configuration",
    "Microsoft.Extensions.DependencyInjection",
    "Microsoft.Extensions.Hosting",
    "Microsoft.Extensions.Logging",
)
IMPLICIT_USINGS_BY_SDK = {
    "Microsoft.NET.Sdk": BASE_IMPLICIT_USINGS,
    "Microsoft.NET.Sdk.Web": BASE_IMPLICIT_USINGS + WEB_IMPLICIT_USINGS,
    "Microsoft.NET.Sdk.Worker": BASE_IMPLICIT_USINGS + WORKER_IMPLICIT_USINGS,
}
SOLUTION_PROJECT = re.compile(r'"([^"]+\.csproj)"')
SLNX_PROJECT = re.compile(r'Path="([^"]+\.csproj)"')


@dataclass
class ProjectUsing:
    namespace: str
    static: bool = False
    alias: str | None = None


@dataclass
class Fragment:
    sdk: str = ""
    properties: dict[str, str] = field(default_factory=dict)
    packages: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    compiles: list[str] = field(default_factory=list)
    usings: list[ProjectUsing] = field(default_factory=list)


@dataclass
class Project:
    key: str
    directory: str
    name: str
    readable: bool
    fragment: Fragment = field(default_factory=Fragment)
    references: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    test: bool = False

    def prop(self, name: str) -> str:
        return self.fragment.properties.get(name, "").strip()

    @property
    def prefix(self) -> str:
        return self.prop("RootNamespace") or self.prop("AssemblyName") or self.name

    @property
    def names(self) -> set[str]:
        return {self.name, self.prop("AssemblyName"), self.prop("PackageId")} - {""}

    @property
    def implicit_usings(self) -> tuple[str, ...]:
        if self.prop("ImplicitUsings").lower() not in ("enable", "true"):
            return ()

        return IMPLICIT_USINGS_BY_SDK.get(self.fragment.sdk, ())


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def normalise(base: str, include: str) -> str:
    return posixpath.normpath(posixpath.join(base, include.replace("\\", "/")))


def read_fragment(path: Path, base: str) -> Fragment | None:
    try:
        root = ElementTree.parse(path).getroot()
    except (ElementTree.ParseError, OSError):
        return None

    fragment = Fragment(sdk=root.get("Sdk", ""))

    for group in root.iter():
        if local(group.tag) == "PropertyGroup":
            for element in group:
                if element.text and element.text.strip():
                    fragment.properties[local(element.tag)] = element.text.strip()

    for element in root.iter():
        tag = local(element.tag)
        include = element.get("Include") or element.get("Update") or ""

        if tag == "PackageReference" and include:
            fragment.packages.append(include)
        elif tag == "ProjectReference" and include:
            fragment.references.append(normalise(base, include))
        elif tag == "Compile" and include and "*" not in include:
            fragment.compiles.append(normalise(base, include))
        elif tag == "Using" and include:
            alias = element.get("Alias")
            static = (element.get("Static") or "").lower() == "true"
            fragment.usings.append(ProjectUsing(include, static, alias))

    return fragment


def ancestors_of(directory: str) -> list[str]:
    found = []
    current = directory

    while True:
        found.append(current)

        if current == ".":
            return list(reversed(found))

        current = posixpath.dirname(current) or "."


def merged_fragment(root: Path, directory: str, own: Fragment | None) -> Fragment | None:
    merged = Fragment()

    for ancestor in ancestors_of(directory):
        candidate = root / ancestor / "Directory.Build.props"

        if candidate.is_file():
            props = read_fragment(candidate, ancestor)

            if props is not None:
                merge(merged, props)

    if own is None:
        return None

    merge(merged, own)
    merged.sdk = own.sdk

    return merged


def merge(target: Fragment, source: Fragment) -> None:
    target.properties.update(source.properties)
    target.packages.extend(source.packages)
    target.references.extend(source.references)
    target.compiles.extend(source.compiles)
    target.usings.extend(source.usings)


def listed_projects(root: Path, solutions: list[str]) -> list[str]:
    found = []

    for solution in solutions:
        pattern = SLNX_PROJECT if solution.endswith(".slnx") else SOLUTION_PROJECT
        base = posixpath.dirname(solution) or "."

        try:
            text = (root / solution).read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue

        found.extend(normalise(base, match) for match in pattern.findall(text))

    return found


def is_test_by_name(name: str) -> bool:
    return name.endswith(TEST_NAME_SUFFIXES)


def is_test_by_signal(fragment: Fragment) -> bool:
    if fragment.properties.get("IsTestProject", "").strip().lower() == "true":
        return True

    if any(
        part.strip() == "MSTest.Sdk" or part.startswith("MSTest.Sdk/")
        for part in sdk_parts(fragment)
    ):
        return True

    for package in fragment.packages:
        lowered = package.lower()

        if lowered in TEST_PACKAGES or lowered.startswith(TEST_PACKAGE_PREFIXES):
            return True

    return False


def sdk_parts(fragment: Fragment) -> list[str]:
    return [part.strip() for part in fragment.sdk.split(";") if part.strip()]


def load_projects(root: Path, project_paths: list[str], solutions: list[str]) -> dict[str, Project]:
    keys = sorted(set(project_paths) | set(listed_projects(root, solutions)))
    projects = {}

    for key in keys:
        directory = posixpath.dirname(key) or "."
        name = posixpath.basename(key)[: -len(".csproj")]
        path = root / key
        own = read_fragment(path, directory) if path.is_file() else None
        fragment = merged_fragment(root, directory, own)
        project = Project(key, directory, name, fragment is not None)

        if fragment is not None:
            project.fragment = fragment
            project.test = is_test_by_signal(fragment)
        else:
            project.test = is_test_by_name(name)

        projects[key] = project

    link_projects(projects)

    return projects


def link_projects(projects: dict[str, Project]) -> None:
    by_name = {}

    for project in projects.values():
        for name in project.names:
            by_name.setdefault(name, project.key)

    for project in projects.values():
        found = [r for r in project.fragment.references if r in projects]
        found += [by_name[p] for p in project.fragment.packages if p in by_name]
        project.references = sorted({r for r in found if r != project.key})
        project.links = sorted(set(project.fragment.compiles))


def owner_of(projects: dict[str, Project], path: str) -> str | None:
    by_directory = {}

    for project in projects.values():
        by_directory.setdefault(project.directory, project.key)

    for directory in reversed(ancestors_of(posixpath.dirname(path) or ".")):
        if directory in by_directory:
            return by_directory[directory]

    return None


def reach_of(projects: dict[str, Project], key: str) -> set[str]:
    seen = {key}
    pending = [key]

    while pending:
        current = projects.get(pending.pop())

        for reference in current.references if current else []:
            if reference not in seen:
                seen.add(reference)
                pending.append(reference)

    return seen
