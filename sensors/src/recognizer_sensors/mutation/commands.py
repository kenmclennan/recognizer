import os

from recognizer_sensors.testrun.suites import Suite, directory_of

MAX_SELECTED_FILES = 50

KOTLIN_CLASSES: dict[str, list[tuple[str, str]]] = {}

CSHARP_CLASSES: dict[str, list[str]] = {}

RUST_UNITS: dict[str, tuple[str, str, str]] = {}

CSHARP_TRX_LOGGER = ["--logger", "trx;LogFilePrefix=results"]


def typescript_flags(suite: Suite, stop: bool, workers: int) -> list[str]:
    bail = ["--bail=1" if suite.runner == "vitest" else "--bail"] if stop else []
    cap = [f"--maxWorkers={max(1, (os.cpu_count() or 1) // workers)}"] if workers > 1 else []

    return [*bail, *cap]


def typescript_whole(suite: Suite, stop: bool, workers: int) -> list[str]:
    run = ["run"] if suite.runner == "vitest" else []

    return ["npx", "--no", "--", suite.runner, *run, *typescript_flags(suite, stop, workers)]


def typescript_related(suite: Suite, file: str, stop: bool, workers: int) -> list[str]:
    flags = typescript_flags(suite, stop, workers)

    if suite.runner == "vitest":
        return ["npx", "--no", "--", "vitest", "related", file, "--run", *flags]

    return ["npx", "--no", "--", "jest", "--findRelatedTests", file, *flags]


def kotlin_fail_fast(command: list[str]) -> list[str]:
    stopped: list[str] = []
    skip = False

    for index, word in enumerate(command):
        if skip:
            skip = False

            continue

        stopped.append(word)

        if word == "test" or word.endswith(":test"):
            if command[index + 1 : index + 2] == ["--no-daemon"]:
                stopped.append("--no-daemon")
                skip = True

            stopped.append("--fail-fast")

    return stopped


def mutant_command(suite: Suite, stop: bool = False, workers: int = 1) -> list[str]:
    if suite.language == "python":
        return ["pytest", "-rfE", *(["-x"] if stop else [])]

    if suite.language == "typescript":
        return typescript_whole(suite, stop, workers)

    if suite.language == "kotlin":
        command = ["./gradlew", "test", "--no-daemon"]

        return kotlin_fail_fast(command) if stop else command

    if suite.language == "rust":
        return ["cargo", "test"]

    return ["dotnet", "test"]


def kotlin_class_command(project: str, classes: list[str]) -> list[str]:
    return [
        "./gradlew",
        f"{project}:test" if project else "test",
        "--no-daemon",
        "--rerun",
        *[arg for name in classes for arg in ("--tests", name)],
        f"{project}:jacocoTestReport" if project else "jacocoTestReport",
    ]


def kotlin_selected_command(selected: list[tuple[str, str]]) -> list[str]:
    command = ["./gradlew"]

    for project in sorted({project for project, _ in selected}):
        command.append(f"{project}:test" if project else "test")

        if "--no-daemon" not in command:
            command.append("--no-daemon")

        for name in sorted(name for p, name in selected if p == project):
            command += ["--tests", name]

    return command


def csharp_filter(classes: list[str]) -> str:
    return "|".join(f"FullyQualifiedName~{name}." for name in sorted(classes))


def csharp_class_command(number: int, classes: list[str]) -> list[str]:
    return [
        "dotnet",
        "test",
        "--collect:XPlat Code Coverage;Format=lcov",
        "--results-directory",
        f".recognizer/cache/coverage/csharp/by-file/{number}",
        *CSHARP_TRX_LOGGER,
        "--filter",
        csharp_filter(classes),
    ]


def csharp_selected_command(classes: list[str]) -> list[str]:
    return ["dotnet", "test", "--filter", csharp_filter(classes)]


def rust_by_target_command(number: int, unit: tuple[str, str, str]) -> list[str]:
    package, kind, name = unit
    flag = ["--lib"] if kind == "lib" else [f"--{kind}", name]

    return [
        "cargo",
        "llvm-cov",
        "--lcov",
        "--output-path",
        f".recognizer/cache/coverage/rust/by-target/{number}.lcov",
        "-p",
        package,
        *flag,
    ]


def rust_selected_command(units: list[tuple[str, str, str]]) -> list[str]:
    command = ["cargo", "test"]

    for package in sorted({package for package, _, _ in units}):
        command += ["-p", package]

    if any(kind == "lib" for _, kind, _ in units):
        command.append("--lib")

    for kind in ("bin", "test"):
        for name in sorted({name for _, k, name in units if k == kind}):
            command += [f"--{kind}", name]

    return command


def killers_first(files: set[str] | frozenset[str], previous: frozenset[str]) -> list[str]:
    return sorted(files, key=lambda f: (f not in previous, f))


def relative_to_directory(files: set[str] | frozenset[str], directory: str) -> list[str] | None:
    if not directory:
        return list(files)

    found = [f.removeprefix(f"{directory}/") for f in files if f.startswith(f"{directory}/")]

    return found if len(found) == len(files) else None


def unselectable(files: set[str] | frozenset[str]) -> bool:
    return not files or len(files) > MAX_SELECTED_FILES or any(f.startswith("-") for f in files)


def selected_command(
    suite: Suite,
    files: set[str] | frozenset[str] | None,
    stop: bool = False,
    previous: frozenset[str] = frozenset(),
    workers: int = 1,
    file: str | None = None,
) -> list[str] | None:
    directory = directory_of(suite)
    language = suite.language

    if language == "typescript":
        local = relative_to_directory({file}, directory) if file else None

        if not local or local[0].startswith("-"):
            return None

        return typescript_related(suite, local[0], stop, workers)

    if files is None or unselectable(files):
        return mutant_command(suite, stop, workers)

    if language == "python":
        local = relative_to_directory(files, directory)

        if local is None:
            return mutant_command(suite, stop, workers)

        kept = (
            frozenset(relative_to_directory(previous, directory) or ()) if directory else previous
        )

        ordered = killers_first(set(local), kept)

        return ["pytest", "-rfE", *(["-x"] if stop else []), *ordered]

    if language == "kotlin":
        if any(f not in KOTLIN_CLASSES for f in files):
            return mutant_command(suite, stop, workers)

        command = kotlin_selected_command(
            [pair for f in sorted(files) for pair in KOTLIN_CLASSES[f]]
        )

        return kotlin_fail_fast(command) if stop else command

    if language == "csharp":
        if any(f not in CSHARP_CLASSES for f in files):
            return mutant_command(suite, stop, workers)

        return csharp_selected_command([n for f in sorted(files) for n in CSHARP_CLASSES[f]])

    if any(f not in RUST_UNITS for f in files):
        return mutant_command(suite, stop, workers)

    return rust_selected_command([RUST_UNITS[f] for f in sorted(files)])
