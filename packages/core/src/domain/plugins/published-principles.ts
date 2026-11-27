import type { Principle } from "../principles.js";
import type { InstalledPlugin } from "./installed-plugin.js";

export function publishedPrinciplesOf(
  plugins: readonly InstalledPlugin[],
): Principle[] {
  const sensors = plugins
    .filter((plugin) => plugin.kind === "sensor")
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const seen = new Set<string>();
  const merged: Principle[] = [];

  for (const sensor of sensors) {
    for (const principle of sensor.manifest.principles ?? []) {
      if (!seen.has(principle.id)) {
        seen.add(principle.id);
        merged.push(principle);
      }
    }
  }

  return merged;
}
