from collections import Counter


def assign_identities(items: list[tuple[str, str, int]]) -> list[str]:
    counts = Counter((module, qualified) for module, qualified, _ in items)
    identities = []

    for module, qualified, start_line in items:
        identity = f"{module}::{qualified}"

        if counts[(module, qualified)] > 1:
            identity = f"{identity}@{start_line}"

        identities.append(identity)

    return identities
