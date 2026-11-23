import { join } from "node:path";
import type { Finding, SensorFindings } from "@recognizer/core";
import {
  readSensorFindings,
  sensorFindingsDocument,
} from "./adapters/filesystem/findings-translator.js";
import type { DirEntry, Io } from "./cli.js";
import {
  type Freshness,
  type Measured,
  splitFindings,
} from "./result-freshness.js";

export function findingsFolder(root: string): string {
  return join(root, ".recognizer", "cache", "findings");
}

export function findingsFile(root: string, name: string): string {
  return join(findingsFolder(root), `${name}.json`);
}

export function writeFindings(
  io: Io,
  root: string,
  findings: SensorFindings,
): void {
  const target = findingsFile(root, findings.sensor.name);
  const temp = `${target}.tmp`;

  try {
    io.writeFile(
      temp,
      `${JSON.stringify(sensorFindingsDocument(findings), null, 2)}\n`,
    );
    io.rename(temp, target);
  } catch (error) {
    io.remove(temp);

    throw error;
  }
}

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

function listed(io: Io, root: string): string[] {
  let entries: DirEntry[];

  try {
    entries = io.readDir(findingsFolder(root));
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .sort();
}

export function readFindingsFiles(
  io: Io,
  root: string,
  freshnessOf: (measured: Measured) => Freshness,
  skip: string[] = [],
  allowed: string[] | null = null,
): ReadOutcome[] {
  return listed(io, root)
    .filter((name) => !skip.includes(name))
    .map((name): ReadOutcome => {
      const outside = allowed !== null && !allowed.includes(name);
      let document: SensorFindings;

      try {
        document = readSensorFindings(
          JSON.parse(io.readFile(findingsFile(root, name))),
          { name },
        );
      } catch (error) {
        return outside
          ? { name, status: "unregistered" }
          : { name, status: "invalid", reason: (error as Error).message };
      }

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
