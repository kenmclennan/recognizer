from collections import defaultdict
from collections.abc import Sequence


def reaches(intersection: int, union: int, threshold: float) -> bool:
    return union > 0 and intersection / union >= threshold


def brute_force_pairs(
    sets: Sequence[frozenset[int]], threshold: float
) -> list[tuple[int, int, int, int]]:
    pairs = []

    for i in range(len(sets)):
        for j in range(i + 1, len(sets)):
            intersection = len(sets[i] & sets[j])
            union = len(sets[i] | sets[j])

            if reaches(intersection, union, threshold):
                pairs.append((i, j, intersection, union))

    return pairs


def pruned_pairs(
    sets: Sequence[frozenset[int]], threshold: float
) -> list[tuple[int, int, int, int]]:
    index: dict[int, list[int]] = defaultdict(list)

    for position, fingerprint_set in enumerate(sets):
        for fingerprint in fingerprint_set:
            index[fingerprint].append(position)

    pairs = []

    for i, mine in enumerate(sets):
        shared: dict[int, int] = defaultdict(int)

        for fingerprint in mine:
            for j in index[fingerprint]:
                if j > i:
                    shared[j] += 1

        for j, intersection in shared.items():
            small, large = sorted((len(mine), len(sets[j])))

            if small / large < threshold:
                continue

            union = len(mine) + len(sets[j]) - intersection

            if reaches(intersection, union, threshold):
                pairs.append((i, j, intersection, union))

    return sorted(pairs)
