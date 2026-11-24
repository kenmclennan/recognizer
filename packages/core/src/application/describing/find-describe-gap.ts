import {
  lineStatus,
  type Responsibility,
} from "../../domain/describing/responsibility.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import type { LineKind } from "../../domain/scan-plan.js";
import type { StructureRepository } from "../../domain/structure-repository.js";
import { describeGap } from "./describe-gap.js";
import type { DescribingPorts } from "./internal/describing-ports.js";

export function findDescribeGap(
  ports: {
    structure: Pick<StructureRepository, "read">;
    describer: Pick<DescribingPorts["describer"], "locate">;
    responsibilities: {
      read(root: string): { get(id: string): Responsibility | undefined };
    };
  },
  root: string,
  modules: string[],
): string[] | null {
  const kinds = (kind: LineKind) => (): LineKind => kind;

  try {
    const located = ports.describer.locate(root);

    if (located.describer === null) {
      return null;
    }

    const describer = located.describer;
    const lines = ports.responsibilities.read(root);
    const hashes = ports.structure.read(root).scannedHashes();

    return describeGap((id): LineKind => {
      const entry = lines.get(id);

      if (entry === undefined) {
        return "missing";
      }

      const hash = hashes.get(id);

      if (hash === undefined) {
        return "out-of-date";
      }

      return lineStatus(entry, hash, describer.command, describer.version)
        .status === "current"
        ? "current"
        : "out-of-date";
    }, modules).stale;
  } catch (error) {
    if (!InvalidRequest.is(error)) {
      throw error;
    }

    return describeGap(kinds("unknown"), modules).stale;
  }
}
