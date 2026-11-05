import re
import sys
from pathlib import Path

SOURCE = Path("csharp/Shop.cs").read_text()

METHOD = re.compile(r"public static \w+\?? (\w+)\(([^)]*)\)\s*\{(.*?)\n    \}", re.S)


def translate(name, parameters, body):
    names = [p.split()[-1] for p in parameters.split(",") if p.strip()]
    lines = [f"def {name}({', '.join(names)}):"]

    for raw in body.splitlines():
        text = raw.strip()

        if not text or text.startswith("#") or text in "{}":
            continue

        text = text.rstrip(";").removeprefix("var ")
        text = text.replace("&&", " and ").replace("||", " or ")
        text = text.replace("true", "True").replace("false", "False")
        lines.append(f"    {text}")

    return "\n".join(lines)


namespace = {}

for name, parameters, body in METHOD.findall(SOURCE):
    exec(translate(name, parameters, body), namespace)

Shop = type("Shop", (), {name: staticmethod(fn) for name, fn in namespace.items() if name[0].isupper()})

assert Shop.IsAdult(30) is True
assert Shop.IsAdult(5) is False

assert Shop.Total(3, 4) == 12

assert Shop.Both(True, True) is True
assert Shop.Both(False, False) is False

Shop.DefaultEnabled()

assert Shop.Gate(True) is True
assert Shop.Gate(False) is False

assert Shop.Windowed(1, 2) is True
assert Shop.Windowed(60, 50) is False

assert Shop.Flagged(5) == 6
