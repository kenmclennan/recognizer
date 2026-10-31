import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FindingsDocument,
  parsePolicy,
  type Scan,
  structureSensor,
} from "recognizer";
import type { LoadedScan } from "./scan-loading";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function fixtureScan(
  name: string,
  file = "scan.json",
  commit: string | null = null,
): LoadedScan {
  const text = readFileSync(join(REPO, "fixtures", name, file), "utf8");
  const scan = { ...JSON.parse(text), commit } as Scan;

  return { file: "scan.python.json", scan };
}

export function fixturePolicy(name: string): string {
  return readFileSync(
    join(REPO, "fixtures", name, ".recognizer/policy.yaml"),
    "utf8",
  );
}

export function fixtureBaseline(name: string): string {
  return readFileSync(
    join(REPO, "fixtures", name, ".recognizer/baselines/violations.json"),
    "utf8",
  );
}

export function expectedModuleIds(language: string): string[] {
  const text = readFileSync(
    join(REPO, "fixtures", language, "expected-scan.json"),
    "utf8",
  );

  return (JSON.parse(text) as Scan).modules.map((module) => module.id);
}

export function expectedScan(language: string): Scan {
  const text = readFileSync(
    join(REPO, "fixtures", language, "expected-scan.json"),
    "utf8",
  );

  return JSON.parse(text) as Scan;
}

export const CURRENT = "abc1234";

export function structureDocument(
  name: string,
  policyText: string | null,
  commit = CURRENT,
): FindingsDocument {
  const { scan } = fixtureScan(name, "scan.json", commit);
  const policy = policyText === null ? null : parsePolicy(policyText);
  const { document } = structureSensor(
    [scan],
    policy,
    {
      hub_threshold: 10,
      warnings: { cycle: true, hub: true },
    },
    { commit, modified: false },
  );

  return document;
}

export function secondSensorDocument(
  module: string,
  summary = "too many magic numbers",
  principle = "name-your-constants",
  commit = CURRENT,
): FindingsDocument {
  return {
    findings_version: 1,
    sensor: { name: "lint", version: "1" },
    commit,
    modified: false,
    settings: {},
    findings: [
      {
        id: `magic:${module}`,
        kind: "magic-numbers",
        severity: "warning",
        principle,
        summary,
        evidence: { modules: [module] },
      },
    ],
  };
}
