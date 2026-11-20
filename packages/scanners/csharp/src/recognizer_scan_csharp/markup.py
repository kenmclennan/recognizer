import posixpath
import re
from dataclasses import dataclass, field
from pathlib import Path

from recognizer_scan_csharp.declarations import SourceFile, Using
from recognizer_scan_csharp.discovery import directory_of
from recognizer_scan_csharp.projects import Project, owner_of
from recognizer_scan_csharp.resolve import Collected, Resolver

RAZOR_EXTENSIONS = (".razor", ".cshtml")
IMPORTS_NAMES = {".razor": "_Imports.razor", ".cshtml": "_ViewImports.cshtml"}
RAZOR_COMMENT = re.compile(r"@\*.*?\*@", re.DOTALL)
XAML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
TYPE_DIRECTIVE = re.compile(r"^[ \t]*@(?:inject|model|inherits)[ \t]+(.*)$", re.MULTILINE)
USING_DIRECTIVE = re.compile(
    r"^[ \t]*@using[ \t]+(?:(static)[ \t]+)?(?:([A-Za-z_]\w*)[ \t]*=[ \t]*)?"
    r"([A-Za-z_][\w.]*)[ \t]*;?[ \t]*\r?$",
    re.MULTILINE,
)
DOTTED_NAME = re.compile(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*")
COMPONENT_TAG = re.compile(r"<([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?=[\s/>])")
XMLNS = re.compile(r'xmlns:(\w+)\s*=\s*"(?:clr-namespace|using):([^";]+)(?:;[^"]*)?"')
XAML_ELEMENT = re.compile(r"<(\w+):(\w+)(?:\.\w+)?")
XAML_CLASS = re.compile(r'\bx:Class\s*=\s*"([^"]*)"')
XAML_DATA_TYPE = re.compile(r'\bx:DataType\s*=\s*"([^"]*)"')


@dataclass
class Extracted:
    usings: list[Using] = field(default_factory=list)
    names: dict[tuple[str, ...], int] = field(default_factory=dict)

    def name(self, segments: list[str] | tuple[str, ...], line: int) -> None:
        key = tuple(segments)

        if key not in self.names or line < self.names[key]:
            self.names[key] = line


def blank_comments(text: str, pattern: re.Pattern) -> str:
    return pattern.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def line_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def type_expression(text: str) -> str:
    depth = 0

    for index, character in enumerate(text):
        if character == "<":
            depth += 1
        elif character == ">":
            depth = max(0, depth - 1)
        elif character.isspace() and depth == 0:
            return text[:index]

    return text


def extract_razor(text: str, is_component_file: bool) -> Extracted:
    text = blank_comments(text, RAZOR_COMMENT)
    found = Extracted()

    for match in USING_DIRECTIVE.finditer(text):
        static, alias, target = match.groups()
        segments = tuple(target.split("."))
        kind = "alias" if alias else "static" if static else "plain"
        found.usings.append(Using(kind, False, alias, segments, line_at(text, match.start())))

    for match in TYPE_DIRECTIVE.finditer(text):
        line = line_at(text, match.start())

        for name in DOTTED_NAME.findall(type_expression(match.group(1))):
            found.name(name.split("."), line)

    if is_component_file:
        for match in COMPONENT_TAG.finditer(text):
            segments = match.group(1).split(".")

            if segments[-1][:1].isupper():
                found.name(segments, line_at(text, match.start()))

    return found


def extract_xaml(text: str) -> Extracted:
    text = blank_comments(text, XAML_COMMENT)
    found = Extracted()
    prefixes = {m.group(1): m.group(2).strip() for m in XMLNS.finditer(text)}

    for match in XAML_ELEMENT.finditer(text):
        prefix, name = match.groups()

        if prefix in prefixes:
            found.name([*prefixes[prefix].split("."), name], line_at(text, match.start()))

    for match in XAML_CLASS.finditer(text):
        value = match.group(1).strip()

        if DOTTED_NAME.fullmatch(value):
            found.name(value.split("."), line_at(text, match.start()))

    for match in XAML_DATA_TYPE.finditer(text):
        value = match.group(1).strip()
        line = line_at(text, match.start())

        if value.startswith("{"):
            continue

        if ":" in value:
            prefix, name = value.split(":", 1)

            if prefix in prefixes and DOTTED_NAME.fullmatch(name):
                found.name([*prefixes[prefix].split("."), *name.split(".")], line)
        elif DOTTED_NAME.fullmatch(value):
            found.name(value.split("."), line)

    return found


def extract(path: str, text: str) -> Extracted:
    if path.endswith(".xaml"):
        return extract_xaml(text)

    return extract_razor(text, path.endswith(".razor"))


def source_module_of(
    path: str, projects: dict[str, Project], files: list[SourceFile], scanned: set[str]
) -> SourceFile | None:
    code_behind = f"{path}.cs"
    by_path = {f.path: f for f in files}

    if code_behind in scanned:
        return by_path[code_behind]

    owner = owner_of(projects, path)

    if owner is None:
        return None

    candidates = [
        f
        for f in files
        if (f.top_level or any(not d.outer for d in f.decls))
        and owner_of(projects, f.path) == owner
    ]
    stop = projects[owner].directory
    directory = directory_of(path)

    while True:
        here = sorted(f.path for f in candidates if directory_of(f.path) == directory)

        if here:
            return by_path[here[0]]

        if directory == stop or directory in (".", ""):
            return None

        directory = posixpath.dirname(directory) or "."


def namespace_of(path: str, project: Project) -> str:
    folder = posixpath.relpath(directory_of(path), project.directory)
    parts = [project.prefix] + ([] if folder == "." else folder.split("/"))

    return ".".join(parts)


def imports_for(
    root: Path, path: str, project: Project, cache: dict[str, Extracted]
) -> list[Using]:
    suffix = Path(path).suffix

    if suffix not in IMPORTS_NAMES:
        return []

    found: list[Using] = []
    directory = directory_of(path)
    chain = []

    while True:
        chain.append(directory)

        if directory == project.directory or directory in (".", ""):
            break

        directory = posixpath.dirname(directory) or "."

    for directory in reversed(chain):
        candidate = posixpath.normpath(posixpath.join(directory, IMPORTS_NAMES[suffix]))

        if candidate not in cache:
            target = root / candidate
            text = (
                target.read_text(encoding="utf-8-sig", errors="replace") if target.is_file() else ""
            )
            cache[candidate] = extract(candidate, text)

        found.extend(cache[candidate].usings)

    return found


def read_markup(
    root: Path,
    path: str,
    projects: dict[str, Project],
    files: list[SourceFile],
    scanned: set[str],
    resolver: Resolver,
    imports: dict[str, Extracted],
    order: int,
    collected: Collected,
) -> bytes:
    data = (root / path).read_bytes()
    source = source_module_of(path, projects, files, scanned)
    owner = owner_of(projects, path)

    if source is None or owner is None:
        return data

    project = projects[owner]
    text = data.decode("utf-8-sig", errors="replace")
    found = extract(path, text)
    stand_in = SourceFile(path, directory_of(path), False, text)
    stand_in.usings = [*imports_for(root, path, project, imports), *found.usings]
    stand_in.projects = source.projects
    stand_in.reach = source.reach
    namespace = namespace_of(path, project)

    for segments, line in sorted(found.names.items(), key=lambda item: (item[1], item[0])):
        for target in resolver.chain(stand_in, list(segments), (), namespace):
            if target.path != source.path:
                collected.depend(source.path, target.path, line, order, [target.name])

    return data
