import re

from recognizer_scan_csharp.declarations import SourceFile
from recognizer_scan_csharp.index import Index

ENTRY_ATTRIBUTES = {"ApiController"}
FRAMEWORK_ATTRIBUTES = {
    "Generator",
    "DiagnosticAnalyzer",
    "ExportCodeFixProvider",
    "ExportCodeRefactoringProvider",
    "Cmdlet",
    "DbContext",
    "Migration",
}
HOSTING_BASES = {"Controller", "ControllerBase", "BackgroundService", "IHostedService"}
FRAMEWORK_BASES = {
    "Migration",
    "ModelSnapshot",
    "IIncrementalGenerator",
    "ISourceGenerator",
    "DiagnosticAnalyzer",
    "CodeFixProvider",
    "Cmdlet",
    "PSCmdlet",
}
CODE_BEHIND_SUFFIXES = (".xaml.cs", ".razor.cs", ".cshtml.cs")
MEDIATR_NAMES = {
    "IRequestHandler",
    "INotificationHandler",
    "IStreamRequestHandler",
    "IPipelineBehavior",
    "IRequestPreProcessor",
    "IRequestPostProcessor",
    "IRequestExceptionHandler",
}
VALIDATION_NAMES = {"AbstractValidator", "IValidator"}
ASSIGNABLE = re.compile(r"typeof\(\s*([\w.]+)\s*(?:<[^()]*?>)?\s*\)\s*\.IsAssignableFrom")
TYPES_TO_REGISTER = re.compile(
    r"GetTypesToRegister\s*(?:<\s*([\w.]+)|\(\s*(?:[^,()]+,\s*)?typeof\(\s*([\w.]+))"
)
OPEN_GENERIC = re.compile(
    r"(?:\.Register|\.Append|RegisterDecorator)\s*\(\s*typeof\(\s*([\w.]+)\s*<[\s,]*>\s*\)([^;]*)"
)


def last_segment(name: str) -> str:
    return name.split(".")[-1]


def convention_roots(files: list[SourceFile], index: Index) -> set[str]:
    named = set()
    text = "\n".join(f.text for f in files)

    for match in ASSIGNABLE.finditer(text):
        named.add(last_segment(match.group(1)))

    for match in TYPES_TO_REGISTER.finditer(text):
        named.add(last_segment(match.group(1) or match.group(2)))

    for match in OPEN_GENERIC.finditer(text):
        if "ssembl" in match.group(2):
            named.add(last_segment(match.group(1)))

    roots = named & index.abstract_names()

    if "AddMediatR" in text:
        roots |= MEDIATR_NAMES

    if "AddValidatorsFromAssembly" in text:
        roots |= VALIDATION_NAMES

    return roots


def is_entry_point(file: SourceFile, roots: set[str]) -> bool:
    if file.top_level or file.path.endswith(CODE_BEHIND_SUFFIXES):
        return True

    for decl in file.decls:
        names = {last_segment(".".join(b)) for b in decl.bases}

        if (
            decl.static_main
            or decl.attributes & (ENTRY_ATTRIBUTES | FRAMEWORK_ATTRIBUTES)
            or names & (HOSTING_BASES | FRAMEWORK_BASES | roots)
        ):
            return True

    return False
