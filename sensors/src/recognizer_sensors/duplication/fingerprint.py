import hashlib

from recognizer_sensors.duplication.normalise import Normalised

FINGERPRINT_DEPTH = 3


def serialise(node: Normalised, depth: int) -> str:
    label, children = node

    if depth == 0 or not children:
        return label

    inner = ",".join(serialise(child, depth - 1) for child in children)

    return f"{label}({inner})"


def digest(text: str) -> int:
    return int.from_bytes(hashlib.sha1(text.encode("utf-8")).digest()[:8], "big")


def fingerprints(root: Normalised) -> frozenset[int]:
    found: set[int] = set()
    stack = [root]

    while stack:
        node = stack.pop()
        found.add(digest(serialise(node, FINGERPRINT_DEPTH)))
        stack.extend(node[1])

    return frozenset(found)
