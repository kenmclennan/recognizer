from pathlib import Path, PurePosixPath

from recognizer_sensors.outcome import Outcome
from recognizer_sensors.scans import Scan, ScanMember, ScanModule
from recognizer_sensors.settings import SettingsError
from recognizer_sensors.unused_exports.entry_points import glob_to_regex, is_entry_point

DEFAULTS: dict = {"entry_points": []}

PRINCIPLE = "Export only what is used"
FIX_PATTERN = "narrow-exports"
FOREIGN = "foreign:"


def parse_settings(raw: dict) -> dict:
    unknown = sorted(set(raw) - set(DEFAULTS))

    if unknown:
        raise SettingsError(f"unknown setting: {', '.join(unknown)}")

    globs = raw.get("entry_points", DEFAULTS["entry_points"])

    if not isinstance(globs, list):
        raise SettingsError("entry_points must be an array of globs")

    if not all(isinstance(glob, str) and glob for glob in globs):
        raise SettingsError("entry_points must hold non-empty strings")

    for glob in globs:
        glob_to_regex(glob)

    return {"entry_points": list(globs)}


def used_names(scan: Scan) -> tuple[dict[str, set[str]], set[str]]:
    named: dict[str, set[str]] = {}
    whole: set[str] = set()

    for edge in scan.edges:
        if edge.target.startswith(FOREIGN) or edge.source == edge.target:
            continue

        if edge.kind == "depends":
            if edge.names:
                named.setdefault(edge.target, set()).update(edge.names)
            else:
                whole.add(edge.target)
        elif edge.to_member is not None:
            named.setdefault(edge.target, set()).add(edge.to_member)

    return named, whole


def is_used(name: str, used: set[str]) -> bool:
    return name in used or name.split(".", 1)[0] in used


def unused_members(module: ScanModule, used: set[str]) -> list[ScanMember]:
    first: dict[str, ScanMember] = {}

    for member in module.members:
        if member.exported and member.name not in first:
            first[member.name] = member

    return [first[name] for name in sorted(first) if not is_used(name, used)]


def file_for(language: str, module: ScanModule, member: ScanMember) -> str | None:
    if language != "kotlin":
        return module.files[0] if module.files else None

    leading = member.name.split(".", 1)[0]

    for file in module.files:
        if PurePosixPath(file).stem == leading:
            return file

    return module.files[0] if len(module.files) == 1 else None


def evidence_member(language: str, module: ScanModule, member: ScanMember) -> dict:
    file = file_for(language, module, member)
    entry: dict = {"module": module.id, "name": member.name}

    if file is not None and member.line is not None:
        entry["file"] = file
        entry["lines"] = [member.line, member.line]

    return entry


def finding_for(language: str, module: ScanModule, unused: list[ScanMember]) -> dict:
    noun = "name" if len(unused) == 1 else "names"
    names = ", ".join(member.name for member in unused)

    return {
        "id": f"unused-exports:{module.id}",
        "kind": "unused-exports",
        "severity": "warning",
        "principle": PRINCIPLE,
        "fix_pattern": FIX_PATTERN,
        "summary": f"{module.id} exports {len(unused)} {noun} no other module imports: {names}",
        "evidence": {
            "modules": [module.id],
            "members": [evidence_member(language, module, member) for member in unused],
        },
    }


def run(repository: Path, scans: list[Scan], settings: dict) -> Outcome:
    globs = settings["entry_points"]
    findings = []

    for scan in scans:
        named, whole = used_names(scan)

        for module in scan.modules:
            if module.id in whole or is_entry_point(module.id, globs):
                continue

            unused = unused_members(module, named.get(module.id, set()))

            if unused:
                findings.append(finding_for(scan.language, module, unused))

    return Outcome(findings)
