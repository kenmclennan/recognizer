import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scan } from "recognizer";
import type { LoadedScan } from "./scan-loading";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function fixtureScan(name: string, file = "scan.json"): LoadedScan {
  const text = readFileSync(join(REPO, "fixtures", name, file), "utf8");

  return { file: "scan.python.json", scan: JSON.parse(text) as Scan };
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
