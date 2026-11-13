import type { PlannedWork } from "./scan-estimate";
import type { SensorsPort, WorkRequest } from "./sensor-run";

export type WorkScope = WorkRequest & { stamp: string };

type Slot = { state: "pending" } | { state: "done"; work: PlannedWork | null };

export type PlannedWorkCache = {
  ensure(scope: WorkScope): void;
  answers(scopes: readonly WorkScope[]): Record<string, PlannedWork>;
};

export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;

  for (let at = 0; at < text.length; at += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

export function workKey(scope: WorkScope): string {
  return JSON.stringify([
    scope.sensor,
    scope.modules === null ? null : [...scope.modules].sort(),
    scope.suites === null ? null : [...scope.suites].sort(),
    scope.stamp,
  ]);
}

export function createPlannedWork(
  port: Pick<SensorsPort, "plannedWork">,
  changed: () => void,
): PlannedWorkCache {
  const slots = new Map<string, Slot>();

  return {
    ensure(scope) {
      const key = workKey(scope);

      if (slots.has(key)) {
        return;
      }

      slots.set(key, { state: "pending" });

      const { stamp: _stamp, ...request } = scope;

      port
        .plannedWork(request)
        .catch(() => null)
        .then((work) => {
          slots.set(key, { state: "done", work });
          changed();
        });
    },
    answers(scopes) {
      const found: Record<string, PlannedWork> = {};

      for (const scope of scopes) {
        const slot = slots.get(workKey(scope));

        if (slot?.state === "done" && slot.work !== null) {
          found[scope.sensor] = slot.work;
        }
      }

      return found;
    },
  };
}
