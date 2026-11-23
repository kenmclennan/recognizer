import { join } from "node:path";
import type { Repository } from "@recognizer/core";
import type { Io } from "./cli.js";
import type { FindingRecord } from "./findings-document.js";
import {
  type MetricDeclaration,
  type Overlay,
  validateOverlay,
} from "./overlays.js";
import { scanHashes } from "./result-freshness.js";

export const STRUCTURE_OVERLAY_METRICS: MetricDeclaration[] = [
  { name: "complexity", type: "count", granularity: "member", bad: "high" },
  {
    name: "function_length",
    type: "count",
    granularity: "member",
    bad: "high",
  },
  { name: "duplication", type: "count", granularity: "module", bad: "high" },
];

export function structureOverlayFile(root: string): string {
  return join(root, ".recognizer", "cache", "overlays", "structure.json");
}

export interface StructureMeasures {
  commit: string;
  modified: boolean;
  version: string;
  repository: Repository;
  complexity: Record<string, number> | null;
  functionLength: Record<string, number>;
  duplication: FindingRecord[] | null;
}

export function duplicatedLines(
  findings: readonly FindingRecord[],
): Record<string, number> {
  const lines = new Map<string, Set<number>>();

  for (const finding of findings) {
    for (const member of finding.evidence.members ?? []) {
      if (member.lines === undefined) {
        continue;
      }

      const held = lines.get(member.module) ?? new Set<number>();

      for (let line = member.lines[0]; line <= member.lines[1]; line += 1) {
        held.add(line);
      }

      lines.set(member.module, held);
    }
  }

  return Object.fromEntries(
    [...lines].map(([module, held]) => [module, held.size]),
  );
}

function moduleOfKey(key: string): string {
  const at = key.indexOf("::");

  return at === -1 ? key : key.slice(0, at);
}

export function buildStructureOverlay(measures: StructureMeasures): Overlay {
  const hashes = scanHashes(measures.repository);
  const duplication =
    measures.duplication === null
      ? null
      : duplicatedLines(measures.duplication);
  const values: Overlay["values"] = {};

  if (measures.complexity !== null) {
    values.complexity = measures.complexity;
  }

  values.function_length = measures.functionLength;

  if (duplication !== null) {
    values.duplication = duplication;
  }

  const measured = new Set(
    Object.values(values).flatMap((byId) => Object.keys(byId).map(moduleOfKey)),
  );
  const inputs: Record<string, string> = {};

  for (const module of [...measured].sort()) {
    const hash = hashes.get(module);

    if (hash !== undefined) {
      inputs[module] = hash;
    }
  }

  return {
    overlay_version: 2,
    commit: measures.commit,
    modified: measures.modified,
    producer: { name: "recognizer", version: measures.version },
    inputs,
    metrics: STRUCTURE_OVERLAY_METRICS.map((metric) => ({ ...metric })),
    values,
  };
}

export function writeStructureOverlay(
  io: Io,
  root: string,
  overlay: Overlay,
): void {
  validateOverlay(overlay, {
    commit: overlay.commit,
    modified: overlay.modified,
    metrics: STRUCTURE_OVERLAY_METRICS,
  });

  const target = structureOverlayFile(root);
  const temp = `${target}.tmp`;

  try {
    io.writeFile(temp, `${JSON.stringify(overlay, null, 2)}\n`);
    io.rename(temp, target);
  } catch (error) {
    io.remove(temp);

    throw error;
  }
}
