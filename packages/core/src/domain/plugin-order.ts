export const CORE_ENTRIES = ["structure", "analysis", "suites"] as const;

export interface Ordered {
  name: string;
  display: string;
}

export function comparePlugins(a: Ordered, b: Ordered): number {
  return (
    a.display.toLowerCase().localeCompare(b.display.toLowerCase()) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}
