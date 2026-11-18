from pathlib import Path


def ensure_cache_ignore(repository: Path) -> None:
    folder = repository / ".recognizer" / "cache"
    folder.mkdir(parents=True, exist_ok=True)

    try:
        with open(folder / ".gitignore", "x", encoding="utf-8") as handle:
            handle.write("*\n")
    except FileExistsError:
        pass
