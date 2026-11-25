import {
  type MarkerFacts,
  type ReportedResult,
  type Repository,
  RepositoryStateHolder,
  type SensorFindings,
} from "../../src/index.js";
import {
  createFakes,
  type Fakes,
  repositoryStateDependenciesOf,
} from "../fakes/container.js";
import { repositoryOf } from "../fakes/repository-of.js";

export const ROOT = "/work/repository";

export function holderOver(
  fakes: Fakes,
  root: string = ROOT,
): RepositoryStateHolder {
  return new RepositoryStateHolder(root, repositoryStateDependenciesOf(fakes));
}

export function fakesWith(...names: string[]): Fakes {
  const fakes = createFakes();

  for (const name of names) {
    fakes.sensors.installed.set(name, {
      name,
      runsTests: false,
      held: false,
      display: name.toUpperCase(),
    });
  }

  return fakes;
}

export function findingsOf(
  name: string,
  inputs: Record<string, string>,
  changes: Partial<SensorFindings> = {},
): SensorFindings {
  return {
    sensor: { name, version: "1" },
    commit: "c0ffee",
    modified: false,
    settings: {},
    reportedAt: "2026-11-24T10:01:00.000Z",
    findings: [],
    inputs,
    ...changes,
  };
}

export function reportedResult(
  changes: Partial<ReportedResult> = {},
): ReportedResult {
  return {
    findings: "findings:tally",
    overlay: null,
    inputsDigest: null,
    testsDigest: null,
    reportedAt: "2026-11-24T10:01:00.000Z",
    inputs: null,
    ...changes,
  };
}

export function structureOf(hashes: Record<string, string>): Repository {
  return repositoryOf(hashes, Object.keys(hashes));
}

export type { MarkerFacts };
