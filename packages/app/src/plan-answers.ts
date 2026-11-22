import { type LoadedPlanData, latestPlanOnly } from "./plan-reads";
import { fingerprint } from "./planned-work";
import type { PlanRequest, ScanPlanView } from "./scan-freshness";
import type { PlanAnswer } from "./scan-panel-model";

export type PlanAnswers = {
  ask(request: PlanRequest, stamp?: string): void;
  answerFor(request: PlanRequest, stamp?: string): PlanAnswer | null;
};

export function planStampOf(facts: LoadedPlanData): string {
  const lines = facts.scans.flatMap((scan) =>
    scan.modules.map(({ id }) => `${id}=${facts.lineKinds(id)}`),
  );
  const hashes = facts.scans.flatMap((scan) =>
    (scan.files ?? []).map(({ path, hash }) => `${path}:${hash}`),
  );

  return fingerprint(
    JSON.stringify([
      facts.measured,
      facts.tests,
      facts.describerRegistered,
      facts.sensors,
      lines,
      hashes,
    ]),
  );
}

function keyOf(request: PlanRequest, stamp: string): string {
  return `${stamp}|${JSON.stringify(request)}`;
}

const KEPT = 32;

function slotOf(request: PlanRequest): string {
  return `${request.mode}:${request.scope === null ? "all" : "scoped"}`;
}

export function createPlanAnswers(
  plan: (request: PlanRequest) => Promise<ScanPlanView>,
  changed: () => void,
): PlanAnswers {
  const answers = new Map<string, ScanPlanView>();
  const asked = new Set<string>();
  const lastOfSlot = new Map<string, ScanPlanView>();
  const guards = new Map<
    string,
    (request: PlanRequest) => Promise<ScanPlanView | null>
  >();

  function guardOf(slot: string) {
    let guard = guards.get(slot);

    if (guard === undefined) {
      guard = latestPlanOnly(plan);
      guards.set(slot, guard);
    }

    return guard;
  }

  return {
    ask(request, stamp = "") {
      const key = keyOf(request, stamp);

      if (asked.has(key)) {
        return;
      }

      asked.add(key);

      const slot = slotOf(request);

      guardOf(slot)(request)
        .then((view) => {
          if (view === null) {
            asked.delete(key);

            return;
          }

          answers.set(key, view);
          lastOfSlot.set(slot, view);

          if (answers.size > KEPT) {
            const oldest = answers.keys().next().value as string;

            answers.delete(oldest);
            asked.delete(oldest);
          }

          changed();
        })
        .catch(() => {
          asked.delete(key);
        });
    },
    answerFor(request, stamp = "") {
      const exact = answers.get(keyOf(request, stamp));

      if (exact !== undefined) {
        return { view: exact, settled: true };
      }

      const last = lastOfSlot.get(slotOf(request));

      return last === undefined ? null : { view: last, settled: false };
    },
  };
}
