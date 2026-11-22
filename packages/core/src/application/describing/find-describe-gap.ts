import type { Store } from "../shared/ports/store.js";
import { describeGap } from "./describe-gap.js";

export function findDescribeGap(
  ports: { store: Pick<Store, "responsibilityKinds"> },
  root: string,
  modules: string[],
): string[] | null {
  const lines = ports.store.responsibilityKinds(root);

  if (!lines.registered) {
    return null;
  }

  return describeGap((id) => lines.kinds[id] ?? "missing", modules).stale;
}
