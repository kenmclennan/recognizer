import type { Loaded } from "./scan-loading";

function sensed(loaded: Loaded): string {
  return JSON.stringify([
    loaded.policy,
    loaded.baseline,
    loaded.findings,
    loaded.sensors,
    loaded.overlays ?? null,
    loaded.overlaysUnreadable ?? null,
  ]);
}

export function loadedUnchanged(
  previous: Loaded | null,
  next: Loaded,
): boolean {
  return previous !== null && sensed(previous) === sensed(next);
}

export function sameStructure(previous: Loaded | null, next: Loaded): boolean {
  return (
    previous !== null &&
    JSON.stringify([previous.modules, previous.scans]) ===
      JSON.stringify([next.modules, next.scans])
  );
}
