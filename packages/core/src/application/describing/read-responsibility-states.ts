import {
  type LineStatusReason,
  lineStatus,
} from "../../domain/describing/responsibility.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import type { StructureRepository } from "../../domain/structure-repository.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import type { Describer } from "./ports/describer.js";

export type ResponsibilityStateView =
  | { kind: "current"; line: string }
  | { kind: "out-of-date"; line: string; reasons: LineStatusReason[] }
  | { kind: "missing" }
  | { kind: "unknown"; reason: string };

export interface ResponsibilityStatesView {
  states: Record<string, ResponsibilityStateView>;
  describedAtMs: number | null;
}

export interface ResponsibilityStatePorts {
  structure: Pick<StructureRepository, "read">;
  describer: Pick<Describer, "locate">;
  responsibilities: Pick<DescribingPorts["responsibilities"], "read">;
}

export function readResponsibilityStates(
  ports: ResponsibilityStatePorts,
  request: {
    root: string;
    modules: string[];
    describedAtMs: number | null;
  },
): ResponsibilityStatesView {
  const { root, modules, describedAtMs } = request;
  const states: Record<string, ResponsibilityStateView> = {};

  try {
    const lines = ports.responsibilities.read(root);
    const describer = ports.describer.locate(root).describer;
    const hashes = ports.structure.read(root).scannedHashes();

    for (const id of modules) {
      const entry = lines.get(id);

      if (entry === undefined) {
        states[id] = { kind: "missing" };
      } else if (describer === null) {
        states[id] = {
          kind: "out-of-date",
          line: entry.line,
          reasons: ["describer", "version"],
        };
      } else {
        const hash = hashes.get(id);
        const status =
          hash === undefined
            ? null
            : lineStatus(entry, hash, describer.command, describer.version);

        states[id] =
          status === null
            ? { kind: "out-of-date", line: entry.line, reasons: ["source"] }
            : status.status === "out-of-date"
              ? {
                  kind: "out-of-date",
                  line: entry.line,
                  reasons: status.reasons,
                }
              : { kind: "current", line: entry.line };
      }
    }
  } catch (error) {
    if (!InvalidRequest.is(error)) {
      throw error;
    }

    const reason = error.messages.join("; ");

    for (const id of modules) {
      states[id] = { kind: "unknown", reason };
    }
  }

  return { states, describedAtMs };
}
