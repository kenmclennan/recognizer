import json
import os
import subprocess
import sys

from conftest import REPOSITORY
from test_duplication import find

KOTLIN_SOURCE = REPOSITORY / "scanners" / "kotlin" / "src"

FUNCTION = (
    "package pkg\n\nclass {name} {{\n"
    "    fun total(items: List<Item>): Int {{\n        var total = 0\n"
    "        for (item in items) {{\n            total += item.price * item.quantity\n        }}\n"
    "        return total\n    }}\n}}\n"
)

SCAN_SCRIPT = (
    "import sys\n"
    "sys.path.insert(0, sys.argv[2])\n"
    "from pathlib import Path\n"
    "import recognizer_scan_kotlin.scanner as scanner\n"
    "scanner.version = lambda name: '0'\n"
    "from recognizer_scan_kotlin.serialise import render\n"
    "root = Path(sys.argv[1])\n"
    "sys.stdout.write(render(scanner.scan_with_stats(root, None).document))\n"
)


def git(root, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=root,
        check=True,
        capture_output=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"},
    )


def scan_kotlin(root):
    result = subprocess.run(
        [sys.executable, "-I", "-c", SCAN_SCRIPT, str(root), str(KOTLIN_SOURCE)],
        capture_output=True,
        text=True,
        check=True,
    )

    return json.loads(result.stdout)


def test_an_ignored_bin_folder_adds_no_module_and_no_duplication_finding(tmp_path):
    for name in ("One", "Two"):
        for folder in ("src", "bin"):
            target = tmp_path / folder / f"{name}.kt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(FUNCTION.format(name=name))

    (tmp_path / "src" / "Three.kt").write_text(
        "package pkg\n\nclass Three {\n    fun label(name: String): String {\n"
        '        return "<" + name + ">"\n    }\n}\n'
    )
    (tmp_path / ".gitignore").write_text("bin/\n.recognizer/\n")
    git(tmp_path, "init", "-q")
    git(tmp_path, "add", ".gitignore", "src")
    git(tmp_path, "commit", "-q", "-m", "init")

    document = scan_kotlin(tmp_path)
    ids = [module["id"] for module in document["modules"]]

    assert ids == ["src/One.kt", "src/Three.kt", "src/Two.kt"]

    cache = tmp_path / ".recognizer" / "cache"
    cache.mkdir(parents=True)
    (cache / "scan.kotlin.json").write_text(json.dumps(document))

    findings = find(tmp_path, min_nodes=1)

    assert findings
    assert not any("bin/" in json.dumps(finding) for finding in findings)
