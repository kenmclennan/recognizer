export type Pair = readonly [number, number, number, number];

export function reaches(
  intersection: number,
  union: number,
  threshold: number,
): boolean {
  return union > 0 && intersection / union >= threshold;
}

export function bruteForcePairs(
  sets: readonly ReadonlySet<string>[],
  threshold: number,
): Pair[] {
  const pairs: Pair[] = [];

  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const mine = sets[i] as ReadonlySet<string>;
      const other = sets[j] as ReadonlySet<string>;
      let intersection = 0;

      for (const fingerprint of mine) {
        if (other.has(fingerprint)) {
          intersection += 1;
        }
      }

      const union = mine.size + other.size - intersection;

      if (reaches(intersection, union, threshold)) {
        pairs.push([i, j, intersection, union]);
      }
    }
  }

  return pairs;
}

export function prunedPairs(
  sets: readonly ReadonlySet<string>[],
  threshold: number,
): Pair[] {
  const interned = new Map<string, number>();
  const members: Int32Array[] = sets.map((fingerprints) => {
    const ids = new Int32Array(fingerprints.size);
    let at = 0;

    for (const fingerprint of fingerprints) {
      let id = interned.get(fingerprint);

      if (id === undefined) {
        id = interned.size;
        interned.set(fingerprint, id);
      }

      ids[at] = id;
      at += 1;
    }

    return ids;
  });
  const order = members
    .map((_, index) => index)
    .sort(
      (a, b) =>
        (members[a] as Int32Array).length - (members[b] as Int32Array).length ||
        a - b,
    );
  const sizes = order.map((index) => (members[index] as Int32Array).length);
  const counts = new Int32Array(sets.length);
  const postings: number[][] = Array.from({ length: interned.size }, () => []);

  order.forEach((index, position) => {
    for (const id of members[index] as Int32Array) {
      (postings[id] as number[]).push(position);
    }
  });

  const cursor = new Int32Array(interned.size);
  const pairs: Pair[] = [];
  const touched: number[] = [];

  order.forEach((index, position) => {
    const mine = members[index] as Int32Array;
    const size = sizes[position] as number;

    touched.length = 0;

    for (const id of mine) {
      const list = postings[id] as number[];
      let at = cursor[id] as number;

      while (at < list.length && (list[at] as number) <= position) {
        at += 1;
      }

      cursor[id] = at;

      for (; at < list.length; at += 1) {
        const other = list[at] as number;

        if (size / (sizes[other] as number) < threshold) {
          break;
        }

        if (counts[other] === 0) {
          touched.push(other);
        }

        counts[other] = (counts[other] as number) + 1;
      }
    }

    for (const other of touched) {
      const intersection = counts[other] as number;
      const union = size + (sizes[other] as number) - intersection;

      counts[other] = 0;

      if (reaches(intersection, union, threshold)) {
        const a = index;
        const b = order[other] as number;

        pairs.push(
          a < b ? [a, b, intersection, union] : [b, a, intersection, union],
        );
      }
    }
  });

  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function roundSimilarity(score: number): number {
  const rounded = score.toFixed(3);
  const exact = score.toFixed(100);
  const tail = exact.slice(exact.indexOf(".") + 4);

  if (/^50*$/.test(tail)) {
    const truncated = exact.slice(0, exact.indexOf(".") + 4);
    const last = Number(truncated.slice(-1));

    return Number(last % 2 === 0 ? truncated : rounded);
  }

  return Number(rounded);
}

export function roundPercent(score: number): number {
  const percent = score * 100;
  const floor = Math.floor(percent);

  if (percent - floor === 0.5) {
    return floor % 2 === 0 ? floor : floor + 1;
  }

  return Math.round(percent);
}
