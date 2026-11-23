import { join } from "node:path";
import {
  readFindingsFiles as classifyFindings,
  type Freshness,
  type Measured,
  type ReadOutcome,
  type SensorFindings,
  type StoredFindings,
} from "@recognizer/core";
import {
  readSensorFindings,
  sensorFindingsDocument,
} from "./adapters/filesystem/findings-translator.js";
import type { Io } from "./cli.js";

export type { ReadOutcome };

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

export function readStoredFindings(io: Io, root: string): StoredFindings[] {
  let names: string[];

  try {
    names = io
      .readDir(findingsFolder(root))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }

  return names.map((name): StoredFindings => {
    try {
      return {
        name,
        status: "read",
        document: readSensorFindings(
          JSON.parse(io.readFile(findingsFile(root, name))),
          { name },
        ),
      };
    } catch (error) {
      return { name, status: "invalid", reason: (error as Error).message };
    }
  });
}

export function readFindingsFiles(
  io: Io,
  root: string,
  freshnessOf: (measured: Measured) => Freshness,
  skip: string[] = [],
  allowed: string[] | null = null,
): ReadOutcome[] {
  return classifyFindings(
    readStoredFindings(io, root),
    freshnessOf,
    skip,
    allowed,
  );
}
