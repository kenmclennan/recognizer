import type { Finding } from "../../domain/finding.js";
import type { StoredFindings } from "../../domain/findings-repository.js";
import type { Repository } from "../../domain/repository.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import {
  buildFreshness,
  type Freshness,
  type Measured,
} from "../sensing/freshness.js";
import { splitFindings } from "./split-findings.js";
import { currentTestsHash, type TestsHashPorts } from "./tests-hash.js";

export type ReadOutcome =
  | {
      name: string;
      status: "read";
      document: SensorFindings;
      hidden: Finding[];
      valid: boolean;
      reported?: true;
    }
  | { name: string; status: "invalid"; reason: string }
  | { name: string; status: "unregistered" };

export function freshnessFor(
  ports: TestsHashPorts,
  root: string,
  repository: Repository,
): (measured: Measured) => Freshness {
  let tests: string | null | undefined;

  return (measured) => {
    if (measured.tests !== undefined && tests === undefined) {
      tests = currentTestsHash(ports, root, repository);
    }

    return buildFreshness(repository, tests ?? null);
  };
}

export function readFindingsFiles(
  stored: StoredFindings[],
  freshnessOf: (measured: Measured) => Freshness,
  skip: string[] = [],
  allowed: string[] | null = null,
): ReadOutcome[] {
  return stored
    .filter(({ name }) => !skip.includes(name))
    .map((entry): ReadOutcome => {
      const { name } = entry;
      const outside = allowed !== null && !allowed.includes(name);

      if (entry.status === "invalid") {
        return outside
          ? { name, status: "unregistered" }
          : { name, status: "invalid", reason: entry.reason };
      }

      const { document } = entry;

      if (
        outside &&
        (name === "structure" || document.reportedAt === undefined)
      ) {
        return { name, status: "unregistered" };
      }

      const reported = outside ? { reported: true as const } : {};
      const freshness = freshnessOf(document);
      const { current, hidden } = splitFindings(document, freshness);

      return {
        name,
        status: "read",
        document: { ...document, findings: current },
        hidden,
        valid: freshness.valid(document),
        ...reported,
      };
    });
}
