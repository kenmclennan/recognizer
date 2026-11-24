import re

DEFAULT_JACOCO_REPORT = "build/reports/jacoco/test/jacocoTestReport.xml"

PLUGIN_LINES = [
    re.compile(r"^id\s*\(\s*[\"']jacoco[\"']\s*\)(\s+version\b.*)?$"),
    re.compile(r"^id\s+[\"']jacoco[\"'](\s+version\b.*)?$"),
    re.compile(r"^jacoco$"),
]

APPLY_LINES = [
    re.compile(r"^apply\s+plugin\s*:\s*[\"']jacoco[\"']$"),
    re.compile(r"^apply\s*\(\s*plugin\s*=\s*\"jacoco\"\s*\)$"),
]

REPORT_LITERAL = re.compile(
    r"outputLocation\s*(?:\.set\(|=)\s*layout\.buildDirectory\.file\(\s*([\"'])([^\"'\n]*)\1\s*\)"
)

UNREADABLE_MARKERS = re.compile(
    r"outputLocation|\.destination|reportsDirectory|buildDir\s*=|buildDirectory\s*=|"
    r"buildDirectory\.set"
)


def strip_gradle_comments(text: str) -> str:
    out: list[str] = []
    quote: str | None = None
    at = 0

    while at < len(text):
        char = text[at]
        following = text[at + 1] if at + 1 < len(text) else None

        if quote is not None:
            out.append(char)

            if char == "\\" and following is not None:
                out.append(following)
                at += 2
                continue

            if text.startswith(quote, at):
                out.append(quote[1:])
                at += len(quote)
                quote = None
                continue

            at += 1
            continue

        if char == "/" and following == "/":
            while at < len(text) and text[at] != "\n":
                at += 1
            continue

        if char == "/" and following == "*":
            end = text.find("*/", at + 2)
            at = len(text) if end == -1 else end + 2
            out.append(" ")
            continue

        if text.startswith('"""', at):
            quote = '"""'
            out.append('"""')
            at += 3
            continue

        if char in ('"', "'"):
            quote = char

        out.append(char)
        at += 1

    return "".join(out)


def top_level_of(text: str) -> tuple[str, list[str]]:
    top: list[str] = []
    depth = 0
    quote: str | None = None
    block: int | None = None
    plugins: list[str] = []
    at = 0

    while at < len(text):
        char = text[at]

        if quote is not None:
            if char == "\\":
                at += 1
            elif char == quote:
                quote = None

            if depth == 0:
                top.append(char)

            at += 1
            continue

        if char in ('"', "'"):
            quote = char

        if char == "{":
            if depth == 0 and re.search(r"(^|[\s;])plugins\s*$", "".join(top)):
                block = at + 1

            depth += 1

            if depth == 1:
                top.append("{")

            at += 1
            continue

        if char == "}":
            depth = max(0, depth - 1)

            if depth == 0 and block is not None:
                plugins.append(text[block:at])
                block = None

            if depth == 0:
                top.append("}")

            at += 1
            continue

        if depth == 0 or char == "\n":
            top.append(char)

        at += 1

    return "".join(top), plugins


def lines_of(text: str) -> list[str]:
    return [line.strip() for line in re.split(r"[\n;]", text) if line.strip() != ""]


def applies_jacoco(source: str) -> bool:
    top, plugins = top_level_of(strip_gradle_comments(source))
    in_plugins = any(
        pattern.search(line)
        for block in plugins
        for line in lines_of(block)
        for pattern in PLUGIN_LINES
    )

    return in_plugins or any(
        pattern.search(line) for line in lines_of(top) for pattern in APPLY_LINES
    )


def readable_literal(literal: str) -> bool:
    return (
        literal != ""
        and "$" not in literal
        and "\\" not in literal
        and not literal.startswith("/")
        and ".." not in literal.split("/")
    )


def jacoco_report_of(source: str) -> dict:
    text = strip_gradle_comments(source)
    literals = list(dict.fromkeys(match.group(2) for match in REPORT_LITERAL.finditer(text)))

    if len(literals) == 1 and readable_literal(literals[0]):
        return {"kind": "literal", "path": f"build/{literals[0]}"}

    if UNREADABLE_MARKERS.search(text):
        return {"kind": "unreadable"}

    return {"kind": "default"}
