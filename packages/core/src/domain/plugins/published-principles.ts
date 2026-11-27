import type { Principle } from "../principles.js";
import type { InstalledPlugin } from "./installed-plugin.js";

export function mergePublishedPrinciples(
  sources: readonly { name: string; principles?: readonly Principle[] }[],
): Principle[] {
  const sorted = [...sources].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const seen = new Set<string>();
  const merged: Principle[] = [];

  for (const source of sorted) {
    for (const principle of source.principles ?? []) {
      if (!seen.has(principle.id)) {
        seen.add(principle.id);
        merged.push(principle);
      }
    }
  }

  return merged;
}

export function publishedPrinciplesOf(
  plugins: readonly InstalledPlugin[],
): Principle[] {
  return mergePublishedPrinciples(
    plugins
      .filter((plugin) => plugin.kind === "sensor")
      .map((plugin) => ({
        name: plugin.name,
        principles: plugin.manifest.principles,
      })),
  );
}
