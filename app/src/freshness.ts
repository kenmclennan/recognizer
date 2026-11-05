import type { Scan } from "recognizer";

type Hashed = { files?: { path: string; hash: string }[] };

export type Measured = { inputs?: Record<string, string>; tests?: string };

export type Freshness = {
  valid(measured: Measured): boolean;
  current(measured: Measured, module: string): boolean;
  moduleOf(key: string): string;
  counts(
    measured: Measured,
    valueKeys: Iterable<string>,
  ): { outOfDate: number; total: number };
};

export function moduleOf(key: string): string {
  const at = key.indexOf("::");

  return at === -1 ? key : key.slice(0, at);
}

export function scanHashes(scans: readonly Scan[]): Map<string, string> {
  const hashes = new Map<string, string>();

  for (const scan of scans) {
    for (const file of (scan as Hashed).files ?? []) {
      hashes.set(file.path, file.hash);
    }
  }

  return hashes;
}

export function buildFreshness(
  scans: readonly Scan[],
  tests: string | null = null,
): Freshness {
  const hashes = scanHashes(scans);

  const valid = (measured: Measured) =>
    measured.inputs !== undefined &&
    (measured.tests === undefined || measured.tests === tests);

  const current = (measured: Measured, module: string) => {
    const hash = hashes.get(module);

    return (
      valid(measured) &&
      hash !== undefined &&
      measured.inputs?.[module] === hash
    );
  };

  return {
    valid,
    current,
    moduleOf,
    counts(measured, valueKeys) {
      const modules =
        measured.inputs === undefined
          ? new Set([...valueKeys].map(moduleOf))
          : new Set(Object.keys(measured.inputs));
      const listed = [...modules].filter((module) => hashes.has(module));

      return {
        outOfDate: listed.filter((module) => !current(measured, module)).length,
        total: listed.length,
      };
    },
  };
}
