import type { Finding } from "../../domain/finding.js";
import type { Repository } from "../../domain/repository.js";
import type { Measured } from "../../domain/scan-plan.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import { splitFindings } from "../analysis/split-findings.js";

export type { Measured };

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

export function buildFreshness(
  repository: Repository,
  tests: string | null = null,
): Freshness {
  const hashes = repository.scannedHashes();

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

export type DocumentFreshness = {
  valid: boolean;
  current: string[];
  recorded: string[];
  outOfDate: number;
  stale: boolean;
};

export function documentFreshness(
  repository: Repository,
  measured: Measured,
  tests: string | null,
): DocumentFreshness {
  const freshness = buildFreshness(repository, tests);
  const hashes = repository.scannedHashes();
  const valid = freshness.valid(measured);
  const outOfDate = freshness.counts(measured, []).outOfDate;

  return {
    valid,
    current: [...hashes.keys()].filter((module) =>
      freshness.current(measured, module),
    ),
    recorded: Object.keys(measured.inputs ?? {}).filter((module) =>
      hashes.has(module),
    ),
    outOfDate,
    stale: !valid || outOfDate > 0,
  };
}

export function splitDocument(
  repository: Repository,
  document: SensorFindings,
  tests: string | null,
): { shown: Finding[]; hidden: Finding[] } {
  const { current, hidden } = splitFindings(
    document,
    buildFreshness(repository, tests),
  );

  return { shown: current, hidden };
}
