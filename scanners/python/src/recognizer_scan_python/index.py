from dataclasses import dataclass
from pathlib import PurePosixPath


@dataclass(frozen=True)
class Hit:
    module_id: str
    length: int


def dotted_parts(relative: PurePosixPath) -> tuple[str, ...]:
    parts = list(relative.with_suffix("").parts)

    if parts and parts[-1] == "__init__":
        parts.pop()

    return tuple(parts)


class ModuleIndex:
    def __init__(self, module_ids: list[str], source_roots: list[str]):
        self._roots = [PurePosixPath(root) for root in source_roots]
        self._by_parts: dict[tuple[str, ...], str] = {}

        for root in self._roots:
            self._claim(module_ids, root)

    def _claim(self, module_ids: list[str], root: PurePosixPath) -> None:
        local: dict[tuple[str, ...], str] = {}

        for module_id in module_ids:
            path = PurePosixPath(module_id)

            if not path.is_relative_to(root):
                continue

            parts = dotted_parts(path.relative_to(root))
            is_package = path.name == "__init__.py"

            if parts and (parts not in local or is_package):
                local[parts] = module_id

        for parts, module_id in local.items():
            self._by_parts.setdefault(parts, module_id)

    def exact(self, parts: tuple[str, ...] | list[str]) -> str | None:
        return self._by_parts.get(tuple(parts))

    def longest(self, parts: tuple[str, ...] | list[str]) -> Hit | None:
        for length in range(len(parts), 0, -1):
            module_id = self._by_parts.get(tuple(parts[:length]))

            if module_id is not None:
                return Hit(module_id, length)

        return None

    def package_parts(self, module_id: str) -> tuple[str, ...] | None:
        directory = PurePosixPath(module_id).parent

        for root in self._roots:
            if directory.is_relative_to(root):
                return tuple(directory.relative_to(root).parts)

        return None
