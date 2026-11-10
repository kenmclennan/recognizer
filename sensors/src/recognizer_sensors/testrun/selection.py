from recognizer_sensors.crap.lcov import Coverage

Selection = dict[str, dict[int, frozenset[str]]]


class SelectionBuilder:
    def __init__(self) -> None:
        self.pool: dict[frozenset[str], frozenset[str]] = {}
        self.grown: dict[tuple[frozenset[str], str], frozenset[str]] = {}
        self.executed: dict[str, dict[int, frozenset[str]]] = {}

    def pooled(self, files: frozenset[str]) -> frozenset[str]:
        return self.pool.setdefault(files, files)

    def add(self, name: str, part: Coverage) -> None:
        empty = self.pooled(frozenset())

        for path, lines in part.items():
            target = self.executed.setdefault(path, {})

            for line, hits in lines.items():
                if hits <= 0:
                    continue

                current = target.get(line, empty)
                key = (current, name)
                grown = self.grown.get(key)

                if grown is None:
                    grown = self.pooled(current | {name})
                    self.grown[key] = grown

                target[line] = grown

    def build(self, whole: Coverage) -> Selection:
        selection: Selection = {}

        for path, lines in whole.items():
            executed = self.executed.get(path, {})

            for line, hits in lines.items():
                files = executed.get(line)

                if hits > 0 and files:
                    selection.setdefault(path, {})[line] = files

        return selection
