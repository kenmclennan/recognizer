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
    def __init__(
        self, module_ids: list[str], source_roots: list[str], script_folders: bool = False
    ):
        self._roots = [PurePosixPath(root) for root in source_roots]
        self._by_parts: dict[tuple[str, ...], str] = {}
        self._module_ids = module_ids
        self._packages = {
            str(PurePosixPath(module_id).parent)
            for module_id in module_ids
            if PurePosixPath(module_id).name == "__init__.py"
        }
        self._script_folders = script_folders
        self._siblings: dict[str, dict[tuple[str, ...], str]] = {}

        for root in self._roots:
            self._claim(module_ids, root, self._by_parts)

    def _sibling_parts(self, importer: str | None) -> dict[tuple[str, ...], str]:
        if not self._script_folders or importer is None:
            return {}

        directory = PurePosixPath(importer).parent
        key = str(directory)

        if key == "." or key in self._packages:
            return {}

        if key not in self._siblings:
            claimed: dict[tuple[str, ...], str] = {}
            self._claim(self._module_ids, directory, claimed)
            self._siblings[key] = claimed

        return self._siblings[key]

    def _claim(
        self,
        module_ids: list[str],
        root: PurePosixPath,
        target: dict[tuple[str, ...], str],
    ) -> None:
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
            target.setdefault(parts, module_id)

    def exact(self, parts: tuple[str, ...] | list[str], importer: str | None = None) -> str | None:
        found = self._by_parts.get(tuple(parts))

        if found is not None:
            return found

        return self._sibling_parts(importer).get(tuple(parts))

    def longest(
        self, parts: tuple[str, ...] | list[str], importer: str | None = None
    ) -> Hit | None:
        hit = self._longest_in(self._by_parts, parts)

        if hit is not None:
            return hit

        return self._longest_in(self._sibling_parts(importer), parts)

    @staticmethod
    def _longest_in(
        table: dict[tuple[str, ...], str], parts: tuple[str, ...] | list[str]
    ) -> Hit | None:
        for length in range(len(parts), 0, -1):
            module_id = table.get(tuple(parts[:length]))

            if module_id is not None:
                return Hit(module_id, length)

        return None

    def package_parts(self, module_id: str) -> tuple[str, ...] | None:
        directory = PurePosixPath(module_id).parent

        for root in self._roots:
            if directory.is_relative_to(root):
                return tuple(directory.relative_to(root).parts)

        return None
