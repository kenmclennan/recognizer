import type { Repository } from "@recognizer/core";
import type {
  LineKind,
  Measured,
  PlanRequest,
  ScanPlanView,
  SensorRow,
} from "./scan-freshness";

export type { PlanRequest, ScanPlanView, SensorRow };

export type LoadedPlanData = {
  scans: Repository;
  measured: Record<string, Measured | null>;
  tests: string | null;
  describerRegistered: boolean;
  lineKinds: (id: string) => LineKind;
  sensors: SensorRow[];
};

export function planReads(data: LoadedPlanData) {
  const modules = data.scans.files.map(({ path }) => path);
  const lines = {
    registered: data.describerRegistered,
    kinds: Object.fromEntries(modules.map((id) => [id, data.lineKinds(id)])),
  };

  return {
    structure: {
      read: () => data.scans,
      responsibilityKinds: () => lines,
    },
    findings: {
      measuredOf: (_root: string, sensor: string) =>
        data.measured[sensor] ?? null,
      testsDigest: () => data.tests,
    },
    sensors: { registered: () => data.sensors },
  };
}

export function latestPlanOnly(
  ask: (request: PlanRequest) => Promise<ScanPlanView>,
): (request: PlanRequest) => Promise<ScanPlanView | null> {
  let latest = 0;

  return async (request) => {
    latest += 1;

    const mine = latest;
    const view = await ask(request);

    return mine === latest ? view : null;
  };
}
