import type { StructureRepository } from "../../domain/structure-repository.js";
import { describeGap } from "./describe-gap.js";

export function findDescribeGap(
  ports: { structure: Pick<StructureRepository, "responsibilityKinds"> },
  root: string,
  modules: string[],
): string[] | null {
  const lines = ports.structure.responsibilityKinds(root);

  if (!lines.registered) {
    return null;
  }

  return describeGap((id) => lines.kinds[id] ?? "missing", modules).stale;
}
