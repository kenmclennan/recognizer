import type { LineKind } from "../../domain/scan-plan.js";

export function describeGap(
  kindOf: (id: string) => LineKind,
  modules: string[],
): { stale: string[]; described: number } {
  const stale: string[] = [];
  let described = 0;

  for (const id of modules) {
    const kind = kindOf(id);

    if (kind === "current" || kind === "out-of-date") {
      described += 1;
    }

    if (kind === "out-of-date" || kind === "missing") {
      stale.push(id);
    }
  }

  return { stale, described };
}
